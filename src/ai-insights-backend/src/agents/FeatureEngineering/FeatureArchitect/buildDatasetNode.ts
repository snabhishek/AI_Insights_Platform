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

  const userMessage = [
    "Generate build dataset script based on source tables and transformed features.",
    `User Requirements: ${userPromptText}`,
    `Tables List: ${JSON.stringify(state.batchedTables.map((t) => t.tableName))}`,
    `Orchestrator Decisions: ${JSON.stringify(state.orchestrationDecision)}`,
    `Feature Transformation Artifact: ${ARTIFACT_FEATURE_TRANSFORMATION}`,
    `Target Pipeline File: ${scriptPath}`,
    `Region to Edit: ${REGION_BUILD_DATASET}`,
    `Output Artifact: ${ARTIFACT_DATASET}`,
    `Metadata Output: ${ARTIFACT_METADATA_YAML}`,
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

    return {
      buildDataset: result,
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
      history: [
        {
          worker: WORKER_BUILD_DATASET,
          summary: DEFAULT_BUILD_FAILED,
        },
      ],
    };
  }
}
