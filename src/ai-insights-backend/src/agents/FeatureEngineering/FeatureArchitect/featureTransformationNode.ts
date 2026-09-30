import { RunnableConfig } from "@langchain/core/runnables";
import { IngestionServices } from "../../state";
import { getModel, invokeAgentJson, getPromptFromFile, logMilestoneThinking } from "../../utils/agentUtils";
import { validateWithRetry } from "../../validator/validatorNode";
import { FeatureArchitectAnnotation, FeatureTransformationOutput } from "./state";
import * as path from "path";
import { createGetTableColumnsAndProfileTool, getMcpFilesystemTools, getPythonScriptDirectory } from "../../tools";
import {
  ARTIFACT_FEATURE_CREATED,
  ARTIFACT_FEATURE_TRANSFORMATION,
  DEFAULT_PIPELINE_SCRIPT_NAME,
  PROMPT_FEATURE_TRANSFORMATION,
  REGION_FEATURE_TRANSFORMATION,
  STATUS_FAILED,
  STATUS_OK,
  TRACE_FEATURE_TRANSFORMATION,
  WORKER_FEATURE_TRANSFORMATION,
} from "./constants";

const DEFAULT_USER_PROMPT = "None provided";
const DEFAULT_STAGE_TITLE = "Feature Engineering";
const DEFAULT_STAGE_THINKING = "Generating feature transformation and imputation recommendations based on orchestration decisions...";
const DEFAULT_TRANSFORMATION_SUCCESS = "Feature Transformation completed successfully";
const DEFAULT_TRANSFORMATION_FAILED = "Feature Transformation execution failed/fallback triggered";
const DEFAULT_NO_MODEL_MSG = "No model available for Feature Transformation";
const DEFAULT_FALLBACK_SUMMARY = "Feature Transformation fallback triggered";
const DEFAULT_SYSTEM_PROMPT_FALLBACK = "You are an expert AI Feature Engineering Agent specialized in feature transformation and missing value imputation.";
const MAX_RECURSION_LIMIT = 100;

export async function featureTransformationNode(
  state: typeof FeatureArchitectAnnotation.State,
  config?: RunnableConfig
) {
  const services = config?.configurable?.services as IngestionServices;
  const model = getModel();

  const fallback: FeatureTransformationOutput = {
    status: STATUS_FAILED,
    summary: DEFAULT_FALLBACK_SUMMARY,
    recommendations: [],
  };

  if (!model) {
    return {
      featureTransformation: fallback,
      history: [
        {
          worker: WORKER_FEATURE_TRANSFORMATION,
          summary: DEFAULT_NO_MODEL_MSG,
        },
      ],
    };
  }

  const systemPrompt = await getPromptFromFile(
    PROMPT_FEATURE_TRANSFORMATION,
    DEFAULT_SYSTEM_PROMPT_FALLBACK
  );

  if (services) {
    await logMilestoneThinking(
      services,
      DEFAULT_STAGE_TITLE,
      DEFAULT_STAGE_THINKING
    );
  }

  const pythonScriptDir = getPythonScriptDirectory(services, state.runTimestamp);
  const scriptName = state.aggregatedScriptPath ?? DEFAULT_PIPELINE_SCRIPT_NAME;
  const scriptPath = path.join(pythonScriptDir, scriptName);
  const userPromptText = state.userPrompt ?? DEFAULT_USER_PROMPT;

  const userMessage = [
    "Design and generate feature transformation and imputation recommendations based on Orchestrator decisions and created features.",
    `User Requirements: ${userPromptText}`,
    `Tables List: ${JSON.stringify(state.batchedTables.map((t) => t.tableName))}`,
    `Orchestrator Decisions: ${JSON.stringify(state.orchestrationDecision)}`,
    `Newly Created Features: ${JSON.stringify(state.featureCreation?.recommendations)}`,
    `Input Feature File: ${ARTIFACT_FEATURE_CREATED}`,
    `Target Pipeline File: ${scriptPath}`,
    `Region to Edit: ${REGION_FEATURE_TRANSFORMATION}`,
    `Output Artifact: ${ARTIFACT_FEATURE_TRANSFORMATION}`,
    "Action Required:",
    `1. Use MCP tool 'read_text_file' on '${scriptPath}' to inspect the exact region markers and line structure (or initialize it using 'write_file' if it does not exist).`,
    `2. Use MCP tool 'edit_file' (or 'write_file') to write/insert your feature transformation code into the ${REGION_FEATURE_TRANSFORMATION} region in '${scriptPath}', reading from '--input-path' (${ARTIFACT_FEATURE_CREATED}) and saving transformed features to '--output-path' (${ARTIFACT_FEATURE_TRANSFORMATION}).`,
    "3. Return the final JSON summary of recommendations.",
  ].join("\n\n");

  try {
    const getTableColumnsAndProfileTool = createGetTableColumnsAndProfileTool(state.inspector, state.dataProfile);
    const fsTools = await getMcpFilesystemTools(services);

    const result = await validateWithRetry<FeatureTransformationOutput>(
      WORKER_FEATURE_TRANSFORMATION,
      async () =>
        await invokeAgentJson<FeatureTransformationOutput>(
          "featureArchitect",
          model,
          userMessage,
          fallback,
          services,
          {
            systemPrompt,
            traceLabel: TRACE_FEATURE_TRANSFORMATION,
            tools: [getTableColumnsAndProfileTool, ...fsTools],
            recursionLimit: MAX_RECURSION_LIMIT,
          }
        ),
      fallback,
      services
    );

    const summaryText = result.summary.length > 0 ? result.summary : DEFAULT_TRANSFORMATION_SUCCESS;

    return {
      featureTransformation: result,
      history: [
        {
          worker: WORKER_FEATURE_TRANSFORMATION,
          summary: summaryText,
        },
      ],
    };
  } catch (error) {
    console.warn("[featureTransformationNode] Execution failed, using fallback", error);
    return {
      featureTransformation: fallback,
      history: [
        {
          worker: WORKER_FEATURE_TRANSFORMATION,
          summary: DEFAULT_TRANSFORMATION_FAILED,
        },
      ],
    };
  }
}
