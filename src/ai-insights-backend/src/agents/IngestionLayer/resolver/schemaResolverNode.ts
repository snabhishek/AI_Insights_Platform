import { RunnableConfig } from "@langchain/core/runnables";
import * as path from "path";
import * as fsSync from "fs";
import * as yaml from "js-yaml";
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
  loadProjectOrFieldSchemaYaml,
  updateOrCreateProjectSchemaFile,
  saveModularResolvedSchemas,
  getPackagesDir,
  sanitizeName, 
  generateDateTimeStamp 
} from "../../tools/helpers";

export async function resolveSchema(
  connector: any, 
  inspection: Record<string, unknown>, 
  userPrompt: string | undefined, 
  dataProfile: Record<string, unknown> | undefined,
  projectId: string | undefined,
  services: IngestionServices,
  stateRunTimestamp?: string
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

  let workspaceName: string | undefined;
  let projectName: string | undefined;
  let projectWithWs: any = null;

  if (projectId && services?.projectService) {
    try {
      projectWithWs = await services.projectService.getProjectWithWorkspace(projectId);
      if (projectWithWs) {
        workspaceName = projectWithWs.workspaceName;
        projectName = projectWithWs.project.name;
      }
    } catch (lookupErr: any) {
      console.warn(`[resolveSchema] Failed upfront project lookup for ${projectId}:`, lookupErr?.message || lookupErr);
    }
  }

  const { content: rawFieldSchemaYaml, sourcePath: schemaSourcePath, isProjectSchema } = 
    await loadProjectOrFieldSchemaYaml(workspaceName, projectName);

  if (isProjectSchema && rawFieldSchemaYaml) {
    try {
      const parsedProjectYaml: any = yaml.load(rawFieldSchemaYaml);
      const dk = parsedProjectYaml?.fields?.DomainKnowledge || parsedProjectYaml?.domainKnowledge;
      if (dk) {
        fallback.domainKnowledge = {
          tier1: dk.Tier1 || dk.tier1 || fallback.domainKnowledge.tier1,
          tier2: dk.Tier2 || dk.tier2 || fallback.domainKnowledge.tier2,
          useCase: dk.UseCase || dk.useCase || fallback.domainKnowledge.useCase,
          useCaseDescription: dk.UseCaseDescription || dk.useCaseDescription || fallback.domainKnowledge.useCaseDescription,
        };
        const dkDomain = (dk.Tier1 || dk.tier1) && (dk.Tier2 || dk.tier2) ? `${dk.Tier1 || dk.tier1} - ${dk.Tier2 || dk.tier2}` : null;
        if (dkDomain) {
          fallback.domain = dkDomain;
        }
      }
    } catch (e) {
      // ignore fallback error
    }
  }

  const systemPrompt = await getPromptFromFile(
    "resolveSchema.md",
    "You are an expert AI Data Architect specialized in schema resolution and data ingestion planning."
  );

  const safeUserRequest = typeof userPrompt === "string" && userPrompt.trim().length > 0 
    ? userPrompt 
    : "No additional request provided.";

  const schemaHeader = isProjectSchema
    ? `## Project Field Schema Taxonomy & Updated Domain Knowledge (${path.basename(schemaSourcePath)})`
    : `## Live Modular Field Schema Taxonomy`;

  const prompt = [
    systemPrompt,
    rawFieldSchemaYaml ? `${schemaHeader}\n\`\`\`yaml\n${rawFieldSchemaYaml}\n\`\`\`` : "",
    "## Context",
    inspection ? `### Inspection Context\n\`\`\`json\n${JSON.stringify({ connector, inspection }, null, 2)}\n\`\`\`` : "",
    dataProfile ? `### Data Profile Context\n\`\`\`json\n${JSON.stringify(dataProfile, null, 2)}\n\`\`\`` : "",
    safeUserRequest ? `### User Request\n${safeUserRequest}` : ""
  ].filter(Boolean).join("\n\n");

  const model = getModel();

  await logMilestoneThinking(services, "Schema Resolver", `Resolving DataIngestion modular schema in a single prompt...`);
  const result = await invokeAgentJson("resolveSchema", model, prompt, fallback, services, {
    traceLabel: "agent:resolveSchema",
  });

  const { mappings: rawMappings, domainKnowledge: extractedDk } = extractResolvedMappings(result, fallbackMappings);
  const resolvedDomainKnowledge = extractedDk || result?.domainKnowledge || fallback.domainKnowledge;

  await logMilestoneThinking(services, "Schema Resolver", `Aligned ${rawMappings.length} structural columns in DataIngestion schema.`);

  const resolvedDomain = (typeof result?.domain === "string" && result.domain.trim().length > 0)
    ? result.domain.trim()
    : (fallback.domain || inferredDomain);

  const packagesDir = getPackagesDir();
  let outputYamlPath = path.resolve(packagesDir, "resolved_schema.yaml");
  const resolvedTablesList = result?.dataIngestionSchema?.resolvedTables || result?.resolvedTables || fallback.resolvedTables;

  // Build/extract dataIngestionSchema
  let dataIngestionSchema = result?.dataIngestionSchema;
  if (!dataIngestionSchema || !dataIngestionSchema.fields) {
    const fieldsObj: Record<string, any[]> = {};
    for (const mapping of rawMappings) {
      const topic = mapping.targetTopic || "General";
      if (!fieldsObj[topic]) fieldsObj[topic] = [];
      fieldsObj[topic].push({
        field: mapping.datasetField,
        subtype: mapping.subtype || null,
        priority: mapping.priority || "Medium",
        priorityRationale: mapping.priorityRationale || null,
        sensitiveSubtype: mapping.sensitiveSubtype || null,
      });
    }
    dataIngestionSchema = {
      version: "1.0",
      generatedAt: new Date().toISOString(),
      resolvedTables: resolvedTablesList,
      fields: fieldsObj,
    };
  }

  const modularPayload = { dataIngestionSchema };
  const activeRunTimestamp = (stateRunTimestamp && stateRunTimestamp.trim().length > 0) ? stateRunTimestamp.trim() : generateDateTimeStamp();

  if (projectWithWs) {
    try {
      const saved = await saveModularResolvedSchemas(
        projectWithWs.workspaceName,
        projectWithWs.project.name,
        modularPayload,
        activeRunTimestamp
      );
      outputYamlPath = saved.dataIngestionPath;
      console.info(`[resolveSchema] Saved modular schema file for project: DataIngestion -> ${saved.dataIngestionPath}`);
    } catch (writeErr: any) {
      console.warn(`[resolveSchema] Failed to save modular project schema files:`, writeErr?.message || writeErr);
    }
  } else if (projectId) {
    try {
      const pWs = await services.projectService.getProjectWithWorkspace(projectId);
      if (pWs) {
        const saved = await saveModularResolvedSchemas(
          pWs.workspaceName,
          pWs.project.name,
          modularPayload,
          activeRunTimestamp
        );
        outputYamlPath = saved.dataIngestionPath;
        console.info(`[resolveSchema] Saved modular schema file for project: DataIngestion -> ${saved.dataIngestionPath}`);
      }
    } catch (lookupErr: any) {
      console.warn(`[resolveSchema] Failed to lookup project/workspace for ${projectId}:`, lookupErr?.message || lookupErr);
    }
  }

  return {
    ...fallback,
    ...result,
    domain: resolvedDomain,
    dataIngestionSchema,
    mappings: rawMappings,
    yamlPath: outputYamlPath,
    schemaPath: outputYamlPath,
    runTimestamp: activeRunTimestamp,
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
  const activeRunTimestamp = (state.runTimestamp && state.runTimestamp.trim().length > 0)
    ? state.runTimestamp.trim()
    : ((services as any)?.runTimestamp && String((services as any).runTimestamp).trim().length > 0
        ? String((services as any).runTimestamp).trim()
        : generateDateTimeStamp());

  const resolvedSources = await Promise.all(validConnectors.map(async (connector) => {
    const inspection = inspectionSources.find((source: any) => source?.connectorId === connector.id) || state.inspection;
    const resolved = await resolveSchema(
      connector, 
      inspection, 
      typeof state.userPrompt === "string" ? state.userPrompt : "",
      state.dataProfile,
      (state as any).projectId,
      services,
      activeRunTimestamp
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
    runTimestamp: activeRunTimestamp,
    schemaResolution: { sources: resolvedSources },
    batchedTables: updatedBatchedTables,
    status: "completed",
    summary: "Schema resolution completed",
    steps: [{ name: "Schema Resolver", status: "completed", summary: "Schema mapping prepared" }],
    stageOutputs: { resolveSchema: { sources: resolvedSources } },
    stageStatuses: { resolveSchema: "Completed" },
  };
}

export function extractResolvedMappings(result: any, fallbackMappings: any[]): { mappings: any[]; domainKnowledge?: any } {
  if (!result || typeof result !== "object") {
    return { mappings: fallbackMappings };
  }

  let domainKnowledge = result.domainKnowledge;

  if (Array.isArray(result.mappings) && result.mappings.length > 0) {
    const mappings = result.mappings.map((m: any) => ({
      datasetField: m.datasetField || m.field || "unknown",
      targetTopic: m.targetTopic || m.topic || m.category || "General",
      subtype: m.subtype || null,
      priority: m.priority || "Medium",
      priorityRationale: m.priorityRationale || null,
      sensitiveSubtype: m.sensitiveSubtype || null,
    }));
    return { mappings, domainKnowledge };
  }

  const fieldsSource = (result.dataIngestionSchema?.fields && typeof result.dataIngestionSchema.fields === "object")
    ? result.dataIngestionSchema.fields
    : ((result.fields && typeof result.fields === "object") ? result.fields : result);
  const extractedMappings: any[] = [];

  for (const [categoryName, categoryVal] of Object.entries(fieldsSource)) {
    if (categoryName.toLowerCase() === "domainknowledge") {
      if (categoryVal && typeof categoryVal === "object" && !Array.isArray(categoryVal)) {
        const dkObj: any = categoryVal;
        domainKnowledge = {
          tier1: dkObj.Tier1 || dkObj.tier1 || domainKnowledge?.tier1,
          tier2: dkObj.Tier2 || dkObj.tier2 || domainKnowledge?.tier2,
          useCase: dkObj.UseCase || dkObj.useCase || domainKnowledge?.useCase,
          useCaseDescription: dkObj.UseCaseDescription || dkObj.useCaseDescription || domainKnowledge?.useCaseDescription,
        };
      }
      continue;
    }

    if (["domain", "strategy", "resolvedtables", "generatedat", "unmappeddatasetfields", "dataingestionschema"].includes(categoryName.toLowerCase())) {
      continue;
    }

    if (Array.isArray(categoryVal)) {
      for (const item of categoryVal) {
        if (!item || typeof item !== "object") continue;
        const fieldName = item.field || item.datasetField;
        if (!fieldName) continue;
        extractedMappings.push({
          datasetField: fieldName,
          targetTopic: categoryName,
          subtype: item.subtype || null,
          priority: item.priority || "Medium",
          priorityRationale: item.priorityRationale || null,
          sensitiveSubtype: item.sensitiveSubtype || null,
        });
      }
    }
  }

  if (extractedMappings.length > 0) {
    return { mappings: extractedMappings, domainKnowledge };
  }

  return { mappings: fallbackMappings, domainKnowledge };
}
