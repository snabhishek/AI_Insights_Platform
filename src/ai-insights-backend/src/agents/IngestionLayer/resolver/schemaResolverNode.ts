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
    : `## Live Field Schema Taxonomy (Schema.yaml)`;

  const prompt = [
    systemPrompt,
    rawFieldSchemaYaml ? `${schemaHeader}\n\`\`\`yaml\n${rawFieldSchemaYaml}\n\`\`\`` : "",
    "## Context",
    inspection ? `### Inspection Context\n\`\`\`json\n${JSON.stringify({ connector, inspection }, null, 2)}\n\`\`\`` : "",
    dataProfile ? `### Data Profile Context\n\`\`\`json\n${JSON.stringify(dataProfile, null, 2)}\n\`\`\`` : "",
    safeUserRequest ? `### User Request\n${safeUserRequest}` : ""
  ].filter(Boolean).join("\n\n");

  const model = getModel();

  await logMilestoneThinking(services, "Schema Resolver", `Resolving semantic types and target mappings according to ${isProjectSchema ? "Project" : "Field"} Schema Taxonomy...`);
  const result = await invokeAgentJson("resolveSchema", model, prompt, fallback, services, {
    traceLabel: "agent:resolveSchema",
  });

  const rawMappings = (result && Array.isArray(result.mappings) && result.mappings.length > 0)
    ? result.mappings
    : fallbackMappings;

  await logMilestoneThinking(services, "Schema Resolver", `Aligned ${rawMappings.length} structural columns with Field Schema target categories.`);

  const resolvedDomain = (typeof result?.domain === "string" && result.domain.trim().length > 0)
    ? result.domain.trim()
    : (fallback.domain || inferredDomain);

  const packagesDir = getPackagesDir();
  let outputYamlPath = path.resolve(packagesDir, "resolved_schema.yaml");
  
  const payloadToWrite = {
    domainKnowledge: result?.domainKnowledge || fallback.domainKnowledge,
    domain: resolvedDomain,
    resolvedTables: result?.resolvedTables || fallback.resolvedTables,
    strategy: result?.strategy || fallback.strategy,
    mappings: rawMappings,
    unmappedDatasetFields: result?.unmappedDatasetFields || []
  };

  if (projectWithWs) {
    try {
      outputYamlPath = await updateOrCreateProjectSchemaFile(
        projectWithWs.workspaceName,
        projectWithWs.project.name,
        {
          name: projectWithWs.project.name,
          domain: projectWithWs.project.domain,
          subDomain: projectWithWs.project.subDomain,
          useCase: projectWithWs.project.useCase,
        },
        payloadToWrite
      );
      console.info(`[resolveSchema] Updated project schema YAML file at ${outputYamlPath} with ${rawMappings.length} mappings`);
    } catch (writeErr: any) {
      console.warn(`[resolveSchema] Failed to update project schema file, using fallback:`, writeErr?.message || writeErr);
      if (rawMappings.length > 0) {
        await writeResolvedSchemaYaml(outputYamlPath, payloadToWrite);
      }
    }
  } else if (projectId) {
    try {
      const pWs = await services.projectService.getProjectWithWorkspace(projectId);
      if (pWs) {
        outputYamlPath = await updateOrCreateProjectSchemaFile(
          pWs.workspaceName,
          pWs.project.name,
          {
            name: pWs.project.name,
            domain: pWs.project.domain,
            subDomain: pWs.project.subDomain,
            useCase: pWs.project.useCase,
          },
          payloadToWrite
        );
        console.info(`[resolveSchema] Updated project schema YAML file at ${outputYamlPath} with ${rawMappings.length} mappings`);
      } else if (rawMappings.length > 0) {
        await writeResolvedSchemaYaml(outputYamlPath, payloadToWrite);
      }
    } catch (lookupErr: any) {
      console.warn(`[resolveSchema] Failed to lookup project/workspace for ${projectId}, using fallback:`, lookupErr?.message || lookupErr);
      if (rawMappings.length > 0) {
        await writeResolvedSchemaYaml(outputYamlPath, payloadToWrite);
      }
    }
  } else if (rawMappings.length > 0) {
    await writeResolvedSchemaYaml(outputYamlPath, payloadToWrite);
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
