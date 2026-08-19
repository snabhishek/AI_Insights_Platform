import { RunnableConfig } from "@langchain/core/runnables";
import { IngestionServices } from "../../state";
import { getModel, invokeAgentJson, getPromptFromFile, logMilestoneThinking } from "../../utils/agentUtils";
import { FeatureArchitectAnnotation, FeatureSelectionOutput } from "./state";

export async function featureSelectionNode(
  state: typeof FeatureArchitectAnnotation.State,
  config?: RunnableConfig
) {
  const services = config?.configurable?.services as IngestionServices;
  const model = getModel();

  const fallback: FeatureSelectionOutput = {
    status: "Failed",
    summary: "Feature Selection fallback triggered",
    recommendations: [],
  };

  if (!model) {
    return {
      featureSelection: fallback,
      history: [
        {
          worker: "featureSelection",
          summary: "No model available for Feature Selection",
        },
      ],
    };
  }

  const systemPrompt = await getPromptFromFile(
    "featureSelection.md",
    "You are an expert AI Feature Engineering Agent specialized in feature selection."
  );

  if (services) {
    await logMilestoneThinking(
      services,
      "Feature Engineering",
      "Generating feature selection recommendations based on all updated features..."
    );
  }

  const userMessage = [
    "Design and generate feature selection recommendations based on all updated features and targets.",
    `User Requirements: ${state.userPrompt || "None provided"}`,
    `Selected Tables: ${JSON.stringify(state.batchedTables.map((t) => t.tableName))}`,
    `Orchestrator Decisions: ${JSON.stringify(state.orchestrationDecision)}`,
    `Inspector details: ${JSON.stringify(state.inspector)}`,
    `Feature Creation Recommendations: ${JSON.stringify(state.featureCreation)}`,
    `Feature Transformation Recommendations: ${JSON.stringify(state.featureTransformation)}`,
    `Feature Extraction Recommendations: ${JSON.stringify(state.featureExtraction)}`,
  ].join("\n\n");

  try {
    const result = await invokeAgentJson<FeatureSelectionOutput>(
      "featureArchitect",
      model,
      userMessage,
      fallback,
      services,
      {
        systemPrompt,
        traceLabel: "featureArchitect:featureSelection",
      }
    );

    return {
      featureSelection: result,
      history: [
        {
          worker: "featureSelection",
          summary: result.summary || "Feature Selection completed successfully",
        },
      ],
    };
  } catch (error) {
    console.warn("[featureSelectionNode] Execution failed, using fallback", error);
    return {
      featureSelection: fallback,
      history: [
        {
          worker: "featureSelection",
          summary: "Feature Selection execution failed/fallback triggered",
        },
      ],
    };
  }
}
