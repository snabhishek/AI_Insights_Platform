import { RunnableConfig } from "@langchain/core/runnables";
import { IngestionServices } from "../../state";
import { getModel, invokeAgentJson, getPromptFromFile, logMilestoneThinking } from "../../utils/agentUtils";
import { validateWithRetry } from "../../validator/validatorNode";
import { FeatureArchitectAnnotation, DataValidationOutput } from "./state";
import * as path from "path";
import { getMcpFilesystemTools, getPythonScriptDirectory } from "../../tools";
import {
  ARTIFACT_DATASET,
  ARTIFACT_VALIDATION_REPORT,
  DEFAULT_PIPELINE_SCRIPT_NAME,
  PROMPT_DATA_VALIDATION,
  REGION_DATA_VALIDATION,
  STATUS_FAILED,
  STATUS_OK,
  TRACE_DATA_VALIDATION,
  WORKER_DATA_VALIDATION,
} from "./constants";

const DEFAULT_USER_PROMPT = "None provided";
const DEFAULT_STAGE_TITLE = "Feature Engineering";
const DEFAULT_STAGE_THINKING = "Generating data validation code to audit the baseline dataset...";
const DEFAULT_VALIDATION_SUCCESS = "Data Validation script generated successfully";
const DEFAULT_VALIDATION_FAILED = "Data Validation code generation failed/fallback triggered";
const DEFAULT_NO_MODEL_MSG = "No model available for Data Validation";
const DEFAULT_FALLBACK_SUMMARY = "Data Validation fallback triggered";
const DEFAULT_SYSTEM_PROMPT_FALLBACK = "You are an expert AI Data Quality and Validation Agent.";
const MAX_RECURSION_LIMIT = 100;

export async function dataValidationNode(
  state: typeof FeatureArchitectAnnotation.State,
  config?: RunnableConfig
) {
  const services = config?.configurable?.services as IngestionServices;
  const model = getModel();

  const fallback: DataValidationOutput = {
    status: STATUS_FAILED,
    summary: DEFAULT_FALLBACK_SUMMARY,
  };

  if (!model) {
    return {
      dataValidation: fallback,
      history: [
        {
          worker: WORKER_DATA_VALIDATION,
          summary: DEFAULT_NO_MODEL_MSG,
        },
      ],
    };
  }

  const systemPrompt = await getPromptFromFile(
    PROMPT_DATA_VALIDATION,
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
    "Generate data validation script to audit the baseline dataset.",
    `User Requirements: ${userPromptText}`,
    `Tables List: ${JSON.stringify(state.batchedTables.map((t) => t.tableName))}`,
    `Orchestrator Decisions: ${JSON.stringify(state.orchestrationDecision)}`,
    `Input Dataset Artifact: ${ARTIFACT_DATASET}`,
    `Target Pipeline File: ${scriptPath}`,
    `Region to Edit: ${REGION_DATA_VALIDATION}`,
    `Output Report: ${ARTIFACT_VALIDATION_REPORT}`,
    "Action Required:",
    `1. Use MCP tool 'read_text_file' on '${scriptPath}' to inspect the exact region markers and line structure (or initialize it using 'write_file' if it does not exist).`,
    `2. Use MCP tool 'edit_file' (or 'write_file') to write/insert your data validation code into the ${REGION_DATA_VALIDATION} region in '${scriptPath}', validating '--dataset-path' (${ARTIFACT_DATASET}) and saving results to '--output-path' (${ARTIFACT_VALIDATION_REPORT}).`,
    "3. Return the final JSON summary.",
  ].join("\n\n");

  try {
    const fsTools = await getMcpFilesystemTools(services);

    const result = await validateWithRetry<DataValidationOutput>(
      WORKER_DATA_VALIDATION,
      async () =>
        await invokeAgentJson<DataValidationOutput>(
          "featureArchitect",
          model,
          userMessage,
          fallback,
          services,
          {
            systemPrompt,
            traceLabel: TRACE_DATA_VALIDATION,
            tools: [...fsTools],
            recursionLimit: MAX_RECURSION_LIMIT,
          }
        ),
      fallback,
      services
    );

    const summaryText = result.summary.length > 0 ? result.summary : DEFAULT_VALIDATION_SUCCESS;

    return {
      dataValidation: result,
      history: [
        {
          worker: WORKER_DATA_VALIDATION,
          summary: summaryText,
        },
      ],
    };
  } catch (error) {
    console.warn("[dataValidationNode] Execution failed, using fallback", error);
    return {
      dataValidation: fallback,
      history: [
        {
          worker: WORKER_DATA_VALIDATION,
          summary: DEFAULT_VALIDATION_FAILED,
        },
      ],
    };
  }
}
