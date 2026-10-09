"use client";

import React from "react";
import { PipelineStatus, PipelineStatuses, RunStatus } from "./types";
import { PIPELINE_STEPS } from "./constants";
import WorkflowCard from "./WorkflowCard";
import { NODE_CONFIG, normalizeFlatStageStatuses, StageKey, STAGE_CONFIG, TrackedAgentKey } from "./pipelineNames";

interface WorkflowPipelineProps {
  pipelineStatuses: PipelineStatuses;
  completionPercentage: number;
  runStatus: RunStatus;
  lastRunTime: string;
  activeStage: string | null;
  stageOutputs: Record<string, unknown>;
  workflowMessage: string;
  onRunWorkflow: () => void;
  onReRunWorkflow?: () => void;
  onStopWorkflow?: () => void;

  onSelectStage: (stepId: string) => void;
  onApprove: () => void;
  onRetry: (stepId: string) => void;
  isPaused?: boolean;
  pausedAtPhase?: string | null;
  onPause?: () => void;
  onResume?: () => void;
  isApproving?: boolean;
  isSubmittingWorkflow?: boolean;
  isPausing?: boolean;
  isStopping?: boolean;
  isResuming?: boolean;
  isRetrying?: boolean;
  isAwaitingResponse?: boolean;
  approvalNextStep?: string | null;
}

import { SUBSTEP_TO_PIPELINE_MAP } from "./pipelineFlowConfig";

const MAIN_STEP_MAPPING = SUBSTEP_TO_PIPELINE_MAP;

const DEFAULT_MAIN_STEP_ID: StageKey = "dataIngestion";

export function getMainStepId(stepOrStageId: string | null): StageKey {
  if (!stepOrStageId) return DEFAULT_MAIN_STEP_ID;
  const displayName = MAIN_STEP_MAPPING[stepOrStageId] ??
    (stepOrStageId in STAGE_CONFIG
      ? STAGE_CONFIG[stepOrStageId as StageKey].displayName
      : undefined);
  return (Object.keys(STAGE_CONFIG) as StageKey[]).find(
    (stageKey) => STAGE_CONFIG[stageKey].displayName === displayName
  ) ?? DEFAULT_MAIN_STEP_ID;
}

export function toDisplayStatuses(pipelineStatuses: PipelineStatuses): Record<string, PipelineStatus> {
  const flatStatuses = normalizeFlatStageStatuses(pipelineStatuses);
  const displayStatus = (status: PipelineStatus | undefined): PipelineStatus => status ?? "None";
  const result: Record<string, PipelineStatus> = {};

  for (const stageKey of Object.keys(STAGE_CONFIG) as StageKey[]) {
    const status = displayStatus(pipelineStatuses[stageKey]?.status);
    result[stageKey] = status;
    result[STAGE_CONFIG[stageKey].displayName] = status;
  }
  for (const [nodeKey, config] of Object.entries(NODE_CONFIG) as [TrackedAgentKey, (typeof NODE_CONFIG)[TrackedAgentKey]][]) {
    const status = displayStatus(flatStatuses[nodeKey]);
    result[nodeKey] = status;
    result[config.displayName] = status;
  }
  result.modelTraining = displayStatus(flatStatuses.modelTrainingExecNode);
  result["Model Training"] = result.modelTraining;
  result["Model Validation"] = result.modelTraining;
  return result;
}

function calculateDataIngestionStatus(pipelineStatuses: Record<string, PipelineStatus>): PipelineStatus {
  const s1 = (pipelineStatuses["Data Inspection"] as PipelineStatus) ?? "Pending";
  const s2 = (pipelineStatuses["Data Profiling"] as PipelineStatus) ?? "Pending";
  const s3 = (pipelineStatuses["Schema Resolver"] as PipelineStatus) ?? "Pending";

  if (pipelineStatuses["Data Ingestion"] === "Completed") {
    return "Completed";
  }

  if ((s1 === "Completed" && s2 === "Completed" && s3 === "Completed") || s3 === "Completed") {
    return "Completed";
  }

  const isDownstreamActiveOrPending =
    pipelineStatuses["Feature Engineering"] === "Completed" ||
    pipelineStatuses["Feature Engineering"] === "In-Progress" ||
    pipelineStatuses["Hierarchy Mapper"] === "Completed" ||
    pipelineStatuses["Hierarchy Mapper"] === "In-Progress" ||
    pipelineStatuses["Feature Architect"] === "Completed" ||
    pipelineStatuses["Feature Architect"] === "In-Progress" ||
    pipelineStatuses["Feature Validator"] === "Completed" ||
    pipelineStatuses["Feature Validator"] === "In-Progress" ||
    pipelineStatuses["Exogenous Scout"] === "Completed" ||
    pipelineStatuses["Exogenous Scout"] === "In-Progress" ||
    pipelineStatuses["Model Selection"] === "Completed" ||
    pipelineStatuses["Model Selection"] === "In-Progress" ||
    pipelineStatuses["Training Configuration"] === "Completed" ||
    pipelineStatuses["Training Configuration"] === "In-Progress" ||
    pipelineStatuses["Pre Flight"] === "Completed" ||
    pipelineStatuses["Pre Flight"] === "In-Progress" ||
    pipelineStatuses["Model Training"] === "Completed" ||
    pipelineStatuses["Model Training"] === "In-Progress";

  if (isDownstreamActiveOrPending) {
    return "Completed";
  }

  // 4. In-Progress if explicitly In-Progress or any substep is actively In-Progress
  if (
    pipelineStatuses["Data Ingestion"] === "In-Progress" ||
    [s1, s2, s3].some((s) => s === "In-Progress")
  ) {
    return "In-Progress";
  }

  // 5. If some are completed while others are Pending or pending, it's In-Progress
  if ([s1, s2, s3].some((s) => s === "Completed")) {
    return "In-Progress";
  }

  if ([s1, s2, s3].some((s) => s === "Pending")) {
    return "Pending";
  }
  return "Pending";
}

export function getMainStepStatus(stepId: string, pipelineStatuses: PipelineStatuses): PipelineStatus {
  const group = pipelineStatuses[stepId as StageKey];
  return group?.status ?? "None";
}

export function getMainStepStatuses(
  pipelineStatuses: PipelineStatuses
): Record<string, PipelineStatus> {
  const result: Record<string, PipelineStatus> = {};

  for (const step of PIPELINE_STEPS) {
    result[step.id] = getMainStepStatus(step.id, pipelineStatuses);
  }

  return result;
}

export default function WorkflowPipeline({
  pipelineStatuses: groupedPipelineStatuses,
  runStatus,
  lastRunTime,
  activeStage,
  stageOutputs,
  workflowMessage,
  onRunWorkflow,
  onReRunWorkflow,
  onStopWorkflow,

  onSelectStage,
  onApprove,
  onRetry,
  isPaused,
  pausedAtPhase,
  onPause,
  onResume,
  isApproving,
  isSubmittingWorkflow,
  isPausing,
  isStopping,
  isResuming,
  isRetrying,
  isAwaitingResponse,
  approvalNextStep,
}: WorkflowPipelineProps) {
  const pipelineStatuses = toDisplayStatuses(groupedPipelineStatuses);
  const hasInProgressGroup = Object.values(groupedPipelineStatuses || {}).some(
    (g: any) => g?.status === "In-Progress"
  );
  const hasInProgressFlat = Object.values(pipelineStatuses).some(
    (s) => s === "In-Progress"
  );
  const hasInProgress = hasInProgressGroup || hasInProgressFlat;

  const hasAwaitingApproval =
    runStatus === "Awaiting Approval" 
    // &&
    // Object.values(groupedPipelineStatuses || {}).some(
    //   (g: any) => g?.status === "Awaiting Approval"
    // ) &&
    // Object.values(pipelineStatuses).some(
    //   (s) => s === "Awaiting Approval"
    // );

  const effectiveRunStatus: RunStatus =
    hasAwaitingApproval
      ? "Awaiting Approval"
      : runStatus === "In-Progress"
        ? "In-Progress"
        : runStatus === "Paused" || isPaused
          ? "Paused"
          : runStatus === "Stopped"
            ? "Stopped"
            : runStatus === "Failed"
              ? "Failed"
              : hasInProgress
                ? "In-Progress"
                : runStatus;

  const isAwaitingApprovalWorkflow = hasAwaitingApproval || effectiveRunStatus === "Awaiting Approval";

  const effectiveApprovalNextStep = approvalNextStep || (() => {
    const diStatus = pipelineStatuses["dataIngestion"] || pipelineStatuses["Data Ingestion"];
    const feStatus = pipelineStatuses["featureEngineering"] || pipelineStatuses["Feature Engineering"];
    const mtvStatus = pipelineStatuses["modelTrainingValidation"] || pipelineStatuses["Model Training & Validation"];
    if (diStatus === "Awaiting Approval" || (diStatus === "Completed" && (feStatus === "Pending" || feStatus === "None"))) {
      return "Feature Engineering";
    }
    if (feStatus === "Awaiting Approval" || (feStatus === "Completed" && (mtvStatus === "Pending" || mtvStatus === "None"))) {
      return "Model Training & Validation";
    }
    if (mtvStatus === "Awaiting Approval") {
      return "Model Selection";
    }
    return "Feature Engineering";
  })();

  const isWorkflowStoppedOrFailed = effectiveRunStatus === "Stopped" || effectiveRunStatus === "Failed" || effectiveRunStatus === 'In-Progress';
  const isAnyActionLoading = Boolean(
    isApproving || isSubmittingWorkflow || isPausing || isStopping || isResuming || isRetrying
  );  
  const currentStage = activeStage || "inspect";
  const mainSelectedStage = getMainStepId(currentStage);

  const mainStatusMap = getMainStepStatuses(groupedPipelineStatuses);
  const mainStatuses = PIPELINE_STEPS.map((step) => mainStatusMap[step.id]);

  const hasExistingRun =
    (lastRunTime !== "Not run yet" ||
      effectiveRunStatus === "Completed" ||
      effectiveRunStatus === "Failed" ||
      Object.values(pipelineStatuses).some((s) => s === "Completed" || s === "In-Progress")) && effectiveRunStatus !== "Stopped";

  const runButtonText = hasExistingRun ? "Re-Run Workflow" : "Run Workflow";
  const handleRunClick = () => {
    if (isSubmittingWorkflow) return;
    if (hasExistingRun && onReRunWorkflow) {
      onReRunWorkflow();
    } else {
      onRunWorkflow();
    }
  };

// Canonical exact step identifiers defined in pipelineNames.ts and backend workflow rules
const ADVANCE_TO_FE_STEPS = new Set([
  "hierarchyMapperNode",
  "Hierarchy Mapper",
  "featureEngineering",
  "Feature Engineering",
]);

const ADVANCE_TO_MODEL_SELECTION_STEPS = new Set([
  "modelSelectionNode",
  "Model Selection",
  "modelTrainingValidation",
  "Model Training & Validation",
]);

const MODEL_TRAINING_VALIDATION_STEPS = new Set([
  "trainingConfigurationNode",
  "Training Configuration",
  "preFlightNode",
  "Pre Flight",
  "modelTrainingCodeNode",
  "Model Training Code Generation",
  "modelTrainingNode",
  "Model Training",
  "modelTrainingExecNode",
  "Model Training Execution",
  "modelValidationNode",
  "Model Validation",
]);

  const getWorkflowStageStatus = (stage: string): PipelineStatus => {
    let status = pipelineStatuses[stage] ?? "None";

    if (isAwaitingApprovalWorkflow) {
      const nextStep = (effectiveApprovalNextStep || "").trim();
      const isDataIngestion = stage === "dataIngestion" || stage === "Data Ingestion";
      const isFeatureEngineering = stage === "featureEngineering" || stage === "Feature Engineering";
      const isModelTraining = stage === "modelTrainingValidation" || stage === "Model Training & Validation";

      // 1. Data Ingestion awaiting approval to advance to Feature Engineering
      if (isDataIngestion) {
        const isAwaitingFeAdvance =
          ADVANCE_TO_FE_STEPS.has(nextStep) ||
          (!nextStep &&
            (pipelineStatuses["featureEngineering"] === "Pending" ||
              pipelineStatuses["featureEngineering"] === "None" ||
              pipelineStatuses["Feature Engineering"] === "Pending" ||
              pipelineStatuses["Feature Engineering"] === "None") &&
            (pipelineStatuses["dataIngestion"] === "Completed" ||
              pipelineStatuses["Data Ingestion"] === "Completed" ||
              status === "Completed"));
        if (isAwaitingFeAdvance) {
          return "Awaiting Approval";
        }
      }

      // 2. Feature Engineering awaiting approval to advance to Model Training
      if (isFeatureEngineering) {
        const isAwaitingModelAdvance =
          ADVANCE_TO_MODEL_SELECTION_STEPS.has(nextStep) &&
          (pipelineStatuses["modelTrainingValidation"] === "Pending" ||
            pipelineStatuses["modelTrainingValidation"] === "None" ||
            pipelineStatuses["Model Training & Validation"] === "Pending" ||
            pipelineStatuses["Model Training & Validation"] === "None");
        if (isAwaitingModelAdvance) {
          return "Awaiting Approval";
        }
      }

      // 3. Model Training awaiting approval / input (model confirmation, training config, preflight, etc.)
      if (isModelTraining) {
        const isModelPhaseActive =
          MODEL_TRAINING_VALIDATION_STEPS.has(nextStep) ||
          (ADVANCE_TO_MODEL_SELECTION_STEPS.has(nextStep) &&
            (pipelineStatuses["featureEngineering"] === "Completed" ||
              pipelineStatuses["Feature Engineering"] === "Completed") &&
            (pipelineStatuses["modelTrainingValidation"] === "In-Progress" ||
              pipelineStatuses["Model Training & Validation"] === "In-Progress"));
        if (isModelPhaseActive) {
          return "Awaiting Approval";
        }
      }
    }

    const hasAnyWorkStarted =
      Object.values(pipelineStatuses).some((s) => s === "Completed" || s === "In-Progress") ||
      effectiveRunStatus === "In-Progress" ||
      effectiveRunStatus === "Paused" ||
      effectiveRunStatus === "Completed";

    if (status === "Pending" && !hasAnyWorkStarted && effectiveRunStatus === "None") return "None";
    if (status !== "Completed" && effectiveRunStatus === "Stopped") return "Stopped";
    return status;
  };

  return (
    <div className="col-span-12 lg:col-span-8 xl:col-span-9 flex flex-col bg-background border border-border rounded-lg p-6 shadow-soft">

      {isAwaitingApprovalWorkflow && (
        <div className="mb-5 flex items-center justify-between gap-3 px-4 py-3 rounded-xl bg-gradient-to-r from-amber-500/15 via-amber-500/5 to-surface border border-amber-500/30 text-amber-800 dark:text-amber-300 shadow-sm animate-fadeIn">
          <div className="flex items-center gap-2.5">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-500"></span>
            </span>
            <span className="text-xs font-bold tracking-wide">
              This process is awaiting your response.
            </span>
          </div>
          <span className="text-[11px] font-medium text-muted-foreground hidden sm:inline">
            {(() => {
              if (
                workflowMessage &&
                (workflowMessage.toLowerCase().includes("confirm") ||
                  workflowMessage.toLowerCase().includes("select") ||
                  workflowMessage.toLowerCase().includes("approval") ||
                  workflowMessage.toLowerCase().includes("review") ||
                  workflowMessage.toLowerCase().includes("pre-flight"))
              ) {
                return workflowMessage;
              }
              const step = (effectiveApprovalNextStep || "").trim();
              if (step === "trainingConfigurationNode" || step === "Training Configuration") {
                return "Please confirm candidate models in the Model Selection view below to proceed.";
              }
              if (step === "preFlightNode" || step === "Pre Flight") {
                return "Please review and confirm the Training Configuration contract to proceed.";
              }
              if (
                step === "modelTrainingCodeNode" ||
                step === "Model Training Code Generation" ||
                step === "modelTrainingNode" ||
                step === "Model Training"
              ) {
                return "Pre-flight checks passed. Please review and approve to start model training.";
              }
              if (step === "modelTrainingExecNode" || step === "Model Training Execution") {
                return "Please review training code and approve to execute training.";
              }
              if (step === "modelValidationNode" || step === "Model Validation") {
                return "Please review model validation metrics to proceed.";
              }
              if (ADVANCE_TO_FE_STEPS.has(step)) {
                return "Data ingestion complete. Please approve to advance to Feature Engineering.";
              }
              if (ADVANCE_TO_MODEL_SELECTION_STEPS.has(step)) {
                return "Feature Engineering complete. Please approve to advance to Model Training.";
              }
              return "Please review and approve to proceed to the next phase.";
            })()}
          </span>

        </div>
      )}

      <div className="flex items-start justify-between gap-4 border-b border-border pb-4 mb-6 select-none">
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-bold text-foreground leading-tight">Data Insights Workflow</h2>
          <p className="text-xs text-muted-foreground">End-to-end workflow that transforms data into actionable business insights.</p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {isAwaitingApprovalWorkflow ? (
            <>
              {(() => {
                const isModelTrainingSubprocess =
                  effectiveApprovalNextStep === "Training Configuration" ||
                  effectiveApprovalNextStep === "trainingConfigurationNode" ||
                  effectiveApprovalNextStep === "Pre Flight" ||
                  effectiveApprovalNextStep === "preFlightNode" ||
                  effectiveApprovalNextStep === "Model Training" ||
                  effectiveApprovalNextStep === "modelTrainingNode" ||
                  effectiveApprovalNextStep === "modelTrainingCodeNode" ||
                  effectiveApprovalNextStep === "Model Training Code Generation" ||
                  effectiveApprovalNextStep === "Model Training Execution" ||
                  effectiveApprovalNextStep === "modelTrainingExecNode" ||
                  effectiveApprovalNextStep === "Model Validation" ||
                  effectiveApprovalNextStep === "modelValidationNode" ||
                  pausedAtPhase === "Training Configuration" ||
                  pausedAtPhase === "Pre Flight" ||
                  pausedAtPhase === "Model Training";

                if (isModelTrainingSubprocess) {
                  let buttonLabel = "Review Model Selection";
                  const step = (effectiveApprovalNextStep || pausedAtPhase || "").trim();
                  if (step === "modelValidationNode" || step === "Model Validation") {
                    buttonLabel = "Review & Validate Models";
                  } else if (
                    step === "modelTrainingCodeNode" ||
                    step === "Model Training Code Generation" ||
                    step === "modelTrainingNode" ||
                    step === "Model Training" ||
                    step === "modelTrainingExecNode" ||
                    step === "Model Training Execution"
                  ) {
                    buttonLabel = "Review Pre-Flight Verification";
                  } else if (step === "preFlightNode" || step === "Pre Flight") {
                    buttonLabel = "Review Training Configuration";
                  } else if (step === "trainingConfigurationNode" || step === "Training Configuration") {
                    buttonLabel = "Review Model Selection";
                  }

                  return (
                    <button
                      type="button"
                      onClick={() => onSelectStage("modelTrainingValidation")}
                      disabled={isAnyActionLoading}
                      className={`inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold tracking-wide uppercase transition-all shadow-md active:scale-95 cursor-pointer shrink-0 disabled:opacity-50 disabled:cursor-not-allowed ${isApproving ? "opacity-75 cursor-not-allowed" : "hover:scale-105 animate-pulse"}`}
                      title="Open Model Training & Validation to review the active sub-process"
                    >
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path d="M9 11l3 3L22 4" />
                        <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                      </svg>
                      <span>{buttonLabel}</span>
                    </button>
                  );
                }

                return (
                  <button
                    type="button"
                    onClick={() => onApprove()}
                    disabled={isAnyActionLoading}
                    className={`inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold tracking-wide uppercase transition-all shadow-md active:scale-95 cursor-pointer shrink-0 disabled:opacity-75 disabled:cursor-not-allowed ${isApproving ? "opacity-75 cursor-not-allowed" : "hover:scale-105 animate-pulse"}`}
                  >
                    {isApproving ? (
                      <>
                        <svg className="animate-spin" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="3">
                          <circle cx="12" cy="12" r="10" strokeDasharray="30" strokeLinecap="round" />
                        </svg>
                        <span>Advancing...</span>
                      </>
                    ) : (
                      <>
                        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="3">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                        <span>Proceed to Next Phase</span>
                      </>
                    )}
                  </button>
                );
              })()}
              <button
                type="button"
                onClick={onStopWorkflow}
                disabled={isAnyActionLoading}
                className="inline-flex items-center gap-2 px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold tracking-wide uppercase transition-all shadow-md hover:shadow-rose-600/25 active:scale-95 cursor-pointer shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isStopping ? (
                  <>
                    <svg className="animate-spin" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="3">
                      <circle cx="12" cy="12" r="10" strokeDasharray="30" strokeLinecap="round" />
                    </svg>
                    <span>Stopping...</span>
                  </>
                ) : (
                  <>
                    <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor">
                      <rect x="5" y="5" width="14" height="14" rx="2" />
                    </svg>
                    <span>Stop Workflow</span>
                  </>
                )}
              </button>
            </>
          ) : effectiveRunStatus === "In-Progress" ? (
            <>
              <button
                type="button"
                onClick={onPause}
                disabled={isAnyActionLoading}
                className="inline-flex items-center gap-2 px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-xl text-xs font-bold tracking-wide uppercase transition-all shadow-md hover:scale-105 active:scale-95 cursor-pointer shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isPausing ? (
                  <>
                    <svg className="animate-spin" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="3">
                      <circle cx="12" cy="12" r="10" strokeDasharray="30" strokeLinecap="round" />
                    </svg>
                    <span>Pausing...</span>
                  </>
                ) : (
                  <>
                    <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor">
                      <rect x="5" y="5" width="5" height="14" rx="1" />
                      <rect x="14" y="5" width="5" height="14" rx="1" />
                    </svg>
                    <span>Pause</span>
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={onStopWorkflow}
                disabled={isAnyActionLoading}
                className="inline-flex items-center gap-2 px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold tracking-wide uppercase transition-all shadow-md hover:shadow-rose-600/25 active:scale-95 cursor-pointer shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isStopping ? (
                  <>
                    <svg className="animate-spin" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="3">
                      <circle cx="12" cy="12" r="10" strokeDasharray="30" strokeLinecap="round" />
                    </svg>
                    <span>Stopping...</span>
                  </>
                ) : (
                  <>
                    <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor">
                      <rect x="5" y="5" width="14" height="14" rx="2" />
                    </svg>
                    <span>Stop Workflow</span>
                  </>
                )}
              </button>
            </>
          ) : (effectiveRunStatus === "Paused" || isPaused) && !isAwaitingApprovalWorkflow ? (
            <>
              <button
                type="button"
                onClick={onResume}
                disabled={isAnyActionLoading}
                className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold tracking-wide uppercase transition-all shadow-md hover:scale-105 active:scale-95 cursor-pointer shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isResuming ? (
                  <>
                    <svg className="animate-spin" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="3">
                      <circle cx="12" cy="12" r="10" strokeDasharray="30" strokeLinecap="round" />
                    </svg>
                    <span>Resuming...</span>
                  </>
                ) : (
                  <>
                    <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor">
                      <polygon points="5 3 19 12 5 21 5 3" />
                    </svg>
                    <span>Resume</span>
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={onStopWorkflow}
                disabled={isAnyActionLoading}
                className="inline-flex items-center gap-2 px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold tracking-wide uppercase transition-all shadow-md hover:shadow-rose-600/25 active:scale-95 cursor-pointer shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isStopping ? (
                  <>
                    <svg className="animate-spin" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="3">
                      <circle cx="12" cy="12" r="10" strokeDasharray="30" strokeLinecap="round" />
                    </svg>
                    <span>Stopping...</span>
                  </>
                ) : (
                  <>
                    <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor">
                      <rect x="5" y="5" width="14" height="14" rx="2" />
                    </svg>
                    <span>Stop Workflow</span>
                  </>
                )}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={handleRunClick}
              disabled={isAnyActionLoading}
              className="inline-flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary/95 text-white rounded-xl text-xs font-bold tracking-wide uppercase transition-all shadow-md hover:shadow-primary/25 hover:scale-105 active:scale-95 cursor-pointer shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmittingWorkflow ? (
                <>
                  <svg className="animate-spin" viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="3">
                    <circle cx="12" cy="12" r="10" strokeDasharray="30" strokeLinecap="round" />
                  </svg>
                  <span>Starting Workflow...</span>
                </>
              ) : (
                <>
                  <svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor">
                    <polygon points="5 3 19 12 5 21 5 3" />
                  </svg>
                  <span>{runButtonText}</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>

      <div className="flex w-full min-w-0 items-center px-2 py-5 sm:px-4 select-none">
        {PIPELINE_STEPS.map((step, idx) => {
          const stageStatus = getWorkflowStageStatus(step.id);
          const connectorComplete = stageStatus === "Completed" || stageStatus === "Awaiting Approval" || mainStatuses[idx] === "Completed";

          return (
            <React.Fragment key={step.id}>
              <div className="flex min-w-0 flex-[0_1_155px] justify-center">
                <WorkflowCard
                  step={step}
                  status={getWorkflowStageStatus(step.id)}
                  index={idx}
                  isActive={mainSelectedStage === step.id}
                  isUserPaused={effectiveRunStatus === "Paused"}
                  onSelect={onSelectStage}
                />
              </div>

              {idx < PIPELINE_STEPS.length - 1 && (
                <div className="flex min-w-4 flex-1 items-center" aria-hidden="true">
                  <span
                    className={`h-1 min-w-0 flex-1 transition-colors duration-500 ${connectorComplete
                      ? "bg-gradient-to-r from-blue-500 to-indigo-500"
                      : "bg-border/60 dark:bg-white/15"
                      }`}
                  />
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>

      <div className="border-t border-border pt-5 mt-2 flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.2em] font-bold text-muted-foreground">Selected stage</p>
            <h3 className="text-sm font-semibold text-foreground">{STAGE_CONFIG[mainSelectedStage].displayName}</h3>
            <p className="text-xs text-muted-foreground mt-1">
              {(() => {
                const isIngestionStageDone = calculateDataIngestionStatus(pipelineStatuses) === "Completed";
                if (mainSelectedStage === "dataIngestion" && isIngestionStageDone && effectiveRunStatus !== "Awaiting Approval" && groupedPipelineStatuses?.dataIngestion?.status !== "Awaiting Approval") {
                  return "Data Ingestion completed successfully.";
                }
                return workflowMessage || "Select a workflow stage to inspect the live output.";
              })()}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => onSelectStage(mainSelectedStage)}
              className="inline-flex items-center gap-2 px-3.5 py-2 bg-primary hover:bg-primary/90 text-white rounded-lg text-xs font-semibold transition-colors cursor-pointer shadow-sm"
            >
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" className="text-white">
                <path d="M15 3h6v6" />
                <path d="M10 14 21 3" />
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              </svg>
              View Details
            </button>
            <button
              type="button"
              onClick={() => onRetry(mainSelectedStage)}
              disabled={isWorkflowStoppedOrFailed || isAnyActionLoading}
              className="inline-flex items-center gap-2 px-3 py-2 border border-border rounded-lg text-xs font-semibold text-foreground hover:bg-surface-muted transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              title={
                isWorkflowStoppedOrFailed
                  ? `Cannot retry stage when workflow is ${effectiveRunStatus.toLowerCase()}`
                  : "Retry this workflow stage"
              }
            >
              {isRetrying ? (
                <>
                  <svg className="animate-spin" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" strokeDasharray="30" strokeLinecap="round" />
                  </svg>
                  <span>Retrying...</span>
                </>
              ) : (
                <>
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 12a9 9 0 1 1-3-6.7" />
                    <path d="M21 3v6h-6" />
                  </svg>
                  <span>Retry Stage</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      <div className="border-t border-border pt-5 mt-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 select-none">
        <div className="flex items-center gap-4 flex-wrap text-xs">
          {[
            { color: "bg-status-none", label: "None" },
            { color: "bg-status-pending", label: "Pending" },
            { color: "bg-status-in-progress", label: "In-Progress" },
            { color: "bg-status-awaiting-approval", label: "Awaiting Approval" },
            { color: "bg-status-user-input", label: "User Input" },
            { color: "bg-status-completed", label: "Completed" },
            { color: "bg-status-failed", label: "Failed" },
            { color: "bg-status-stopped", label: "Stopped" },
            { color: "bg-status-paused", label: "Paused" },
          ].map(({ color, label }) => (
            <div key={label} className="flex items-center gap-1.5 font-semibold">
              <span className={`w-2.5 h-2.5 rounded-full ${color}`} />
              <span className="text-muted-foreground">{label}</span>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-4 flex-wrap text-xs font-semibold">
          <span className="text-muted-foreground">Last run: {lastRunTime}</span>

          <span
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full font-bold ${isAwaitingApprovalWorkflow
              ? "bg-status-awaiting-approval/15 text-status-awaiting-approval border border-status-awaiting-approval/30"
              : effectiveRunStatus === "Paused"
                ? "bg-status-paused/15 text-status-paused border border-status-paused/30"
                : effectiveRunStatus === "In-Progress"
                  ? "bg-status-in-progress/15 text-status-in-progress border border-status-in-progress/30"
                  : effectiveRunStatus === "Completed"
                    ? "bg-status-completed/15 text-status-completed border border-status-completed/30"
                    : effectiveRunStatus === "Stopped"
                      ? "bg-status-stopped/15 text-status-stopped border border-status-stopped/30"
                      : effectiveRunStatus === "Failed"
                        ? "bg-status-failed/15 text-status-failed border border-status-failed/30"
                        : "bg-surface-muted text-muted-foreground border border-border"
              }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full shrink-0 ${isAwaitingApprovalWorkflow
                ? "bg-status-awaiting-approval animate-pulse"
                : effectiveRunStatus === "Paused"
                  ? "bg-status-paused"
                  : effectiveRunStatus === "In-Progress"
                    ? "bg-status-in-progress animate-ping"
                    : effectiveRunStatus === "Completed"
                      ? "bg-status-completed"
                      : effectiveRunStatus === "Stopped"
                        ? "bg-status-stopped"
                        : effectiveRunStatus === "Failed"
                          ? "bg-status-failed"
                          : "bg-status-none"
                }`}
            />
            {isAwaitingApprovalWorkflow
              ? "Awaiting Approval"
              : effectiveRunStatus === "In-Progress"
                ? "In-Progress"
                : effectiveRunStatus === "Paused"
                  ? "Paused"
                  : effectiveRunStatus === "Completed"
                    ? "Completed"
                    : effectiveRunStatus === "Stopped"
                      ? "Stopped"
                      : effectiveRunStatus === "Failed"
                        ? "Failed"
                        : "None"}
          </span>

        </div>
      </div>
    </div>
  );
}
