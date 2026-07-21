"use client";

import React from "react";
import { PipelineStatus, WorkflowStep } from "./types";

// ─── Color Maps (Active at all times) ────────────────────────────────────────

const COLOR_MAP: Record<string, { border: string; icon: string; glow: string; shadow: string }> = {
  green:  { 
    border: "border-emerald-500/70 dark:border-emerald-400/50",  
    icon: "text-emerald-500 border-emerald-500/20 bg-emerald-500/5 dark:bg-emerald-500/10",  
    glow: "text-emerald-500/[0.04]",
    shadow: "shadow-[0_0_15px_rgba(16,185,129,0.05)]"
  },
  blue:   { 
    border: "border-blue-500/70 dark:border-blue-400/50",   
    icon: "text-blue-500 border-blue-500/20 bg-blue-500/5 dark:bg-blue-500/10",    
    glow: "text-blue-500/[0.04]",
    shadow: "shadow-[0_0_15px_rgba(59,130,246,0.05)]"
  },
  purple: { 
    border: "border-purple-500/70 dark:border-purple-400/50", 
    icon: "text-purple-500 border-purple-500/20 bg-purple-500/5 dark:bg-purple-500/10",  
    glow: "text-purple-500/[0.04]",
    shadow: "shadow-[0_0_15px_rgba(168,85,247,0.05)]"
  },
  yellow: { 
    border: "border-amber-500/70 dark:border-amber-400/50",   
    icon: "text-amber-500 border-amber-500/20 bg-amber-500/5 dark:bg-amber-500/10",    
    glow: "text-amber-500/[0.04]",
    shadow: "shadow-[0_0_15px_rgba(245,158,11,0.05)]"
  },
  red:    { 
    border: "border-rose-500/70 dark:border-rose-400/50",     
    icon: "text-rose-500 border-rose-500/20 bg-rose-500/5 dark:bg-rose-500/10",        
    glow: "text-rose-500/[0.04]",
    shadow: "shadow-[0_0_15px_rgba(244,63,94,0.05)]"
  },
  pink:   { 
    border: "border-pink-500/70 dark:border-pink-400/50",     
    icon: "text-pink-500 border-pink-500/20 bg-pink-500/5 dark:bg-pink-500/10",        
    glow: "text-pink-500/[0.04]",
    shadow: "shadow-[0_0_15px_rgba(236,72,153,0.05)]"
  },
  teal:   { 
    border: "border-teal-500/70 dark:border-teal-400/50",     
    icon: "text-teal-500 border-teal-500/20 bg-teal-500/5 dark:bg-teal-500/10",        
    glow: "text-teal-500/[0.04]",
    shadow: "shadow-[0_0_15px_rgba(20,184,166,0.05)]"
  },
};

// ─── Status Badge ────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: PipelineStatus }) {
  if (status === "Completed") {
    return (
      <span className="w-5.5 h-5.5 rounded-full bg-emerald-500 text-white flex items-center justify-center shadow-md scale-110 transition-transform duration-300" title="Completed">
        <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="4.5">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </span>
    );
  }
  if (status === "In Progress") {
    return (
      <span className="w-5.5 h-5.5 rounded-full bg-indigo-500 text-white flex items-center justify-center shadow-lg shadow-indigo-500/35" title="In Progress">
        <svg className="animate-spin h-3.5 w-3.5 text-white" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
      </span>
    );
  }
  if (status === "Pending") {
    return (
      <span className="w-5.5 h-5.5 rounded-full bg-amber-500 text-white flex items-center justify-center shadow-md animate-pulse" title="Pending">
        <span className="w-1.5 h-1.5 rounded-full bg-white" />
      </span>
    );
  }
  return (
    <span className="w-5.5 h-5.5 rounded-full border border-border/80 dark:border-white/10 bg-surface dark:bg-slate-900 flex items-center justify-center text-muted-foreground/35" title="Not Started">
      <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/20" />
    </span>
  );
}

// ─── WorkflowCard ────────────────────────────────────────────────────────────

interface WorkflowCardProps {
  step: WorkflowStep;
  status: PipelineStatus;
  index: number;
  isActive?: boolean;
  onSelect?: (stepId: string) => void;
}

export default function WorkflowCard({ step, status, index, isActive = false, onSelect }: WorkflowCardProps) {
  const colors = COLOR_MAP[step.color];

  // Hover tooltip with modernized pill design
  return (
    <div className="relative group select-none flex justify-center w-full">
      {/* Modernized Pill Tooltip */}
      <div className="absolute bottom-[calc(100%+12px)] left-1/2 -translate-x-1/2 bg-slate-900/95 dark:bg-slate-950/95 text-white text-[10px] px-3.5 py-1.5 rounded-full font-bold shadow-xl border border-white/10 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 pointer-events-none whitespace-nowrap z-50 flex items-center gap-1.5 tracking-wide">
        <span className="text-emerald-400 font-black uppercase text-[8px] bg-white/10 px-1.5 py-0.5 rounded-full">{step.metric}</span>
        <span className="text-white/80">{step.description}</span>
      </div>

      {/* Card body container - Opaque background with fixed width of 140px and original height of 230px */}
      <button
        type="button"
        onClick={() => onSelect?.(step.id)}
        style={{ width: 155, height: 230 }}
        className={`relative rounded-[28px] border-2 bg-surface dark:bg-slate-900 p-4.5 flex flex-col items-center justify-between transition-all duration-300 hover:-translate-y-1 cursor-pointer text-left ${colors.border} ${colors.shadow} ${isActive ? "ring-2 ring-primary/60 shadow-lg" : ""}`}
      >
        {/* Monospaced card index in background */}
        <div className={`absolute right-5 bottom-4 text-7xl font-black font-mono pointer-events-none select-none leading-none ${colors.glow}`}>
          0{index + 1}
        </div>

        {/* Top bar with Info icon left & Status circle right */}
        <div className="w-full flex items-center justify-between relative z-10">
          {/* Info icon (ℹ) */}
          <span 
            className="w-5 h-5 rounded-full flex items-center justify-center text-muted-foreground/60 hover:text-primary hover:bg-surface-muted/80 transition-colors cursor-help text-[11px] font-bold border border-border/80 dark:border-white/10"
            title="Hover to view details"
          >
            i
          </span>

          {/* Status Badge */}
          <StatusBadge status={status} />
        </div>

        {/* Card Icon Container */}
        <div className={`w-14 h-14 rounded-2xl flex items-center justify-center border shrink-0 transition-all duration-300 mt-2 relative z-10 ${colors.icon}`}>
          {step.icon}
        </div>

        {/* Step Title only */}
        <div className="text-center w-full mt-4 mb-2 z-10 relative">
          <span className="text-xs font-extrabold text-foreground tracking-tight line-clamp-2 leading-tight">
            {step.title}
          </span>
        </div>
      </button>
    </div>
  );
}
