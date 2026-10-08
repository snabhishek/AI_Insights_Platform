"use client";

import React, { useState } from "react";
import { BarChart3, Copy, Check, Sparkles, ThumbsUp, ThumbsDown } from "lucide-react";
import { ChatMessage } from "./types";
import ChatThinkingAccordion from "./ChatThinkingAccordion";
import MarkdownRenderer from "../shared/MarkdownRenderer";

interface ChatMessageItemProps {
  message: ChatMessage;
  onSelectAction?: (actionText: string) => void;
  onRetry?: (messageId: string) => void;
  onFeedback?: (messageId: string, type: "like" | "dislike") => void;
}

export default function ChatMessageItem({
  message,
  onSelectAction,
  onFeedback,
}: ChatMessageItemProps) {
  const [copied, setCopied] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);
  const isUser = message.role === "user";

  const handleCopyMessage = () => {
    navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCopyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCodeCopied(true);
    setTimeout(() => setCodeCopied(false), 2000);
  };

  return (
    <div className={`w-full flex ${isUser ? "justify-end" : "justify-start"} animate-fade-in`}>
      <div
        className={`rounded-2xl transition-all ${
          isUser
            ? "bg-primary text-white border border-transparent shadow-md max-w-[85%] sm:max-w-[75%] lg:max-w-[65%] p-3.5 sm:p-4 space-y-2"
            : "bg-surface border border-border/80 dark:border-zinc-800 shadow-sm max-w-full p-4 sm:p-5 w-full space-y-3"
        }`}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className={`text-xs font-bold ${isUser ? "text-white" : "text-foreground"}`}>
              {isUser ? "You" : message.agentName || "Sparrow"}
            </span>
            {!isUser && message.agentBadge && (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-primary/10 text-primary border border-primary/20">
                {message.agentBadge}
              </span>
            )}
          </div>
          <span className={`text-[10px] ${isUser ? "text-white/80" : "text-muted-foreground"}`}>{message.timestamp}</span>
        </div>

        {!isUser && message.thinking && message.thinking.length > 0 && (
          <ChatThinkingAccordion
            thinking={message.thinking}
            isStreaming={message.isThinking}
            defaultExpanded={false}
          />
        )}

        <MarkdownRenderer content={message.content} className={isUser ? "text-white [&_*]:!text-white" : ""} />

        {message.metricCards && message.metricCards.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-2">
            {message.metricCards.map((metric, mIdx) => (
              <div
                key={mIdx}
                className="p-3 rounded-xl border border-border/80 bg-surface/80 shadow-sm flex flex-col justify-between"
              >
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {metric.label}
                </span>
                <div className="flex items-baseline gap-1.5 my-1">
                  <span className="text-base font-extrabold text-foreground">{metric.value}</span>
                  {metric.change && (
                    <span
                      className={`text-[10px] font-bold ${
                        metric.trend === "up"
                          ? "text-emerald-500"
                          : metric.trend === "down"
                          ? "text-rose-500"
                          : "text-muted-foreground"
                      }`}
                    >
                      {metric.change}
                    </span>
                  )}
                </div>
                {metric.details && (
                  <span className="text-[9px] text-muted-foreground truncate">{metric.details}</span>
                )}
              </div>
            ))}
          </div>
        )}

        {message.tables && message.tables.length > 0 && (
          <div className="space-y-3 pt-2">
            {message.tables.map((table, tIdx) => (
              <div
                key={tIdx}
                className="overflow-x-auto rounded-xl border border-border/80 bg-surface/60 shadow-inner"
              >
                <table className="w-full text-left text-[11px]">
                  <thead className="bg-surface-muted/60 text-muted-foreground border-b border-border/80 font-bold uppercase text-[9px] tracking-wider">
                    <tr>
                      {table.columns.map((col, cIdx) => (
                        <th key={cIdx} className="px-3 py-2">
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40 font-mono">
                    {table.rows.map((row, rIdx) => (
                      <tr key={rIdx} className="hover:bg-surface-muted/30 transition-colors">
                        {table.columns.map((col, cIdx) => (
                          <td key={cIdx} className="px-3 py-1.5 whitespace-nowrap text-foreground/85">
                            {row[col] ?? "-"}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}

        {message.chart && (
          <div className="p-3.5 rounded-xl border border-border/80 bg-surface/60 space-y-2 pt-2">
            <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
              <BarChart3 className="w-3.5 h-3.5 text-primary" />
              <span>{message.chart.title}</span>
            </span>
            <div className="space-y-1.5 pt-1">
              {message.chart.labels.map((lbl, idx) => {
                const val = message.chart?.data[idx] || 0;
                const maxVal = Math.max(...(message.chart?.data || [1]));
                const pct = Math.min(100, Math.round((val / (maxVal || 1)) * 100));
                return (
                  <div key={idx} className="space-y-0.5">
                    <div className="flex justify-between text-[10px] text-muted-foreground font-mono">
                      <span>{lbl}</span>
                      <span className="font-bold text-foreground">{val}%</span>
                    </div>
                    <div className="w-full h-2 rounded-full bg-surface-muted overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-primary/80 to-primary transition-all duration-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {message.codeSnippet && (
          <div className="rounded-xl border border-border/80 bg-slate-950 text-slate-100 overflow-hidden text-xs font-mono shadow-sm">
            <div className="px-3 py-1.5 bg-slate-900 border-b border-slate-800 flex items-center justify-between text-[10px] text-slate-400">
              <span>{message.codeSnippet.filename || `${message.codeSnippet.language} snippet`}</span>
              <button
                type="button"
                onClick={() => handleCopyCode(message.codeSnippet!.code)}
                className="hover:text-white transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                {codeCopied ? (
                  <>
                    <Check className="w-3 h-3 text-emerald-400" />
                    <span className="text-emerald-400 font-semibold">Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3 h-3" />
                    <span>Copy code</span>
                  </>
                )}
              </button>
            </div>
            <pre className="p-3 overflow-x-auto text-[11px] leading-relaxed select-text">
              <code>{message.codeSnippet.code}</code>
            </pre>
          </div>
        )}

        {!isUser && message.clarification && (
          <div className="p-3.5 rounded-xl border border-amber-500/30 bg-amber-500/10 space-y-2.5">
            <div className="flex items-center gap-2 text-amber-500 text-xs font-semibold">
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
              <span>Clarification Required</span>
            </div>
            <p className="text-xs text-foreground font-medium">{message.clarification.question}</p>
            {message.clarification.options && message.clarification.options.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {message.clarification.options.map((opt, oIdx) => (
                  <button
                    key={oIdx}
                    type="button"
                    onClick={() => onSelectAction?.(opt)}
                    className="px-2.5 py-1 rounded-lg border border-amber-500/30 bg-surface hover:bg-amber-500/20 text-foreground text-[11px] font-medium transition-colors cursor-pointer"
                  >
                    {opt}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {!isUser && message.suggestedActions && message.suggestedActions.length > 0 && (
          <div className="pt-2 flex flex-wrap gap-1.5">
            {message.suggestedActions.map((action, aIdx) => (
              <button
                key={aIdx}
                type="button"
                onClick={() => onSelectAction?.(action)}
                className="px-2.5 py-1 rounded-lg border border-primary/20 bg-primary/5 hover:bg-primary/15 text-primary text-[11px] font-medium transition-colors cursor-pointer text-left flex items-center gap-1.5 group active:scale-95"
              >
                <Sparkles className="w-3 h-3 text-primary shrink-0" />
                <span className="group-hover:underline">{action}</span>
              </button>
            ))}
          </div>
        )}

        {!isUser && (
          <div className="flex items-center gap-3 pt-1 text-muted-foreground text-[10px] select-none">
            <button
              type="button"
              onClick={handleCopyMessage}
              className="hover:text-foreground transition-colors flex items-center gap-1 cursor-pointer"
              title="Copy message text"
            >
              {copied ? (
                <>
                  <Check className="w-3 h-3 text-emerald-500" />
                  <span className="text-emerald-500 font-bold">Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-3 h-3" />
                  <span>Copy</span>
                </>
              )}
            </button>
            <button
              type="button"
              onClick={() => onFeedback?.(message.id, "like")}
              className={`hover:text-foreground transition-colors flex items-center gap-1 cursor-pointer ${
                message.userLiked ? "text-emerald-500 font-bold" : ""
              }`}
              title="Helpful"
            >
              <ThumbsUp className="w-3 h-3" />
              <span>Helpful</span>
            </button>
            <button
              type="button"
              onClick={() => onFeedback?.(message.id, "dislike")}
              className={`hover:text-foreground transition-colors flex items-center gap-1 cursor-pointer ${
                message.userDisliked ? "text-rose-500 font-bold" : ""
              }`}
              title="Not helpful"
            >
              <ThumbsDown className="w-3 h-3" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
