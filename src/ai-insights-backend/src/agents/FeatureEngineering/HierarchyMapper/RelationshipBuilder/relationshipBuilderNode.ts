import { RunnableConfig } from "@langchain/core/runnables";
import { AgentState, IngestionServices, BatchedTableState } from "../../../state";
import { getPromptFromFile, getModel, invokeAgentJson, logMilestoneThinking } from "../../../utils/agentUtils";
import { analyzeFunctionalDependenciesTool, enforceRelationshipStatusByPurity } from "./relationshipBuilder.tool";
import { GenericDataConnector } from "./dataConnector";
import { saveModularRelationshipSchema } from "../../../tools/schemaHelper";
import { RelationshipSchemaOutput } from "./state";

/**
 * Relationship Builder Agent Node (Agent 1 of Hierarchy Mapper)
 * Analyzes Data Ingestion Schema and Domain Knowledge to discover functional dependencies and entity hierarchies.
 * Invokes LLM Agent using system prompt relationshipBuilder.md and statistical queries via GenericDataConnector.
 */
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

  // Instantiate GenericDataConnector using duckDBService if available
  let connector: GenericDataConnector | undefined;
  if (services?.duckDBService) {
    connector = new GenericDataConnector(
      "csv",
      { fileName: tableNames[0] || "dataset" },
      services.duckDBService,
      tableNames[0] || "default_table"
    );
  }

  // 1. Calculate statistical dependencies and preliminary candidate structures via Data Connector
  const fallbackResult: RelationshipSchemaOutput = await analyzeFunctionalDependenciesTool({
    connector,
    projectId: services?.projectId || (state.projectId as string),
    userPrompt: state.userPrompt,
    schemaResolution: state.schemaResolution,
    inspection: state.inspection,
    tableNames,
    connectorType: "database",
  });

  // 2. Assemble prompt for LLM Agent
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

  // 3. Invoke LLM Agent with AI trace logging
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

  // Enforce deterministic purity threshold rules (e.g. 0.90 - 0.98 -> needs_review), verify sampleValues against data connector tool calls, and compute accurate summary counts
  const finalResult = enforceRelationshipStatusByPurity(mergedResult, fallbackResult);

  // 4. Save Relationship Schema into Project Folder with timestamped filename
  if (services?.projectService && services?.projectId) {
    try {
      const proj = await services.projectService.getProjectWithWorkspace(services.projectId);
      if (proj && proj.project) {
        await saveModularRelationshipSchema(proj.workspaceName || "DefaultWorkspace", proj.project.name, finalResult, state.runTimestamp);
      }
    } catch (err) {
      console.warn("[relationshipBuilderNode] Warning saving Relationship Schema to project folder:", err);
    }
  }

  const summaryText = finalResult.summary || `Relationship Schema generated with ${finalResult.nodes?.length || 0} nodes and ${finalResult.relationships?.length || 0} relationships.`;

  return {
    relationshipBuilder: finalResult as unknown as Record<string, unknown>,
    status: "running",
    summary: summaryText,
    steps: [{ name: "Relationship Builder", status: "completed", summary: summaryText }],
  };
}
