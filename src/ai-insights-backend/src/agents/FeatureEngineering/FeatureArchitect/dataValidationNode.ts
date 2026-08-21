import { RunnableConfig } from "@langchain/core/runnables";
import { IngestionServices } from "../../state";
import { getModel, invokeAgentJson, getPromptFromFile, logMilestoneThinking } from "../../utils/agentUtils";
import { FeatureArchitectAnnotation, DataValidationOutput } from "./state";

export async function dataValidationNode(
  state: typeof FeatureArchitectAnnotation.State,
  config?: RunnableConfig
) {
  const services = config?.configurable?.services as IngestionServices;
  const model = getModel();

  const fallback: DataValidationOutput = {
    status: "Failed",
    summary: "Data Validation fallback triggered",
  };

  if (!model) {
    return { dataValidation: fallback };
  }

  const systemPrompt = await getPromptFromFile(
    "dataValidation.md",
    "You are an expert AI Data Quality and Validation Agent."
  );

  if (services) {
    await logMilestoneThinking(
      services,
      "Feature Engineering",
      "Generating data validation code to audit the baseline dataset..."
    );
  }

  const userMessage = [
    "Generate data validation script to audit the baseline dataset.",
    `User Requirements: ${state.userPrompt || "None provided"}`,
    `Selected Tables: ${JSON.stringify(state.batchedTables.map((t) => t.tableName))}`,
    `Orchestrator Decisions: ${JSON.stringify(state.orchestrationDecision)}`,
    `Assembled Dataset Script: ${state.buildDataset.pythonCode || ""}`,
  ].join("\n\n");

  try {
    const result = await invokeAgentJson<DataValidationOutput>(
      "featureArchitect",
      model,
      userMessage,
      fallback,
      services,
      {
        systemPrompt,
        traceLabel: "featureArchitect:dataValidation",
      }
    );

    return {
      dataValidation: result,
      history: [
        {
          worker: "dataValidation",
          summary: result.summary || "Data Validation script generated successfully",
        },
      ],
    };
  } catch (error) {
    console.warn("[dataValidationNode] Execution failed, using fallback", error);
    return {
      dataValidation: fallback,
      history: [
        {
          worker: "dataValidation",
          summary: "Data Validation code generation failed/fallback triggered",
        },
      ],
    };
  }
}
