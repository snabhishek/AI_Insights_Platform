"use client";

import React from "react";

interface MessageModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  type: "success" | "error" | "info";
  logs?: string;
  onClose: () => void;
}

export default function MessageModal({
  isOpen,
  title,
  message,
  type,
  logs,
  onClose,
}: MessageModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
      <div className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl transition-all scale-100 flex flex-col max-h-[85vh]">
        
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4 bg-surface-muted">
          <div className="flex items-center gap-2">
            <div className={`p-1.5 rounded-lg border shrink-0 ${
              type === "success"
                ? "bg-green-500/10 border-green-500/20 text-green-500"
                : type === "error"
                ? "bg-red-500/10 border-red-500/20 text-red-500"
                : "bg-blue-500/10 border-blue-500/20 text-blue-500"
            }`}>
              {type === "success" && (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4" />
                </svg>
              )}
              {type === "error" && (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01" />
                </svg>
              )}
              {type === "info" && (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01" />
                </svg>
              )}
            </div>
            <h3 className="text-sm font-bold text-foreground">{title}</h3>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-background hover:text-foreground transition-colors cursor-pointer"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Modal Middle Message Section */}
        <div className="p-6 flex flex-col gap-4 overflow-y-auto text-sm text-foreground">
          <p className="leading-relaxed font-medium">{message}</p>

          {/* Logs Block if provided */}
          {logs && (
            <div className="flex flex-col gap-1.5 mt-2">
              <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                Diagnostics Logs
              </span>
              <div className="border border-border/85 rounded-xl bg-[#0f172a] p-3.5 text-xs font-mono text-slate-300 max-h-[220px] overflow-y-auto whitespace-pre-wrap select-all leading-normal">
                {logs}
              </div>
            </div>
          )}
        </div>

        {/* Horizontal Line Separator & Footer Section */}
        <div className="border-t border-border px-6 py-4 bg-surface-muted flex justify-end">
          <button
            onClick={onClose}
            className="h-9 px-5 bg-primary text-white text-xs font-semibold rounded-lg hover:scale-105 active:scale-95 transition-all cursor-pointer"
          >
            Okay
          </button>
        </div>

      </div>
    </div>
  );
}
