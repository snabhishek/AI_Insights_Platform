"use client";

import React from "react";
import { PipelineStatuses, RunStatus } from "./types";
import { PIPELINE_STEPS } from "./constants";
import WorkflowCard from "./WorkflowCard";

// ─── Props ───────────────────────────────────────────────────────────────────

interface WorkflowPipelineProps {
  pipelineStatuses: PipelineStatuses;
  completionPercentage: number;
  runStatus: RunStatus;
  lastRunTime: string;
  onRunWorkflow: () => void;
  onViewHistory: () => void;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function WorkflowPipeline({
  pipelineStatuses,
  completionPercentage,
  runStatus,
  lastRunTime,
  onRunWorkflow,
  onViewHistory,
}: WorkflowPipelineProps) {

  return (
    <div className="col-span-12 lg:col-span-8 xl:col-span-9 flex flex-col bg-surface border border-border rounded-2xl p-6 shadow-soft">
      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4 border-b border-border pb-4 mb-6 select-none">
        {/* Left: Title + subtitle stacked */}
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-bold text-foreground leading-tight">
            Data Insights Workflow
          </h2>
          <p className="text-xs text-muted-foreground">
            End-to-end workflow that transforms data into actionable business insights.
          </p>
        </div>

        {/* Right: Run Workflow button */}
        <button
          onClick={onRunWorkflow}
          disabled={runStatus === "Running"}
          className="inline-flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary/95 disabled:bg-muted disabled:text-muted-foreground text-white rounded-xl text-xs font-bold tracking-wide uppercase transition-all shadow-md hover:shadow-primary/25 disabled:cursor-not-allowed hover:scale-105 active:scale-95 cursor-pointer shrink-0"
        >
          {runStatus === "Running" ? (
            <>
              <svg className="animate-spin h-3.5 w-3.5" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Running…
            </>
          ) : (
            <>
              <svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
              Run Workflow
            </>
          )}
        </button>
      </div>

      {/* ── 7-Step Workflow Layout Grid (No Scroll/Arrows/Dots) ── */}
      <div className="relative w-full flex items-center justify-between select-none">
        
        {/* Connecting progress line - Starts at 1st card center (7.15%), ends at last card center (92.85%), positioned at top-[125px] */}
        <div className="absolute top-[125px] left-[7.15%] right-[7.15%] h-[5px] bg-border/40 dark:bg-white/10 rounded-full pointer-events-none select-none z-0">
          <div
            className="h-full rounded-full bg-gradient-to-r from-emerald-500 via-indigo-500 to-violet-600 transition-all duration-700 shadow-[0_0_12px_rgba(99,102,241,0.65)]"
            style={{ width: `${completionPercentage}%` }}
          />
        </div>

        {/* 7 Opaque workflow step cards arranged side-by-side closer together */}
        <div className="flex-1 w-full grid grid-cols-7 gap-2 xl:gap-3.5 relative z-10 py-5">
          {PIPELINE_STEPS.map((step, idx) => (
            <WorkflowCard
              key={step.id}
              step={step}
              status={pipelineStatuses[step.id] ?? "Not Started"}
              index={idx}
            />
          ))}
        </div>
      </div>

      {/* ── Footer ── */}
      <div className="border-t border-border pt-5 mt-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 select-none">
        {/* Legend */}
        <div className="flex items-center gap-4 flex-wrap text-xs">
          {[
            { color: "bg-emerald-500", label: "Completed" },
            { color: "bg-indigo-500",  label: "In Progress" },
            { color: "bg-amber-500",   label: "Pending" },
            { color: "bg-border dark:bg-gray-600", label: "Not Started" },
          ].map(({ color, label }) => (
            <div key={label} className="flex items-center gap-1.5 font-semibold">
              <span className={`w-2.5 h-2.5 rounded-full ${color}`} />
              <span className="text-muted-foreground">{label}</span>
            </div>
          ))}
        </div>

        {/* Run info */}
        <div className="flex items-center gap-4 flex-wrap text-xs font-semibold">
          <span className="text-muted-foreground">Last run: {lastRunTime}</span>

          <span
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full font-bold ${
              runStatus === "Running"
                ? "bg-indigo-100 dark:bg-indigo-950/30 text-indigo-800 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800"
                : runStatus === "Success"
                ? "bg-emerald-100 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800"
                : "bg-surface-muted text-muted-foreground border border-border"
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                runStatus === "Running"
                  ? "bg-indigo-500 animate-ping"
                  : runStatus === "Success"
                  ? "bg-emerald-500"
                  : "bg-muted-foreground"
              }`}
            />
            {runStatus === "Running" ? "Running" : runStatus === "Success" ? "Success" : "Idle"}
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
