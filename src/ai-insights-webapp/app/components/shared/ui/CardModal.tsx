"use client";

import React, { useState, useEffect, useRef } from "react";
import { Workflow, WorkflowStep, PipelineStatus } from "../../projects/types";
import { fetchAgentThinkingApi } from "../../../services/aiWorkflowService";

interface CardModalProps {
  isOpen: boolean;
  onClose: () => void;
  render?: React.ReactNode;
  workflowCard?: Workflow | null;
  pipelineStatuses?: Record<string, PipelineStatus>;
  stepOutputs?: Record<string, React.ReactNode>;
  runStatus?: string;
  workflowMessage?: string;
  projectId?: string;
  agentState?: Record<string, any>;
}

// Map color strings to active Tailwind text/border/bg classes for step circles
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

export default function CardModal({
  isOpen,
  onClose,
  render,
  workflowCard,
  pipelineStatuses = {},
  stepOutputs = {},
  runStatus = "Idle",
  workflowMessage = "",
  projectId,
  agentState,
}: CardModalProps) {
  const [activeStepIndex, setActiveStepIndex] = useState<number>(0);
  const [thinkingLogs, setThinkingLogs] = useState<Array<{ time: string; text: string; done: boolean }>>([]);
  const [activeTab, setActiveTab] = useState<"output" | "thinking">("output");
  const lastStepIdRef = useRef<string>("");
  const lastStepStatusRef = useRef<string>("");

  const stepsList: WorkflowStep[] = workflowCard?.step || [];
  const activeStep = stepsList[activeStepIndex] || null;
  const activeStepStatus = activeStep ? (pipelineStatuses[activeStep.id] ?? "Not Started") : "Not Started";

  // Auto-select first step when modal opens or workflow changes
  useEffect(() => {
    setActiveStepIndex(0);
  }, [workflowCard?.id, isOpen]);

  // Synchronize and fetch agent thinking logs
  useEffect(() => {
    if (!isOpen || !activeStep) return;

    const pipeline = "Data Ingestion";
    const stepIdChanged = lastStepIdRef.current !== activeStep.id;

    if (activeStepStatus === "Completed" && projectId) {
      fetchAgentThinkingApi(projectId, pipeline, activeStep.id)
        .then((res) => {
          if (res.success && res.data?.thinking) {
            setThinkingLogs(res.data.thinking);
          } else {
            setThinkingLogs([]);
          }
        })
        .catch((err) => {
          console.error("Failed to fetch agent thinking:", err);
          setThinkingLogs([]);
        });
      
      if (stepIdChanged) {
        lastStepIdRef.current = activeStep.id;
      }
    } else {
      const streamed = agentState?.agentThinking?.[activeStep.id] || [];
      setThinkingLogs(streamed);

      if (stepIdChanged) {
        lastStepIdRef.current = activeStep.id;
      }
    }
  }, [activeStep?.id, activeStepStatus, isOpen, projectId, agentState?.agentThinking]);

  // Synchronize activeTab based on step status and selection
  useEffect(() => {
    if (!activeStep) return;
    const currentStatus = pipelineStatuses[activeStep.id] ?? "Not Started";
    const statusChanged = lastStepStatusRef.current !== currentStatus;
    const stepIdChanged = lastStepIdRef.current !== activeStep.id;

    if (stepIdChanged) {
      if (currentStatus === "In Progress") {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setActiveTab("thinking");
      } else {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setActiveTab("output");
      }
    } else if (statusChanged) {
      if (currentStatus === "Completed") {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setActiveTab("output");
      } else if (currentStatus === "In Progress") {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setActiveTab("thinking");
      }
    }
    lastStepStatusRef.current = currentStatus;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStep?.id, activeStepStatus, pipelineStatuses]);

  if (!isOpen) return null;

  // Fallback to standard render if workflowCard details are not provided
  if (!workflowCard) {
    return (
      <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-slate-900/60 transition-all scale-100 flex flex-col max-h-[85vh] p-6 text-foreground">
        <div className="flex items-center justify-between mb-4 border-b border-border pb-3">
          <h3 className="text-lg font-bold">Stage Details</h3>
          <button onClick={onClose} className="p-1.5 hover:bg-surface-muted rounded-xl transition-colors cursor-pointer text-muted-foreground">
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">{render}</div>
      </div>
    );
  }



  // Check if output is received for the active step (provided as prop by parent)
  const stepOutputContent = activeStep ? stepOutputs[activeStep.id] : null;
  const hasOutput = stepOutputContent !== undefined && stepOutputContent !== null;

  // Helper to check overall workflow status
  const cardStatus = pipelineStatuses[workflowCard.id] ?? "Not Started";

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center p-2 sm:p-3 bg-slate-950/60 animate-fade-in select-none">
      {/* Extended width to full screen with minimum gap, reduced border radius to rounded-xl */}
      <div className="relative w-[98vw] h-[96vh] max-w-none overflow-hidden rounded-xl border border-border bg-surface shadow-2xl flex flex-col sm:flex-row animate-scale-up">
        
        {/* Left Panel: Steps Sidebar */}
        <div className="w-full sm:w-[350px] lg:w-[300px] border-b sm:border-b-0 sm:border-r border-border p-6 overflow-y-auto shrink-0 flex flex-col bg-surface-muted/30">

          <div className="mb-5 shrink-0">
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Execution Steps</span>
            <p className="text-xs text-muted-foreground mt-0.5">Select a pipeline step to review outputs.</p>
          </div>

          <div className="relative flex flex-col gap-6 flex-1 min-h-0">
            {stepsList.map((stepItem, idx) => {
              const isSelected = activeStepIndex === idx;
              const stepStatus = pipelineStatuses[stepItem.id] ?? "Not Started";
              const isStepCompleted = stepStatus === "Completed";
              const isStepInProgress = stepStatus === "In Progress";
              const stepColors = CIRCLE_COLOR_MAP[stepItem.color] || CIRCLE_COLOR_MAP.green;

              return (
                <button
                  key={stepItem.id}
                  title={stepItem.description}
                  onClick={() => setActiveStepIndex(idx)}
                  className={`flex items-center gap-4 text-left w-full relative z-10 py-1.5 focus:outline-none transition-all cursor-pointer group`}
                >
                  {/* Progress segment line: Stops at the final step circle */}
                  {idx < stepsList.length - 1 && (
                    <div className="absolute left-[17px] top-9 bottom-[-24px] w-[2px] bg-border dark:bg-slate-800 z-0" />
                  )}

                  {/* Circle Indicator */}
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 font-extrabold text-sm border-2 transition-all relative z-10 ${
                    isStepCompleted 
                      ? "bg-emerald-500 border-emerald-500 text-white shadow-md" 
                      : isStepInProgress
                      ? "bg-indigo-500 border-indigo-500 text-white shadow-lg animate-pulse"
                      : isSelected
                      ? `${stepColors.border} ${stepColors.text} bg-surface`
                      : "border-border bg-surface text-muted-foreground/60 group-hover:border-muted-foreground/40"
                  }`}>
                    {isStepCompleted ? (
                      <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="4.5">
                        <polyline points="20 6 9 17 4 12" />
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

                  {/* Step Box Details (Transparent Background - requirement checklist) */}
                  <div className="flex-1 min-w-0 pr-2">
                    <div className="flex items-center justify-between gap-1">
                      <span className={`text-xs font-bold truncate transition-colors leading-tight ${
                        isSelected ? "text-foreground font-black" : "text-muted-foreground group-hover:text-foreground"
                      }`}>
                        {stepItem.title}
                      </span>
                      
                      {/* Completed Checkmark / Spinner Badge */}
                      {isStepCompleted && (
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                      )}
                      {isStepInProgress && (
                        <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-ping shrink-0" />
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right Panel: Active Step Logs & Custom Output Area */}
        <div className="flex-1 overflow-y-auto flex flex-col bg-background/30 relative">
          
          {/* Header of right panel containing Title, Icon, Status and Close button */}
          <div className="flex items-center justify-between p-4 border-b border-border shrink-0 select-none">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 flex items-center justify-center border border-indigo-500/20 text-indigo-500 bg-indigo-500/5 shadow-inner">
                {workflowCard.icon}
              </div>
              <div>
                <h2 className="text-lg font-bold text-foreground leading-snug">
                  {workflowCard.title} Node
                </h2>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className={`w-2 h-2 rounded-full ${
                    cardStatus === "Completed" ? "bg-emerald-500" :
                    cardStatus === "In Progress" ? "bg-indigo-500 animate-ping" :
                    cardStatus === "Pending" ? "bg-amber-500" : "bg-muted-foreground/30"
                  }`} />
                  <span className="text-xs font-bold text-muted-foreground">
                    {cardStatus}
                  </span>
                </div>
              </div>
            </div>

            <button 
              onClick={onClose} 
              className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-surface-muted border border-border text-muted-foreground transition-colors cursor-pointer"
              title="Close Details"
            >
              ✕
            </button>
          </div>

          {/* Tab Selection Bar */}
          {activeStep && (
            <div className="flex border-b border-border bg-surface-muted/30 px-6 shrink-0 select-none">
              <button
                onClick={() => setActiveTab("output")}
                className={`py-3 px-4 text-xs font-bold border-b-2 transition-all cursor-pointer flex items-center gap-2 ${
                  activeTab === "output"
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                <span>📥</span>
                <span>Step Output</span>
              </button>
              <button
                onClick={() => setActiveTab("thinking")}
                className={`py-3 px-4 text-xs font-bold border-b-2 transition-all cursor-pointer flex items-center gap-2 ${
                  activeTab === "thinking"
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                <span>🧠</span>
                <span>Agent Reasoning</span>
                {activeStepStatus === "In Progress" && (
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-ping shrink-0" />
                )}
              </button>
            </div>
          )}

          <div className="flex-1 flex flex-col min-h-0 select-text">
            {activeStep ? (
              activeTab === "output" ? (
                /* Tab Content: Output Area */
                <div className="flex-1 flex flex-col min-h-0">
                  {hasOutput ? (
                    <div className="flex-1 overflow-y-auto p-6 select-text">
                      {stepOutputContent}
                    </div>
                  ) : (
                    <div className="flex-1 flex flex-col justify-center items-center p-8 text-center text-sm text-muted-foreground bg-surface-muted/10 select-none">
                      <span className="text-3xl mb-2">📥</span>
                      <strong className="text-foreground">Output is not received yet.</strong>
                      <span className="text-xs max-w-sm mt-1 leading-normal">
                        The execution results will be displayed here as soon as this pipeline step completes and provides output.
                      </span>
                    </div>
                  )}
                </div>
              ) : (
                /* Tab Content: Agent Reasoning Logs */
                <div className="flex-1 flex flex-col min-h-0 p-6 select-text">
                  <div className="flex items-center justify-between mb-4 pb-2 border-b border-border shrink-0 select-none">
                    <div className="flex items-center gap-2">
                      <span className="w-6 h-6 rounded-lg bg-indigo-50 dark:bg-indigo-950/40 text-indigo-500 dark:text-indigo-400 flex items-center justify-center shrink-0">
                        🧠
                      </span>
                      <div>
                        <h3 className="text-sm font-bold text-foreground">Agent Reasoning Logs</h3>
                        <p className="text-[10px] text-muted-foreground">Detailed logic trace executed by the agent</p>
                      </div>
                    </div>
                    {activeStepStatus === "In Progress" && (
                      <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-500 animate-pulse bg-indigo-50 dark:bg-indigo-950/50 px-2 py-0.5 rounded-md">
                        Processing...
                      </span>
                    )}
                  </div>

                  <div className="flex-1 overflow-y-auto font-mono text-xs text-foreground/85 dark:text-slate-300 space-y-2 bg-surface-muted/30 dark:bg-slate-900/30 p-5 rounded-xl border border-border/40 select-text">
                    {thinkingLogs.length > 0 ? (
                      thinkingLogs.map((log, lIdx) => (
                        <div key={lIdx} className="flex gap-3 items-start hover:bg-surface-muted/20 py-0.5">
                          <span className="text-muted-foreground select-none shrink-0">{log.time}</span>
                          <span className="text-muted-foreground select-none shrink-0">›</span>
                          <span className={log.done ? "text-foreground" : "text-muted-foreground animate-pulse"}>
                            {log.text}
                          </span>
                        </div>
                      ))
                    ) : (
                      <div className="text-muted-foreground py-8 text-center select-none font-sans italic text-xs">
                        No agent thinking logs available for this step.
                      </div>
                    )}
                  </div>
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
    </div>
  );
}
