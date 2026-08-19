import { RunnableConfig } from "@langchain/core/runnables";
import { AgentState, IngestionServices } from "../../../state";
import { getPromptFromFile, getModel, invokeAgentJson, logMilestoneThinking } from "../../../utils/agentUtils";
import { generateHierarchicalFormsTool, normalizeAndEnforceFormSchema } from "./formBuilder.tool";
import { FormBuilderOutput } from "./state";
import { saveModularFormSchema } from "../../../tools/helpers";

/**
 * Form Builder Agent Node (Agent 2 of Hierarchy Mapper)
 * Converts Relationship Schema into dynamic hierarchical Form Schema for cascading filter UI.
 */
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

  // 1. Generate fallback Form Schema from tool logic
  const fallbackResult: FormBuilderOutput = await generateHierarchicalFormsTool({
    relationshipBuilderOutput: relOutput,
    schemaResolution: state.schemaResolution,
    userPrompt: state.userPrompt,
  });

  // 2. Assemble prompt for LLM Agent
  const prompt = [
    systemPrompt,
    "## Context",
    relOutput ? `### Input Relationship Schema\n\`\`\`json\n${JSON.stringify(relOutput, null, 2)}\n\`\`\`` : "",
    `### Discovered Candidate Form Structure\n\`\`\`json\n${JSON.stringify(fallbackResult, null, 2)}\n\`\`\``,
    state.userPrompt ? `### User Request\n${state.userPrompt}` : "",
    "Follow the 5 steps in order and output the single clean Form Schema JSON matching the exact filterGroups format in system prompt."
  ].filter(Boolean).join("\n\n");

  const model = getModel();

  await logMilestoneThinking(
    services,
    "Hierarchy Mapper",
    "Executing LLM reasoning for Form Schema generation (grouping by entityScope, priority ordering, controlType decision, optionsSource selection)..."
  );

  // 3. Invoke LLM Agent with AI trace logging
  const agentResult = await invokeAgentJson<any>(
    "formBuilder",
    model,
    prompt,
    fallbackResult,
    services,
    {
      traceLabel: "agent:formBuilder",
    }
  );

  const mergedResult: FormBuilderOutput = {
    ...fallbackResult,
    ...agentResult,
    forms: Array.isArray((agentResult as any)?.filterGroups)
      ? (agentResult as any).filterGroups
      : Array.isArray(agentResult?.forms) && agentResult.forms.length > 0
      ? agentResult.forms
      : fallbackResult.forms,
    filterGroups: Array.isArray((agentResult as any)?.filterGroups)
      ? (agentResult as any).filterGroups
      : Array.isArray(agentResult?.forms) && agentResult.forms.length > 0
      ? agentResult.forms
      : fallbackResult.forms,
  };

  // Enforce deterministic rules: parentFields array, calendar date_range overrides, zero-edge standalone nodes, and accurate summary count
  const finalResult = normalizeAndEnforceFormSchema(mergedResult, relOutput);

  // 4. Save Form Schema into Project Folder with timestamped filename
  if (services?.projectService && services?.projectId) {
    try {
      const proj = await services.projectService.getProjectWithWorkspace(services.projectId);
      if (proj && proj.project) {
        await saveModularFormSchema(proj.workspaceName || "DefaultWorkspace", proj.project.name, finalResult, state.runTimestamp);
      }
    } catch (err) {
      console.warn("[formBuilderNode] Warning saving Form Schema to project folder:", err);
    }
  }

  return {
    formBuilder: finalResult as unknown as Record<string, unknown>,
    status: "running",
    summary: finalResult.summary,
    steps: [{ name: "Form Builder", status: "completed", summary: finalResult.summary }],
  };
}
