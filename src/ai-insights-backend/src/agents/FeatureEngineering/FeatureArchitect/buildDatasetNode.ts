import { RunnableConfig } from "@langchain/core/runnables";
import { IngestionServices } from "../../state";
import { getModel, invokeAgentJson, getPromptFromFile, logMilestoneThinking } from "../../utils/agentUtils";
import { FeatureArchitectAnnotation, BuildDatasetOutput } from "./state";

export async function buildDatasetNode(
  state: typeof FeatureArchitectAnnotation.State,
  config?: RunnableConfig
) {
  const services = config?.configurable?.services as IngestionServices;
  const model = getModel();

  const fallback: BuildDatasetOutput = {
    status: "Failed",
    summary: "Build Dataset fallback triggered",
  };

  if (!model) {
    return { buildDataset: fallback };
  }

  const systemPrompt = await getPromptFromFile(
    "buildDataset.md",
    "You are an expert AI Data Engineering Agent specialized in assembling machine learning datasets."
  );

  if (services) {
    await logMilestoneThinking(
      services,
      "Feature Engineering",
      "Generating dataset assembly code to join all features..."
    );
  }

  const userMessage = [
    "Generate build dataset script based on features created and transformed.",
    `User Requirements: ${state.userPrompt || "None provided"}`,
    `Selected Tables: ${JSON.stringify(state.batchedTables.map((t) => t.tableName))}`,
    `Orchestrator Decisions: ${JSON.stringify(state.orchestrationDecision)}`,
    `Feature Creation Recommendations: ${JSON.stringify(state.featureCreation)}`,
    `Feature Transformation Recommendations: ${JSON.stringify(state.featureTransformation)}`,
  ].join("\n\n");

  try {
    const result = await invokeAgentJson<BuildDatasetOutput>(
      "featureArchitect",
      model,
      userMessage,
      fallback,
      services,
      {
        systemPrompt,
        traceLabel: "featureArchitect:buildDataset",
      }
    );

    return {
      buildDataset: result,
      history: [
        {
          worker: "buildDataset",
          summary: result.summary || "Build Dataset script generated successfully",
        },
      ],
    };
  } catch (error) {
    console.warn("[buildDatasetNode] Execution failed, using fallback", error);
    return {
      buildDataset: fallback,
      history: [
        {
          worker: "buildDataset",
          summary: "Build Dataset code generation failed/fallback triggered",
        },
      ],
    };
  }
}
