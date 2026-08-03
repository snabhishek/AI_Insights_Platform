import { RunnableConfig } from "@langchain/core/runnables";
import path from "path";
import fsSync from "fs";
import { AgentState, IngestionServices } from "../../state";
import { 
  getModel, 
  invokeAgentJson,
  mergeBatchedTableStates,
  buildBatchedTableState,
  logMilestoneThinking,
  getPromptFromFile
} from "../../utils/agentUtils";
import { 
  writeResolvedSchemaYaml, 
  loadFieldSchemaYaml,
  getPackagesDir,
  sanitizeName, 
  generateDateTimeStamp 
} from "../../tools/schemaHelper";

export async function resolveSchema(
  connector: any, 
  inspection: Record<string, unknown>, 
  userPrompt: string | undefined, 
  dataProfile: Record<string, unknown> | undefined,
  projectId: string | undefined,
  services: IngestionServices
): Promise<any> {
  const inspectionSources = Array.isArray((inspection as any)?.sources)
    ? (inspection as any).sources
    : [inspection];
  const tables = inspectionSources.flatMap((source: any) => Array.isArray(source?.tables) ? source.tables : []);

  // Infer business domain fallback from tables or connector name
  const tableDomain = tables.find((t: any) => t.businessDomain || t.domain)?.businessDomain || tables.find((t: any) => t.businessDomain || t.domain)?.domain;
  const inferredDomain = tableDomain || (connector?.name ? `${connector.name} Data Domain` : "General Business Domain");

  const allFields: Array<{ datasetField: string; targetTopic: string }> = [];
  tables.forEach((table: any) => {
    const tableName = table.name || table.tableName || "table";
    if (Array.isArray(table.columns) && table.columns.length > 0) {
      table.columns.forEach((col: any) => {
        const colName = typeof col === "string" ? col : col.name || col.columnName || "";
        if (colName) {
          allFields.push({
            datasetField: `${tableName}.${colName}`,
            targetTopic: "General",
          });
        }
      });
    } else {
      allFields.push({
        datasetField: tableName,
        targetTopic: "General",
      });
    }
  });

  const fallbackMappings = [
    { datasetField: inferredDomain, targetTopic: "Domain" },
    ...allFields.map((f) => ({
      datasetField: f.datasetField,
      targetTopic: "General",
    }))
  ];

  const fallback: Record<string, any> = {
    domainKnowledge: {
      tier1: "General Industry",
      tier2: inferredDomain,
      useCase: "Data Ingestion & Schema Resolution",
      useCaseDescription: "General automated schema taxonomy mapping"
    },
    domain: inferredDomain,
    resolvedTables: tables.map((table: any) => table.name || table.tableName || table.id || "table"),
    strategy: tables.length > 0 ? "inspect-and-map" : "fallback",
    mappings: fallbackMappings,
    unmappedDatasetFields: []
  };

  const systemPrompt = await getPromptFromFile(
    "resolveSchema.md",
    "You are an expert AI Data Architect specialized in schema resolution and data ingestion planning."
  );

  const rawFieldSchemaYaml = await loadFieldSchemaYaml();

  const safeUserRequest = typeof userPrompt === "string" && userPrompt.trim().length > 0 
    ? userPrompt 
    : "No additional request provided.";

  const prompt = `${systemPrompt}

${rawFieldSchemaYaml ? `## Live Field Schema Taxonomy (field_schema.yaml)\n\`\`\`yaml\n${rawFieldSchemaYaml}\n\`\`\`\n` : ""}

## Context
### Inspection Context
${JSON.stringify({ connector, inspection }, null, 2)}

${dataProfile ? `### Data Profile Context\n${JSON.stringify(dataProfile, null, 2)}\n` : ""}
### User Request
${safeUserRequest}
`;

  const model = getModel();

  await logMilestoneThinking(services, "Schema Resolver", `Resolving semantic types and target mappings to topics: [${targetParquetTopics.join(", ")}]...`);
  const result = await invokeAgentJson("resolveSchema", model, prompt, fallback, services, {
    traceLabel: "agent:resolveSchema",
  });

  const rawMappings = (result && Array.isArray(result.mappings) && result.mappings.length > 0)
    ? result.mappings
    : fallbackMappings;

  await logMilestoneThinking(services, "Schema Resolver", `Aligned ${rawMappings.length} structural columns with Parquet target categories.`);

  const resolvedDomain = (typeof result?.domain === "string" && result.domain.trim().length > 0)
    ? result.domain.trim()
    : inferredDomain;

  const packagesDir = getPackagesDir();
  let outputYamlPath = path.resolve(packagesDir, "resolved_schema.yaml");
  if (projectId) {
    try {
      const projectWithWs = await services.projectService.getProjectWithWorkspace(projectId);
      if (projectWithWs) {
        const workspaceName = sanitizeName(projectWithWs.workspaceName);
        const projectTitle = sanitizeName(projectWithWs.project.name);
        const folderName = `${workspaceName}-${projectTitle}`;
        const timestamp = generateDateTimeStamp();
        const fileName = `${workspaceName}-${projectTitle}-${timestamp}.yaml`;

        outputYamlPath = path.resolve(packagesDir, "ProjectFiles", folderName, "Schemas", fileName);
      }
    } catch (lookupErr: any) {
      console.warn(`[resolveSchema] Failed to lookup project/workspace for ${projectId}, fallback path used:`, lookupErr?.message || lookupErr);
    }
  }

  const payloadToWrite = {
    domainKnowledge: result?.domainKnowledge || fallback.domainKnowledge,
    domain: resolvedDomain,
    resolvedTables: result?.resolvedTables || fallback.resolvedTables,
    strategy: result?.strategy || fallback.strategy,
    mappings: rawMappings,
    unmappedDatasetFields: result?.unmappedDatasetFields || []
  };

  if (rawMappings.length > 0) {
    await writeResolvedSchemaYaml(
      outputYamlPath,
      payloadToWrite
    );
    console.info(`[resolveSchema] Wrote resolved schema YAML file to ${outputYamlPath} with ${rawMappings.length} mappings`);
  }

  return {
    ...fallback,
    ...result,
    domain: resolvedDomain,
    mappings: rawMappings,
    yamlPath: outputYamlPath,
    schemaPath: outputYamlPath,
  };
}

export async function schemaResolverNode(state: typeof AgentState.State, config?: RunnableConfig) {
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
  const resolvedSources = await Promise.all(validConnectors.map(async (connector) => {
    const inspection = inspectionSources.find((source: any) => source?.connectorId === connector.id) || state.inspection;
    const resolved = await resolveSchema(
      connector, 
      inspection, 
      typeof state.userPrompt === "string" ? state.userPrompt : "",
      state.dataProfile,
      (state as any).projectId,
      services
    );
    return {
      connectorId: connector.id,
      connectorName: connector.name,
      ...resolved,
    };
  }));
  const updatedBatchedTables = mergeBatchedTableStates(
    state.batchedTables,
    buildBatchedTableState(
      (state.batchedTables || []).map((table) => table.tableName),
      "resolveSchema",
      "resolved",
      "Table schema resolution completed"
    )
  );
  return {
    schemaResolution: { sources: resolvedSources },
    batchedTables: updatedBatchedTables,
    status: "completed",
    summary: "Schema resolution completed",
    steps: [{ name: "Schema Resolver", status: "completed", summary: "Schema mapping prepared" }],
    stageOutputs: { resolveSchema: { sources: resolvedSources } },
    stageStatuses: { resolveSchema: "Completed" },
  };
}
