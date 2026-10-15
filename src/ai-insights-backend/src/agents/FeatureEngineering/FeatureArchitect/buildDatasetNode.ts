import { RunnableConfig } from "@langchain/core/runnables";
import { IngestionServices } from "../../state";
import { getModel, invokeAgentJson, getPromptFromFile, logMilestoneThinking } from "../../utils/agentUtils";
import { validateWithRetry } from "../../validator/validatorNode";
import { FeatureArchitectAnnotation, BuildDatasetOutput } from "./state";
import * as path from "path";
import { getMcpFilesystemTools, getPythonScriptDirectory } from "../../tools";
import {
  ARTIFACT_DATASET,
  ARTIFACT_FEATURE_TRANSFORMATION,
  ARTIFACT_METADATA_YAML,
  DEFAULT_PIPELINE_SCRIPT_NAME,
  PROMPT_BUILD_DATASET,
  REGION_BUILD_DATASET,
  STATUS_FAILED,
  STATUS_OK,
  TRACE_BUILD_DATASET,
  WORKER_BUILD_DATASET,
} from "./constants";

const DEFAULT_USER_PROMPT = "None provided";
const DEFAULT_STAGE_TITLE = "Feature Engineering";
const DEFAULT_STAGE_THINKING = "Generating dataset assembly code to join all features and base tables...";
const DEFAULT_BUILD_SUCCESS = "Build Dataset script generated successfully";
const DEFAULT_BUILD_FAILED = "Build Dataset code generation failed/fallback triggered";
const DEFAULT_NO_MODEL_MSG = "No model available for Build Dataset";
const DEFAULT_FALLBACK_SUMMARY = "Build Dataset fallback triggered";
const DEFAULT_SYSTEM_PROMPT_FALLBACK = "You are an expert AI Data Engineering Agent specialized in assembling machine learning datasets.";
const MAX_RECURSION_LIMIT = 100;

export async function buildDatasetNode(
  state: typeof FeatureArchitectAnnotation.State,
  config?: RunnableConfig
) {
  const services = config?.configurable?.services as IngestionServices;
  const model = getModel();

  const fallback: BuildDatasetOutput = {
    status: STATUS_FAILED,
    summary: DEFAULT_FALLBACK_SUMMARY,
  };

  if (!model) {
    return {
      buildDataset: fallback,
      history: [
        {
          worker: WORKER_BUILD_DATASET,
          summary: DEFAULT_NO_MODEL_MSG,
        },
      ],
    };
  }

  const systemPrompt = await getPromptFromFile(
    PROMPT_BUILD_DATASET,
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
    : (state.orchestrationDecision?.prediction_target_column || state.orchestrationDecision?.targetColumn || "");

  const userMessage = [
    "Generate build dataset script based on source tables and transformed features.",
    `User Requirements: ${userPromptText}`,
    `Tables List: ${JSON.stringify(state.batchedTables.map((t) => t.tableName))}`,
    `Orchestrator Decisions: ${JSON.stringify(state.orchestrationDecision)}`,
    ...(targetCandidate ? [`Prediction Target Column: ${targetCandidate} (Include this target column in the assembled dataset.parquet)`] : []),
    `Feature Transformation Artifact: ${ARTIFACT_FEATURE_TRANSFORMATION}`,
    `Target Pipeline File: ${scriptPath}`,
    `Region to Edit: ${REGION_BUILD_DATASET}`,
    `Output Artifact: ${ARTIFACT_DATASET}`,
    `Metadata Output: ${ARTIFACT_METADATA_YAML}`,
    "Critical Input Loading & Discovery Constraints:",
    "- Read base tables directly from '--db-path' (search root of '--db-path' for matching table DuckDB databases or CSV/Parquet files).",
    "- Read engineered features from '--features-path' (feature_transformation.parquet).",
    "- NEVER treat other pipeline output artifacts ('dataset.parquet', 'feature_extraction.parquet', etc.) as input base tables.",
    "- Do NOT perform recursive directory walks that enter timestamped subdirectories in '--db-path'.",
    "CRITICAL IMPLEMENTATION MANDATE - STRICT FAIL FAST (NO FALLBACKS):",
    "- DO NOT write try-except blocks or fallback code that catches errors, suppresses exceptions, or generates dummy fallback datasets.",
    "- If base tables or transformed features cannot be found or joined, or if required columns/targets are missing, explicitly raise an Exception so execution terminates immediately.",
    "Action Required:",
    `1. Use MCP tool 'read_text_file' on '${scriptPath}' to inspect the exact region markers and line structure (or initialize it using 'write_file' if it does not exist).`,
    `2. Use MCP tool 'edit_file' (or 'write_file') to write/insert your dataset assembly code into the ${REGION_BUILD_DATASET} region in '${scriptPath}', combining base tables with '--features-path' (${ARTIFACT_FEATURE_TRANSFORMATION}) and saving the dataset to '--output-path' (${ARTIFACT_DATASET}).`,
    "3. Return the final JSON summary.",
  ].join("\n\n");

  try {
    const fsTools = await getMcpFilesystemTools(services);

    const result = await validateWithRetry<BuildDatasetOutput>(
      WORKER_BUILD_DATASET,
      async () =>
        await invokeAgentJson<BuildDatasetOutput>(
          "featureArchitect",
          model,
          userMessage,
          fallback,
          services,
          {
            systemPrompt,
            traceLabel: TRACE_BUILD_DATASET,
            tools: [...fsTools],
            recursionLimit: MAX_RECURSION_LIMIT,
          }
        ),
      fallback,
      services
    );

    const summaryText = result.summary.length > 0 ? result.summary : DEFAULT_BUILD_SUCCESS;
    const resolvedTarget = (result as any)?.prediction_target_column || (result as any)?.targetColumn || targetCandidate;

    return {
      buildDataset: result,
      ...(resolvedTarget ? { prediction_target_column: resolvedTarget } : {}),
      history: [
        {
          worker: WORKER_BUILD_DATASET,
          summary: summaryText,
        },
      ],
    };
  } catch (error) {
    console.warn("[buildDatasetNode] Execution failed, using fallback", error);
    return {
      buildDataset: fallback,
      ...(targetCandidate ? { prediction_target_column: targetCandidate } : {}),
      history: [
        {
          worker: WORKER_BUILD_DATASET,
          summary: DEFAULT_BUILD_FAILED,
        },
      ],
    };
  }
}
