import { RunnableConfig } from "@langchain/core/runnables";
import { IngestionServices } from "../../state";
import { getModel, invokeAgentJson, getPromptFromFile, logMilestoneThinking } from "../../utils/agentUtils";
import { validateWithRetry } from "../../validator/validatorNode";
import { FeatureArchitectAnnotation, FeatureExtractionOutput } from "./state";
import * as path from "path";
import { getMcpFilesystemTools, getPythonScriptDirectory } from "../../tools";
import {
  ARTIFACT_DATASET,
  ARTIFACT_FEATURE_EXTRACTION,
  DEFAULT_PIPELINE_SCRIPT_NAME,
  PROMPT_FEATURE_EXTRACTION,
  REGION_FEATURE_EXTRACTION,
  STATUS_FAILED,
  STATUS_OK,
  TRACE_FEATURE_EXTRACTION,
  WORKER_FEATURE_EXTRACTION,
} from "./constants";

const DEFAULT_USER_PROMPT = "None provided";
const DEFAULT_STAGE_TITLE = "Feature Engineering";
const DEFAULT_STAGE_THINKING = "Generating feature extraction and dimensionality reduction recommendations based on updated feature schemas...";
const DEFAULT_EXTRACTION_SUCCESS = "Feature Extraction completed successfully";
const DEFAULT_EXTRACTION_FAILED = "Feature Extraction execution failed/fallback triggered";
const DEFAULT_NO_MODEL_MSG = "No model available for Feature Extraction";
const DEFAULT_FALLBACK_SUMMARY = "Feature Extraction fallback triggered";
const DEFAULT_SYSTEM_PROMPT_FALLBACK = "You are an expert AI Feature Engineering Agent specialized in feature extraction and dimensionality reduction.";
const DEFAULT_NONE_TARGET = "None";
const MAX_RECURSION_LIMIT = 100;

export async function featureExtractionNode(
  state: typeof FeatureArchitectAnnotation.State,
  config?: RunnableConfig
) {
  const services = config?.configurable?.services as IngestionServices;
  const model = getModel();

  const fallback: FeatureExtractionOutput = {
    status: STATUS_FAILED,
    summary: DEFAULT_FALLBACK_SUMMARY,
    recommendations: [],
  };

  if (!model) {
    return {
      featureExtraction: fallback,
      history: [
        {
          worker: WORKER_FEATURE_EXTRACTION,
          summary: DEFAULT_NO_MODEL_MSG,
        },
      ],
    };
  }

  const systemPrompt = await getPromptFromFile(
    PROMPT_FEATURE_EXTRACTION,
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

  const targetCandidate = state.prediction_target_column.length > 0
    ? state.prediction_target_column
    : (state.orchestrationDecision.targetColumn ?? DEFAULT_NONE_TARGET);

  const userMessage = [
    "Design and generate feature extraction and dimensionality reduction recommendations based on the complete updated feature sets.",
    `User Requirements: ${userPromptText}`,
    `Tables List: ${JSON.stringify(state.batchedTables.map((t) => t.tableName))}`,
    `Orchestrator Decisions: ${JSON.stringify(state.orchestrationDecision)}`,
    `Prediction Target Column: ${targetCandidate} (CRITICAL: Exclude this target column from dimensionality reduction/extraction)`,
    `Feature Creation Recommendations: ${JSON.stringify(state.featureCreation?.recommendations)}`,
    `Feature Transformation Recommendations: ${JSON.stringify(state.featureTransformation?.recommendations)}`,
    `Input Dataset Artifact: ${ARTIFACT_DATASET}`,
    `Target Pipeline File: ${scriptPath}`,
    `Region to Edit: ${REGION_FEATURE_EXTRACTION}`,
    `Output Artifact: ${ARTIFACT_FEATURE_EXTRACTION}`,
    "Action Required:",
    `1. Use MCP tool 'read_text_file' on '${scriptPath}' to inspect the exact region markers and line structure (or initialize it using 'write_file' if it does not exist).`,
    `2. Use MCP tool 'edit_file' (or 'write_file') to write/insert your feature extraction code into the ${REGION_FEATURE_EXTRACTION} region in '${scriptPath}', reading from '--input-path' (${ARTIFACT_DATASET}) and saving extracted features to '--output-path' (${ARTIFACT_FEATURE_EXTRACTION}).`,
    "3. Return the final JSON summary of recommendations.",
  ].join("\n\n");

  try {
    const fsTools = await getMcpFilesystemTools(services);

    const result = await validateWithRetry<FeatureExtractionOutput>(
      WORKER_FEATURE_EXTRACTION,
      async () =>
        await invokeAgentJson<FeatureExtractionOutput>(
          "featureArchitect",
          model,
          userMessage,
          fallback,
          services,
          {
            systemPrompt,
            traceLabel: TRACE_FEATURE_EXTRACTION,
            tools: [...fsTools],
            recursionLimit: MAX_RECURSION_LIMIT,
          }
        ),
      fallback,
      services
    );

    const summaryText = result.summary.length > 0 ? result.summary : DEFAULT_EXTRACTION_SUCCESS;

    return {
      featureExtraction: result,
      history: [
        {
          worker: WORKER_FEATURE_EXTRACTION,
          summary: summaryText,
        },
      ],
    };
  } catch (error) {
    console.warn("[featureExtractionNode] Execution failed, using fallback", error);
    return {
      featureExtraction: fallback,
      history: [
        {
          worker: WORKER_FEATURE_EXTRACTION,
          summary: DEFAULT_EXTRACTION_FAILED,
        },
      ],
    };
  }
}
