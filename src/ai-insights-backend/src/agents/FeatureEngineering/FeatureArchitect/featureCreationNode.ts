import { RunnableConfig } from "@langchain/core/runnables";
import { IngestionServices } from "../../state";
import { getModel, invokeAgentJson, getPromptFromFile, logMilestoneThinking } from "../../utils/agentUtils";
import { validateWithRetry } from "../../validator/validatorNode";
import { FeatureArchitectAnnotation, FeatureCreationOutput } from "./state";
import * as path from "path";
import { createGetTableColumnsAndProfileTool, getMcpFilesystemTools, getPythonScriptDirectory } from "../../tools";
import {
  ARTIFACT_FEATURE_CREATED,
  DEFAULT_PIPELINE_SCRIPT_NAME,
  PROMPT_FEATURE_CREATION,
  REGION_FEATURE_CREATION,
  STATUS_FAILED,
  STATUS_OK,
  TRACE_FEATURE_CREATION,
  WORKER_FEATURE_CREATION,
} from "./constants";

const DEFAULT_USER_PROMPT = "None provided";
const DEFAULT_STAGE_TITLE = "Feature Engineering";
const DEFAULT_STAGE_THINKING = "Generating feature creation recommendations based on orchestration decisions...";
const DEFAULT_CREATION_SUCCESS = "Feature Creation completed successfully";
const DEFAULT_CREATION_FAILED = "Feature Creation execution failed/fallback triggered";
const DEFAULT_NO_MODEL_MSG = "No model available for Feature Creation";
const DEFAULT_FALLBACK_SUMMARY = "Feature Creation fallback triggered";
const DEFAULT_SYSTEM_PROMPT_FALLBACK = "You are an expert AI Feature Engineering Agent specialized in feature creation.";
const MAX_RECURSION_LIMIT = 100;

export async function featureCreationNode(
  state: typeof FeatureArchitectAnnotation.State,
  config?: RunnableConfig
) {
  const services = config?.configurable?.services as IngestionServices;
  const model = getModel();

  const fallback: FeatureCreationOutput = {
    status: STATUS_FAILED,
    summary: DEFAULT_FALLBACK_SUMMARY,
    recommendations: [],
  };

  if (!model) {
    return {
      featureCreation: fallback,
      history: [
        {
          worker: WORKER_FEATURE_CREATION,
          summary: DEFAULT_NO_MODEL_MSG,
        },
      ],
    };
  }

  const systemPrompt = await getPromptFromFile(
    PROMPT_FEATURE_CREATION,
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
    "Design and generate feature creation recommendations for the tables and targets determined by the Orchestrator.",
    `User Requirements: ${userPromptText}`,
    `Tables List: ${JSON.stringify(state.batchedTables.map((t) => t.tableName))}`,
    `Orchestrator Decisions: ${JSON.stringify(state.orchestrationDecision)}`,
    `Target Pipeline File: ${scriptPath}`,
    `Region to Edit: ${REGION_FEATURE_CREATION}`,
    `Output Artifact: ${ARTIFACT_FEATURE_CREATED}`,
    "Action Required:",
    `1. Use MCP tool 'read_text_file' on '${scriptPath}' to inspect the exact region markers and line structure (or initialize it using 'write_file' if it does not exist).`,
    `2. Use MCP tool 'edit_file' (or 'write_file') to write/insert your feature creation code into the ${REGION_FEATURE_CREATION} region in '${scriptPath}', saving created features to '--output-path' (${ARTIFACT_FEATURE_CREATED}).`,
    "3. Return the final JSON summary of recommendations.",
  ].join("\n\n");

  try {
    const getTableColumnsAndProfileTool = createGetTableColumnsAndProfileTool(state.inspector, state.dataProfile);
    const fsTools = await getMcpFilesystemTools(services);

    const result = await validateWithRetry<FeatureCreationOutput>(
      WORKER_FEATURE_CREATION,
      async () =>
        await invokeAgentJson<FeatureCreationOutput>(
          "featureArchitect",
          model,
          userMessage,
          fallback,
          services,
          {
            systemPrompt,
            traceLabel: TRACE_FEATURE_CREATION,
            tools: [getTableColumnsAndProfileTool, ...fsTools],
            recursionLimit: MAX_RECURSION_LIMIT,
          }
        ),
      fallback,
      services
    );

    const summaryText = result.summary.length > 0 ? result.summary : DEFAULT_CREATION_SUCCESS;

    return {
      featureCreation: result,
      history: [
        {
          worker: WORKER_FEATURE_CREATION,
          summary: summaryText,
        },
      ],
    };
  } catch (error) {
    console.warn("[featureCreationNode] Execution failed, using fallback", error);
    return {
      featureCreation: fallback,
      history: [
        {
          worker: WORKER_FEATURE_CREATION,
          summary: DEFAULT_CREATION_FAILED,
        },
      ],
    };
  }
}
