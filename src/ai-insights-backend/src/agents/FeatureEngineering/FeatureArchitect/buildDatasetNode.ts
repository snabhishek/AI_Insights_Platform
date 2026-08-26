import { RunnableConfig } from "@langchain/core/runnables";
import { IngestionServices } from "../../state";
import { getModel, invokeAgentJson, getPromptFromFile, logMilestoneThinking } from "../../utils/agentUtils";
import { validateWithRetry } from "../../validator/validatorNode";
import { FeatureArchitectAnnotation, BuildDatasetOutput } from "./state";
import * as path from "path";
import * as fs from "fs";
import { getMcpFilesystemTools, getSandboxDirectory, makePipelineTemplate } from "../../tools";

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

  const sandboxDir = getSandboxDirectory(services?.projectId, state.runTimestamp);
  const scriptName = state.aggregatedScriptPath || "aggregated_feature_pipeline.py";
  const scriptPath = path.join(sandboxDir, scriptName);
  if (!fs.existsSync(scriptPath)) {
    fs.writeFileSync(scriptPath, makePipelineTemplate(scriptName), "utf-8");
  }

  const userMessage = [
    "Generate build dataset script based on features created and transformed.",
    `User Requirements: ${state.userPrompt || "None provided"}`,
    `Tables List: ${JSON.stringify(state.batchedTables.map((t) => t.tableName))}`,
    `Orchestrator Decisions: ${JSON.stringify(state.orchestrationDecision)}`,
    `Feature Creation Recommendations: ${JSON.stringify(state.featureCreation?.recommendations)}`,
    `Feature Transformation Recommendations: ${JSON.stringify(state.featureTransformation?.recommendations)}`,
    `Target Pipeline File: ${scriptPath}`,
    `Region to Edit: BUILD_DATASET`,
    "Action Required:",
    `1. Use MCP tool 'read_text_file' on '${scriptPath}' to inspect the exact region markers and line structure.`,
    `2. Use MCP tool 'edit_file' (or 'write_file') to write/insert your dataset assembly code into the BUILD_DATASET region in '${scriptPath}'.`,
    "3. Return the final JSON summary.",
  ].join("\n\n");

  try {
    const fsTools = await getMcpFilesystemTools({
      projectId: services?.projectId,
      runTimestamp: state.runTimestamp,
    });

    const result = await validateWithRetry<BuildDatasetOutput>(
      "buildDataset",
      async () =>
        await invokeAgentJson<BuildDatasetOutput>(
          "featureArchitect",
          model,
          userMessage,
          fallback,
          services,
          {
            systemPrompt,
            traceLabel: "featureArchitect:buildDataset",
            tools: [...fsTools],
            recursionLimit: 100,
          }
        ),
      fallback,
      services
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
