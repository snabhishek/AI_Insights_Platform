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

// Generates mock thinking logs based on step ID and status
function getThinkingLogs(stepId: string, status: PipelineStatus): Array<{ time: string; text: string; done: boolean }> {
  const now = new Date();
  const formatTime = (offsetSec: number) => {
    const d = new Date(now.getTime() - offsetSec * 1000);
    return d.toLocaleTimeString("en-US", { hour12: true, hour: "2-digit", minute: "2-digit", second: "2-digit" });
  };

  if (stepId === "Data Ingestion") {
    if (status === "Not Started") {
      return [{ time: "--:--:--", text: "Awaiting execution...", done: false }];
    }
    return [
      { time: formatTime(15), text: "Resolving connector properties and verifying credentials...", done: true },
      { time: formatTime(12), text: "Connecting to database data sources...", done: true },
      { time: formatTime(8), text: "Running metadata table inspection schemas...", done: true },
      { time: formatTime(4), text: "Extracting tables list, column structures, and relationships...", done: status === "Completed" },
    ];
  }

  if (stepId === "Data Profiling") {
    if (status === "Not Started") {
      return [{ time: "--:--:--", text: "Awaiting execution...", done: false }];
    }
    if (status === "Pending") {
      return [{ time: "--:--:--", text: "Staged in queue, waiting for ingestion to finish...", done: false }];
    }
    return [
      { time: formatTime(18), text: "Reading data samples from target sources...", done: true },
      { time: formatTime(14), text: "Computing column completeness profiles...", done: true },
      { time: formatTime(10), text: "Running anomaly detection (outliers, formatting errors)...", done: true },
      { time: formatTime(5), text: "Deriving rule-based preprocessing and transformation steps...", done: status === "Completed" },
    ];
  }

  if (stepId === "Schema Resolver") {
    if (status === "Not Started") {
      return [{ time: "--:--:--", text: "Awaiting execution...", done: false }];
    }
    if (status === "Pending") {
      return [{ time: "--:--:--", text: "Staged in queue, waiting for data profiling...", done: false }];
    }
    return [
      { time: formatTime(8), text: "Analyzing target schemas and downstream constraints...", done: true },
      { time: formatTime(4), text: "Generating mapping recommendations using LLM semantic alignment...", done: status === "Completed" },
    ];
  }

  return [
    { time: "--:--:--", text: `Ready to run step ${stepId}...`, done: status === "Completed" }
  ];
}

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
  const [isCollapsed, setIsCollapsed] = useState<boolean>(true);
  const lastStepIdRef = useRef<string>("");

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
        setIsCollapsed(true);
        lastStepIdRef.current = activeStep.id;
      }
    } else {
      const streamed = agentState?.agentThinking?.[activeStep.id] || [];
      setThinkingLogs(streamed);

      if (stepIdChanged) {
        if (activeStepStatus === "In Progress" && streamed.length > 0) {
          setIsCollapsed(false);
        } else {
          setIsCollapsed(true);
        }
        lastStepIdRef.current = activeStep.id;
      } else if (activeStepStatus === "In Progress" && thinkingLogs.length === 0 && streamed.length > 0) {
        // Auto-expand when the first streamed log arrives for this step
        setIsCollapsed(false);
      }
    }
  }, [activeStep?.id, activeStepStatus, isOpen, projectId, agentState?.agentThinking]);

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
        <div className="w-full sm:w-[350px] lg:w-[380px] border-b sm:border-b-0 sm:border-r border-border p-6 overflow-y-auto shrink-0 flex flex-col bg-surface-muted/30">

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
                  onClick={() => setActiveStepIndex(idx)}
                  className={`flex items-start gap-4 text-left w-full relative z-10 py-1.5 focus:outline-none transition-all cursor-pointer group`}
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
                    <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2 leading-snug">
                      {stepItem.description}
                    </p>
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

          <div className="flex-1 flex flex-col select-text">
            {activeStep ? (
              <>
                {/* Output Area (Only shown when output is received) - Rendered on top */}
                <div className="flex-1 flex flex-col min-h-0">
                  {hasOutput ? (
                    <div className="border border-border bg-surface p-5 shadow-soft flex-1 flex flex-col min-h-0 select-none">
                      <div className="flex items-center gap-2 mb-4 border-b border-border pb-3 shrink-0">
                        <span className="w-6 h-6 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 text-emerald-500 dark:text-emerald-400 flex items-center justify-center shrink-0">
                          ✓
                        </span>
                        <div>
                          <h3 className="text-sm font-bold text-foreground">Final Output</h3>
                          <p className="text-[10px] text-muted-foreground">Execution result details for this step</p>
                        </div>
                      </div>

                      <div className="flex-1 overflow-y-auto pr-1 select-text">
                        {stepOutputContent}
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground flex-1 flex flex-col justify-center items-center bg-surface-muted/20 select-none">
                      <span className="text-3xl mb-2">📥</span>
                      <strong>Output is not received yet.</strong>
                      <span className="text-xs max-w-sm mt-1 leading-normal">
                        The execution results will be displayed here as soon as this pipeline step completes and provides output.
                      </span>
                    </div>
                  )}
                </div>

                {/* Agent Thinking logs - Rendered at bottom and collapsible */}
                <div className="border border-border bg-surface p-5 shadow-soft shrink-0 select-none">
                  {/* Collapsible Header */}
                  <button 
                    onClick={() => setIsCollapsed(!isCollapsed)}
                    className="w-full flex items-center justify-between border-b border-border pb-3 focus:outline-none cursor-pointer group"
                  >
                    <div className="flex items-center gap-2">
                      <span className="w-6 h-6 rounded-lg bg-indigo-50 dark:bg-indigo-950/40 text-indigo-500 dark:text-indigo-400 flex items-center justify-center shrink-0">
                        🧠
                      </span>
                      <div className="text-left">
                        <h3 className="text-sm font-bold text-foreground group-hover:text-primary transition-colors">Agent Reasoning Logs</h3>
                        <p className="text-[10px] text-muted-foreground">Detailed logic trace executed by the agent</p>
                      </div>
                      {activeStepStatus === "In Progress" && (
                        <span className="ml-2 text-[10px] font-bold uppercase tracking-wider text-indigo-500 animate-pulse bg-indigo-50 dark:bg-indigo-950/50 px-2 py-0.5 rounded-md">
                          Processing...
                        </span>
                      )}
                    </div>
                    
                    <span className="text-muted-foreground text-xs font-bold transition-transform duration-200">
                      {isCollapsed ? "Expand ▲" : "Collapse ▼"}
                    </span>
                  </button>

                  {/* Collapsible Content */}
                  {!isCollapsed && (
                    <div className="mt-4 font-mono text-xs text-foreground/85 dark:text-slate-300 space-y-2 max-h-[160px] overflow-y-auto bg-surface-muted/50 dark:bg-slate-900/50 p-4 rounded-xl border border-border/40 select-text">
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
                        <div className="text-muted-foreground py-2 text-center select-none font-sans italic text-xs">
                          No agent thinking logs available for this step.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </>
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
