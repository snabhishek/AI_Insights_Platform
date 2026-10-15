"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import { WorkflowStep, PipelineStatus } from "../../projects/types";
import { fetchAgentThinkingApi } from "../../../services/aiWorkflowService";
import { canViewSubprocessLogs } from "../../projects/pipelineNames";

export interface LogEntry {
  time: string;
  text: string;
  done: boolean;
  level?: "info" | "reason" | "warn" | "error" | "exec";
}

export interface SubProcessLogModalProps {
  isOpen: boolean;
  onClose: () => void;
  substep: WorkflowStep;
  pipelineTitle: string;
  projectId: string;
  status: PipelineStatus;
  runStatus: string;
}

function getLogLevel(log: { text: string; done: boolean }): "error" | "warn" | "reason" | "info" {
  const lower = log.text.toLowerCase();
  const isError = lower.includes("error") || lower.includes("fail");
  if (isError) return "error";

  const isWarn = lower.includes("warn") || lower.includes("caution");
  if (isWarn) return "warn";

  if (!log.done || lower.includes("reason") || lower.includes("plan")) {
    return "reason";
  }

  return "info";
}

export default function SubProcessLogModal(props: SubProcessLogModalProps) {
  if (!props.isOpen || !canViewSubprocessLogs(props.status, props.runStatus) || typeof document === "undefined") return null;

  return <SubProcessLogModalContent key={`${props.projectId}:${props.pipelineTitle}:${props.substep.id}`} {...props} />;
}

function SubProcessLogModalContent({
  onClose,
  substep,
  pipelineTitle,
  projectId,
  status,
  runStatus,
}: SubProcessLogModalProps) {
  const [thinkingLogs, setThinkingLogs] = useState<Array<{ time: string; text: string; done: boolean }>>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [logLevel, setLogLevel] = useState<"all" | "reason" | "info" | "warn" | "error">("all");
  const [isMaximized, setIsMaximized] = useState(false);
  const [copied, setCopied] = useState(false);
  const logsContainerRef = useRef<HTMLDivElement>(null);
  const followLatestLogsRef = useRef(true);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const isRunning = status === "In-Progress" && runStatus === "In-Progress";

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const loadThinking = async () => {
      try {
        const response = await fetchAgentThinkingApi(projectId, pipelineTitle, substep.title, controller.signal);
        if (!controller.signal.aborted) {
          setThinkingLogs(response.data.thinking);
          setLoadError(null);
        }
      } catch (err) {
        if (!controller.signal.aborted) setLoadError(String(err));
      } finally {
        if (isRunning && !controller.signal.aborted) timer = setTimeout(loadThinking, 2000);
      }
    };
    void loadThinking();
    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [projectId, pipelineTitle, substep.title, isRunning]);

  useEffect(() => {
    const container = logsContainerRef.current;
    if (container && followLatestLogsRef.current) {
      container.scrollTop = container.scrollHeight;
    }
  }, [thinkingLogs]);

  const filteredLogs = useMemo(() => {
    return thinkingLogs.filter((log) => {

      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const textMatch = log.text.toLowerCase().includes(query);
        const timeMatch = log.time.toLowerCase().includes(query);
        if (!textMatch && !timeMatch) return false;
      }

      if (logLevel === "all") return true;
      return getLogLevel(log) === logLevel;
    });
  }, [thinkingLogs, searchQuery, logLevel]);

  const handleCopyLogs = async () => {
    if (thinkingLogs.length === 0) return;
    const logText = thinkingLogs
      .map((l) => `[${l.time}] [${l.done ? "INFO" : "RUNNING"}] ${l.text}`)
      .join("\n");
    try {
      await navigator.clipboard.writeText(logText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.warn("Failed to copy logs:", e);
    }
  };

  const handleDownloadLogs = () => {
    if (thinkingLogs.length === 0) return;
    const logText = [
      `======================================================================`,
      `AI Insights Platform - Execution Log Stream`,
      `Pipeline:    ${pipelineTitle}`,
      `Sub-process: ${substep.title}`,
      `Timestamp:   ${new Date().toISOString()}`,
      `Total Lines: ${thinkingLogs.length}`,
      `======================================================================`,
      ``,
      ...thinkingLogs.map(
        (l, idx) => `[${l.time}] [Line ${String(idx + 1).padStart(3, "0")}] [${l.done ? "DONE" : "BUSY"}] ${l.text}`
      ),
    ].join("\n");

    const blob = new Blob([logText], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const sanitizedName = substep.title.toLowerCase().replace(/\s+/g, "_");
    link.href = url;
    link.download = `${sanitizedName}_logs_${Date.now()}.log`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return createPortal(
    <div className="fixed inset-0 z-[250] flex items-center justify-center p-3 sm:p-5 bg-slate-950/80 backdrop-blur-md select-none animate-fade-in">

      <div
        className={`relative flex flex-col bg-[#0b0f19] text-slate-200 border border-slate-700/80 rounded-2xl shadow-2xl shadow-black/80 overflow-hidden transition-all duration-200 ${
          isMaximized
            ? "w-[99vw] h-[98vh] max-w-none"
            : "w-[92vw] sm:w-[85vw] max-w-5xl h-[86vh]"
        }`}
      >

        <div className="flex items-center justify-between px-4 py-3 bg-[#0d1322] border-b border-slate-800 shrink-0">

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="w-3.5 h-3.5 rounded-full bg-[#ff5f56] hover:brightness-110 transition-all flex items-center justify-center group cursor-pointer shadow-sm"
              title="Close window (Esc)"
            >
              <span className="opacity-0 group-hover:opacity-100 text-[9px] font-bold text-black leading-none select-none">
                ✕
              </span>
            </button>
            <button
              type="button"
              onClick={() => setIsMaximized((prev) => !prev)}
              className="w-3.5 h-3.5 rounded-full bg-[#ffbd2e] hover:brightness-110 transition-all flex items-center justify-center group cursor-pointer shadow-sm"
              title="Minimize / Restore size"
            >
              <span className="opacity-0 group-hover:opacity-100 text-[8px] font-bold text-black leading-none select-none">
                –
              </span>
            </button>
            <button
              type="button"
              onClick={() => setIsMaximized((prev) => !prev)}
              className="w-3.5 h-3.5 rounded-full bg-[#27c93f] hover:brightness-110 transition-all flex items-center justify-center group cursor-pointer shadow-sm"
              title="Maximize window"
            >
              <span className="opacity-0 group-hover:opacity-100 text-[8px] font-bold text-black leading-none select-none">
                +
              </span>
            </button>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">

            {isRunning ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-status-in-progress/15 text-status-in-progress border border-status-in-progress/30">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-status-in-progress opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-status-in-progress"></span>
                </span>
                <span>STREAMING</span>
              </span>
            ) : status === "Completed" ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-status-completed/15 text-status-completed border border-status-completed/30">
                <span className="w-1.5 h-1.5 rounded-full bg-status-completed"></span>
                <span>COMPLETED</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-slate-800/80 text-slate-400 border border-slate-700/60">
                <span className="w-1.5 h-1.5 rounded-full bg-status-none"></span>
                <span>{status}</span>
              </span>
            )}

            <button
              type="button"
              onClick={() => setIsMaximized((prev) => !prev)}
              className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800/80 rounded-lg transition-colors cursor-pointer"
              title={isMaximized ? "Restore window" : "Maximize window"}
            >
              {isMaximized ? (
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="4 14 10 14 10 20" />
                  <polyline points="20 10 14 10 14 4" />
                  <line x1="14" y1="10" x2="21" y2="3" />
                  <line x1="3" y1="21" x2="10" y2="14" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="15 3 21 3 21 9" />
                  <polyline points="9 21 3 21 3 15" />
                  <line x1="21" y1="3" x2="14" y2="10" />
                  <line x1="3" y1="21" x2="10" y2="14" />
                </svg>
              )}
            </button>

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-slate-800/80 rounded-lg transition-colors cursor-pointer"
              title="Close (Esc)"
            >
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 bg-[#0e1424] border-b border-slate-800 text-xs shrink-0 select-none">

          <div className="relative flex items-center min-w-[200px] sm:min-w-[260px]">
            <svg
              viewBox="0 0 24 24"
              width="13"
              height="13"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="absolute left-2.5 text-slate-500 pointer-events-none"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search in log stream..."
              className="w-full bg-[#080c14] text-slate-200 placeholder-slate-500 pl-8 pr-7 py-1.5 rounded-lg border border-slate-700/80 text-xs font-mono focus:outline-none focus:border-indigo-500 transition-colors"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-2 text-slate-500 hover:text-slate-300 cursor-pointer"
              >
                ✕
              </button>
            )}
          </div>

          <div className="flex items-center gap-1 bg-[#080c14] p-0.5 rounded-lg border border-slate-800">
            {(
              [
                { id: "all", label: `All (${thinkingLogs.length})` },
                { id: "reason", label: "Reasoning" },
                { id: "info", label: "Info" },
                { id: "warn", label: "Warnings" },
                { id: "error", label: "Errors" },
              ] as const
            ).map((lvl) => (
              <button
                key={lvl.id}
                type="button"
                onClick={() => setLogLevel(lvl.id)}
                className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all cursor-pointer ${
                  logLevel === lvl.id
                    ? "bg-slate-800 text-white shadow-xs font-bold"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                {lvl.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">

            <button
              type="button"
              onClick={handleCopyLogs}
              disabled={thinkingLogs.length === 0}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-800/80 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              title="Copy entire log to clipboard"
            >
              {copied ? (
                <>
                  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-emerald-400">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  <span className="text-emerald-400 font-semibold">Copied!</span>
                </>
              ) : (
                <>
                  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                  <span>Copy</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={handleDownloadLogs}
              disabled={thinkingLogs.length === 0}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-800/80 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              title="Download logs as .log file"
            >
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              <span>Export</span>
            </button>
          </div>
        </div>

        <div
          ref={logsContainerRef}
          onScroll={(event) => {
            const container = event.currentTarget;
            followLatestLogsRef.current = container.scrollHeight - container.scrollTop - container.clientHeight <= 48;
          }}
          className="subprocess-log-scroll flex-1 overflow-y-auto p-4 font-mono text-xs sm:text-[13px] leading-relaxed bg-[#080c14] select-text"
        >
          {loadError && <p role="alert" className="mb-3 text-rose-300">{loadError}</p>}

          {filteredLogs.length > 0 ? (
            <div className="space-y-1">
              {filteredLogs.map((log, idx) => {
                const level = getLogLevel(log);
                const isError = level === "error";
                const isWarn = level === "warn";
                const isSuccess = !isError && !isWarn && (log.text.toLowerCase().includes("success") || log.text.toLowerCase().includes("complete"));

                return (
                  <div
                    key={idx}
                    className={`flex items-start gap-2.5 py-1 px-2 rounded-md hover:bg-slate-900/80 transition-colors group ${
                      isError
                        ? "bg-rose-950/20 text-rose-300"
                        : isWarn
                          ? "bg-amber-950/20 text-amber-300"
                          : isSuccess
                            ? "text-emerald-300/90"
                            : log.done
                              ? "text-slate-300"
                              : "text-indigo-300 bg-indigo-950/15"
                    }`}
                  >

                    <span className="text-slate-600 select-none text-[11px] w-8 text-right shrink-0 group-hover:text-slate-500 pt-0.5">
                      {String(idx + 1).padStart(3, "0")}
                    </span>

                    <span className="text-slate-500 select-none text-[11px] shrink-0 pt-0.5 font-semibold">
                      [{log.time}]
                    </span>

                    <span
                      className={`text-[10px] font-bold px-1.5 py-0.2 rounded shrink-0 select-none uppercase ${
                        isError
                          ? "bg-rose-900/60 text-rose-200 border border-rose-700/60"
                          : isWarn
                            ? "bg-amber-900/60 text-amber-200 border border-amber-700/60"
                            : isSuccess
                              ? "bg-emerald-900/60 text-emerald-200 border border-emerald-700/60"
                              : log.done
                                ? "bg-slate-800 text-slate-300 border border-slate-700/60"
                                : "bg-indigo-900/60 text-indigo-200 border border-indigo-700/60 animate-pulse"
                      }`}
                    >
                      {isError ? "ERR" : isWarn ? "WARN" : isSuccess ? "DONE" : log.done ? "INFO" : "EXEC"}
                    </span>

                    <div className="flex-1 break-words leading-relaxed font-mono">
                      <span>{log.text}</span>

                      {!log.done && idx === filteredLogs.length - 1 && isRunning && (
                        <span className="inline-block w-2 h-3.5 bg-emerald-400 ml-1.5 animate-pulse align-middle" />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="py-14 text-center select-none text-slate-500 font-mono text-xs">
              <p className="text-slate-400 font-semibold mb-1">
                {searchQuery ? `No logs match filter &quot;${searchQuery}&quot;` : "No execution logs recorded yet."}
              </p>
              <p className="text-[11px] text-slate-600 max-w-sm mx-auto">
                {searchQuery
                  ? "Try resetting your search query or switching severity filters above."
                  : isRunning
                    ? "Agent is initializing and executing subprocess routines. Logs will stream here shortly."
                    : "Logs generated during the execution of this subprocess will be available here."}
              </p>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between px-4 py-2 bg-[#0d1322] border-t border-slate-800 text-[11px] text-slate-500 shrink-0 font-mono select-none">
          <div className="flex items-center gap-3">
            <span>Encoding: UTF-8</span>
          </div>

          <div className="flex items-center gap-3">
            <span>Press <kbd className="px-1.5 py-0.5 bg-slate-800 text-slate-300 rounded border border-slate-700 text-[10px]">Esc</kbd> to close</span>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
