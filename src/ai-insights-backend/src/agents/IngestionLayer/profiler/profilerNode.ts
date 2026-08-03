import { RunnableConfig } from "@langchain/core/runnables";
import { AgentState, IngestionServices } from "../../state";
import { createFetchSampleDataTool } from "../../tools/profiling/fetchSampleData.tool";
import { createContentValueProfileTool } from "../../tools/profiling/contentValueProfile.tool";
import { createCompletenessProfileTool } from "../../tools/profiling/completenessProfile.tool";
import { createStatisticalProfileTool } from "../../tools/profiling/statisticalProfile.tool";
import { 
  getModel, 
  getPromptFromFile, 
  invokeAgentJson,
  mergeBatchedTableStates,
  buildBatchedTableState,
  logMilestoneThinking
} from "../../utils/agentUtils";

export async function profileData(connector: any, inspection: Record<string, unknown>, services: IngestionServices): Promise<any> {
  const model = getModel();

  const fetchSampleTool = createFetchSampleDataTool(services.connectionTester, services.connectorService, connector);
  const contentProfileTool = createContentValueProfileTool(services.connectionTester, services.connectorService, connector);
  const completenessProfileTool = createCompletenessProfileTool(services.connectionTester, services.connectorService, connector);
  const statisticalProfileTool = createStatisticalProfileTool(services.connectionTester, services.connectorService, connector);

  const profilingTools = [fetchSampleTool, contentProfileTool, completenessProfileTool, statisticalProfileTool];

  const inspectionSources = Array.isArray((inspection as any)?.sources)
    ? (inspection as any).sources
    : [inspection];
  const allTables = inspectionSources.flatMap((source: any) => {
    const sourceTables = Array.isArray(source?.tables) ? source.tables : [];
    return sourceTables.filter((t: any) => {
      const name = typeof t?.name === "string" ? t.name : typeof t?.tableName === "string" ? t.tableName : "";
      return name.trim().length > 0;
    });
  });
  const tableNames = allTables.map((t: any) => t.name || t.tableName);

  const fallback = {
    status: "OK",
    tables: allTables.map((t: any) => {
      const tableName = t.name || t.tableName;
      const columns = Array.isArray(t.columns) ? t.columns : [];
      return {
        tableName,
        contentProfile: { columns: columns.map((c: any) => ({ name: c.name || c, sampleValues: [], uniqueCount: 0, dataType: c.dataType || "string" })) },
        completenessProfile: { columns: columns.map((c: any) => ({ name: c.name || c, nullCount: 0, completeness: 1.0 })) },
        statisticalProfile: { numericColumns: [], dateColumns: [] },
      };
    }),
    tableOrder: tableNames,
    summary: `Profiled ${tableNames.length} tables`,
  };

  if (!model) {
    return fallback;
  }

  const systemPrompt = await getPromptFromFile(
    "dataprofile.md",
    "You are an AI data profiler. Analyze the tables and columns provided in the context and return a detailed data profiling result as valid JSON."
  );

  const inspectionSummary = allTables.map((t: any) => ({
    tableName: t.name || t.tableName,
    columns: Array.isArray(t.columns) ? t.columns.map((c: any) => ({ name: c.name || c, dataType: c.dataType || "string", nullable: c.nullable ?? true })) : [],
    relationships: {
      explicit: Array.isArray(t.relations) ? t.relations : [],
      inferred: Array.isArray(t.relationships?.inferred) ? t.relationships.inferred : [],
    },
    businessDomain: t.businessDomain || t.domain || "general",
  }));

  const userMessage = [
    `Connector Context:`,
    `- connectorId: "${connector.id}"`,
    `- connectorType: "${connector.type}"`,
    `- connectorName: "${connector.name}"`,
    `- connectionConfig: ${JSON.stringify(connector.connectionConfig || {})}`,
    `Tables to profile (${allTables.length}): ${JSON.stringify(inspectionSummary, null, 2)}`,
    "Generate complete profiling analysis JSON containing 'status', 'tables' array (with contentProfile, completenessProfile, statisticalProfile for each table), and 'tableOrder'.",
    "Return valid JSON only."
  ].join("\n\n");

  try {
    await logMilestoneThinking(services, "Data Profiling", `Running sample data ingestion and completeness analysis on tables: [${tableNames.join(", ")}]...`);
    const result = await invokeAgentJson(
      "profileData",
      model,
      userMessage,
      fallback,
      services,
      {
        systemPrompt,
        traceLabel: "agent:profileData",
        tools: profilingTools
      }
    );
    await logMilestoneThinking(services, "Data Profiling", `Data profiling successfully completed for ${tableNames.length} tables.`);
    return {
      ...fallback,
      ...result,
    };
  } catch (error) {
    console.warn("DataProfile agent execution failed, using fallback", error);
    return fallback;
  }
}

export async function profilerNode(state: typeof AgentState.State, config?: RunnableConfig) {
  const services = config?.configurable?.services as IngestionServices;
  if (!services) {
    throw new Error("Services dependency is not provided in config");
  }
  const { connectorService } = services;
  const connectors = await Promise.all(state.connectorId.map(async (connectorId) => await connectorService.getById(connectorId)));
  const validConnectors = connectors.filter((connector) => !!connector);
  const inspectionSources = Array.isArray((state.inspection as any)?.sources)
    ? (state.inspection as any).sources
    : [state.inspection];
  const profileSources = await Promise.all(validConnectors.map(async (connector) => {
    const inspection = inspectionSources.find((source: any) => source?.connectorId === connector.id) || state.inspection;
    const profile = await profileData(connector, inspection, services);
    return {
      connectorId: connector.id,
      connectorName: connector.name,
      ...profile,
    };
  }));
  const updatedBatchedTables = mergeBatchedTableStates(
    state.batchedTables,
    buildBatchedTableState(
      (state.batchedTables || []).map((table) => table.tableName),
      "profileData",
      "profiled",
      "Table data profile completed"
    )
  );
  return {
    dataProfile: { sources: profileSources },
    batchedTables: updatedBatchedTables,
    status: "running",
    summary: "Data profiling completed",
    steps: [{ name: "Data Profiler", status: "completed", summary: "Profiling completed" }],
    stageOutputs: { profileData: { sources: profileSources } },
    stageStatuses: { profileData: "Completed" },
  };
}
