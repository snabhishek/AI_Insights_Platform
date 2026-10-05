import { RunnableConfig } from "@langchain/core/runnables";
import { AgentState, IngestionServices } from "../../../state";
import { getPromptFromFile, getModel, invokeAgentJson, logMilestoneThinking } from "../../../utils/agentUtils";
import { generateHierarchicalFormsTool, normalizeAndEnforceFormSchema } from "./formBuilder.tool";
import { FormBuilderOutput } from "./state";
import { saveModularFormSchema } from "../../../tools/helpers";
import { validateWithRetry } from "../../../validator/validatorNode";
import { RelationshipSchemaOutput } from "../RelationshipBuilder/state";

type FormBuilderValidationResult = { isValid: boolean; errors?: string[] };

export function validateFormBuilderRawOutput(
  output: Record<string, unknown>,
  relationshipSchema?: RelationshipSchemaOutput,
  expectedSourceId?: string
): FormBuilderValidationResult {
  const errors: string[] = [];
  const nodes = relationshipSchema?.nodes || [];
  const relationships = relationshipSchema?.relationships || [];
  const expectedFieldIds = new Set(
    nodes
      .filter((node) => node.role !== "identifier")
      .map((node) => node.columnName || node.aliasOf?.[0] || node.id)
  );
  const expectedIdsByField = new Map(
    nodes
      .filter((node) => node.role !== "identifier")
      .map((node) => [node.columnName || node.aliasOf?.[0] || node.id, node.id])
  );

  if (!output || typeof output !== "object" || Array.isArray(output)) {
    return { isValid: false, errors: ["Output must be a JSON object."] };
  }

  if (typeof output.sourceId !== "string" || output.sourceId.trim() === "") {
    errors.push("sourceId must be a non-empty string.");
  } else if (expectedSourceId && output.sourceId !== expectedSourceId) {
    errors.push(`sourceId must match the input source ID "${expectedSourceId}".`);
  }

  if (!Array.isArray(output.filterGroups)) {
    errors.push("filterGroups must be an array.");
    return { isValid: false, errors };
  }

  const returnedFieldIds = new Set<string>();
  for (const [groupIndex, group] of output.filterGroups.entries()) {
    if (!group || typeof group !== "object" || Array.isArray(group)) {
      errors.push(`filterGroups[${groupIndex}] must be an object.`);
      continue;
    }

    const groupValue = group as Record<string, unknown>;
    if (typeof groupValue.groupName !== "string" || groupValue.groupName.trim() === "") {
      errors.push(`filterGroups[${groupIndex}].groupName must be a non-empty string.`);
    }
    if (groupValue.priority !== "primary" && groupValue.priority !== "secondary") {
      errors.push(`filterGroups[${groupIndex}].priority must be "primary" or "secondary".`);
    }
    if (!Array.isArray(groupValue.fields)) {
      errors.push(`filterGroups[${groupIndex}].fields must be an array.`);
      continue;
    }

    for (const [fieldIndex, field] of groupValue.fields.entries()) {
      const location = `filterGroups[${groupIndex}].fields[${fieldIndex}]`;
      if (!field || typeof field !== "object" || Array.isArray(field)) {
        errors.push(`${location} must be an object.`);
        continue;
      }

      const fieldValue = field as Record<string, unknown>;
      const fieldId = fieldValue.fieldId;
      if (typeof fieldId !== "string" || fieldId.trim() === "") {
        errors.push(`${location}.fieldId must be a non-empty string.`);
        continue;
      }
      if (!expectedFieldIds.has(fieldId)) {
        errors.push(`${location}.fieldId "${fieldId}" is not an exact physical column name from the Relationship Schema.`);
        continue;
      }
      if (returnedFieldIds.has(fieldId)) {
        errors.push(`Field "${fieldId}" appears more than once.`);
      }
      returnedFieldIds.add(fieldId);

      if (typeof fieldValue.label !== "string" || fieldValue.label.trim() === "") {
        errors.push(`${location}.label must be a non-empty string.`);
      }
      if (!["dropdown", "multi_select", "searchable_dropdown", "date_range"].includes(String(fieldValue.controlType))) {
        errors.push(`${location}.controlType must be a supported control type.`);
      }
      if (!Array.isArray(fieldValue.parentFields)) {
        errors.push(`${location}.parentFields must be an array.`);
      } else {
        const nodeId = expectedIdsByField.get(fieldId);
        const expectedParents = relationships
          .filter((relationship) => relationship.child === nodeId && relationship.status !== "rejected")
          .map((relationship) => relationship.parent);
        const actualParents = fieldValue.parentFields;
        if (
          actualParents.length !== expectedParents.length ||
          expectedParents.some((parentId) => !actualParents.includes(parentId))
        ) {
          errors.push(`${location}.parentFields must include all and only the active Relationship Schema parent IDs.`);
        }
      }
      if (fieldValue.options !== undefined && !Array.isArray(fieldValue.options)) {
        errors.push(`${location}.options must be an array when provided.`);
      }
    }
  }

  for (const fieldId of expectedFieldIds) {
    if (!returnedFieldIds.has(fieldId)) {
      errors.push(`Required Relationship Schema field "${fieldId}" is missing.`);
    }
  }

  return errors.length > 0 ? { isValid: false, errors } : { isValid: true };
}

export async function formBuilderNode(state: typeof AgentState.State, config?: RunnableConfig) {
  const services = config?.configurable?.services as IngestionServices;

  await logMilestoneThinking(
    services,
    "Hierarchy Mapper",
    "Initiating Form Builder Agent to convert Relationship Schema into cascading Form Schema..."
  );

  const systemPrompt = await getPromptFromFile(
    "formBuilder.md",
    "You are the Form Builder Agent. You convert a Relationship Schema into a Form Schema that a frontend can use to render a dynamic, cascading filter form."
  );

  const relOutput = (state as any).relationshipBuilder;
  const sourceId =
    (state as any).connectorId ||
    (relOutput as any)?.sourceId ||
    (state.schemaResolution as any)?.connectorId ||
    (state as any)?.connector?.id ||
    "default_source";

  const fallbackResult: FormBuilderOutput = await generateHierarchicalFormsTool({
    relationshipBuilderOutput: relOutput,
    schemaResolution: state.schemaResolution,
    userPrompt: state.userPrompt,
    sourceId,
  });

  const prompt = [
    systemPrompt,
    "## Context",
    `### Source Data ID\n"${sourceId}"`,
    relOutput ? `### Input Relationship Schema\n\`\`\`json\n${JSON.stringify(relOutput, null, 2)}\n\`\`\`` : "",
    `### Discovered Candidate Form Structure\n\`\`\`json\n${JSON.stringify(fallbackResult, null, 2)}\n\`\`\``,
    state.userPrompt ? `### User Request\n${state.userPrompt}` : "",
    "Follow the 5 steps in order and output the single clean Form Schema JSON matching the exact filterGroups format in system prompt."
  ].filter(Boolean).join("\n\n");

  const model = getModel();

  await logMilestoneThinking(
    services,
    "Hierarchy Mapper",
    "Executing LLM reasoning for Form Schema generation (grouping by entityScope, priority ordering, controlType decision)..."
  );

  const rawAgentResult = await validateWithRetry<Record<string, unknown>>(
    "formBuilder",
    async (feedbackPrompt?: string) =>
      invokeAgentJson<Record<string, unknown>>(
        "formBuilder",
        model,
        feedbackPrompt ? `${prompt}\n\n${feedbackPrompt}` : prompt,
        fallbackResult as unknown as Record<string, unknown>,
        services,
        { traceLabel: "agent:formBuilder" }
      ),
    fallbackResult as unknown as Record<string, unknown>,
    services,
    10,
    "Return a Form Builder JSON object whose filterGroups represent every non-identifier Relationship Schema node exactly once, use exact physical field IDs, and include the correct active parent IDs.",
    (output) => validateFormBuilderRawOutput(output, relOutput, sourceId)
  );

  const rawValidation = validateFormBuilderRawOutput(rawAgentResult, relOutput, sourceId);
  const rawResult = (rawValidation.isValid ? rawAgentResult : fallbackResult) as FormBuilderOutput;

  const finalResult = normalizeAndEnforceFormSchema(rawResult, relOutput, sourceId);

  const effectiveRunTimestamp = state.runTimestamp || (services as any)?.runTimestamp;
  if (services?.projectService && services?.projectId) {
    try {
      const proj = await services.projectService.getProjectWithWorkspace(services.projectId);
      if (proj && proj.project) {
        await saveModularFormSchema(proj.workspaceName || "DefaultWorkspace", proj.project.name, finalResult, effectiveRunTimestamp);
      }
    } catch (err) {
      console.warn("[formBuilderNode] Warning saving Form Schema to project folder:", err);
    }
  }

  return {
    formBuilder: finalResult as unknown as Record<string, unknown>,
    runTimestamp: effectiveRunTimestamp,
    status: "running",
    summary: finalResult.summary,
    steps: [{ name: "Form Builder", status: "completed", summary: finalResult.summary }],
  };
}
