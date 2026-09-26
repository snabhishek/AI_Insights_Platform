import { RunnableConfig } from "@langchain/core/runnables";
import { IngestionServices } from "../../state";
import { getModel, invokeAgentJson, getPromptFromFile, logMilestoneThinking } from "../../utils/agentUtils";
import { validateWithRetry } from "../../validator/validatorNode";
import { FeatureArchitectAnnotation, FeatureSelectionOutput } from "./state";
import * as path from "path";
import { getMcpFilesystemTools, getPythonScriptDirectory } from "../../tools";
import {
  ARTIFACT_FEATURE_EXTRACTION,
  ARTIFACT_FEATURE_SELECTION,
  DEFAULT_PIPELINE_SCRIPT_NAME,
  PROMPT_FEATURE_SELECTION,
  REGION_FEATURE_SELECTION,
  STATUS_FAILED,
  STATUS_OK,
  TRACE_FEATURE_SELECTION,
  WORKER_FEATURE_SELECTION,
} from "./constants";

const DEFAULT_USER_PROMPT = "None provided";
const DEFAULT_STAGE_TITLE = "Feature Engineering";
const DEFAULT_STAGE_THINKING = "Generating feature selection recommendations based on all updated features...";
const DEFAULT_SELECTION_SUCCESS = "Feature Selection completed successfully";
const DEFAULT_SELECTION_FAILED = "Feature Selection execution failed/fallback triggered";
const DEFAULT_NO_MODEL_MSG = "No model available for Feature Selection";
const DEFAULT_FALLBACK_SUMMARY = "Feature Selection fallback triggered";
const DEFAULT_SYSTEM_PROMPT_FALLBACK = "You are an expert AI Feature Engineering Agent specialized in feature selection.";
const DEFAULT_NONE_TARGET = "None";
const MAX_RECURSION_LIMIT = 100;

export async function featureSelectionNode(
  state: typeof FeatureArchitectAnnotation.State,
  config?: RunnableConfig
) {
  const services = config?.configurable?.services as IngestionServices;
  const model = getModel();

  const fallback: FeatureSelectionOutput = {
    status: STATUS_FAILED,
    summary: DEFAULT_FALLBACK_SUMMARY,
    recommendations: [],
  };

  if (!model) {
    return {
      featureSelection: fallback,
      history: [
        {
          worker: WORKER_FEATURE_SELECTION,
          summary: DEFAULT_NO_MODEL_MSG,
        },
      ],
    };
  }

  const systemPrompt = await getPromptFromFile(
    PROMPT_FEATURE_SELECTION,
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
    "Design and generate feature selection recommendations based on all updated features and targets.",
    `User Requirements: ${userPromptText}`,
    `Tables List: ${JSON.stringify(state.batchedTables.map((t) => t.tableName))}`,
    `Orchestrator Decisions: ${JSON.stringify(state.orchestrationDecision)}`,
    `Prediction Target Column: ${targetCandidate} (CRITICAL: Preserved target column, exclude from removal/filtering)`,
    `Feature Creation Recommendations: ${JSON.stringify(state.featureCreation?.recommendations)}`,
    `Feature Transformation Recommendations: ${JSON.stringify(state.featureTransformation?.recommendations)}`,
    `Feature Extraction Recommendations: ${JSON.stringify(state.featureExtraction?.recommendations)}`,
    `Input Feature Artifact: ${ARTIFACT_FEATURE_EXTRACTION}`,
    `Target Pipeline File: ${scriptPath}`,
    `Region to Edit: ${REGION_FEATURE_SELECTION}`,
    `Output Artifact: ${ARTIFACT_FEATURE_SELECTION}`,
    "Action Required:",
    `1. Use MCP tool 'read_text_file' on '${scriptPath}' to inspect the exact region markers and line structure (or initialize it using 'write_file' if it does not exist).`,
    `2. Use MCP tool 'edit_file' (or 'write_file') to write/insert your feature selection code into the ${REGION_FEATURE_SELECTION} region in '${scriptPath}', reading from '--input-path' (${ARTIFACT_FEATURE_EXTRACTION}) and saving filtered features to '--output-path' (${ARTIFACT_FEATURE_SELECTION}).`,
    "3. Return the final JSON summary of recommendations.",
  ].join("\n\n");

  try {
    const fsTools = await getMcpFilesystemTools(services);

    const result = await validateWithRetry<FeatureSelectionOutput>(
      WORKER_FEATURE_SELECTION,
      async () =>
        await invokeAgentJson<FeatureSelectionOutput>(
          "featureArchitect",
          model,
          userMessage,
          fallback,
          services,
          {
            systemPrompt,
            traceLabel: TRACE_FEATURE_SELECTION,
            tools: [...fsTools],
            recursionLimit: MAX_RECURSION_LIMIT,
          }
        ),
      fallback,
      services
    );

    const summaryText = result.summary.length > 0 ? result.summary : DEFAULT_SELECTION_SUCCESS;

    return {
      featureSelection: result,
      history: [
        {
          worker: WORKER_FEATURE_SELECTION,
          summary: summaryText,
        },
      ],
    };
  } catch (error) {
    console.warn("[featureSelectionNode] Execution failed, using fallback", error);
    return {
      featureSelection: fallback,
      history: [
        {
          worker: WORKER_FEATURE_SELECTION,
          summary: DEFAULT_SELECTION_FAILED,
        },
      ],
    };
  }
}
