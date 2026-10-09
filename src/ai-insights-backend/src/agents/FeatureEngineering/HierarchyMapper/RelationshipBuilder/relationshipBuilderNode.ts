import * as fs from "fs";
import * as path from "path";
import { RunnableConfig } from "@langchain/core/runnables";
import { BaseMessage, HumanMessage, AIMessage } from "@langchain/core/messages";
import { AgentState, IngestionServices, BatchedTableState } from "../../../state";
import { getPromptFromFile, getModel, invokeAgentJson, logMilestoneThinking } from "../../../utils/agentUtils";
import { analyzeFunctionalDependenciesTool, enforceRelationshipStatusByPurity } from "./relationshipBuilder.tool";
import { GenericDataConnector } from "./dataConnector";
import { saveModularRelationshipSchema } from "../../../tools/helpers";
import { getProjectSchemasDir } from "../../../../config/fileServer.config";
import { RelationshipSchemaOutput } from "./state";
import { validateWithRetry } from "../../../validator/validatorNode";

type RelationshipBuilderValidationResult = { isValid: boolean; errors?: string[] };

export function validateRelationshipBuilderRawOutput(
  output: Record<string, unknown>,
  fallbackSchema?: RelationshipSchemaOutput
): RelationshipBuilderValidationResult {
  const errors: string[] = [];

  if (!output || typeof output !== "object" || Array.isArray(output)) {
    return { isValid: false, errors: ["Output must be a JSON object."] };
  }

  // 1. Validate nodes
  if (!Array.isArray(output.nodes)) {
    errors.push("nodes must be an array.");
  } else if (output.nodes.length === 0 && (fallbackSchema?.nodes?.length ?? 0) > 0) {
    errors.push("nodes array cannot be empty when dataset columns are available.");
  } else {
    const nodeIds = new Set<string>();
    for (const [idx, node] of output.nodes.entries()) {
      const location = `nodes[${idx}]`;
      if (!node || typeof node !== "object" || Array.isArray(node)) {
        errors.push(`${location} must be an object.`);
        continue;
      }

      const nodeVal = node as Record<string, unknown>;
      const id = typeof nodeVal.id === "string" ? nodeVal.id.trim() : "";
      if (!id) {
        errors.push(`${location}.id must be a non-empty string.`);
      } else {
        if (nodeIds.has(id)) {
          errors.push(`Duplicate node id "${id}" in nodes array.`);
        }
        nodeIds.add(id);
      }

      const validRoles = ["identifier", "categorical", "location", "temporal"];
      if (typeof nodeVal.role !== "string" || !validRoles.includes(nodeVal.role.toLowerCase())) {
        errors.push(`${location}.role must be one of: ${validRoles.join(", ")}.`);
      }

      if (typeof nodeVal.entityScope !== "string" || nodeVal.entityScope.trim() === "") {
        errors.push(`${location}.entityScope must be a non-empty string.`);
      }

      if (nodeVal.aliasOf !== undefined && !Array.isArray(nodeVal.aliasOf) && typeof nodeVal.aliasOf !== "string") {
        errors.push(`${location}.aliasOf must be an array of strings.`);
      }
    }

    // 2. Validate relationships
    if (!Array.isArray(output.relationships)) {
      errors.push("relationships must be an array.");
    } else {
      const validTypes = [
        "strict_hierarchy",
        "geographic_hierarchy",
        "temporal_hierarchy",
        "reference_link",
      ];
      const validStatuses = ["confirmed", "needs_review", "rejected"];
      const validPriorities = ["primary", "secondary"];

      const adjacency = new Map<string, Set<string>>();

      for (const [idx, rel] of output.relationships.entries()) {
        const location = `relationships[${idx}]`;
        if (!rel || typeof rel !== "object" || Array.isArray(rel)) {
          errors.push(`${location} must be an object.`);
          continue;
        }

        const relVal = rel as Record<string, unknown>;
        const parent = typeof relVal.parent === "string" ? relVal.parent.trim() : "";
        const child = typeof relVal.child === "string" ? relVal.child.trim() : "";

        if (!parent) {
          errors.push(`${location}.parent must be a non-empty string referencing a node ID.`);
        } else if (nodeIds.size > 0 && !nodeIds.has(parent)) {
          errors.push(`${location}.parent "${parent}" does not exist in nodes array.`);
        }

        if (!child) {
          errors.push(`${location}.child must be a non-empty string referencing a node ID.`);
        } else if (nodeIds.size > 0 && !nodeIds.has(child)) {
          errors.push(`${location}.child "${child}" does not exist in nodes array.`);
        }

        if (parent && child && parent === child) {
          errors.push(`${location} cannot have parent identical to child ("${parent}").`);
        }

        if (typeof relVal.type !== "string" || !validTypes.includes(relVal.type.toLowerCase())) {
          errors.push(`${location}.type must be one of: ${validTypes.join(", ")}.`);
        }

        if (relVal.status !== undefined && (typeof relVal.status !== "string" || !validStatuses.includes(relVal.status.toLowerCase()))) {
          errors.push(`${location}.status must be one of: ${validStatuses.join(", ")}.`);
        }

        if (relVal.priority !== undefined && (typeof relVal.priority !== "string" || !validPriorities.includes(relVal.priority.toLowerCase()))) {
          errors.push(`${location}.priority must be "primary" or "secondary".`);
        }

        if (typeof relVal.evidence !== "object" || relVal.evidence === null || Array.isArray(relVal.evidence)) {
          errors.push(`${location}.evidence must be an object containing statistical purity evidence.`);
        } else {
          const evidence = relVal.evidence as Record<string, unknown>;
          const validMethods = ["dependency_stats", "date_decomposition", "value_set_comparison", "manual_confirmed"];
          if (typeof evidence.method !== "string" || !validMethods.includes(evidence.method)) {
            errors.push(`${location}.evidence.method must be one of: ${validMethods.join(", ")}.`);
          }
          if (typeof evidence.sourceType !== "string" || evidence.sourceType.trim() === "") {
            errors.push(`${location}.evidence.sourceType must be a non-empty string.`);
          }
          if (typeof evidence.purity !== "number" || !Number.isFinite(evidence.purity) || evidence.purity < 0 || evidence.purity > 1) {
            errors.push(`${location}.evidence.purity must be a number between 0 and 1.`);
          }
          if (typeof evidence.sampleSize !== "number" || !Number.isFinite(evidence.sampleSize) || evidence.sampleSize < 0) {
            errors.push(`${location}.evidence.sampleSize must be a non-negative number.`);
          }
          if (
            evidence.method === "dependency_stats" &&
            (typeof evidence.sampleSize !== "number" || evidence.sampleSize <= 0 ||
              typeof evidence.purity !== "number" || evidence.purity < 0.90)
          ) {
            errors.push(`${location} requires dependency evidence with purity >= 0.90 and a positive sample size.`);
          }
          if (evidence.method === "dependency_stats") {
            const measuredRelationship = fallbackSchema?.relationships.find(
              (candidate) =>
                candidate.parent === parent &&
                candidate.child === child &&
                candidate.evidence.method === "dependency_stats"
            );
            if (
              !measuredRelationship ||
              evidence.purity !== measuredRelationship.evidence.purity ||
              evidence.sampleSize !== measuredRelationship.evidence.sampleSize ||
              evidence.sourceType !== measuredRelationship.evidence.sourceType
            ) {
              errors.push(`${location} dependency evidence must match a measured Relationship Schema result.`);
            }
          }
          if (evidence.method === "date_decomposition" && relVal.type !== "temporal_hierarchy") {
            errors.push(`${location} date_decomposition evidence is only valid for temporal_hierarchy relationships.`);
          }
          if (evidence.method === "date_decomposition" && !fallbackSchema?.relationships.some(
            (candidate) =>
              candidate.parent === parent &&
              candidate.child === child &&
              candidate.evidence.method === "date_decomposition"
          )) {
            errors.push(`${location} date_decomposition must match a temporal hierarchy between existing nodes.`);
          }
          if (!["dependency_stats", "date_decomposition"].includes(String(evidence.method))) {
            errors.push(`${location}.evidence.method is not supported for a generated relationship.`);
          }
        }

        if (parent && child && parent !== child) {
          if (!adjacency.has(parent)) adjacency.set(parent, new Set());
          adjacency.get(parent)!.add(child);
        }
      }

      // Check for cycles in relationships
      const visited = new Set<string>();
      const recStack = new Set<string>();
      let hasCycle = false;

      const checkCycle = (node: string): boolean => {
        visited.add(node);
        recStack.add(node);
        const neighbors = adjacency.get(node) || new Set();
        for (const neighbor of neighbors) {
          if (!visited.has(neighbor)) {
            if (checkCycle(neighbor)) return true;
          } else if (recStack.has(neighbor)) {
            return true;
          }
        }
        recStack.delete(node);
        return false;
      };

      for (const node of adjacency.keys()) {
        if (!visited.has(node)) {
          if (checkCycle(node)) {
            hasCycle = true;
            break;
          }
        }
      }

      if (hasCycle) {
        errors.push("Circular dependency/cycle detected in relationships hierarchy.");
      }
    }
  }

  // 3. Validate conformedGroups if present
  if (output.conformedGroups !== undefined) {
    if (!Array.isArray(output.conformedGroups)) {
      errors.push("conformedGroups must be an array when provided.");
    } else {
      for (const [idx, group] of output.conformedGroups.entries()) {
        const location = `conformedGroups[${idx}]`;
        if (!group || typeof group !== "object" || Array.isArray(group)) {
          errors.push(`${location} must be an object.`);
          continue;
        }
        const grpVal = group as Record<string, unknown>;
        if (typeof grpVal.conceptName !== "string" || grpVal.conceptName.trim() === "") {
          errors.push(`${location}.conceptName must be a non-empty string.`);
        }
        if (grpVal.resolution !== undefined && grpVal.resolution !== "shared" && grpVal.resolution !== "separate") {
          errors.push(`${location}.resolution must be "shared" or "separate".`);
        }
      }
    }
  }

  return errors.length > 0 ? { isValid: false, errors } : { isValid: true };
}


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
    connectorType: connector ? "csv" : "database",
  });

  const prompt = [
    systemPrompt,
    "## Upstream Context",
    state.stageStatuses.resolveSchema ? `### Data Ingestion Schema\n\`\`\`json\n${JSON.stringify(state.stageOutputs.resolveSchema, null, 2)}\n\`\`\`` : "",
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

  // 3. Invoke LLM Agent with AI trace logging, conversation memory, and validator retry loop
  const conversationMessages: BaseMessage[] = [];

  const rawAgentResult = await validateWithRetry<Record<string, unknown>>(
    "relationshipBuilder",
    async (feedbackPrompt?: string) => {
      const userMessage = feedbackPrompt
        ? `Previous attempt had validation errors:\n${feedbackPrompt}\n\nPlease review your previous output and rectify these errors. Return the corrected Relationship Schema JSON object matching the required format.`
        : prompt;

      const agentResult = await invokeAgentJson<Record<string, unknown>>(
        "relationshipBuilder",
        model,
        userMessage,
        fallbackResult as unknown as Record<string, unknown>,
        services,
        {
          systemPrompt,
          traceLabel: "agent:relationshipBuilder",
          messages: [...conversationMessages],
        }
      );

      // Record interaction in conversation memory
      conversationMessages.push(new HumanMessage(userMessage));
      conversationMessages.push(new AIMessage(typeof agentResult === "string" ? agentResult : JSON.stringify(agentResult, null, 2)));

      return agentResult;
    },
    fallbackResult as unknown as Record<string, unknown>,
    services,
    10,
    "Return a valid Relationship Schema JSON object with valid 'nodes' (each with id, role, entityScope, aliasOf), 'relationships' (each with parent, child, type, evidence, status, priority, businessLabel), and optional 'conformedGroups'.",
    (output) => validateRelationshipBuilderRawOutput(output, fallbackResult)
  );

  const rawValidation = validateRelationshipBuilderRawOutput(rawAgentResult, fallbackResult);
  const rawResult = (rawValidation.isValid ? rawAgentResult : fallbackResult) as unknown as RelationshipSchemaOutput;

  const mergedResult: RelationshipSchemaOutput = {
    ...fallbackResult,
    ...rawResult,
    version: rawResult?.version || fallbackResult.version || "1.0",
    nodes: Array.isArray(rawResult?.nodes) && rawResult.nodes.length > 0 ? rawResult.nodes : fallbackResult.nodes,
    relationships: Array.isArray(rawResult?.relationships) && rawResult.relationships.length > 0 ? rawResult.relationships : fallbackResult.relationships,
    conformedGroups: Array.isArray(rawResult?.conformedGroups) ? rawResult.conformedGroups : fallbackResult.conformedGroups,
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
    status: "In-Progress" as const,
    summary: summaryText,
    steps: [{ name: "Relationship Builder", status: "Completed" as const, summary: summaryText }],
  };
}
