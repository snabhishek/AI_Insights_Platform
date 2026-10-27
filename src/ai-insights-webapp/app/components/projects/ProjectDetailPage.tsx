"use client";

import React, { useState, useEffect } from "react";
import { Project, DataSource, UserProfile } from "../providers/AppContext";
import { PipelineStatus, PipelineStatuses, RunStatus, StageOutputs, Workflow, WorkflowStep, WorkflowAgentState } from "./types";
import { getMainStepId, toDisplayStatuses } from "./WorkflowPipeline";
import CardModal from "../shared/ui/CardModal";
import SubProcessLogModal from "../shared/ui/SubProcessLogModal";
import { ScrollText } from "lucide-react";
import { PIPELINE_STEPS } from "./constants";
import { resolveModelTrainingReviewStep } from "./pipelineFlowConfig";
import { canViewSubprocessLogs, normalizeStageOutputs, StageKey } from "./pipelineNames";
import IngestionStepOutput from "./pipeline-outputs/IngestionStepOutput";
import ProfilingStepOutput from "./pipeline-outputs/ProfilingStepOutput";
import SchemaResolverStepOutput from "./pipeline-outputs/SchemaResolverStepOutput";
import ExogenousScoutStepOutput from "./pipeline-outputs/ExogenousScoutStepOutput";
import HierarchyMapperStepOutput from "./pipeline-outputs/HierarchyMapperStepOutput";
import FeatureArchitectStepOutput from "./pipeline-outputs/FeatureArchitectStepOutput";
import FeatureValidatorStepOutput from "./pipeline-outputs/FeatureValidatorStepOutput";
import ModelTrainingValidationStepOutput from "./pipeline-outputs/ModelTrainingValidationStepOutput";
import ModelTrainingExecutionStepOutput from "./pipeline-outputs/ModelTrainingExecutionStepOutput";
import SignalStrip, { toStripStages, type StepStatus } from "./SignalStrip";

type AlertType = "error" | "success" | "info";

interface ProjectDetailPageProps {
  project: Project;
  allDataSources: DataSource[];
  userProfile: UserProfile;
  pipelineStatuses: PipelineStatuses;
  completionPercentage: number;
  runStatus: RunStatus;
  lastRunTime: string;
  onRunWorkflow: () => void;
  onReRunWorkflow?: (newUseCase?: string) => void;
  onSaveUseCase?: (newUseCase: string) => Promise<void> | void;
  onStopWorkflow?: () => void;
  onGoBack: () => void;
  onDelete: () => void;
  onEdit: () => void;

  onManageSources: () => void;
  onAddTag: () => void;
  activeStage: string | null;
  stageOutputs: StageOutputs;
  workflowMessage: string;
  workflowError: string | null;
  onSelectStage: (stepId: string) => void;
  onApprove: (
    overrideTargetPhase?: string,
    selectedModels?: string[],
    splitEndDate?: string,
    predictionHorizon?: number,
    predictionFrequency?: string,
    predictionObjectiveStartDate?: string
  ) => void;
  onRetry: (stepId: string) => void;
  isPaused?: boolean;
  pausedAtPhase?: string | null;
  onPause?: () => void;
  onResume?: () => void;
  approvalNextStep?: string | null;
  isApproving?: boolean;
  isAwaitingResponse?: boolean;
  isSubmittingWorkflow?: boolean;
  isPausing?: boolean;
  isStopping?: boolean;
  isResuming?: boolean;
  isRetrying?: boolean;
  agentThinking?: Record<string, Array<{ time: string; text: string; done: boolean }>>;
  showAlert: (opts: { title: string; message?: string; type: AlertType; logs?: string }) => void;
}

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
  "modelValidationNode",
  "Model Validation",
]);

const SIGNAL_STRIP_STAGES = toStripStages(
  PIPELINE_STEPS.map((stage) => ({
    ...stage,
    short:
      stage.id === "dataIngestion"
        ? "Raw signal"
        : stage.id === "featureEngineering"
          ? "Shaped features"
          : "Model-ready",
  }))
);

export default function ProjectDetailPage({
  project,
  allDataSources,
  userProfile,
  pipelineStatuses,
  completionPercentage,
  runStatus,
  lastRunTime,
  onRunWorkflow,
  onReRunWorkflow,
  onSaveUseCase,
  onStopWorkflow,
  onGoBack,
  onDelete,
  onEdit,

  onManageSources,
  onAddTag,
  activeStage,
  stageOutputs,
  workflowMessage,
  workflowError,
  onSelectStage,
  onApprove,
  onRetry,
  isPaused,
  onPause,
  onResume,
  approvalNextStep,
  isApproving,
  isAwaitingResponse,
  isSubmittingWorkflow,
  isPausing,
  isStopping,
  isResuming,
  isRetrying,
  showAlert,
}: ProjectDetailPageProps) {
  const [isExecutionModalOpen, setIsExecutionModalOpen] = useState<boolean>(false);
  const [selectedWorkflow, setSelectedWorkflow] = useState<Workflow | null>(null);
  const [selectedSubstepId, setSelectedSubstepId] = useState<string | null>(null);
  const [retryingStepId, setRetryingStepId] = useState<string | null>(null);
  const [isLogModalOpen, setIsLogModalOpen] = useState(false);
  const [logModalSubstep, setLogModalSubstep] = useState<WorkflowStep | null>(null);
  const [logModalPipelineTitle, setLogModalPipelineTitle] = useState<string | null>(null);

  const handleOpenLogs = (stepItem: WorkflowStep, stageTitle: string) => {
    setLogModalSubstep(stepItem);
    setLogModalPipelineTitle(stageTitle);
    setIsLogModalOpen(true);
  };

  const displayPipelineStatuses = toDisplayStatuses(pipelineStatuses);
  const signalStatus: Record<string, StepStatus> = Object.fromEntries(
    PIPELINE_STEPS.flatMap((stage) =>
      (stage.step ?? []).map((step) => {
        const status = displayPipelineStatuses[step.id];
        const stripStatus: StepStatus =
          status === "Completed"
            ? "done"
            : status === "In-Progress" ||
                status === "Awaiting Approval" ||
                status === "User Input" ||
                status === "Paused"
              ? "running"
              : "pending";
        return [step.id, stripStatus];
      })
    )
  );

  useEffect(() => {
    if (!isRetrying) {
      setRetryingStepId(null);
    }
  }, [isRetrying]);

  const hasInProgressGroup = Object.values(pipelineStatuses || {}).some(
    (g: any) => g?.status === "In-Progress"
  );
  const hasInProgressFlat = Object.values(displayPipelineStatuses).some(
    (s) => s === "In-Progress"
  );
  const hasInProgress = hasInProgressGroup || hasInProgressFlat;

  const hasAwaitingApproval = runStatus === "Awaiting Approval";

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
    const diStatus = displayPipelineStatuses["dataIngestion"] || displayPipelineStatuses["Data Ingestion"];
    const feStatus = displayPipelineStatuses["featureEngineering"] || displayPipelineStatuses["Feature Engineering"];
    const mtvStatus = displayPipelineStatuses["modelTrainingValidation"] || displayPipelineStatuses["Model Training & Validation"];
    if (diStatus === "Awaiting Approval" || (diStatus === "Completed" && (feStatus === "Pending" || feStatus === "None"))) {
      return "Feature Engineering";
    }
    if (feStatus === "Awaiting Approval" || (feStatus === "Completed" && (mtvStatus === "Pending" || mtvStatus === "None"))) {
      return "Model Training & Validation";
    }
    if (mtvStatus === "Awaiting Approval") {
      const mtv = displayPipelineStatuses;
      if (mtv.modelTrainingCodeNode === "User Input" || mtv.modelTrainingCodeNode === "Awaiting Approval") {
        return "Model Training";
      }
      if (mtv.preFlightNode === "User Input" || mtv.preFlightNode === "Awaiting Approval") {
        return "Pre Flight";
      }
      if (mtv.trainingConfigurationNode === "User Input" || mtv.trainingConfigurationNode === "Awaiting Approval") {
        return "Training Configuration";
      }
      if (mtv.modelSelectionNode === "User Input" || mtv.modelSelectionNode === "Awaiting Approval") {
        return "Model Selection";
      }
      if (mtv.modelSelectionNode !== "Completed") return "Model Selection";
      if (mtv.trainingConfigurationNode !== "Completed") return "Training Configuration";
      if (mtv.preFlightNode !== "Completed") return "Pre Flight";
      return "Model Training";
    }
    return "Feature Engineering";
  })();

  const isWorkflowStoppedOrFailed =
    effectiveRunStatus === "Stopped" ||
    effectiveRunStatus === "Failed" ||
    effectiveRunStatus === "Paused" ||
    effectiveRunStatus === "In-Progress";

  const isAnyActionLoading = Boolean(
    isApproving || isSubmittingWorkflow || isPausing || isStopping || isResuming || isRetrying
  );

  const hasExistingRun =
    (lastRunTime !== "Not run yet" ||
      effectiveRunStatus === "Completed" ||
      effectiveRunStatus === "Failed" ||
      Object.values(displayPipelineStatuses).some((s) => s === "Completed" || s === "In-Progress")) &&
    effectiveRunStatus !== "Stopped";

  const runButtonText = hasExistingRun ? "Re-Run Workflow" : "Run Workflow";

  const handleRunClick = () => {
    if (isSubmittingWorkflow) return;
    if (hasExistingRun && onReRunWorkflow) {
      onReRunWorkflow();
    } else {
      onRunWorkflow();
    }
  };

  const getWorkflowStageStatus = (stage: string): PipelineStatus => {
    const status = displayPipelineStatuses[stage] ?? "None";

    if (isAwaitingApprovalWorkflow) {
      const nextStep = (effectiveApprovalNextStep || "").trim();
      const isDataIngestion = stage === "dataIngestion" || stage === "Data Ingestion";
      const isFeatureEngineering = stage === "featureEngineering" || stage === "Feature Engineering";
      const isModelTraining = stage === "modelTrainingValidation" || stage === "Model Training & Validation";

      if (isDataIngestion) {
        const isAwaitingFeAdvance =
          ADVANCE_TO_FE_STEPS.has(nextStep) ||
          (!nextStep &&
            (displayPipelineStatuses["featureEngineering"] === "Pending" ||
              displayPipelineStatuses["featureEngineering"] === "None" ||
              displayPipelineStatuses["Feature Engineering"] === "Pending" ||
              displayPipelineStatuses["Feature Engineering"] === "None") &&
            (displayPipelineStatuses["dataIngestion"] === "Completed" ||
              displayPipelineStatuses["Data Ingestion"] === "Completed" ||
              status === "Completed"));
        if (isAwaitingFeAdvance) {
          return "Awaiting Approval";
        }
      }

      if (isFeatureEngineering) {
        const isAwaitingModelAdvance =
          ADVANCE_TO_MODEL_SELECTION_STEPS.has(nextStep) &&
          (displayPipelineStatuses["modelTrainingValidation"] === "Pending" ||
            displayPipelineStatuses["modelTrainingValidation"] === "None" ||
            displayPipelineStatuses["Model Training & Validation"] === "Pending" ||
            displayPipelineStatuses["Model Training & Validation"] === "None");
        if (isAwaitingModelAdvance) {
          return "Awaiting Approval";
        }
      }

      if (isModelTraining) {
        const isModelPhaseActive =
          MODEL_TRAINING_VALIDATION_STEPS.has(nextStep) ||
          (ADVANCE_TO_MODEL_SELECTION_STEPS.has(nextStep) &&
            (displayPipelineStatuses["featureEngineering"] === "Completed" ||
              displayPipelineStatuses["Feature Engineering"] === "Completed") &&
            (displayPipelineStatuses["modelTrainingValidation"] === "In-Progress" ||
              displayPipelineStatuses["Model Training & Validation"] === "In-Progress"));
        if (isModelPhaseActive) {
          return "Awaiting Approval";
        }
      }
    }

    const hasAnyWorkStarted =
      Object.values(displayPipelineStatuses).some((s) => s === "Completed" || s === "In-Progress") ||
      effectiveRunStatus === "In-Progress" ||
      effectiveRunStatus === "Paused" ||
      effectiveRunStatus === "Completed";

    if (status === "Pending" && !hasAnyWorkStarted && effectiveRunStatus === "None") return "None";
    if (status !== "Completed" && effectiveRunStatus === "Stopped") return "Stopped";
    return status;
  };

  const modelTrainingReview = isAwaitingApprovalWorkflow
    ? resolveModelTrainingReviewStep(effectiveApprovalNextStep)
    : null;

  const isModelTrainingReviewStep = (stepId: string, stageId: string): boolean =>
    stageId === "modelTrainingValidation" && modelTrainingReview?.stepId === stepId;


  const handleSelectStage = (stepId: string) => {
    // Stage cards themselves are not navigable; only subprocess items are navigable.
    const isMainStageId = PIPELINE_STEPS.some((item) => item.id === stepId);
    if (isMainStageId) {
      return;
    }

    const mainId = getMainStepId(stepId);
    onSelectStage(mainId);
    const match = PIPELINE_STEPS.find((item) => item.id === mainId);
    if (match) {
      setSelectedWorkflow(match);
      setSelectedSubstepId(stepId);
      setIsExecutionModalOpen(true);
    }
  };

  const renderStepCircleIcon = (stepItem: WorkflowStep, stageId: string) => {
    const stepStatus = displayPipelineStatuses[stepItem.id] ?? "Pending";
    const isCompleted = stepStatus === "Completed";
    const isAwaiting = !isCompleted && isModelTrainingReviewStep(stepItem.id, stageId);
    const isStepInProgress =
      !isAwaiting &&
      !isCompleted &&
      stepStatus === "In-Progress" &&
      effectiveRunStatus === "In-Progress";
    const isPausedStep =
      !isCompleted &&
      (stepStatus === "Paused" ||
        (effectiveRunStatus === "Paused" && stepStatus === "In-Progress"));
    const isStopped =
      stepStatus === "Stopped" ||
      (effectiveRunStatus === "Stopped" && !isCompleted && stepStatus === "In-Progress");

    if (isCompleted) {
      return (
        <div className="w-10 h-10 rounded-full bg-status-completed border-2 border-status-completed text-white flex items-center justify-center shrink-0 shadow-sm">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="4.5" aria-label="Completed">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
      );
    }

    if (isPausedStep) {
      return (
        <div className="w-10 h-10 rounded-full bg-status-paused border-2 border-status-paused text-white flex items-center justify-center shrink-0 shadow-sm">
          <div className="flex items-center gap-0.5">
            <div className="w-0.5 h-2.5 bg-white rounded-full" />
            <div className="w-0.5 h-2.5 bg-white rounded-full" />
          </div>
        </div>
      );
    }

    if (isAwaiting) {
      return (
        <div className="w-10 h-10 rounded-full bg-status-awaiting-approval border-2 border-status-awaiting-approval text-white flex items-center justify-center shrink-0 shadow-md animate-pulse">
          <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="4.5">
            <polygon points="5 3 19 12 5 21 5 3" />
          </svg>
        </div>
      );
    }

    if (isStepInProgress) {
      return (
        <div className="w-10 h-10 rounded-full bg-status-in-progress border-2 border-status-in-progress text-white flex items-center justify-center shrink-0 shadow-md animate-pulse">
          <svg className="animate-spin h-3.5 w-3.5 text-white" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        </div>
      );
    }

    if (isStopped) {
      return (
        <div className="w-10 h-10 rounded-full bg-status-stopped border-2 border-status-stopped text-white flex items-center justify-center shrink-0 shadow-sm">
          <div className="w-2 h-2 rounded-xs bg-white" />
        </div>
      );
    }

    if (stepStatus === "Failed") {
      return (
        <div className="w-10 h-10 rounded-full bg-status-failed border-2 border-status-failed text-white flex items-center justify-center shrink-0 shadow-sm">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="3.5" aria-label="Failed">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </div>
      );
    }

    const colorMap: Record<string, string> = {
      green: "bg-emerald-600 text-white border-emerald-600",
      blue: "bg-blue-600 text-white border-blue-600",
      purple: "bg-purple-600 text-white border-purple-600",
      yellow: "bg-amber-600 text-white border-amber-600",
      teal: "bg-teal-600 text-white border-teal-600",
      pink: "bg-pink-600 text-white border-pink-600",
    };
    const cClass = colorMap[stepItem.color] || "bg-primary text-white border-primary";

    return (
      <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 border-2 font-black text-xs transition-all shadow-xs ${cClass}`}>
        {stepItem.icon}
      </div>
    );
  };

  return (
    <>
      <div className="p-4 sm:p-6 w-full flex flex-col min-h-full bg-background animate-fade-in select-none">

        {/* 1. Header: Project Title, Subtitle, Pills on Left; Workflow Buttons on Right */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground">
              {project.projectName || project.name}
            </h1>

            {project.projectName && (
              <span className="text-sm text-muted-foreground font-medium">
                {project.name}
              </span>
            )}

            {(project.domain || project.subDomain) && (
              <div className="flex items-center gap-2 flex-wrap">
                {project.domain && (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-primary text-white shadow-sm">
                    <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.5" className="shrink-0 text-white">
                      <circle cx="12" cy="12" r="10" /><path d="M2 12h20M12 2a15.3 15.3 0 0 1 0 20M12 2a15.3 15.3 0 0 0 0 20" />
                    </svg>
                    {project.domain}
                  </span>
                )}
                {project.subDomain && (
                  <>
                    <span className="text-muted-foreground/40 text-xs select-none">›</span>
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-primary/90 text-white shadow-sm">
                      {project.subDomain}
                    </span>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Workflow Action Buttons at the right end of the header */}
          <div className="flex items-center gap-2.5 flex-wrap shrink-0">
            {isAwaitingApprovalWorkflow ? (
              <>
                {modelTrainingReview ? (
                  <button
                    type="button"
                    onClick={() => handleSelectStage(modelTrainingReview.stepId)}
                    disabled={isAnyActionLoading}
                    className={`inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold tracking-wide uppercase transition-all shadow-md active:scale-95 cursor-pointer shrink-0 disabled:opacity-50 disabled:cursor-not-allowed ${
                      isApproving ? "opacity-75 cursor-not-allowed" : "hover:scale-105 animate-pulse"
                    }`}
                    title="Open Model Training & Validation to review the active sub-process"
                  >
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M9 11l3 3L22 4" />
                      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                    </svg>
                    <span>{modelTrainingReview.buttonLabel}</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => onApprove()}
                    disabled={isAnyActionLoading}
                    className={`inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold tracking-wide uppercase transition-all shadow-md active:scale-95 cursor-pointer shrink-0 disabled:opacity-75 disabled:cursor-not-allowed ${
                      isApproving ? "opacity-75 cursor-not-allowed" : "hover:scale-105 animate-pulse"
                    }`}
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
                )}

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

        {/* Error or Awaiting Response Banners */}
        {workflowError && (
          <div
            role="alert"
            className="mb-5 flex items-start gap-3 px-4 py-3 rounded-xl bg-gradient-to-r from-red-500/15 via-red-500/5 to-surface border border-red-500/30 text-red-800 dark:text-red-300 shadow-sm animate-fadeIn"
          >
            <svg
              className="mt-0.5 shrink-0"
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="10" />
              <path d="M12 8v4m0 4h.01" />
            </svg>
            <div className="min-w-0">
              <p className="text-xs font-bold tracking-wide">Workflow error</p>
              <p className="mt-1 text-xs whitespace-pre-wrap break-words">{workflowError}</p>
            </div>
          </div>
        )}

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
              {workflowMessage || "Please review and approve to proceed to the next phase."}
            </span>
          </div>
        )}

        {/* <SignalStrip
          stages={SIGNAL_STRIP_STAGES}
          status={signalStatus}
          selectedId={selectedSubstepId ?? undefined}
          onSelect={handleSelectStage}
          height={88}
          className="mb-4"
        /> */}

        {/* 3. Three Stage Cards Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-stretch">
          {PIPELINE_STEPS.map((stage) => {
            const stageId = stage.id;
            const steps = stage.step || [];
            const completedCount = steps.filter(
              (s) => displayPipelineStatuses[s.id] === "Completed"
            ).length;

            // Per-stage accent colors
            const stageColorTheme =
              stageId === "dataIngestion"
                ? {
                    border: "border-t-emerald-600 dark:border-t-emerald-500",
                    iconBg: "bg-emerald-600",
                    counterText: "text-emerald-700 dark:text-emerald-400",
                    bar: "bg-emerald-600 dark:bg-emerald-500",
                  }
                : stageId === "featureEngineering"
                ? {
                    border: "border-t-amber-500 dark:border-t-amber-400",
                    iconBg: "bg-amber-500",
                    counterText: "text-amber-600 dark:text-amber-400",
                    bar: "bg-amber-500 dark:bg-amber-400",
                  }
                : {
                    border: "border-t-pink-600 dark:border-t-pink-500",
                    iconBg: "bg-pink-600",
                    counterText: "text-pink-600 dark:text-pink-400",
                    bar: "bg-pink-600 dark:bg-pink-500",
                  };

            return (
              <div
                key={stage.id}
                className={`h-full min-h-[430px] rounded-2xl border border-border/80 border-t-4 bg-surface p-4 shadow-xs transition-all duration-300 ${stageColorTheme.border}`}
              >
                {/* Stage Header */}
                <div className="select-none">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <div
                        className={`w-11 h-11 rounded-xl ${stageColorTheme.iconBg} text-white flex items-center justify-center font-bold text-base shadow-sm shrink-0`}
                      >
                        {stage.icon}
                      </div>
                      <h2 className="truncate text-lg font-extrabold text-foreground tracking-tight leading-snug">
                        {stage.title}
                      </h2>
                    </div>

                    <span className={`shrink-0 text-lg font-black tracking-tight ${stageColorTheme.counterText}`}>
                      {completedCount}/{steps.length}
                    </span>
                  </div>
                  <p className="mt-2 truncate text-sm leading-normal text-muted-foreground">
                    {stage.description}
                  </p>
                </div>

                {/* Accent Divider Line */}
                <div className={`h-1.5 rounded-full mt-3 mb-3.5 ${stageColorTheme.bar}`} />

                {/* Steps List */}
                <div className="flex flex-col gap-2">
                  {steps.map((stepItem) => {
                    const isStepGlowing = isModelTrainingReviewStep(stepItem.id, stageId);
                    const isStepSelected = selectedSubstepId === stepItem.id;
                    const stepStatus = displayPipelineStatuses[stepItem.id] ?? "Pending";
                    const isAwaitingApprovalStepNotRetryable =
                      isAwaitingApprovalWorkflow &&
                      (stepStatus === "Pending" ||
                        stepStatus === "None");

                    return (
                      <div
                        key={stepItem.id}
                        onClick={() => handleSelectStage(stepItem.id)}
                        className={`group flex min-h-[66px] cursor-pointer items-center justify-between gap-3 rounded-xl border px-3 py-2.5 transition-all duration-200 ${
                          isStepSelected
                            ? "border-blue-500 bg-blue-50/40 dark:bg-blue-950/25 ring-1 ring-blue-500"
                            : "border-transparent bg-slate-100 hover:border-border/80 hover:bg-slate-200/70 dark:bg-surface-muted dark:hover:bg-surface-muted/80"
                        } ${
                          isStepGlowing
                            ? "animate-approval-glow ring-2 ring-amber-400 dark:ring-amber-500 bg-amber-500/10"
                            : ""
                        }`}
                      >
                        {/* Step status is reflected by the icon, while the icon shape identifies the step. */}
                        <div className="shrink-0">
                          {renderStepCircleIcon(stepItem, stageId)}
                        </div>

                        <div className="min-w-0 flex-1 pr-1">
                          <h3 className="truncate text-sm font-bold leading-tight text-foreground">
                            {stepItem.title}
                          </h3>
                          <p className="mt-1 truncate text-sm leading-tight text-muted-foreground" title={stepItem.description}>
                            {stepItem.description}
                          </p>
                        </div>

                        <div className="shrink-0 flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setRetryingStepId(stepItem.id);
                              onRetry(stepItem.id);
                            }}
                            disabled={
                              isRetrying ||
                              isWorkflowStoppedOrFailed ||
                              isAwaitingApprovalStepNotRetryable ||
                              isAnyActionLoading
                            }
                            className="group/btn relative inline-flex items-center justify-center w-8 h-8 rounded-lg border border-border hover:border-primary/60 bg-surface hover:bg-surface-muted text-foreground transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shadow-2xs shrink-0 select-none"
                            aria-label={`Retry ${stepItem.title}`}
                          >
                            {isRetrying && retryingStepId === stepItem.id ? (
                              <svg className="animate-spin text-primary" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.5">
                                <circle cx="12" cy="12" r="10" strokeDasharray="30" strokeLinecap="round" />
                              </svg>
                            ) : (
                              <svg
                                viewBox="0 0 24 24"
                                width="15"
                                height="15"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2.2"
                                className="text-muted-foreground group-hover/btn:text-primary dark:group-hover/btn:text-primary-foreground group-hover/btn:scale-110 transition-all"
                              >
                                <path d="M21 12a9 9 0 1 1-3-6.7" />
                                <path d="M21 3v6h-6" />
                              </svg>
                            )}

                            {/* Modern hover pill */}
                            <span className="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-slate-900/95 dark:bg-slate-100 px-2.5 py-0.5 text-[10px] font-semibold text-white dark:text-slate-900 opacity-0 shadow-md transition-all duration-150 group-hover/btn:opacity-100 group-hover/btn:-translate-y-0.5 z-30">
                              {isRetrying && retryingStepId === stepItem.id ? "Retrying..." : "Retry"}
                            </span>
                          </button>

                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOpenLogs(stepItem, stage.title);
                            }}
                            disabled={!canViewSubprocessLogs(stepStatus, effectiveRunStatus)}
                            className="group/btn relative inline-flex items-center justify-center w-8 h-8 rounded-lg border border-border enabled:hover:border-primary/60 bg-surface enabled:hover:bg-surface-muted text-foreground transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shadow-2xs shrink-0 select-none"
                            aria-label={`View execution logs for ${stepItem.title}`}
                          >
                            <ScrollText
                              size={16}
                              strokeWidth={2}
                              className="text-muted-foreground group-hover/btn:text-primary dark:group-hover/btn:text-primary-foreground group-hover/btn:scale-110 transition-all"
                            />
                            {stepStatus === "In-Progress" && effectiveRunStatus === "In-Progress" && (
                              <span className="absolute -top-1 -right-1 flex h-2 w-2">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                              </span>
                            )}

                            {/* Modern hover pill */}
                            <span className="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-slate-900/95 dark:bg-slate-100 px-2.5 py-0.5 text-[10px] font-semibold text-white dark:text-slate-900 opacity-0 shadow-md transition-all duration-150 group-hover/btn:opacity-100 group-hover/btn:-translate-y-0.5 z-30">
                              Logs
                            </span>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 4. Output Card Modal (Retained Item 3: opened when clicking any step) */}
      {(() => {
        const savedAgentState: WorkflowAgentState = project.agentState || {};
        const savedOutputs = normalizeStageOutputs(savedAgentState.stageOutputs);
        const currentOutputs = normalizeStageOutputs(stageOutputs);
        const allowLegacyOutputFallback =
          savedAgentState.stageOutputs === undefined && runStatus !== "In-Progress";

        const effectiveInspect =
          currentOutputs.inspect ||
          savedOutputs.inspect ||
          (allowLegacyOutputFallback ? savedAgentState.inspection || savedAgentState.inspect : undefined);
        const effectiveProfileData =
          currentOutputs.profileData ||
          savedOutputs.profileData ||
          (allowLegacyOutputFallback ? savedAgentState.dataProfile || savedAgentState.profileData : undefined);
        const effectiveResolveSchema =
          currentOutputs.resolveSchema ||
          savedOutputs.resolveSchema ||
          (allowLegacyOutputFallback ? savedAgentState.schemaResolution || savedAgentState.resolveSchema : undefined);
        const effectiveHierarchyMapper =
          currentOutputs.hierarchyMapperNode ||
          savedOutputs.hierarchyMapperNode ||
          (allowLegacyOutputFallback
            ? savedAgentState.hierarchyMapperNode || savedAgentState.hierarchyMapper
            : undefined);
        const effectiveRelationshipBuilder = effectiveHierarchyMapper?.relationshipBuilder;
        const effectiveFormBuilder = effectiveHierarchyMapper?.formBuilder;
        const effectiveFeatureArchitect =
          currentOutputs.featureArchitectNode ||
          savedOutputs.featureArchitectNode ||
          (allowLegacyOutputFallback
            ? savedAgentState.featureArchitectNode || savedAgentState.featureArchitect
            : undefined);
        const effectiveFeatureValidator =
          currentOutputs.featureValidatorNode ||
          savedOutputs.featureValidatorNode ||
          effectiveFeatureArchitect?.featureValidator ||
          (allowLegacyOutputFallback
            ? savedAgentState.featureValidatorNode || savedAgentState.featureValidator
            : undefined);
        const effectiveExogenousScout =
          currentOutputs.exogenous ||
          savedOutputs.exogenous ||
          (allowLegacyOutputFallback
            ? savedAgentState.exogenousScout || savedAgentState.exogenous
            : undefined);
        const effectiveModelSelection =
          currentOutputs.modelSelectionNode ||
          savedOutputs.modelSelectionNode ||
          (allowLegacyOutputFallback
            ? savedAgentState.modelSelectionNode || savedAgentState.modelSelection
            : undefined);
        const effectiveTrainingConfig =
          currentOutputs.trainingConfigurationNode || savedOutputs.trainingConfigurationNode;
        const isTrainingConfigurationComplete =
          displayPipelineStatuses.trainingConfigurationNode === "Completed" &&
          Boolean(effectiveTrainingConfig?.contractPath);
        const effectivePreFlight =
          currentOutputs.preFlightNode ||
          savedOutputs.preFlightNode ||
          (allowLegacyOutputFallback ? savedAgentState.preFlightNode || savedAgentState.preFlight : undefined);
        const effectiveModelTraining =
          currentOutputs.modelTrainingCodeNode ||
          savedOutputs.modelTrainingCodeNode ||
          (allowLegacyOutputFallback
            ? savedAgentState.modelTrainingCodeNode || savedAgentState.modelTraining
            : undefined);
        const effectiveModelValidation = effectiveModelTraining?.modelValidation;
        const effectiveRunTimestamp = savedAgentState.runTimestamp;

        const stepOutputs: Record<string, React.ReactNode> = {
          inspect: effectiveInspect ? <IngestionStepOutput inspectOutput={effectiveInspect} /> : null,
          profileData: effectiveProfileData ? <ProfilingStepOutput profileData={effectiveProfileData} /> : null,
          resolveSchema: effectiveResolveSchema ? <SchemaResolverStepOutput resolveSchema={effectiveResolveSchema} /> : null,
          hierarchyMapperNode: (effectiveHierarchyMapper || effectiveRelationshipBuilder || effectiveFormBuilder) ? (
            <HierarchyMapperStepOutput
              hierarchyMapper={effectiveHierarchyMapper}
              relationshipBuilder={effectiveRelationshipBuilder}
              formBuilder={effectiveFormBuilder}
            />
          ) : null,
          featureArchitectNode: effectiveFeatureArchitect ? (
            <FeatureArchitectStepOutput featureArchitect={effectiveFeatureArchitect} />
          ) : null,
          featureValidatorNode: effectiveFeatureValidator ? (
            <FeatureValidatorStepOutput featureValidator={effectiveFeatureValidator} />
          ) : null,
          exogenous: effectiveExogenousScout ? (
            <ExogenousScoutStepOutput exogenousScout={effectiveExogenousScout} />
          ) : null,
          modelSelectionNode: effectiveModelSelection ? (
            <ModelTrainingValidationStepOutput
              modelSelection={effectiveModelSelection}
              projectId={project.id}
              activeSubstep="Model Selection"
              activeRunTimestamp={effectiveRunTimestamp}
              nextStepInProgress={displayPipelineStatuses.trainingConfigurationNode === "In-Progress"}
              onSelectionConfirmed={(models) => {
                if (onApprove) {
                  onApprove("Training Configuration", models);
                }
              }}
            />
          ) : null,
          trainingConfigurationNode: isTrainingConfigurationComplete ? (
            <ModelTrainingValidationStepOutput
              modelSelection={effectiveModelSelection}
              trainingConfiguration={effectiveTrainingConfig}
              projectId={project.id}
              activeSubstep="Training Configuration"
              activeRunTimestamp={effectiveRunTimestamp}
              isConfigurationComplete={isTrainingConfigurationComplete}
              nextStepInProgress={displayPipelineStatuses.preFlightNode === "In-Progress"}
              onApprove={(selectedModels, splitEndDate) => {
                if (onApprove) {
                  onApprove("Pre Flight", selectedModels, splitEndDate);
                }
              }}
              isApproving={isApproving}
            />
          ) : null,
          preFlightNode: effectivePreFlight ? (
            <ModelTrainingValidationStepOutput
              preFlight={effectivePreFlight}
              projectId={project.id}
              activeSubstep="Pre Flight"
              activeRunTimestamp={effectiveRunTimestamp}
              nextStepInProgress={displayPipelineStatuses.modelTrainingCodeNode === "In-Progress"}
              onApprovePreFlight={() => {
                if (onApprove) {
                  onApprove("Model Training");
                }
              }}
              isApproving={isApproving}
            />
          ) : null,
          modelTrainingCodeNode: (
            <ModelTrainingExecutionStepOutput
              status={displayPipelineStatuses.modelTrainingCodeNode ?? "Pending"}
              modelTraining={effectiveModelTraining}
              trainingConfiguration={effectiveTrainingConfig}
              modelSelection={effectiveModelSelection}
              projectId={project.id}
              activeRunTimestamp={effectiveRunTimestamp}
              selectedModels={savedAgentState.selectedModels}
              isExecuting={
                (isApproving && (displayPipelineStatuses.modelTrainingCodeNode === "User Input" || displayPipelineStatuses.modelTrainingCodeNode === "Completed")) ||
                displayPipelineStatuses.modelTrainingCodeNode === "In-Progress"
              }
              onExecute={(selectedModels) => {
                if (onApprove) {
                  onApprove("Model Training", selectedModels);
                }
              }}
            />
          ),
          "Model Validation": (effectiveModelValidation || effectiveModelTraining) ? (
            <ModelTrainingValidationStepOutput
              modelValidation={effectiveModelValidation}
              modelTraining={effectiveModelTraining}
              trainingConfiguration={effectiveTrainingConfig}
              modelSelection={effectiveModelSelection}
              projectId={project.id}
              activeSubstep="Model Validation"
              activeRunTimestamp={effectiveRunTimestamp}
              nextStepInProgress={displayPipelineStatuses.modelTrainingCodeNode === "In-Progress"}
              onApproveValidation={(horizon, frequency, startDate, selectedModels) => {
                if (onApprove) {
                  onApprove("Model Validation", selectedModels, undefined, horizon, frequency, startDate);
                }
              }}
              isApproving={isApproving}
            />
          ) : null,
          "Feature Engineering": effectiveExogenousScout ? (
            <ExogenousScoutStepOutput exogenousScout={effectiveExogenousScout} />
          ) : effectiveFeatureArchitect ? (
            <FeatureArchitectStepOutput featureArchitect={effectiveFeatureArchitect} />
          ) : null,
        };

        return (
          <CardModal
            isOpen={isExecutionModalOpen}
            onClose={() => setIsExecutionModalOpen(false)}
            workflowCard={selectedWorkflow}
            selectedSubstepId={selectedSubstepId}
            pipelineStatuses={displayPipelineStatuses}
            stepOutputs={stepOutputs}
            runStatus={runStatus}
            projectId={project.id}
            agentState={project.agentState}
            approvalNextStep={approvalNextStep}
          />
        );
      })()}

      {logModalSubstep && logModalPipelineTitle && <SubProcessLogModal
        isOpen={isLogModalOpen}
        onClose={() => setIsLogModalOpen(false)}
        substep={logModalSubstep}
        pipelineTitle={logModalPipelineTitle}
        projectId={project.id}
        status={displayPipelineStatuses[logModalSubstep.id]}
        runStatus={effectiveRunStatus}
      />}
    </>
  );
}
