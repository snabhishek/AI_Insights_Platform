import { RunnableConfig } from "@langchain/core/runnables";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { AgentState, IngestionServices } from "../../state";
import { createGetSchemaTool, createInspectTool } from "../../tools/inspection";
import {
  getModel,
  getInspectionSystemPrompt,
  chunkInspectionTableNames,
  buildBatchedTableState,
  buildInspectionBatchUserMessage,
  mergeInspectionPayload,
  mergeBatchedTableStates,
  extractModelText,
  parseJsonObject,
  getLatestAgentMessage,
  getLastToolResult,
  InspectionPayload,
  logMilestoneThinking,
  logAgentMessagesAsThinking,
  invokeAgentJson
} from "../../utils/agentUtils";
import { createAgent } from "langchain";
import { HumanMessage } from "@langchain/core/messages";

const INSPECTION_INITIAL_BATCH_SIZE = 10;
const INSPECTION_FOLLOW_UP_BATCH_SIZE = 5;

export async function runInspectorWithTools(connector: any, services: IngestionServices): Promise<any> {
  const inspectTool = createInspectTool(services.fileService, services.connectorService, connector);
  const schemaTool = createGetSchemaTool(services.connectionTester, services.connectorService, connector);
  const model = getModel();
  const connectionConfig = connector.connectionConfig || {};
  const safeConnector = {
    ...connector,
    connectionConfig: {
      ...connectionConfig,
      password: connectionConfig.password ? "***" : undefined,
    },
  };

  if (!model) {
    const inspectionPayload = await inspectTool.invoke({
      connectorId: connector.id,
      connectorType: connector.type,
      maxTables: 50,
      maxColumns: 200,
    }) as Record<string, unknown>;
    return {
      connectorId: connector.id,
      connectorName: connector.name,
      batchedTables: [],
      ...inspectionPayload,
    };
  }

  const inspectionPrompt = await getInspectionSystemPrompt();
  const inspectAgentTool = tool(
    async ({
      connectorId,
      connectorType,
      tableNames,
      maxTables,
      maxColumns,
    }: {
      connectorId?: string;
      connectorType?: string;
      tableNames?: string[];
      maxTables?: number;
      maxColumns?: number;
    }) => inspectTool.invoke({
      connectorId: connectorId || connector.id,
      connectorType: connectorType || connector.type,
      tableNames,
      maxTables: typeof maxTables === "number" && maxTables > 0 ? maxTables : 50,
      maxColumns: typeof maxColumns === "number" && maxColumns > 0 ? maxColumns : 200,
    }),
    {
      name: "inspectDataSource",
      description: "Inspect a connector source and return table fields, data types, constraints, and relationships.",
      schema: z.object({
        connectorId: z.string().optional().describe("Connector ID used to resolve the stored connection settings"),
        connectorType: z.string().optional().describe("Connector type fallback when connectorId is unavailable"),
        tableNames: z.array(z.string()).optional().describe("Specific tables to inspect for column/constraint details"),
        maxTables: z.number().optional().describe("Maximum tables to list when tableNames is not provided"),
        maxColumns: z.number().optional().describe("Maximum columns per table in detailed inspection"),
      }),
    }
  );

  let schemaDetails: { success?: boolean; type?: string; tables?: Array<Record<string, unknown>> } | undefined;
  try {
    console.info(`[Workflow] Step [Data Inspection] Connecting to database & querying table list for connector "${connector.name}"...`);
    await logMilestoneThinking(services, "Data Inspection", `Querying schema tables list for connector "${connector.name}"...`);
    schemaDetails = await schemaTool.invoke({
      connectorId: connector.id,
      connectorType: connector.type,
    }) as { success?: boolean; type?: string; tables?: Array<Record<string, unknown>> };
    if (schemaDetails?.tables) {
      console.info(`[Workflow] Step [Data Inspection] Discovered ${schemaDetails.tables.length} tables in data source.`);
      await logMilestoneThinking(services, "Data Inspection", `Discovered ${schemaDetails.tables.length} tables in data source.`);
    }
  } catch (error) {
    console.warn("Schema tool inspection failed, continuing without table context", error);
  }

  const tableList = Array.isArray(schemaDetails?.tables)
    ? schemaDetails.tables.map((table: Record<string, unknown>) => ({
      name: table.name || table.tableName || table.id || "unknown",
      type: table.type || table.tableType || "unknown",
    }))
    : [];
  const schemaType = schemaDetails?.type || "unknown";
  const tableNames = tableList
    .map((table) => typeof table.name === "string" ? table.name : "")
    .filter((tableName) => tableName.trim().length > 0);

  if (tableNames.length === 0) {
    const inspectionPayload = await inspectTool.invoke({
      connectorId: connector.id,
      connectorType: connector.type,
      maxTables: 50,
      maxColumns: 200,
    }) as Record<string, unknown>;
    return {
      connectorId: connector.id,
      connectorName: connector.name,
      ...inspectionPayload,
    };
  }

  const schemaSummary = {
    type: schemaType,
    tableCount: tableList.length,
  };
  const batches = chunkInspectionTableNames(tableNames, INSPECTION_INITIAL_BATCH_SIZE, INSPECTION_FOLLOW_UP_BATCH_SIZE);
  const inspectionTableStatuses = batches.flatMap((batchTableNames, batchIndex) => buildBatchedTableState(
    batchTableNames,
    "inspect",
    "analysed",
    `Analyzed in inspection batch ${batchIndex + 1}/${batches.length}`
  ));

  let accumulatedInspection: InspectionPayload = {
    connectorId: connector.id,
    connectorName: connector.name,
    schemaType,
    tableCount: tableNames.length,
    tables: [],
  };
  let lastToolResult: Record<string, unknown> | undefined;

  for (const [batchIndex, batchTableNames] of batches.entries()) {
    await logMilestoneThinking(services, "Data Inspection", `Extracting table schema metadata for batch ${batchIndex + 1}/${batches.length}: [${batchTableNames.join(", ")}]...`);
    
    // 1. Direct fast schema & constraint extraction from DB/file (~100ms)
    let directBatchInspection: InspectionPayload;
    try {
      directBatchInspection = await inspectTool.invoke({
        connectorId: connector.id,
        connectorType: connector.type,
        tableNames: batchTableNames,
        maxColumns: 200,
      }) as InspectionPayload;
    } catch (err) {
      console.warn(`[inspectorNode] Direct inspection failed for batch ${batchIndex + 1}:`, err);
      directBatchInspection = {
        connectorId: connector.id,
        connectorName: connector.name,
        schemaType,
        tableCount: batchTableNames.length,
        tables: batchTableNames.map((name) => ({ tableName: name, columns: [] })),
      };
    }

    let parsedBatchPayload: InspectionPayload = directBatchInspection;

    // 2. Single-pass LLM metadata enrichment for semantic descriptions & business meaning (~500ms)
    if (model && directBatchInspection && Array.isArray(directBatchInspection.tables) && directBatchInspection.tables.length > 0) {
      try {
        const userMessage = buildInspectionBatchUserMessage({
          safeConnector,
          schemaSummary,
          batchTableNames,
          batchIndex,
          totalBatches: batches.length,
          previousAnalysis: directBatchInspection,
        });

        const enrichedResult = await invokeAgentJson(
          "inspect",
          model,
          userMessage,
          directBatchInspection,
          services,
          {
            systemPrompt: inspectionPrompt,
            traceLabel: `inspect:${connector.type}:batch-${batchIndex + 1}`,
            tools: [inspectAgentTool],
          }
        );
        if (enrichedResult && Array.isArray(enrichedResult.tables) && enrichedResult.tables.length > 0) {
          parsedBatchPayload = enrichedResult as InspectionPayload;
        }
      } catch (err) {
        console.warn(`[inspectorNode] LLM enrichment skipped for batch ${batchIndex + 1}, using direct schema`, err);
      }
    }

    accumulatedInspection = mergeInspectionPayload(
      accumulatedInspection,
      parsedBatchPayload,
      connector,
      schemaType,
      tableNames.length
    );
  }

  if (Array.isArray(accumulatedInspection.tables) && accumulatedInspection.tables.length > 0) {
    return {
      ...accumulatedInspection,
      batchedTables: inspectionTableStatuses,
    };
  }

  if (lastToolResult) {
    return {
      connectorId: connector.id,
      connectorName: connector.name,
      batchedTables: inspectionTableStatuses,
      ...lastToolResult,
    };
  }

  const schema = schemaDetails || await schemaTool.invoke({
    connectorId: connector.id,
    connectorType: connector.type,
  }) as { success?: boolean; type?: string; tables?: Array<Record<string, unknown>> };

  return {
    connectorId: connector.id,
    connectorName: connector.name,
    batchedTables: inspectionTableStatuses,
    schemaType: schema?.type || "unknown",
    tableCount: Array.isArray(schema?.tables) ? schema.tables.length : 0,
    tables: Array.isArray(schema?.tables) ? schema.tables : [],
    notes: "Fallback schema used; limited column details.",
  };
}

export async function inspectorNode(state: typeof AgentState.State, config?: RunnableConfig) {
  const services = config?.configurable?.services as IngestionServices;
  if (!services) {
    throw new Error("Services dependency is not provided in config");
  }
  const { connectorService } = services;
  const connectors = await Promise.all(state.connectorId.map(async (connectorId) => await connectorService.getById(connectorId)));
  const validConnectors = connectors.filter((connector) => !!connector);
  if (validConnectors.length === 0) {
    return {
      status: "failed",
      summary: "Connector not found",
      steps: [{ name: "Inspector", status: "failed", summary: "Connector not found" }],
      stageStatuses: { inspect: "Failed" },
    };
  }
  const inspections = await Promise.all(validConnectors.map(async (connector) => await runInspectorWithTools(connector, services)));
  const batchedTables = inspections.flatMap((inspection: any) => Array.isArray(inspection?.batchedTables) ? inspection.batchedTables : []);
  return {
    inspection: { sources: inspections },
    batchedTables: mergeBatchedTableStates(state.batchedTables, batchedTables),
    status: "running",
    summary: "Inspection completed",
    steps: [{ name: "Inspector", status: "completed", summary: "Source inspection finished" }],
    stageOutputs: { inspect: { sources: inspections } },
    stageStatuses: { inspect: "Completed" },
  };
}
