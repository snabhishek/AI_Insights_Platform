import { RunnableConfig } from "@langchain/core/runnables";
import { IngestionServices } from "../../state";
import { getModel, invokeAgentJson, getPromptFromFile, logMilestoneThinking } from "../../utils/agentUtils";
import { FeatureArchitectAnnotation, OrchestrationDecisionOutput } from "./state";

export async function orchestratorNode(
  state: typeof FeatureArchitectAnnotation.State,
  config?: RunnableConfig
) {
  const services = config?.configurable?.services as IngestionServices;
  const model = getModel();

  const fallback: OrchestrationDecisionOutput = {
    status: "Failed",
    summary: "Orchestration decision fallback triggered",
    decisions: [],
  };

  if (!model) {
    return { orchestrationDecision: fallback };
  }

  const systemPrompt = await getPromptFromFile(
    "featureOrchestrator.md",
    "You are an expert AI Feature Engineering Orchestrator Agent."
  );

  if (services) {
    await logMilestoneThinking(
      services,
      "Feature Engineering",
      "Analyzing inputs to orchestrate feature creation and feature transformation tasks..."
    );
  }

  const userMessage = [
    "Analyze the schema and user requirement to determine which columns require feature creation and feature transformation.",
    `User Requirements: ${state.userPrompt || "None provided"}`,
    `Selected Tables: ${JSON.stringify(state.batchedTables.map((t) => t.tableName))}`,
    `Inspector details: ${JSON.stringify(state.inspector)}`,
  ].join("\n\n");

  try {
    const result = await invokeAgentJson<OrchestrationDecisionOutput>(
      "featureArchitect",
      model,
      userMessage,
      fallback,
      services,
      {
        systemPrompt,
        traceLabel: "featureArchitect:orchestrator",
      }
    );

    return {
      orchestrationDecision: result,
    };
  } catch (error) {
    console.warn("[orchestratorNode] Execution failed, using fallback", error);
    return {
      orchestrationDecision: fallback,
    };
  }
}
