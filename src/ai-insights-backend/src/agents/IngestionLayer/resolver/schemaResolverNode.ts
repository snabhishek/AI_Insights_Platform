import { RunnableConfig } from "@langchain/core/runnables";
import path from "path";
import fsSync from "fs";
import { AgentState, IngestionServices } from "../../state";
import { 
  getModel, 
  invokeAgentJson,
  mergeBatchedTableStates,
  buildBatchedTableState
} from "../../utils/agentUtils";
import { buildResolveSchemaPrompt } from "../../prompts/resolveSchema.prompt";
import { 
  getTopicsFromParquetSchema, 
  writeResolvedSchemaParquet, 
  sanitizeName, 
  generateDateTimeStamp 
} from "../../tools/parquetHelper";

function resolvePackageFilePath(filename: string): string {
  const candidatePaths = [
    path.resolve(__dirname, "../../../../../packages", filename),
    path.resolve(process.cwd(), "../packages", filename),
    path.resolve(process.cwd(), "src/packages", filename),
    path.resolve(__dirname, "../../../packages", filename),
  ];
  for (const candidate of candidatePaths) {
    if (fsSync.existsSync(candidate)) {
      return candidate;
    }
  }
  return candidatePaths[0];
}

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

  const staticSchemaPath = resolvePackageFilePath("static_schema_updated.parquet");
  const targetParquetTopics = await getTopicsFromParquetSchema(staticSchemaPath);

  const defaultTopic = targetParquetTopics[0] || "General";
  const fallbackMappings = [
    { datasetField: inferredDomain, targetTopic: "Domain" },
    ...allFields.map((f) => ({
      datasetField: f.datasetField,
      targetTopic: defaultTopic,
    }))
  ];

  const fallback: Record<string, any> = {
    domain: inferredDomain,
    resolvedTables: tables.map((table: any) => table.name || table.tableName || table.id || "table"),
    strategy: tables.length > 0 ? "inspect-and-map" : "fallback",
    mappings: fallbackMappings,
    unmappedDatasetFields: []
  };

  const prompt = buildResolveSchemaPrompt(connector, inspection, targetParquetTopics, userPrompt, dataProfile);
  const model = getModel();

  const result = await invokeAgentJson("resolveSchema", model, prompt, fallback, services, {
    traceLabel: "agent:resolveSchema",
  });

  const rawMappings = (result && Array.isArray(result.mappings) && result.mappings.length > 0)
    ? result.mappings
    : fallbackMappings;

  const resolvedDomain = (typeof result?.domain === "string" && result.domain.trim().length > 0)
    ? result.domain.trim()
    : inferredDomain;

  // Ensure a Domain topic mapping exists in mappingsToWrite so writeResolvedSchemaParquet populates the Domain column
  const hasDomainMapping = rawMappings.some((m: any) => m.targetTopic === "Domain");
  const mappingsToWrite = hasDomainMapping
    ? rawMappings
    : [{ datasetField: resolvedDomain, targetTopic: "Domain" }, ...rawMappings];

  let outputParquetPath = path.resolve(path.dirname(staticSchemaPath), "resolved_schema.parquet");
  if (projectId) {
    try {
      const projectWithWs = await services.projectService.getProjectWithWorkspace(projectId);
      if (projectWithWs) {
        const workspaceName = sanitizeName(projectWithWs.workspaceName);
        const projectTitle = sanitizeName(projectWithWs.project.name);
        const folderName = `${workspaceName}-${projectTitle}`;
        const timestamp = generateDateTimeStamp();
        const fileName = `${workspaceName}-${projectTitle}-${timestamp}.parquet`;

        const packagesDir = path.dirname(staticSchemaPath);
        outputParquetPath = path.resolve(packagesDir, "ProjectFiles", folderName, "Schemas", fileName);
      }
    } catch (lookupErr: any) {
      console.warn(`[resolveSchema] Failed to lookup project/workspace for ${projectId}, fallback path used:`, lookupErr?.message || lookupErr);
    }
  }

  if (mappingsToWrite.length > 0) {
    await writeResolvedSchemaParquet(
      outputParquetPath,
      mappingsToWrite as Array<{ datasetField: string; targetTopic: string }>,
      targetParquetTopics
    );
    console.info(`[resolveSchema] Wrote resolved schema parquet file to ${outputParquetPath} with ${mappingsToWrite.length} mappings`);
  }

  return {
    ...fallback,
    ...result,
    domain: resolvedDomain,
    mappings: mappingsToWrite,
    parquetPath: outputParquetPath,
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
