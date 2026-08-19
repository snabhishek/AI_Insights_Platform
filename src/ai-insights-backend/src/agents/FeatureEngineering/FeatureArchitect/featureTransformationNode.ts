import { RunnableConfig } from "@langchain/core/runnables";
import { IngestionServices } from "../../state";
import { getModel, invokeAgentJson, getPromptFromFile, logMilestoneThinking } from "../../utils/agentUtils";
import { FeatureArchitectAnnotation, FeatureTransformationOutput } from "./state";

export async function featureTransformationNode(
  state: typeof FeatureArchitectAnnotation.State,
  config?: RunnableConfig
) {
  const services = config?.configurable?.services as IngestionServices;
  const model = getModel();

  const fallback: FeatureTransformationOutput = {
    status: "Failed",
    summary: "Feature Transformation fallback triggered",
    recommendations: [],
  };

  if (!model) {
    return {
      featureTransformation: fallback,
      history: [
        {
          worker: "featureTransformation",
          summary: "No model available for Feature Transformation",
        },
      ],
    };
  }

  const systemPrompt = await getPromptFromFile(
    "featureTransformation.md",
    "You are an expert AI Feature Engineering Agent specialized in feature transformation and missing value imputation."
  );

  if (services) {
    await logMilestoneThinking(
      services,
      "Feature Engineering",
      "Generating feature transformation and imputation recommendations based on orchestration decisions..."
    );
  }

  const userMessage = [
    "Design and generate feature transformation and imputation recommendations based on Orchestrator decisions and created features.",
    `User Requirements: ${state.userPrompt || "None provided"}`,
    `Selected Tables: ${JSON.stringify(state.batchedTables.map((t) => t.tableName))}`,
    `Orchestrator Decisions: ${JSON.stringify(state.orchestrationDecision)}`,
    `Inspector details: ${JSON.stringify(state.inspector)}`,
    `Newly Created Features: ${JSON.stringify(state.featureCreation)}`,
  ].join("\n\n");

  try {
    const result = await invokeAgentJson<FeatureTransformationOutput>(
      "featureArchitect",
      model,
      userMessage,
      fallback,
      services,
      {
        systemPrompt,
        traceLabel: "featureArchitect:featureTransformation",
      }
    );

    return {
      featureTransformation: result,
      history: [
        {
          worker: "featureTransformation",
          summary: result.summary || "Feature Transformation completed successfully",
        },
      ],
    };
  } catch (error) {
    console.warn("[featureTransformationNode] Execution failed, using fallback", error);
    return {
      featureTransformation: fallback,
      history: [
        {
          worker: "featureTransformation",
          summary: "Feature Transformation execution failed/fallback triggered",
        },
      ],
    };
  }
}
