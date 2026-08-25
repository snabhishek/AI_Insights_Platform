import { RunnableConfig } from "@langchain/core/runnables";
import { IngestionServices } from "../../state";
import { getModel, invokeAgentJson, getPromptFromFile, logMilestoneThinking } from "../../utils/agentUtils";
import { validateWithRetry } from "../../validator/validatorNode";
import { FeatureArchitectAnnotation, FeatureExtractionOutput } from "./state";
import * as path from "path";
import * as fs from "fs";
import { getMcpFilesystemTools, getSandboxDirectory, makePipelineTemplate } from "../../tools";

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
    return {
      featureExtraction: fallback,
      history: [
        {
          worker: "featureExtraction",
          summary: "No model available for Feature Extraction",
        },
      ],
    };
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

  const sandboxDir = getSandboxDirectory(services?.projectId, state.runTimestamp);
  const scriptName = state.aggregatedScriptPath || "aggregated_feature_pipeline.py";
  const scriptPath = path.join(sandboxDir, scriptName);
  if (!fs.existsSync(scriptPath)) {
    fs.writeFileSync(scriptPath, makePipelineTemplate(scriptName), "utf-8");
  }

  const userMessage = [
    "Design and generate feature extraction and dimensionality reduction recommendations based on the complete updated feature sets.",
    `User Requirements: ${state.userPrompt || "None provided"}`,
    `Tables List: ${JSON.stringify(state.batchedTables.map((t) => t.tableName))}`,
    `Orchestrator Decisions: ${JSON.stringify(state.orchestrationDecision)}`,
    // `Inspector details: ${JSON.stringify(state.inspector)}`,
    `Feature Creation Recommendations: ${JSON.stringify(state.featureCreation?.recommendations)}`,
    `Feature Transformation Recommendations: ${JSON.stringify(state.featureTransformation?.recommendations)}`,
    `Target Pipeline File: ${scriptPath}`,
    `Region to Edit: FEATURE_EXTRACTION`,
    "Action Required:",
    `1. Use MCP tool 'read_text_file' on '${scriptPath}' to inspect the exact region markers and line structure.`,
    `2. Use MCP tool 'edit_file' (or 'write_file') to write/insert your feature extraction code into the FEATURE_EXTRACTION region in '${scriptPath}'.`,
    "3. Return the final JSON summary of recommendations.",
  ].join("\n\n");

  try {
    const fsTools = await getMcpFilesystemTools({
      projectId: services?.projectId,
      runTimestamp: state.runTimestamp,
    });

    const result = await validateWithRetry<FeatureExtractionOutput>(
      "featureExtraction",
      async () =>
        await invokeAgentJson<FeatureExtractionOutput>(
          "featureArchitect",
          model,
          userMessage,
          fallback,
          services,
          {
            systemPrompt,
            traceLabel: "featureArchitect:featureExtraction",
            tools: [...fsTools],
            recursionLimit: 100,
          }
        ),
      fallback,
      services
    );

    return {
      featureExtraction: result,
      history: [
        {
          worker: "featureExtraction",
          summary: result.summary || "Feature Extraction completed successfully",
        },
      ],
    };
  } catch (error) {
    console.warn("[featureExtractionNode] Execution failed, using fallback", error);
    return {
      featureExtraction: fallback,
      history: [
        {
          worker: "featureExtraction",
          summary: "Feature Extraction execution failed/fallback triggered",
        },
      ],
    };
  }
}
