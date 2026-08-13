"use client";

import React from "react";
import { PipelineStatus, PipelineStatuses, RunStatus } from "./types";
import { PIPELINE_STEPS } from "./constants";
import WorkflowCard from "./WorkflowCard";

interface WorkflowPipelineProps {
  pipelineStatuses: PipelineStatuses;
  completionPercentage: number;
  runStatus: RunStatus;
  lastRunTime: string;
  activeStage: string | null;
  stageOutputs: Record<string, unknown>;
  requiresApproval: boolean;
  workflowMessage: string;
  onRunWorkflow: () => void;
  onReRunWorkflow?: () => void;
  onStopWorkflow?: () => void;
  onViewHistory: () => void;
  onSelectStage: (stepId: string) => void;
  onApprove: () => void;
  onRetry: (stepId: string) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function extractTableNames(source: Record<string, unknown>): string[] {
  const tables = Array.isArray(source.tables) ? source.tables : [];
  return tables
    .map((t: any) => typeof t?.name === "string" ? t.name : typeof t?.tableName === "string" ? t.tableName : "")
    .filter((n: string) => n.length > 0)
    .slice(0, 12);
}

function formatStageOutput(stage: string, stageOutputs: Record<string, unknown>) {
  const payloads = (stage === "profileData" || stage === "preprocess")
    ? [
        { label: "Data Profiling", output: stageOutputs.profileData },
        { label: "Preprocessing", output: stageOutputs.preprocess },
      ]
    : [
        { label: stage === "inspect" ? "Inspection" : "Schema Resolution", output: stageOutputs[stage] ?? stageOutputs[stage === "inspect" ? "inspect" : stage] },
      ];

  const groups: Array<{ title: string; body: string }> = [];
  const add = (title: string, body: string) => {
    if (body) groups.push({ title, body });
  };

  payloads.forEach(({ label, output }) => {
    if (!output) return;

    if (Array.isArray((output as any)?.sources)) {
      const sources = (output as any).sources as Array<Record<string, unknown>>;
      add(`${label} overview`, `${sources.length} connector${sources.length === 1 ? "" : "s"} processed`);

      sources.forEach((source, sourceIndex) => {
        const connectorName = typeof source.connectorName === "string"
          ? source.connectorName
          : typeof source.connectorId === "string"
            ? source.connectorId
            : `Source ${sourceIndex + 1}`;

        // Inspection: show table names and column counts
        const tableNames = extractTableNames(source);
        const tables = Array.isArray(source.tables) ? source.tables : [];
        if (tableNames.length > 0) {
          add(`${connectorName} — Tables`, tableNames.join(", ") + (tables.length > 12 ? ` (+${tables.length - 12} more)` : ""));
          const totalCols = tables.reduce((sum: number, t: any) => sum + (Array.isArray(t?.columns) ? t.columns.length : 0), 0);
          if (totalCols > 0) add(`${connectorName} — Columns`, `${totalCols} column${totalCols === 1 ? "" : "s"} across ${tables.length} table${tables.length === 1 ? "" : "s"}`);
        }

        // Schema type
        if (typeof source.schemaType === "string" && source.schemaType !== "unknown") {
          add(`${connectorName} — Schema`, source.schemaType as string);
        }

        // Profiling: completeness & statistics
        if (Array.isArray((source as any).contentProfile?.columns)) {
          const cols = (source as any).contentProfile.columns;
          add(`${connectorName} — Content Profile`, `${cols.length} column${cols.length === 1 ? "" : "s"} profiled`);
        }
        if (Array.isArray((source as any).completenessProfile?.columns)) {
          const cols = (source as any).completenessProfile.columns;
          const fullyComplete = cols.filter((c: any) => c?.completeness === 1 || c?.completeness === "100%").length;
          add(`${connectorName} — Completeness`, `${fullyComplete}/${cols.length} columns fully complete`);
        }
        if (Array.isArray((source as any).statisticalProfile?.numericColumns)) {
          const numCols = (source as any).statisticalProfile.numericColumns;
          add(`${connectorName} — Numeric Stats`, `${numCols.length} numeric column${numCols.length === 1 ? "" : "s"} analyzed`);
        }

        // Preprocessing: action summary
        if (isRecord((source as any).summary)) {
          const s = (source as any).summary as Record<string, unknown>;
          const parts: string[] = [];
          if (typeof s.totalActions === "number" && s.totalActions > 0) parts.push(`${s.totalActions} total actions`);
          if (typeof s.applied === "number" && s.applied > 0) parts.push(`${s.applied} applied`);
          if (typeof s.skipped === "number" && s.skipped > 0) parts.push(`${s.skipped} skipped`);
          if (typeof s.failed === "number" && s.failed > 0) parts.push(`${s.failed} failed`);
          if (parts.length > 0) add(`${connectorName} — Actions`, parts.join(" • "));
        } else if (typeof source.summary === "string") {
          add(`${connectorName} — Status`, source.summary as string);
        } else if (typeof source.status === "string") {
          add(`${connectorName} — Status`, source.status as string);
        }

        // Preprocessing: table count
        if (typeof source.tableCount === "number" && source.tableCount > 0 && tableNames.length === 0) {
          add(`${connectorName} — Tables`, `${source.tableCount} table${source.tableCount === 1 ? "" : "s"} processed`);
        }

        // Schema resolution: mappings
        const mappings = Array.isArray(source.mappings) ? source.mappings.length : 0;
        const resolvedTables = Array.isArray(source.resolvedTables) ? source.resolvedTables : [];
        const unmapped = Array.isArray(source.unmappedDatasetFields) ? source.unmappedDatasetFields : [];
        if (mappings > 0) add(`${connectorName} — Mappings`, `${mappings} field${mappings === 1 ? "" : "s"} mapped to target schema`);
        if (resolvedTables.length > 0) add(`${connectorName} — Resolved`, resolvedTables.slice(0, 8).join(", ") + (resolvedTables.length > 8 ? ` (+${resolvedTables.length - 8} more)` : ""));
        if (unmapped.length > 0) add(`${connectorName} — Unmapped`, unmapped.slice(0, 6).join(", ") + (unmapped.length > 6 ? ` (+${unmapped.length - 6} more)` : ""));

        // Warnings
        const warnings = Array.isArray(source.warnings) ? source.warnings.filter((w: unknown): w is string => typeof w === "string") : [];
        if (warnings.length > 0) add(`${connectorName} — Findings`, warnings.slice(0, 3).join(" • "));
      });
    }

    // Fallback for non-sources structure
    if (isRecord(output) && !Array.isArray((output as any)?.sources)) {
      const tableCount = Array.isArray(output.tables) ? output.tables.length : 0;
      const mappingCount = Array.isArray(output.mappings) ? output.mappings.length : 0;
      const resolvedTables = Array.isArray(output.resolvedTables) ? output.resolvedTables.length : 0;
      if (typeof output.status === "string") add(`${label} status`, output.status as string);
      if (tableCount > 0) add(`${label} tables`, `${tableCount} table${tableCount === 1 ? "" : "s"}`);
      if (mappingCount > 0) add(`${label} mappings`, `${mappingCount} mapping${mappingCount === 1 ? "" : "s"}`);
      if (resolvedTables > 0) add(`${label} resolved`, `${resolvedTables} table${resolvedTables === 1 ? "" : "s"} ready`);
    }
  });

  if (groups.length === 0) {
    add("Output", "No output available yet. Run the workflow to populate this stage.");
  }
  return groups;
}

function getStageTitle(stepId: string): string {
  switch (stepId) {
    case "Data Ingestion": return "Inspect";
    case "Data Profiling": return "Profile & Preprocess";
    case "Schema Resolver": return "Schema Resolution";
    default: return stepId;
  }
}

// Data-driven map associating internal stage/sub-step keys to top-level pipeline card IDs
const MAIN_STEP_MAPPING: Record<string, string> = {
  "Data Ingestion": "Data Ingestion",
  "Data Profiling": "Data Ingestion",
  "Schema Resolver": "Data Ingestion",
  "inspect": "Data Ingestion",
  "profileData": "Data Ingestion",
  "preprocess": "Data Ingestion",
  "resolveSchema": "Data Ingestion",
  "Exogenous Scout": "Feature Engineering",
  "exogenousScout": "Feature Engineering",
  "exogenous": "Feature Engineering",
  "Hierarchy Mapper": "Feature Engineering",
  "Feature Architect": "Feature Engineering",
  "Feature Validator": "Feature Engineering",
  "Feature Engineering": "Feature Engineering",
  "Model Training": "Model Training",
  "Model Validation": "Model Validation",
  "Forecast": "Forecast",
};

const DEFAULT_MAIN_STEP_ID = "Data Ingestion";
const DATA_INGESTION_SUBSTEPS = ["Data Ingestion", "Data Profiling", "Schema Resolver"] as const;

export function getMainStepId(stepOrStageId: string | null): string {
  if (!stepOrStageId) return DEFAULT_MAIN_STEP_ID;
  return MAIN_STEP_MAPPING[stepOrStageId] ?? DEFAULT_MAIN_STEP_ID;
}

function calculateDataIngestionStatus(pipelineStatuses: PipelineStatuses): PipelineStatus {
  const [s1, s2, s3] = DATA_INGESTION_SUBSTEPS.map(
    (key) => (pipelineStatuses[key] as PipelineStatus) ?? "Not Started"
  );

  if (s3 === "Completed" || (s1 === "Completed" && s2 === "Completed")) {
    return "Completed";
  }
  if ([s1, s2, s3].some((s) => s === "In Progress" || s === "Completed")) {
    return "In Progress";
  }
  if ([s1, s2, s3].some((s) => s === "Pending")) {
    return "Pending";
  }
  return "Not Started";
}

function calculateFeatureEngineeringStatus(pipelineStatuses: PipelineStatuses): PipelineStatus {
  const status = (pipelineStatuses["Exogenous Scout"] || pipelineStatuses["Feature Engineering"]) as PipelineStatus ?? "Not Started";
  if (status === "Completed") return "Completed";
  if (status === "In Progress") return "In Progress";
  if (status === "Pending") return "Pending";
  return "Not Started";
}

export function getMainStepStatus(stepId: string, pipelineStatuses: PipelineStatuses): PipelineStatus {
  if (stepId === "Data Ingestion") {
    return calculateDataIngestionStatus(pipelineStatuses);
  }
  if (stepId === "Feature Engineering") {
    return calculateFeatureEngineeringStatus(pipelineStatuses);
  }
  return (pipelineStatuses[stepId] as PipelineStatus) ?? "Not Started";
}

export function getMainStepStatuses(
  pipelineStatuses: PipelineStatuses,
  runStatus?: RunStatus
): Record<string, PipelineStatus> {
  const result: Record<string, PipelineStatus> = {};
  let foundActiveRunning = false;

  for (const step of PIPELINE_STEPS) {
    let rawStatus = getMainStepStatus(step.id, pipelineStatuses);

    if (runStatus === "Running" && !foundActiveRunning) {
      if (rawStatus !== "Completed") {
        rawStatus = "In Progress";
        foundActiveRunning = true;
      }
    }

    result[step.id] = rawStatus;
  }

  return result;
}

export default function WorkflowPipeline({
  pipelineStatuses,
  completionPercentage,
  runStatus,
  lastRunTime,
  activeStage,
  stageOutputs,
  requiresApproval,
  workflowMessage,
  onRunWorkflow,
  onReRunWorkflow,
  onStopWorkflow,
  onViewHistory,
  onSelectStage,
  onApprove,
  onRetry,
}: WorkflowPipelineProps) {
  const currentStage = activeStage || "inspect";
  const mainSelectedStage = getMainStepId(currentStage);

  // Compute 5-main-step level statuses and progress line width across the 4 segment connections
  const mainStatusMap = getMainStepStatuses(pipelineStatuses, runStatus);
  const mainStatuses = PIPELINE_STEPS.map((step) => mainStatusMap[step.id]);

  let completedMainCount = 0;
  for (let i = 0; i < mainStatuses.length; i++) {
    if (mainStatuses[i] === "Completed") {
      completedMainCount++;
    } else {
      break;
    }
  }

  const nextIsInProgress = completedMainCount < mainStatuses.length && mainStatuses[completedMainCount] === "In Progress";
  const totalSegments = PIPELINE_STEPS.length - 1; // 4 segments between 5 main cards
  const calculatedCompletionPct = completedMainCount === PIPELINE_STEPS.length
    ? 100
    : Math.min(
        100,
        Math.max(0, ((completedMainCount + (nextIsInProgress ? 0.5 : 0)) / totalSegments) * 100)
      );

  const hasExistingRun =
    lastRunTime !== "Not run yet" ||
    runStatus === "Success" ||
    Object.values(pipelineStatuses).some((s) => s === "Completed" || s === "In Progress");

  const runButtonText = hasExistingRun ? "Re-Run Workflow" : "Run Workflow";
  const handleRunClick = hasExistingRun && onReRunWorkflow ? onReRunWorkflow : onRunWorkflow;

  return (
    <div className="col-span-12 lg:col-span-8 xl:col-span-9 flex flex-col bg-background border border-border rounded-lg p-6 shadow-soft">
      <div className="flex items-start justify-between gap-4 border-b border-border pb-4 mb-6 select-none">
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-bold text-foreground leading-tight">Data Insights Workflow</h2>
          <p className="text-xs text-muted-foreground">End-to-end workflow that transforms data into actionable business insights.</p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {(requiresApproval || runStatus === "Paused") ? (
            <>
              <button
                type="button"
                onClick={onApprove}
                className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold tracking-wide uppercase transition-all shadow-md hover:scale-105 active:scale-95 cursor-pointer shrink-0"
              >
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="3">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                Approve
              </button>
              <button
                type="button"
                onClick={onStopWorkflow}
                className="inline-flex items-center gap-2 px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold tracking-wide uppercase transition-all shadow-md hover:shadow-rose-600/25 active:scale-95 cursor-pointer shrink-0"
              >
                <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor">
                  <rect x="5" y="5" width="14" height="14" rx="2" />
                </svg>
                Stop Workflow
              </button>
            </>
          ) : runStatus === "Running" ? (
            <button
              type="button"
              onClick={onStopWorkflow}
              className="inline-flex items-center gap-2 px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold tracking-wide uppercase transition-all shadow-md hover:shadow-rose-600/25 active:scale-95 cursor-pointer shrink-0"
            >
              <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor">
                <rect x="5" y="5" width="14" height="14" rx="2" />
              </svg>
              Stop Workflow
            </button>
          ) : (
            <button
              type="button"
              onClick={handleRunClick}
              className="inline-flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary/95 text-white rounded-xl text-xs font-bold tracking-wide uppercase transition-all shadow-md hover:shadow-primary/25 hover:scale-105 active:scale-95 cursor-pointer shrink-0"
            >
              <svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
              {runButtonText}
            </button>
          )}
        </div>
      </div>

      <div className="relative w-full flex items-center justify-between select-none">
        <div className="absolute top-[125px] left-[7.15%] right-[7.15%] h-[5px] bg-border/40 dark:bg-white/10 rounded-full pointer-events-none select-none z-0">
          <div
            className="h-full rounded-full bg-gradient-to-r from-emerald-500 via-indigo-500 to-violet-600 transition-all duration-700 shadow-[0_0_12px_rgba(99,102,241,0.65)]"
            style={{ width: `${calculatedCompletionPct}%` }}
          />
        </div>

        <div className="flex-1 flex justify-between w-full gap-2 xl:gap-3 relative z-10 py-5">
          {PIPELINE_STEPS.map((step, idx) => (
            <WorkflowCard
              key={step.id}
              step={step}
              status={mainStatusMap[step.id]}
              index={idx}
              isActive={mainSelectedStage === step.id}
              onSelect={onSelectStage}
            />
          ))}
        </div>
      </div>

      <div className="border-t border-border pt-5 mt-2 flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.2em] font-bold text-muted-foreground">Selected stage</p>
            <h3 className="text-sm font-semibold text-foreground">{mainSelectedStage}</h3>
            <p className="text-xs text-muted-foreground mt-1">{workflowMessage || "Select a workflow stage to inspect the live output."}</p>
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
              onClick={() => onRetry(currentStage || mainSelectedStage)}
              className="inline-flex items-center gap-2 px-3 py-2 border border-border rounded-lg text-xs font-semibold text-foreground hover:bg-surface-muted transition-colors cursor-pointer"
            >
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 12a9 9 0 1 1-3-6.7" />
                <path d="M21 3v6h-6" />
              </svg>
              Retry Stage
            </button>
          </div>
        </div>
      </div>

      <div className="border-t border-border pt-5 mt-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 select-none">
        <div className="flex items-center gap-4 flex-wrap text-xs">
          {[
            { color: "bg-emerald-500", label: "Completed" },
            { color: "bg-indigo-500", label: "Running" },
            { color: "bg-amber-500", label: "Pending" },
            { color: "bg-border dark:bg-gray-600", label: "Not Started" },
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
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full font-bold ${
              runStatus === "Running"
                ? "bg-indigo-100 dark:bg-indigo-950/30 text-indigo-800 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800"
                : runStatus === "Paused"
                ? "bg-amber-100 dark:bg-amber-950/30 text-amber-800 dark:text-amber-400 border border-amber-200 dark:border-amber-800"
                : runStatus === "Success"
                ? "bg-emerald-100 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800"
                : "bg-surface-muted text-muted-foreground border border-border"
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                runStatus === "Running"
                  ? "bg-indigo-500 animate-ping"
                  : runStatus === "Paused"
                  ? "bg-amber-500 animate-pulse"
                  : runStatus === "Success"
                  ? "bg-emerald-500"
                  : "bg-muted-foreground"
              }`}
            />
            {runStatus === "Running" ? "Running" : runStatus === "Paused" ? "Awaiting Approval" : runStatus === "Success" ? "Success" : "Idle"}
          </span>

          <button
            onClick={onViewHistory}
            className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-primary transition-colors cursor-pointer"
          >
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            View Run History
          </button>
        </div>
      </div>
    </div>
  );
}
