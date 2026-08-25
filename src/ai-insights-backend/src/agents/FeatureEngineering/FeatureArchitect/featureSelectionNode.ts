import { RunnableConfig } from "@langchain/core/runnables";
import { IngestionServices } from "../../state";
import { getModel, invokeAgentJson, getPromptFromFile, logMilestoneThinking } from "../../utils/agentUtils";
import { validateWithRetry } from "../../validator/validatorNode";
import { FeatureArchitectAnnotation, FeatureSelectionOutput } from "./state";
import * as path from "path";
import * as fs from "fs";
import { getMcpFilesystemTools, getSandboxDirectory, makePipelineTemplate } from "../../tools";

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

  const sandboxDir = getSandboxDirectory(services?.projectId, state.runTimestamp);
  const scriptName = state.aggregatedScriptPath || "aggregated_feature_pipeline.py";
  const scriptPath = path.join(sandboxDir, scriptName);
  if (!fs.existsSync(scriptPath)) {
    fs.writeFileSync(scriptPath, makePipelineTemplate(scriptName), "utf-8");
  }

  const userMessage = [
    "Design and generate feature selection recommendations based on all updated features and targets.",
    `User Requirements: ${state.userPrompt || "None provided"}`,
    `Tables List: ${JSON.stringify(state.batchedTables.map((t) => t.tableName))}`,
    `Orchestrator Decisions: ${JSON.stringify(state.orchestrationDecision)}`,
    // `Inspector details: ${JSON.stringify(state.inspector)}`,
    `Feature Creation Recommendations: ${JSON.stringify(state.featureCreation?.recommendations)}`,
    `Feature Transformation Recommendations: ${JSON.stringify(state.featureTransformation?.recommendations)}`,
    `Feature Extraction Recommendations: ${JSON.stringify(state.featureExtraction?.recommendations)}`,
    `Target Pipeline File: ${scriptPath}`,
    `Region to Edit: FEATURE_SELECTION`,
    "Action Required:",
    `1. Use MCP tool 'read_text_file' on '${scriptPath}' to inspect the exact region markers and line structure.`,
    `2. Use MCP tool 'edit_file' (or 'write_file') to write/insert your feature selection code into the FEATURE_SELECTION region in '${scriptPath}'.`,
    "3. Return the final JSON summary of recommendations.",
  ].join("\n\n");

  try {
    const fsTools = await getMcpFilesystemTools({
      projectId: services?.projectId,
      runTimestamp: state.runTimestamp,
    });

    const result = await validateWithRetry<FeatureSelectionOutput>(
      "featureSelection",
      async () =>
        await invokeAgentJson<FeatureSelectionOutput>(
          "featureArchitect",
          model,
          userMessage,
          fallback,
          services,
          {
            systemPrompt,
            traceLabel: "featureArchitect:featureSelection",
            tools: [...fsTools],
            recursionLimit: 100,
          }
        ),
      fallback,
      services
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
