import { RunnableConfig } from "@langchain/core/runnables";
import { AgentState, IngestionServices, checkWorkflowInterrupt } from "../../state";
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
  finalOrchTarget: string | undefined,
  stateTarget?: string | undefined,
  stateTargetColumn?: string | undefined
): string {
  const candidates = [
    graphTarget,
    finalTarget,
    graphOrchPredTarget,
    graphOrchTarget,
    finalOrchPredTarget,
    finalOrchTarget,
    stateTarget,
    stateTargetColumn,
  ];

  for (const cand of candidates) {
    const isValid = typeof cand === "string" && cand.trim().length > 0;
    if (isValid) {
      return cand.trim();
    }
  }

  return DEFAULT_TARGET_COLUMN;
}

function loadFeatureValidationReportIfPresent(
  pythonScriptDir: string,
  currentOutput: Record<string, unknown>
): Record<string, unknown> {
  const datasetDir = path.join(path.dirname(pythonScriptDir), "dataset");
  const reportPath = path.join(datasetDir, ARTIFACT_FEATURE_VALIDATION_REPORT);
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

  const interrupt = checkWorkflowInterrupt(services, "featureArchitectNode");
  if (interrupt) return interrupt;

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
        prediction_target_column: state.prediction_target_column || (state as any).targetColumn || "",
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
      (finalOutput.orchestrationDecision as Record<string, unknown> | undefined)?.targetColumn as string | undefined,
      state.prediction_target_column,
      (state as any).targetColumn as string | undefined
    );

    finalOutput.prediction_target_column = predictionTargetColumn;
    finalOutput.targetColumn = predictionTargetColumn;

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

    const projectId = services.projectId ?? "";
    const runTimestamp = state.runTimestamp ?? "";
    await cleanupRunContainer(projectId, runTimestamp);

    return {
      featureArchitect: finalOutput,
      featureValidator: featureValidatorOutput,
      prediction_target_column: predictionTargetColumn,
      targetColumn: predictionTargetColumn,
      status: STATUS_RUNNING,
      summary: DEFAULT_SUCCESS_SUMMARY,
      steps: [
        {
          name: DEFAULT_STAGE_TITLE,
          status: STATUS_COMPLETED,
          summary: DEFAULT_STEP_SUMMARY,
        },
      ],
      stageOutputs: {
        featureArchitectNode: finalOutput,
        featureValidatorNode: featureValidatorOutput,
      },
      stageStatuses: {
        featureArchitectNode: STATUS_COMPLETED,
        featureValidatorNode: STATUS_COMPLETED,
      },
    };
  } catch (error) {
    console.error("[FeatureArchitectNode] Execution error encountered; preserving Docker container for inspection:", error);
    throw error;
  }
}
