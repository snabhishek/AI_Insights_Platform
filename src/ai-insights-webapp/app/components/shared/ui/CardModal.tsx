"use client";

import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { Workflow, WorkflowStep, PipelineStatus, WorkflowAgentState } from "../../projects/types";
import SubProcessLogModal from "./SubProcessLogModal";

export type CardModalTabType = "output" | "thinking";

interface CardModalProps {
  isOpen: boolean;
  onClose: () => void;
  render?: React.ReactNode;
  workflowCard?: Workflow | null;
  selectedSubstepId?: string | null;
  pipelineStatuses?: Record<string, PipelineStatus>;
  stepOutputs?: Record<string, React.ReactNode>;
  runStatus?: string;
  workflowMessage?: string;
  projectId?: string;
  agentState?: WorkflowAgentState;
  agentThinking?: Record<string, Array<{ time: string; text: string; done: boolean }>>;
  requiresApproval?: boolean;
  approvalNextStep?: string | null;
  isApproving?: boolean;
  isAwaitingResponse?: boolean;
  onApprove?: (overrideTargetPhase?: string, selectedModels?: string[]) => void;
  onSubstepChange?: (substepId: string) => void;
}

const CIRCLE_COLOR_MAP: Record<string, { border: string; bg: string; text: string }> = {
  green: {
    border: "border-emerald-500 dark:border-emerald-400",
    bg: "bg-emerald-500 dark:bg-emerald-600",
    text: "text-emerald-500 dark:text-emerald-400",
  },
  blue: {
    border: "border-blue-500 dark:border-blue-400",
    bg: "bg-blue-500 dark:bg-blue-600",
    text: "text-blue-500 dark:text-blue-400",
  },
  purple: {
    border: "border-purple-500 dark:border-purple-400",
    bg: "bg-purple-500 dark:bg-purple-600",
    text: "text-purple-500 dark:text-purple-400",
  },
  yellow: {
    border: "border-amber-500 dark:border-amber-400",
    bg: "bg-amber-500 dark:bg-amber-600",
    text: "text-amber-500 dark:text-amber-400",
  },
  red: {
    border: "border-rose-500 dark:border-rose-400",
    bg: "bg-rose-500 dark:bg-rose-600",
    text: "text-rose-500 dark:text-rose-400",
  },
  pink: {
    border: "border-pink-500 dark:border-pink-400",
    bg: "bg-pink-500 dark:bg-pink-600",
    text: "text-pink-500 dark:text-pink-400",
  },
  teal: {
    border: "border-teal-500 dark:border-teal-400",
    bg: "bg-teal-500 dark:bg-teal-600",
    text: "text-teal-500 dark:text-teal-400",
  },
};

export default function CardModal(props: CardModalProps) {
  if (!props.isOpen) return null;

  return <CardModalContent {...props} />;
}

function CardModalContent({
  isOpen,
  onClose,
  render,
  workflowCard,
  selectedSubstepId = null,
  pipelineStatuses = {},
  stepOutputs = {},
  runStatus = "None",
  workflowMessage = "",
  projectId,
  agentState,
  agentThinking,
  requiresApproval = false,
  approvalNextStep = null,
  isApproving = false,
  isAwaitingResponse = false,
  onApprove,
  onSubstepChange,
}: CardModalProps) {
  const [mounted, setMounted] = useState(false);
  const [activeStepIndex, setActiveStepIndex] = useState<number>(0);
  const [isLogModalOpen, setIsLogModalOpen] = useState(false);
  const [logModalSubstep, setLogModalSubstep] = useState<WorkflowStep | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const stepsList: WorkflowStep[] = workflowCard?.step || [];
  const activeStep = stepsList[activeStepIndex] || null;
  const activeStepStatus = activeStep ? (pipelineStatuses[activeStep.id] ?? "Pending") : "Pending";
  const isInProgressStatus = (status: string | undefined) =>
    status === "In-Progress";

  const cardId = workflowCard?.id || "";
  const isDataIngestionCard = cardId === "dataIngestion" || workflowCard?.title === "Data Ingestion";
  const isFeatureEngineeringCard = cardId === "featureEngineering" || workflowCard?.title === "Feature Engineering";
  const isModelTrainingCard = cardId === "modelTrainingValidation" || workflowCard?.title === "Model Training & Validation";

  const hasStepOutput = (stepId: string): boolean => {
    if (stepOutputs[stepId] != null) return true;
    const stageOuts = agentState?.stageOutputs;
    if (!stageOuts) return false;
    if (stepId === "inspect") return Boolean(stageOuts.inspect || agentState?.inspect);
    if (stepId === "profileData") return Boolean(stageOuts.profileData || agentState?.profileData);
    if (stepId === "resolveSchema") return Boolean(stageOuts.resolveSchema || agentState?.resolveSchema);
    if (stepId === "hierarchyMapperNode") return Boolean(stageOuts.hierarchyMapperNode || agentState?.hierarchyMapperNode);
    if (stepId === "featureArchitectNode") return Boolean(stageOuts.featureArchitectNode || agentState?.featureArchitectNode);
    if (stepId === "featureValidatorNode") return Boolean(stageOuts.featureValidatorNode || agentState?.featureValidatorNode);
    if (stepId === "exogenous") return Boolean(stageOuts.exogenous || agentState?.exogenous);
    if (stepId === "modelSelectionNode") return Boolean(stageOuts.modelSelectionNode || agentState?.modelSelectionNode);
    if (stepId === "trainingConfigurationNode") return Boolean(stageOuts.trainingConfigurationNode?.contractPath || agentState?.trainingConfigurationNode?.contractPath);
    if (stepId === "preFlightNode") return Boolean(stageOuts.preFlightNode || agentState?.preFlightNode);
    if (stepId === "modelTrainingExecNode") return Boolean(stageOuts.modelTrainingExecNode || agentState?.modelTrainingExecNode);
    return false;
  };

  const isDownstreamFromDIStartedOrDone =
    pipelineStatuses["Feature Engineering"] === "Completed" ||
    isInProgressStatus(pipelineStatuses["Feature Engineering"]) ||
    pipelineStatuses["Hierarchy Mapper"] === "Completed" ||
    isInProgressStatus(pipelineStatuses["Hierarchy Mapper"]) ||
    pipelineStatuses["Model Training & Validation"] === "Completed" ||
    isInProgressStatus(pipelineStatuses["Model Training & Validation"]) ||
    pipelineStatuses["Model Selection"] === "Completed" ||
    isInProgressStatus(pipelineStatuses["Model Selection"]);

  const isDownstreamFromFEStartedOrDone =
    pipelineStatuses["Model Training & Validation"] === "Completed" ||
    isInProgressStatus(pipelineStatuses["Model Training & Validation"]) ||
    pipelineStatuses["Model Selection"] === "Completed" ||
    isInProgressStatus(pipelineStatuses["Model Selection"]) ||
    pipelineStatuses["Training Configuration"] === "Completed" ||
    isInProgressStatus(pipelineStatuses["Training Configuration"]);

  const allSubstepsCompletedInStage = stepsList.length > 0 &&
    stepsList.every((s) => pipelineStatuses[s.id] === "Completed");

  const hasModelSelectionOutput = hasStepOutput("Model Selection") || pipelineStatuses["Model Selection"] === "Completed";
  const hasTrainingConfigContract = Boolean(
    agentState?.stageOutputs?.trainingConfigurationNode?.contractPath ||
    agentState?.trainingConfigurationNode?.contractPath ||
    (stepOutputs.trainingConfigurationNode && typeof stepOutputs.trainingConfigurationNode === "object")
  );
  const hasPreFlightOutput = hasStepOutput("Pre Flight") || pipelineStatuses["Pre Flight"] === "Completed";
  const hasModelTrainingOutput = hasStepOutput("Model Training") || pipelineStatuses["Model Training"] === "Completed";

  const isWaitingForModelConfirmation =
    isModelTrainingCard &&
    hasModelSelectionOutput &&
    !hasTrainingConfigContract &&
    pipelineStatuses["Training Configuration"] !== "Completed" &&
    (approvalNextStep === "Training Configuration" ||
      approvalNextStep === "trainingConfigurationNode" ||
      approvalNextStep === "Model Selection" ||
      approvalNextStep === "modelSelectionNode" ||
      (runStatus === "Paused" && requiresApproval));

  const isWaitingForPreFlightApproval =
    isModelTrainingCard &&
    hasTrainingConfigContract &&
    !hasPreFlightOutput &&
    pipelineStatuses["Pre Flight"] !== "Completed" &&
    (approvalNextStep === "Pre Flight" ||
      approvalNextStep === "preFlightNode" ||
      (runStatus === "Paused" && requiresApproval && !isWaitingForModelConfirmation));

  const isWaitingForTrainingApproval =
    isModelTrainingCard &&
    hasPreFlightOutput &&
    !hasModelTrainingOutput &&
    pipelineStatuses["Model Training"] !== "Completed" &&
    (approvalNextStep === "Model Training" ||
      approvalNextStep === "modelTrainingNode" ||
      approvalNextStep === "modelTrainingCodeNode" ||
      (runStatus === "Paused" && requiresApproval && !isWaitingForModelConfirmation && !isWaitingForPreFlightApproval));

  const isStageAwaitingApprovalToAdvance =
    (runStatus === "Paused" || requiresApproval) && (
      (isDataIngestionCard && (approvalNextStep === "Feature Engineering" || approvalNextStep === "hierarchyMapperNode" || (!isDownstreamFromDIStartedOrDone && allSubstepsCompletedInStage))) ||
      (isFeatureEngineeringCard && (approvalNextStep === "Model Training & Validation" || approvalNextStep === "Model Selection" || approvalNextStep === "modelSelectionNode" || (!isDownstreamFromFEStartedOrDone && allSubstepsCompletedInStage)))
    );

  const isCardAwaitingApproval =
    (isDataIngestionCard && isStageAwaitingApprovalToAdvance) ||
    (isFeatureEngineeringCard && isStageAwaitingApprovalToAdvance) ||
    (isModelTrainingCard && (isWaitingForModelConfirmation || isWaitingForPreFlightApproval || isWaitingForTrainingApproval || (requiresApproval && runStatus === "Paused")));

  useEffect(() => {
    if (!isOpen || !workflowCard) return;
    const steps = workflowCard.step || [];
    if (steps.length === 0) return;

    if (selectedSubstepId) {
      const targetIdx = steps.findIndex((s) => s.id === selectedSubstepId || s.title === selectedSubstepId);
      if (targetIdx !== -1) {
        setActiveStepIndex(targetIdx);
        return;
      }
    }

    // 2. If a step is actively "In-Progress", prioritize it
    const inProgressIdx = steps.findIndex((s) => isInProgressStatus(pipelineStatuses[s.id]) && runStatus === "In-Progress");
    if (inProgressIdx !== -1) {
      setActiveStepIndex(inProgressIdx);
      return;
    }

    if (isWaitingForModelConfirmation) {
      const modelSelIdx = steps.findIndex((s) => s.id === "modelSelectionNode");
      if (modelSelIdx !== -1) {
        setActiveStepIndex(modelSelIdx);
        return;
      }
    }
    if (isWaitingForPreFlightApproval) {
      const trainCfgIdx = steps.findIndex((s) => s.id === "trainingConfigurationNode");
      if (trainCfgIdx !== -1) {
        setActiveStepIndex(trainCfgIdx);
        return;
      }
    }
    if (isWaitingForTrainingApproval) {
      const preFlightIdx = steps.findIndex((s) => s.id === "preFlightNode");
      if (preFlightIdx !== -1) {
        setActiveStepIndex(preFlightIdx);
        return;
      }
    }
    if (isStageAwaitingApprovalToAdvance) {
      setActiveStepIndex(steps.length - 1);
      return;
    }

    let latestWithOutputIdx = -1;
    for (let i = steps.length - 1; i >= 0; i--) {
      const s = steps[i];
      if (hasStepOutput(s.id) || pipelineStatuses[s.id] === "Completed") {
        latestWithOutputIdx = i;
        break;
      }
    }
    if (latestWithOutputIdx !== -1) {
      setActiveStepIndex(latestWithOutputIdx);
      return;
    }

    const firstUncompletedIdx = steps.findIndex((s) => pipelineStatuses[s.id] !== "Completed");
    setActiveStepIndex(firstUncompletedIdx !== -1 ? firstUncompletedIdx : 0);
  }, [
    workflowCard?.id,
    isOpen,
    selectedSubstepId,
    approvalNextStep,
    requiresApproval,
    isWaitingForModelConfirmation,
    isWaitingForPreFlightApproval,
    isWaitingForTrainingApproval,
    isStageAwaitingApprovalToAdvance,
  ]);

  const handleOpenLogs = (stepToOpen?: WorkflowStep | null) => {
    const target = stepToOpen || activeStep;
    if (target) {
      setLogModalSubstep(target);
      setIsLogModalOpen(true);
    }
  };

  if (!isOpen || !mounted) return null;

  if (!workflowCard) {
    return createPortal(
      <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm transition-all scale-100 flex flex-col max-h-[85vh] p-6 text-foreground select-none">
        <div className="flex items-center justify-between mb-4 border-b border-border pb-3 w-full">
          <h3 className="text-lg font-bold">Stage Details</h3>
          <button onClick={onClose} className="p-1.5 hover:bg-surface-muted rounded-xl transition-colors cursor-pointer text-muted-foreground">
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">{render}</div>
      </div>,
      document.body
    );
  }

  const stepOutputContent = activeStep ? stepOutputs[activeStep.id] : null;
  const hasOutput = stepOutputContent !== undefined && stepOutputContent !== null;

  const cardStatus = pipelineStatuses[workflowCard.id] ?? "Pending";

  return createPortal(
    <div className="fixed inset-0 z-[200] p-3 sm:p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in select-none">

      <div className="relative w-[97vw] h-[95vh] overflow-hidden rounded-xl border border-border bg-surface shadow-2xl flex flex-col sm:flex-row animate-scale-up">

        <div className="w-full sm:w-[250px] border-b sm:border-b-0 sm:border-r border-border p-5 overflow-y-auto shrink-0 flex flex-col bg-surface-muted/30">

          <div className="mb-4 shrink-0">
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Execution Steps</span>
            <p className="text-xs text-muted-foreground mt-0.5">Select a pipeline step to review outputs.</p>
          </div>

          <div className="relative flex flex-col gap-5 flex-1 min-h-0">
            {stepsList.map((stepItem, idx) => {
              const isSelected = activeStepIndex === idx;
              const stepStatus = pipelineStatuses[stepItem.id] ?? "Pending";

              const isStepAwaitingApproval =
                stepStatus === "Awaiting Approval" || stepStatus === "User Input";

              const isNonterminalModelTrainingStep =
                isModelTrainingCard &&
                (stepItem.id === "trainingConfigurationNode" ||
                  stepItem.id === "preFlightNode" ||
                  stepItem.id === "modelTrainingCodeNode" ||
                  stepItem.id === "modelTrainingExecNode") &&
                (stepStatus === "Pending" ||
                  isInProgressStatus(stepStatus));

              // Is this step completed?
              // All completed substeps show completed UI (green and tick)
              const isStepCompleted =
                !isNonterminalModelTrainingStep &&
                !isStepAwaitingApproval &&
                stepStatus === "Completed";

              const isStepInProgress =
                !isStepAwaitingApproval &&
                !isStepCompleted &&
                isInProgressStatus(stepStatus) &&
                runStatus === "In-Progress";

              const isStopped = runStatus === "Stopped" && !isStepCompleted && isInProgressStatus(stepStatus);
              const isPausedStep = !isStepCompleted && (stepStatus === "Paused" || (runStatus === "Paused" && isInProgressStatus(stepStatus)));
              const stepColors = CIRCLE_COLOR_MAP[stepItem.color] || CIRCLE_COLOR_MAP.green;

              return (
                <div
                  key={stepItem.id}
                  className="relative flex items-center group w-full"
                >

                  {idx < stepsList.length - 1 && (
                    <div className="absolute left-[17px] top-9 bottom-[-24px] w-[2px] bg-border dark:bg-slate-800 z-0" />
                  )}

                  <button
                    title={stepItem.description}
                    onClick={() => {
                      setActiveStepIndex(idx);
                      onSubstepChange?.(stepItem.id);
                    }}
                    className="flex items-center gap-3.5 text-left w-full relative z-10 py-1.5 focus:outline-none transition-all cursor-pointer"
                  >
                    {/* Circle Indicator */}
                    <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 font-extrabold text-sm border-2 transition-all relative z-10 
                      ${isStepCompleted ? "bg-status-completed border-status-completed text-white shadow-md"
                        : isPausedStep ? "bg-status-paused border-status-paused text-white shadow-md"
                        : isStopped ? "bg-status-stopped border-status-stopped text-white shadow-md"
                          : isStepAwaitingApproval ? "bg-status-awaiting-approval border-status-awaiting-approval text-white shadow-md animate-pulse"
                            : isStepInProgress
                              ? "bg-status-in-progress border-status-in-progress text-white shadow-lg animate-pulse"
                              : isSelected
                                ? `${stepColors.border} ${stepColors.text} bg-surface`
                                : "border-border bg-surface text-muted-foreground/60 group-hover:border-muted-foreground/40"
                      }`}>
                      {isStepCompleted ? (
                        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="4.5">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      ) : isPausedStep ? (
                        <div className="flex items-center gap-0.5">
                          <div className="w-0.5 h-2.5 bg-white rounded-full" />
                          <div className="w-0.5 h-2.5 bg-white rounded-full" />
                        </div>
                      ) : isStepAwaitingApproval ? (
                        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="4.5">
                          <polygon points="5 3 19 12 5 21 5 3" />
                        </svg>
                      ) : isStepInProgress ? (
                        <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                      ) : (
                        idx + 1
                      )}
                    </div>

                    <div className="flex-1 min-w-0 pr-1">
                      <div className="flex items-center justify-between gap-1">
                        <span className={`text-xs font-bold truncate transition-colors leading-tight ${
                          isSelected ? "text-foreground font-black" : "text-muted-foreground group-hover:text-foreground"
                        }`}>
                          {stepItem.title}
                        </span>

                        <div className="flex items-center gap-1.5 shrink-0">
                          {isStepCompleted && (
                            <span className="w-1.5 h-1.5 rounded-full bg-status-completed shrink-0" />
                          )}
                          {isStepAwaitingApproval && (
                            <span className="w-1.5 h-1.5 rounded-full bg-status-awaiting-approval animate-pulse shrink-0" />
                          )}
                          {isStepInProgress && (
                            <span className="w-1.5 h-1.5 rounded-full bg-status-in-progress animate-ping shrink-0" />
                          )}
                          {isStopped && (
                            <span className="w-1.5 h-1.5 rounded-full bg-status-stopped shrink-0" />
                          )}

                          <span
                            role="button"
                            tabIndex={0}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOpenLogs(stepItem);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.stopPropagation();
                                handleOpenLogs(stepItem);
                              }
                            }}
                            className="opacity-0 group-hover:opacity-100 hover:opacity-100 p-1 rounded bg-white hover:bg-slate-50 text-primary border border-primary/50 dark:bg-surface dark:text-primary-foreground dark:border-primary/60 transition-all cursor-pointer shadow-xs"
                            title={`View logs for ${stepItem.title}`}
                          >
                            <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2">
                              <polyline points="4 17 10 11 4 5" />
                              <line x1="12" y1="19" x2="20" y2="19" />
                            </svg>
                          </span>
                        </div>
                      </div>
                    </div>
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex-1 flex flex-col min-h-0 bg-background/30 relative overflow-hidden">

          <div className="flex items-center justify-between px-5 py-3 border-b border-border/80 bg-surface-muted/60 shrink-0 select-none">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 flex items-center justify-center border border-indigo-500/20 text-indigo-500 bg-indigo-500/5 rounded-lg shadow-inner">
                {workflowCard.icon}
              </div>
              <div>
                <h2 className="text-sm font-bold text-foreground leading-snug">
                  {workflowCard.title} Node
                </h2>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className={`w-2 h-2 rounded-full ${
                    isCardAwaitingApproval ? "bg-status-awaiting-approval animate-pulse" :
                    cardStatus === "Completed" ? "bg-status-completed" :
                    isInProgressStatus(cardStatus) ? "bg-status-in-progress animate-ping" :
                    cardStatus === "Pending" ? "bg-status-pending" :
                    cardStatus === "User Input" ? "bg-status-user-input" :
                    cardStatus === "Stopped" ? "bg-status-stopped" :
                    cardStatus === "Failed" ? "bg-status-failed" : "bg-status-none"
                  }`} />
                  <span className="text-[11px] font-semibold text-muted-foreground">
                    {isCardAwaitingApproval ? "Awaiting Approval" : cardStatus}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {(() => {
                const isModelTrainingCard = workflowCard?.id === "modelTrainingValidation" || workflowCard?.title === "Model Training & Validation";
                const isSubProcessApproval = isModelTrainingCard || [
                  "Model Selection", "modelSelection", "modelSelectionNode",
                  "Training Configuration", "trainingConfiguration", "trainingConfigurationNode",
                  "Pre Flight", "preFlight", "preFlightNode",
                  "Model Training", "modelTraining", "modelTrainingNode", "modelTrainingCodeNode",
                  "Model Validation", "modelValidation", "modelValidationNode",
                ].includes(approvalNextStep || "");

                if (!requiresApproval || isSubProcessApproval) return null;

                return (
                  <button
                    type="button"
                    onClick={() => onApprove?.(approvalNextStep || undefined)}
                    disabled={isApproving}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold transition-all shadow-sm active:scale-95 cursor-pointer ${
                      isApproving ? "opacity-75 cursor-not-allowed" : "animate-pulse"
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
                );
              })()}

              <button
                onClick={onClose}
                className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-background border border-border text-muted-foreground transition-colors cursor-pointer"
                title="Close Details"
              >
                ✕
              </button>
            </div>
          </div>

          {activeStep && (
            <div className="flex items-center justify-between px-6 py-2.5 bg-surface/90 dark:bg-slate-900/60 border-b border-border/70 shrink-0 select-none">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="text-xs font-bold text-foreground truncate">
                  {activeStep.title}
                </span>
                <span
                  className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                    activeStepStatus === "Completed"
                      ? "bg-status-completed/15 text-status-completed border border-status-completed/30"
                      : isInProgressStatus(activeStepStatus)
                        ? "bg-status-in-progress/15 text-status-in-progress border border-status-in-progress/30 animate-pulse"
                        : activeStepStatus === "Awaiting Approval"
                          ? "bg-status-awaiting-approval/15 text-status-awaiting-approval border border-status-awaiting-approval/30 animate-pulse"
                          : activeStepStatus === "User Input"
                            ? "bg-status-user-input/15 text-status-user-input border border-status-user-input/30"
                            : activeStepStatus === "Stopped"
                              ? "bg-status-stopped/15 text-status-stopped border border-status-stopped/30"
                              : activeStepStatus === "Failed"
                                ? "bg-status-failed/15 text-status-failed border border-status-failed/30"
                                : activeStepStatus === "Pending"
                                  ? "bg-status-pending/15 text-status-pending border border-status-pending/30"
                                  : "bg-surface-muted text-muted-foreground border border-border"
                  }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      activeStepStatus === "Completed"
                        ? "bg-status-completed"
                        : isInProgressStatus(activeStepStatus)
                          ? "bg-status-in-progress animate-ping"
                          : activeStepStatus === "Awaiting Approval"
                            ? "bg-status-awaiting-approval animate-pulse"
                            : activeStepStatus === "User Input"
                              ? "bg-status-user-input"
                              : activeStepStatus === "Stopped"
                                ? "bg-status-stopped"
                                : activeStepStatus === "Failed"
                                  ? "bg-status-failed"
                                  : activeStepStatus === "Pending"
                                    ? "bg-status-pending"
                                    : "bg-status-none"
                    }`}
                  />
                  {activeStepStatus}
                </span>
                {activeStep.description && (
                  <span className="text-[11px] text-muted-foreground truncate hidden md:inline border-l border-border/70 pl-2.5">
                    {activeStep.description}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => handleOpenLogs(activeStep)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-white hover:bg-slate-50 text-primary border border-primary dark:bg-surface dark:hover:bg-surface-muted dark:text-primary-foreground dark:border-primary shadow-xs transition-all active:scale-95 cursor-pointer group"
                  title={`View execution logs for ${activeStep.title}`}
                >
                  <svg
                    viewBox="0 0 24 24"
                    width="13"
                    height="13"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    className="text-primary dark:text-primary-foreground group-hover:scale-110 transition-transform"
                  >
                    <polyline points="4 17 10 11 4 5" />
                    <line x1="12" y1="19" x2="20" y2="19" />
                  </svg>
                  <span>Logs</span>
                  {isInProgressStatus(activeStepStatus) && (
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                    </span>
                  )}
                </button>
              </div>
            </div>
          )}

          <div className="flex-1 flex flex-col min-h-0 select-text overflow-hidden">
            {activeStep ? (
              hasOutput ? (
                <div className="flex-1 overflow-y-auto p-6 select-text">
                  {stepOutputContent}
                </div>
              ) : (
                <div className="flex-1 flex flex-col justify-center items-center p-8 text-center text-sm text-muted-foreground bg-surface-muted/10 select-none">
                  {requiresApproval ? (
                    <div className="flex flex-col items-center max-w-md p-6 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-foreground animate-fadeIn">
                      <div className="w-12 h-12 rounded-full bg-amber-500/20 flex items-center justify-center text-amber-500 mb-3">
                        <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <circle cx="12" cy="12" r="10" />
                          <line x1="12" y1="8" x2="12" y2="12" />
                          <line x1="12" y1="16" x2="12.01" y2="16" />
                        </svg>
                      </div>
                      <strong className="text-base font-bold text-foreground">
                        Awaiting Approval
                      </strong>
                      <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed text-center">
                        {workflowMessage || `This pipeline stage is paused awaiting your approval to proceed to ${approvalNextStep || activeStep?.title || "the next phase"}.`}
                      </p>
                      <button
                        type="button"
                        onClick={() => onApprove?.(approvalNextStep || undefined)}
                        disabled={isApproving}
                        className={`mt-4 inline-flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold tracking-wide uppercase transition-all shadow-md active:scale-95 cursor-pointer ${
                          isApproving ? "opacity-75 cursor-not-allowed" : "hover:scale-105"
                        }`}
                      >
                        {isApproving ? (
                          <>
                            <svg className="animate-spin" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="3">
                              <circle cx="12" cy="12" r="10" strokeDasharray="30" strokeLinecap="round" />
                            </svg>
                            <span>Advancing Workflow...</span>
                          </>
                        ) : (
                          <>
                            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="3">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                            <span>Proceed to Next Phase</span>
                          </>
                        )}
                      </button>
                    </div>
                  ) : (
                    <>
                      <span className="text-3xl mb-2">📥</span>
                      <strong className="text-foreground">Output is not received yet.</strong>
                      <span className="text-xs max-w-sm mt-1 leading-normal">
                        The execution results will be displayed here as soon as this pipeline step completes and provides output.
                      </span>
                      <button
                        type="button"
                        onClick={() => handleOpenLogs(activeStep)}
                        className="mt-4 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-white hover:bg-slate-50 text-primary border border-primary dark:bg-surface dark:text-primary-foreground dark:border-primary transition-colors cursor-pointer shadow-xs"
                      >
                        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" className="text-primary dark:text-primary-foreground">
                          <polyline points="4 17 10 11 4 5" />
                          <line x1="12" y1="19" x2="20" y2="19" />
                        </svg>
                        <span>View Step Logs</span>
                      </button>
                    </>
                  )}
                </div>
              )
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-center text-muted-foreground p-8 select-none">
                <p className="text-sm">Please select a step from the left side panel.</p>
              </div>
            )}
          </div>

        </div>

      </div>

      <SubProcessLogModal
        isOpen={isLogModalOpen}
        onClose={() => setIsLogModalOpen(false)}
        substep={logModalSubstep || activeStep}
        pipelineTitle={workflowCard.title || "Workflow Pipeline"}
        projectId={projectId}
        pipelineStatuses={pipelineStatuses}
        stepsList={stepsList}
        agentThinking={agentThinking}
        agentState={agentState}
        runStatus={runStatus}
        onSelectSubstep={(st) => {
          const targetIdx = stepsList.findIndex((s) => s.id === st.id);
          if (targetIdx !== -1) {
            setActiveStepIndex(targetIdx);
            onSubstepChange?.(st.id);
          }
          setLogModalSubstep(st);
        }}
      />
    </div>,
    document.body
  );
}
