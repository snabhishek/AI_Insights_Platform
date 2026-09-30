"use client";

import React, { useState } from "react";
import { ThinkingStep } from "./types";

interface ChatThinkingAccordionProps {
  thinking: ThinkingStep[];
  isStreaming?: boolean;
  defaultExpanded?: boolean;
}

export default function ChatThinkingAccordion({
  thinking,
  isStreaming = false,
  defaultExpanded = false,
}: ChatThinkingAccordionProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  if (!thinking || thinking.length === 0) return null;

  const completedCount = thinking.filter((t) => t.done).length;
  const isAllDone = completedCount === thinking.length && !isStreaming;

  return (
    <div className="w-full my-2 rounded-xl overflow-hidden text-xs transition-all shadow-sm">
      {/* Header Bar */}
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-3.5 py-2 flex items-center justify-between gap-2 text-left bg-indigo-500/5 hover:bg-indigo-500/10 transition-colors cursor-pointer select-none"
      >
        <div className="flex items-center gap-2 text-indigo-400 font-semibold truncate">
          <span className="text-sm">🧠</span>
          <span>Agent Reasoning & Pipeline Trace</span>
          {isStreaming ? ( 
            <span className="flex items-center gap-1 text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 animate-pulse border border-indigo-500/30">
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-ping" />
              Thinking...
            </span>
          ) : (
            <span className="text-[10px] text-muted-foreground font-normal">
              ({completedCount}/{thinking.length} steps executed)
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 text-muted-foreground shrink-0">
          <span className="text-[10px] text-indigo-300/70">{isExpanded ? "Hide trace" : "View trace"}</span>
          <svg
            className={`w-3.5 h-3.5 transition-transform duration-200 ${isExpanded ? "rotate-180 text-indigo-400" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth="2.5"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {/* Accordion Body */}
      {isExpanded && (
        <div className="p-3 bg-surface-muted/30 font-mono text-[11px] space-y-1.5 max-h-56 overflow-y-auto select-text">
          {thinking.map((step, idx) => (
            <div key={idx} className="flex items-start gap-2.5 py-0.5 text-foreground/90">
              <span className="text-muted-foreground shrink-0 select-none">{step.time}</span>
              <span className="shrink-0 select-none">
                {step.done ? (
                  <span className="text-emerald-500">✓</span>
                ) : (
                  <span className="inline-block w-2.5 h-2.5 rounded-full border-2 border-indigo-400 border-t-transparent animate-spin" />
                )}
              </span>
              <span className={step.done ? "text-foreground" : "text-indigo-300 font-semibold animate-pulse"}>
                {step.text}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
