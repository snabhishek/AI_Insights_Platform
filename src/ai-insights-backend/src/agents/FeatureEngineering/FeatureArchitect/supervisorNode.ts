import { RunnableConfig } from "@langchain/core/runnables";
import { IngestionServices } from "../../state";
import { getModel, invokeAgentJson, getPromptFromFile, logMilestoneThinking } from "../../utils/agentUtils";
import { FeatureArchitectAnnotation } from "./state";
import { createGetTableNamesTool, createGetTableColumnsAndProfileTool } from "../../tools";
import {
  PROMPT_FEATURE_SUPERVISOR,
  STATUS_COMPLETED,
  STATUS_FAILED,
  STATUS_OK,
  TRACE_SUPERVISOR,
  WORKER_BUILD_DATASET,
  WORKER_DATA_VALIDATION,
  WORKER_FEATURE_CREATION,
  WORKER_FEATURE_EXTRACTION,
  WORKER_FEATURE_SELECTION,
  WORKER_FEATURE_TRANSFORMATION,
  WORKER_FEATURE_VALIDATOR,
  WORKER_FINISH,
  WORKER_PROGRAM_RECTIFIER,
  WORKER_SUPERVISOR,
} from "./constants";

const DEFAULT_USER_PROMPT = "None provided";
const DEFAULT_STAGE_TITLE = "Feature Engineering";
const DEFAULT_NONE_RATIONALE = "None";
const DEFAULT_FALLBACK_RATIONALE = "Supervisor fallback triggered, choosing to finish.";
const DEFAULT_SUPERVISOR_SUMMARY = "Feature Architecture planning and execution completed successfully under supervisor control.";
const DEFAULT_NO_MODEL_MSG = "No model available for Supervisor Node";
const DEFAULT_SYSTEM_PROMPT_FALLBACK = "You are an expert AI Feature Engineering Supervisor Agent.";
const MAX_RECURSION_LIMIT = 100;

interface SupervisorOutput extends Record<string, unknown> {
  status: string;
  nextWorker: string;
  rationale: string;
  prediction_target_column?: string;
  orchestrationDecision?: {
    summary: string;
    problemType: string;
    targetColumn: string;
    prediction_target_column?: string;
    predictionEntity: string;
    timeColumn?: string;
    leakageColumns?: string[];
    decisions: any[];
  };
}

function findPendingExecutableWorker(
  state: typeof FeatureArchitectAnnotation.State,
  historyWorkers: string[]
): string | null {
  const checkStages = [
    { name: WORKER_FEATURE_CREATION, hasCode: Boolean(state.featureCreation?.pythonCode) },
    { name: WORKER_FEATURE_TRANSFORMATION, hasCode: Boolean(state.featureTransformation?.pythonCode) },
    { name: WORKER_BUILD_DATASET, hasCode: Boolean(state.buildDataset?.pythonCode) },
    { name: WORKER_DATA_VALIDATION, hasCode: Boolean(state.dataValidation?.pythonCode) },
    { name: WORKER_FEATURE_EXTRACTION, hasCode: Boolean(state.featureExtraction?.pythonCode) },
    { name: WORKER_FEATURE_SELECTION, hasCode: Boolean(state.featureSelection?.pythonCode) },
    { name: WORKER_FEATURE_VALIDATOR, hasCode: Boolean(state.featureValidator?.pythonCode) },
  ];

  for (const stage of checkStages) {
    const executedKey = `${stage.name}_executed`;
    const failedKey = `${stage.name}_executed_failed`;
    const isExecuted = historyWorkers.includes(executedKey);
    const isFailed = historyWorkers.includes(failedKey);
    const isPending = stage.hasCode && !isExecuted && !isFailed;
    if (isPending) {
      return WORKER_PROGRAM_RECTIFIER;
    }
  }

  return null;
}

function resolveTargetColumn(
  resultTarget: string | undefined,
  resultOrchPredictionTarget: string | undefined,
  resultOrchTarget: string | undefined,
  stateTarget: string | undefined,
  stateOrchPredictionTarget: string | undefined,
  stateOrchTarget: string | undefined
): string {
  const candidates = [
    resultTarget,
    resultOrchPredictionTarget,
    resultOrchTarget,
    stateTarget,
    stateOrchPredictionTarget,
    stateOrchTarget,
  ];

  for (const cand of candidates) {
    const isValid = typeof cand === "string" && cand.trim().length > 0;
    if (isValid) {
      return cand;
    }
  }

  return "";
}

export async function supervisorNode(
  state: typeof FeatureArchitectAnnotation.State,
  config?: RunnableConfig
) {
  const services = config?.configurable?.services as IngestionServices;
  const model = getModel();

  const fallback: SupervisorOutput = {
    status: STATUS_FAILED,
    nextWorker: WORKER_FINISH,
    rationale: DEFAULT_FALLBACK_RATIONALE,
  };

  if (!model) {
    return {
      nextWorker: WORKER_FINISH,
      finalOutput: {
        status: STATUS_FAILED,
        summary: DEFAULT_NO_MODEL_MSG,
      },
    };
  }

  const systemPrompt = await getPromptFromFile(
    PROMPT_FEATURE_SUPERVISOR,
    DEFAULT_SYSTEM_PROMPT_FALLBACK
  );

  const historyWorkers = state.history.map((h) => h.worker);

  // 1. Deterministic code execution routing to programRectifier
  const pendingWorker = findPendingExecutableWorker(state, historyWorkers);
  if (pendingWorker !== null) {
    return { nextWorker: pendingWorker };
  }

  // 2. Otherwise, check state progression to call workers or finish
  if (services) {
    const historyText = historyWorkers.length > 0 ? historyWorkers.join(" -> ") : "none";
    await logMilestoneThinking(
      services,
      DEFAULT_STAGE_TITLE,
      `Supervisor is planning next agent tasks. Executed workers history: [${historyText}]`
    );
  }

  const userPromptText = state.userPrompt ?? DEFAULT_USER_PROMPT;
  const userMessage = [
    "Analyze the schema, user requirements, and history to choose the next feature engineering worker node.",
    `User Requirements: ${userPromptText}`,
    `Selected Tables: ${JSON.stringify(state.batchedTables.map((t) => t.tableName))}`,
    `Execution History: ${JSON.stringify(state.history)}`,
  ].join("\n\n");

  try {
    const getTableNamesTool = createGetTableNamesTool(state.batchedTables);
    const getTableColumnsAndProfileTool = createGetTableColumnsAndProfileTool(state.inspector, state.dataProfile);

    const result = await invokeAgentJson<SupervisorOutput>(
      WORKER_SUPERVISOR,
      model,
      userMessage,
      fallback,
      services,
      {
        systemPrompt,
        traceLabel: TRACE_SUPERVISOR,
        tools: [getTableNamesTool, getTableColumnsAndProfileTool],
        recursionLimit: MAX_RECURSION_LIMIT,
      }
    );

    const safeNextWorker = typeof result.nextWorker === "string" && result.nextWorker.length > 0
      ? result.nextWorker
      : WORKER_FINISH;

    if (services) {
      const rationaleText = typeof result.rationale === "string" && result.rationale.length > 0
        ? result.rationale
        : DEFAULT_NONE_RATIONALE;
      await logMilestoneThinking(
        services,
        DEFAULT_STAGE_TITLE,
        `Supervisor scheduled task: "${safeNextWorker}". Rationale: ${rationaleText}`
      );
    }

    const targetCol = resolveTargetColumn(
      result.prediction_target_column,
      result.orchestrationDecision?.prediction_target_column,
      result.orchestrationDecision?.targetColumn,
      state.prediction_target_column,
      state.orchestrationDecision?.prediction_target_column,
      state.orchestrationDecision?.targetColumn
    );

    if (safeNextWorker === WORKER_FINISH) {
      const finalTarget = targetCol.length > 0
        ? targetCol
        : (state.orchestrationDecision?.targetColumn ?? "");

      const finalOutput = {
        status: STATUS_COMPLETED,
        prediction_target_column: finalTarget,
        orchestrationDecision: {
          ...state.orchestrationDecision,
          targetColumn: finalTarget,
          prediction_target_column: finalTarget,
        },
        featureCreation: state.featureCreation,
        featureTransformation: state.featureTransformation,
        buildDataset: state.buildDataset,
        dataValidation: state.dataValidation,
        featureExtraction: state.featureExtraction,
        featureSelection: state.featureSelection,
        featureValidator: state.featureValidator,
        summary: DEFAULT_SUPERVISOR_SUMMARY,
      };

      return {
        nextWorker: safeNextWorker,
        prediction_target_column: finalTarget,
        finalOutput,
      };
    }

    const updates: Record<string, any> = {
      nextWorker: safeNextWorker,
      prediction_target_column: targetCol,
    };

    if (result.orchestrationDecision) {
      const orchSummary = result.orchestrationDecision.summary ?? "";
      const orchProblemType = result.orchestrationDecision.problemType ?? "";
      const orchTarget = targetCol.length > 0
        ? targetCol
        : (result.orchestrationDecision.targetColumn ?? "");
      const orchPredTarget = targetCol.length > 0
        ? targetCol
        : (result.orchestrationDecision.prediction_target_column ?? orchTarget);
      const orchEntity = result.orchestrationDecision.predictionEntity ?? "";
      const orchTime = result.orchestrationDecision.timeColumn ?? "";
      const orchLeakage = result.orchestrationDecision.leakageColumns ?? [];
      const orchDecisions = result.orchestrationDecision.decisions ?? [];

      updates.orchestrationDecision = {
        status: STATUS_OK,
        summary: orchSummary,
        problemType: orchProblemType,
        targetColumn: orchTarget,
        prediction_target_column: orchPredTarget,
        predictionEntity: orchEntity,
        timeColumn: orchTime,
        leakageColumns: orchLeakage,
        decisions: orchDecisions,
      };
    }

    return updates;
  } catch (error) {
    console.warn("[supervisorNode] Execution failed, using fallback", error);
    return {
      nextWorker: WORKER_FINISH,
      finalOutput: {
        status: STATUS_FAILED,
        summary: `Supervisor execution failed: ${error instanceof Error ? error.message : String(error)}`,
      },
    };
  }
}
