import { RunnableConfig } from "@langchain/core/runnables";
import { IngestionServices } from "../../state";
import { getModel, invokeAgentJson, getPromptFromFile, logMilestoneThinking } from "../../utils/agentUtils";
import { FeatureArchitectAnnotation, FeatureCreationOutput } from "./state";

export async function featureCreationNode(
  state: typeof FeatureArchitectAnnotation.State,
  config?: RunnableConfig
) {
  const services = config?.configurable?.services as IngestionServices;
  const model = getModel();

  const fallback: FeatureCreationOutput = {
    status: "Failed",
    summary: "Feature Creation fallback triggered",
    recommendations: [],
  };

  if (!model) {
    return { featureCreation: fallback };
  }

  const systemPrompt = await getPromptFromFile(
    "featureCreation.md",
    "You are an expert AI Feature Engineering Agent specialized in feature creation."
  );

  if (services) {
    await logMilestoneThinking(
      services,
      "Feature Engineering",
      "Generating feature creation recommendations based on orchestration decisions..."
    );
  }

  const userMessage = [
    "Design and generate feature creation recommendations for the tables and targets determined by the Orchestrator.",
    `User Requirements: ${state.userPrompt || "None provided"}`,
    `Selected Tables: ${JSON.stringify(state.batchedTables.map((t) => t.tableName))}`,
    `Orchestrator Decisions: ${JSON.stringify(state.orchestrationDecision)}`,
    `Inspector details: ${JSON.stringify(state.inspector)}`,
  ].join("\n\n");

  try {
    const result = await invokeAgentJson<FeatureCreationOutput>(
      "featureArchitect",
      model,
      userMessage,
      fallback,
      services,
      {
        systemPrompt,
        traceLabel: "featureArchitect:featureCreation",
      }
    );

    return {
      featureCreation: result,
    };
  } catch (error) {
    console.warn("[featureCreationNode] Execution failed, using fallback", error);
    return {
      featureCreation: fallback,
    };
  }
}
