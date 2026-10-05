import { RunnableConfig } from "@langchain/core/runnables";
import { AgentState, IngestionServices } from "../../state";
import { logMilestoneThinking } from "../../utils/agentUtils";
import { createFeatureArchitectGraph } from "./graph";
import { cleanupRunContainer } from "../../tools/helpers/pythonExecutor";
import { getPythonScriptDirectory } from "../../tools";
import * as path from "path";
import * as fs from "fs";
import {
  ARTIFACT_FEATURE_VALIDATION_REPORT,
  STATUS_COMPLETED,
  STATUS_FAILED,
  STATUS_RUNNING,
} from "./constants";

const DEFAULT_STAGE_TITLE = "Feature Engineering";
const DEFAULT_START_THINKING = "Feature Architect Agent is starting feature engineering design workflow...";
const DEFAULT_SUCCESS_SUMMARY = "Feature Engineering completed successfully";
const DEFAULT_STEP_SUMMARY = "Architected and validated feature creation, transformation, extraction, and selection.";
const DEFAULT_STATUS_FAILED = "failed";
const DEFAULT_STATUS_PAUSED = "paused";
const DEFAULT_NOT_SPECIFIED = "not specified";
const DEFAULT_TARGET_COLUMN = "";
const MAX_RECURSION_LIMIT = 100;
const UTF8_ENCODING = "utf-8";

function parseJsonSafe(content: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(content);
    const isValid = typeof parsed === "object" && parsed !== null;
    return isValid ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function resolveTargetColumn(
  graphTarget: string | undefined,
  finalTarget: string | undefined,
  graphOrchPredTarget: string | undefined,
  graphOrchTarget: string | undefined,
  finalOrchPredTarget: string | undefined,
  finalOrchTarget: string | undefined
): string {
  const candidates = [
    graphTarget,
    finalTarget,
    graphOrchPredTarget,
    graphOrchTarget,
    finalOrchPredTarget,
    finalOrchTarget,
  ];

  for (const cand of candidates) {
    const isValid = typeof cand === "string" && cand.trim().length > 0;
    if (isValid) {
      return cand;
    }
  }

  return DEFAULT_TARGET_COLUMN;
}

function loadFeatureValidationReportIfPresent(
  pythonScriptDir: string,
  currentOutput: Record<string, unknown>
): Record<string, unknown> {
  const reportPath = path.join(pythonScriptDir, ARTIFACT_FEATURE_VALIDATION_REPORT);
  const fileExists = fs.existsSync(reportPath);
  if (!fileExists) {
    return currentOutput;
  }

  try {
    const raw = fs.readFileSync(reportPath, UTF8_ENCODING);
    const parsed = parseJsonSafe(raw);
    if (!parsed) {
      return currentOutput;
    }
    return {
      ...currentOutput,
      ...parsed,
    };
  } catch {
    return currentOutput;
  }
}

export async function featureArchitectNode(state: typeof AgentState.State, config?: RunnableConfig) {
  const services = config?.configurable?.services as IngestionServices;
  if (!services) {
    throw new Error("Services dependency is not provided in config");
  }

  const isCancelled = services.isCancelled?.() ?? false;
  const isAborted = services.abortSignal?.aborted ?? false;
  const isFailedState = state.status === DEFAULT_STATUS_FAILED;
  const isPausedState = state.status === DEFAULT_STATUS_PAUSED;
  const shouldSkip = isCancelled || isAborted || isFailedState || isPausedState;

  if (shouldSkip) {
    console.info("[Workflow] featureArchitectNode skipping execution because workflow is stopped/paused.");
    const returnStatus = state.status.length > 0 ? state.status : DEFAULT_STATUS_FAILED;
    return { status: returnStatus };
  }

  await logMilestoneThinking(
    services,
    DEFAULT_STAGE_TITLE,
    DEFAULT_START_THINKING
  );

  const pythonScriptDir = getPythonScriptDirectory(services, state.runTimestamp);

  try {

    const architectGraph = createFeatureArchitectGraph();
    const graphResult = await architectGraph.invoke(
      {
        batchedTables: state.batchedTables,
        inspector: state.inspection,
        dataProfile: state.dataProfile,
        userPrompt: state.userPrompt,
        connectorId: state.connectorId,
        runTimestamp: state.runTimestamp,
      },
      {
        configurable: { services },
        recursionLimit: MAX_RECURSION_LIMIT,
      }
    );

    const finalOutput: Record<string, unknown> = (graphResult.finalOutput as Record<string, unknown>) ?? {};
    const predictionTargetColumn = resolveTargetColumn(
      graphResult.prediction_target_column as string | undefined,
      finalOutput.prediction_target_column as string | undefined,
      (graphResult.orchestrationDecision as Record<string, unknown> | undefined)?.prediction_target_column as string | undefined,
      (graphResult.orchestrationDecision as Record<string, unknown> | undefined)?.targetColumn as string | undefined,
      (finalOutput.orchestrationDecision as Record<string, unknown> | undefined)?.prediction_target_column as string | undefined,
      (finalOutput.orchestrationDecision as Record<string, unknown> | undefined)?.targetColumn as string | undefined
    );

    finalOutput.prediction_target_column = predictionTargetColumn;

    const baseValidatorOutput = (finalOutput.featureValidator as Record<string, unknown> | undefined) ??
      (graphResult.featureValidator as Record<string, unknown> | undefined) ??
      {};

    const featureValidatorOutput = loadFeatureValidationReportIfPresent(
      pythonScriptDir,
      baseValidatorOutput
    );

    const logTargetName = predictionTargetColumn.length > 0 ? predictionTargetColumn : DEFAULT_NOT_SPECIFIED;
    await logMilestoneThinking(
      services,
      DEFAULT_STAGE_TITLE,
      `Feature Architect & Validator workflow completed successfully. Target column: "${logTargetName}".`
    );

    return {
      featureArchitect: finalOutput,
      featureValidator: featureValidatorOutput,
      prediction_target_column: predictionTargetColumn,
      status: STATUS_RUNNING,
      summary: DEFAULT_SUCCESS_SUMMARY,
      steps: [
        {
          name: DEFAULT_STAGE_TITLE,
          status: STATUS_COMPLETED.toLowerCase(),
          summary: DEFAULT_STEP_SUMMARY,
        },
      ],
      stageOutputs: {
        featureArchitect: finalOutput,
        featureValidator: featureValidatorOutput,
      },
      stageStatuses: {
        featureArchitect: STATUS_COMPLETED,
        featureValidator: STATUS_COMPLETED,
      },
    };
  } finally {

    const projectId = services.projectId ?? "";
    const runTimestamp = state.runTimestamp ?? "";
    await cleanupRunContainer(projectId, runTimestamp);
  }
}
