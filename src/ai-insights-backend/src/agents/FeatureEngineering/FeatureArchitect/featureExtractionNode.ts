import { RunnableConfig } from "@langchain/core/runnables";
import { IngestionServices } from "../../state";
import { getModel, invokeAgentJson, getPromptFromFile, logMilestoneThinking } from "../../utils/agentUtils";
import { FeatureArchitectAnnotation, FeatureExtractionOutput } from "./state";

export async function featureExtractionNode(
  state: typeof FeatureArchitectAnnotation.State,
  config?: RunnableConfig
) {
  const services = config?.configurable?.services as IngestionServices;
  const model = getModel();

  const fallback: FeatureExtractionOutput = {
    status: "Failed",
    summary: "Feature Extraction fallback triggered",
    recommendations: [],
  };

  if (!model) {
    return { featureExtraction: fallback };
  }

  const systemPrompt = await getPromptFromFile(
    "featureExtraction.md",
    "You are an expert AI Feature Engineering Agent specialized in feature extraction and dimensionality reduction."
  );

  if (services) {
    await logMilestoneThinking(
      services,
      "Feature Engineering",
      "Generating feature extraction and dimensionality reduction recommendations based on updated feature schemas..."
    );
  }

  const userMessage = [
    "Design and generate feature extraction and dimensionality reduction recommendations based on the complete updated feature sets.",
    `User Requirements: ${state.userPrompt || "None provided"}`,
    `Selected Tables: ${JSON.stringify(state.batchedTables.map((t) => t.tableName))}`,
    `Orchestrator Decisions: ${JSON.stringify(state.orchestrationDecision)}`,
    `Inspector details: ${JSON.stringify(state.inspector)}`,
    `Feature Creation Recommendations: ${JSON.stringify(state.featureCreation)}`,
    `Feature Transformation Recommendations: ${JSON.stringify(state.featureTransformation)}`,
  ].join("\n\n");

  try {
    const result = await invokeAgentJson<FeatureExtractionOutput>(
      "featureArchitect",
      model,
      userMessage,
      fallback,
      services,
      {
        systemPrompt,
        traceLabel: "featureArchitect:featureExtraction",
      }
    );

    return {
      featureExtraction: result,
    };
  } catch (error) {
    console.warn("[featureExtractionNode] Execution failed, using fallback", error);
    return {
      featureExtraction: fallback,
    };
  }
}
