import { RunnableConfig } from "@langchain/core/runnables";
import { IngestionServices } from "../../state";
import { getModel, invokeAgentJson, getPromptFromFile, logMilestoneThinking } from "../../utils/agentUtils";
import { validateWithRetry } from "../../validator/validatorNode";
import { FeatureArchitectAnnotation, FeatureTransformationOutput } from "./state";
import * as path from "path";
import * as fs from "fs";
import { createGetTableColumnsAndProfileTool, getMcpFilesystemTools, getSandboxDirectory, makePipelineTemplate } from "../../tools";


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

  const sandboxDir = getSandboxDirectory(services?.projectId, state.runTimestamp);
  const scriptName = state.aggregatedScriptPath || "aggregated_feature_pipeline.py";
  const scriptPath = path.join(sandboxDir, scriptName);
  if (!fs.existsSync(scriptPath)) {
    fs.writeFileSync(scriptPath, makePipelineTemplate(scriptName), "utf-8");
  }

  const userMessage = [
    "Design and generate feature transformation and imputation recommendations based on Orchestrator decisions and created features.",
    `User Requirements: ${state.userPrompt || "None provided"}`,
    `Tables List: ${JSON.stringify(state.batchedTables.map((t) => t.tableName))}`,
    `Orchestrator Decisions: ${JSON.stringify(state.orchestrationDecision)}`,
    // `Inspector details: ${JSON.stringify(state.inspector)}`,
    `Newly Created Features: ${JSON.stringify(state.featureCreation?.recommendations)}`,
    `Target Pipeline File: ${scriptPath}`,
    `Region to Edit: FEATURE_TRANSFORMATION`,
    "Action Required:",
    `1. Use MCP tool 'read_text_file' on '${scriptPath}' to inspect the exact region markers and line structure.`,
    `2. Use MCP tool 'edit_file' (or 'write_file') to write/insert your feature transformation code into the FEATURE_TRANSFORMATION region in '${scriptPath}'.`,
    "3. Return the final JSON summary of recommendations.",
  ].join("\n\n");

  try {
    const getTableColumnsAndProfileTool = createGetTableColumnsAndProfileTool(state.inspector, state.dataProfile);
    const fsTools = await getMcpFilesystemTools({
      projectId: services?.projectId,
      runTimestamp: state.runTimestamp,
    });

    const result = await validateWithRetry<FeatureTransformationOutput>(
      "featureTransformation",
      async () =>
        await invokeAgentJson<FeatureTransformationOutput>(
          "featureArchitect",
          model,
          userMessage,
          fallback,
          services,
          {
            systemPrompt,
            traceLabel: "featureArchitect:featureTransformation",
            tools: [getTableColumnsAndProfileTool, ...fsTools],
            recursionLimit: 100,
          }
        ),
      fallback,
      services
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
