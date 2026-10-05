import * as fs from "fs";
import * as path from "path";
import { RunnableConfig } from "@langchain/core/runnables";
import { AgentState, IngestionServices, BatchedTableState } from "../../../state";
import { getPromptFromFile, getModel, invokeAgentJson, logMilestoneThinking } from "../../../utils/agentUtils";
import { analyzeFunctionalDependenciesTool, enforceRelationshipStatusByPurity } from "./relationshipBuilder.tool";
import { GenericDataConnector } from "./dataConnector";
import { saveModularRelationshipSchema } from "../../../tools/helpers";
import { getProjectSchemasDir } from "../../../../config/fileServer.config";
import { RelationshipSchemaOutput } from "./state";

export async function relationshipBuilderNode(state: typeof AgentState.State, config?: RunnableConfig) {
  const services = config?.configurable?.services as IngestionServices;

  await logMilestoneThinking(
    services,
    "Hierarchy Mapper",
    "Initiating Relationship Builder Agent to discover functional dependencies and hierarchies..."
  );

  const systemPrompt = await getPromptFromFile(
    "relationshipBuilder.md",
    "You are the Relationship Schema Agent. You take the field classification file and domain knowledge file, ask summary/aggregate questions about the data using the generic data connector, and output one clean Relationship Schema file."
  );

  let tableNames: string[] = [];
  if (Array.isArray(state.batchedTables) && state.batchedTables.length > 0) {
    tableNames = state.batchedTables.map((t: BatchedTableState) => t.tableName).filter(Boolean);
  }

  let connector: GenericDataConnector | undefined;
  if (services?.duckDBService) {
    connector = new GenericDataConnector(
      "csv",
      { fileName: tableNames[0] || "dataset" },
      services.duckDBService,
      tableNames[0] || "default_table"
    );
  }

  const fallbackResult: RelationshipSchemaOutput = await analyzeFunctionalDependenciesTool({
    connector,
    projectId: services?.projectId || (state.projectId as string),
    userPrompt: state.userPrompt,
    schemaResolution: state.schemaResolution,
    inspection: state.inspection,
    tableNames,
    connectorType: "database",
  });

  const prompt = [
    systemPrompt,
    "## Upstream Context",
    state.schemaResolution ? `### Data Ingestion Schema\n\`\`\`json\n${JSON.stringify(state.schemaResolution, null, 2)}\n\`\`\`` : "",
    `### Discovered Candidate Dependency & Value Statistics\n\`\`\`json\n${JSON.stringify(fallbackResult, null, 2)}\n\`\`\``,
    state.userPrompt ? `### User Request\n${state.userPrompt}` : "",
    "Follow the 7 steps in order and output the single clean Relationship Schema JSON object matching the exact format in system prompt."
  ].filter(Boolean).join("\n\n");

  const model = getModel();

  await logMilestoneThinking(
    services,
    "Hierarchy Mapper",
    "Executing LLM reasoning for 7-step Relationship Schema construction (scoping, alias merging, entity grouping, dependency testing, temporal, conformed, business labeling)..."
  );

  const agentResult = await invokeAgentJson<any>(
    "relationshipBuilder",
    model,
    prompt,
    fallbackResult,
    services,
    {
      traceLabel: "agent:relationshipBuilder",
    }
  );

  const mergedResult: RelationshipSchemaOutput = {
    ...fallbackResult,
    ...agentResult,
    version: agentResult?.version || fallbackResult.version || "1.0",
    nodes: Array.isArray(agentResult?.nodes) && agentResult.nodes.length > 0 ? agentResult.nodes : fallbackResult.nodes,
    relationships: Array.isArray(agentResult?.relationships) && agentResult.relationships.length > 0 ? agentResult.relationships : fallbackResult.relationships,
    conformedGroups: Array.isArray(agentResult?.conformedGroups) ? agentResult.conformedGroups : fallbackResult.conformedGroups,
  };

  const finalResult = enforceRelationshipStatusByPurity(mergedResult, fallbackResult);

  const effectiveRunTimestamp = state.runTimestamp || (services as any)?.runTimestamp;
  if (services?.projectService && services?.projectId) {
    try {
      const proj = await services.projectService.getProjectWithWorkspace(services.projectId);
      if (proj && proj.project) {
        await saveModularRelationshipSchema(proj.workspaceName || "DefaultWorkspace", proj.project.name, finalResult, effectiveRunTimestamp);

        const workspaceName = proj.workspaceName || "DefaultWorkspace";
        const projectName = proj.project.name;
        const schemasDir = getProjectSchemasDir(workspaceName, projectName, effectiveRunTimestamp);
        await fs.promises.mkdir(schemasDir, { recursive: true });

        const relJsonContent = JSON.stringify(finalResult, null, 2);
        await fs.promises.writeFile(path.join(schemasDir, "relationship_schema.json"), relJsonContent, "utf-8");
        if (effectiveRunTimestamp) {
          await fs.promises.writeFile(path.join(schemasDir, `relationship_schema_${effectiveRunTimestamp}.json`), relJsonContent, "utf-8");
        }

        const globalSchemasDir = getProjectSchemasDir(workspaceName, projectName);
        await fs.promises.mkdir(globalSchemasDir, { recursive: true });
        await fs.promises.writeFile(path.join(globalSchemasDir, "relationship_schema.json"), relJsonContent, "utf-8");
      }
    } catch (err) {
      console.warn("[relationshipBuilderNode] Warning saving Relationship Schema to project folder:", err);
    }
  }

  const summaryText = finalResult.summary || `Relationship Schema generated with ${finalResult.nodes?.length || 0} nodes and ${finalResult.relationships?.length || 0} relationships.`;

  return {
    relationshipBuilder: finalResult as unknown as Record<string, unknown>,
    runTimestamp: effectiveRunTimestamp,
    status: "running",
    summary: summaryText,
    steps: [{ name: "Relationship Builder", status: "completed", summary: summaryText }],
  };
}
