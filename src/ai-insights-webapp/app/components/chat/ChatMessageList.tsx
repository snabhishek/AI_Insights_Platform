"use client";

import React, { useRef, useEffect } from "react";
import { BarChart3, Zap, Cpu, Wrench, AlertCircle, Bot } from "lucide-react";
import { ChatMessage, AgentPersona } from "./types";
import { Project } from "../providers/AppContext";
import ChatMessageItem from "./ChatMessageItem";

interface ChatMessageListProps {
  messages: ChatMessage[];
  activePersona: AgentPersona;
  isGenerating?: boolean;
  onSelectAction?: (actionText: string) => void;
  onRetry?: (messageId: string) => void;
  onFeedback?: (messageId: string, type: "like" | "dislike") => void;
  onSelectSuggestedQuestion?: (question: string) => void;
  selectedProject?: Project | null;
  isChatEnabled?: boolean;
}

export default function ChatMessageList({
  messages,
  activePersona,
  isGenerating = false,
  onSelectAction,
  onRetry,
  onFeedback,
  selectedProject,
}: ChatMessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  const hasUserMessages = messages.some((m) => m.role === "user");
  const conversationMessages = messages.filter((m) => m.id !== "msg-welcome-1");

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isGenerating]);

  return (
    <div className="flex-1 bg-surface overflow-y-auto relative px-4 sm:px-6 py-6 space-y-4 flex flex-col">
      {!hasUserMessages ? (
        <div className="flex-1 flex flex-col items-center justify-center my-auto min-h-[420px] p-4 text-center animate-fade-in select-none">
          <div className="w-full max-w-xl mx-auto rounded-3xl border border-border/80 bg-surface-muted/30 dark:bg-zinc-900/60 backdrop-blur-md p-6 sm:p-8 space-y-5 shadow-sm text-center">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 text-primary flex items-center justify-center shadow-sm mx-auto">
              <Bot className="w-8 h-8" />
            </div>

            <div className="space-y-1">
              <h2 className="text-lg sm:text-xl font-bold text-foreground tracking-tight">
                Welcome to Sparrow AI Agent Copilot!
              </h2>
              <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                I&apos;m Sparrow, your intelligent assistant for pipeline orchestration, feature engineering, and predictive ML insights.
              </p>
            </div>

            <div className="text-left bg-surface/80 border border-border/70 rounded-2xl p-4 space-y-2.5 shadow-2xs">
              <span className="text-[11px] font-bold text-foreground uppercase tracking-wider block">
                What I can help you with:
              </span>
              <ul className="space-y-2 text-xs text-foreground/80 leading-snug">
                <li className="flex items-start gap-2.5">
                  <BarChart3 className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                  <div>
                    <strong className="text-foreground">End-to-End Insights:</strong> Synthesize multi-stage pipeline outputs and project health.
                  </div>
                </li>
                <li className="flex items-start gap-2.5">
                  <Zap className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                  <div>
                    <strong className="text-foreground">Feature Engineering:</strong> Formulate rolling lags, seasonal transformations, and scout exogenous regressors.
                  </div>
                </li>
                <li className="flex items-start gap-2.5">
                  <Cpu className="w-4 h-4 text-indigo-500 shrink-0 mt-0.5" />
                  <div>
                    <strong className="text-foreground">Model Diagnostics:</strong> Compare LightGBM, XGBoost, and Prophet models with SHAP explainability.
                  </div>
                </li>
                <li className="flex items-start gap-2.5">
                  <Wrench className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                  <div>
                    <strong className="text-foreground">Data Engineering:</strong> Inspect schema integrity, cardinality, and SQL query optimizations.
                  </div>
                </li>
              </ul>
            </div>

            <div className="pt-1">
              {selectedProject ? (
                <div className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-xs font-semibold shadow-2xs">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  <span>Scoped to project: {selectedProject.name}</span>
                </div>
              ) : (
                <div className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 text-xs font-semibold shadow-2xs">
                  <AlertCircle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                  <span>Select a project from the sidebar dropdown above to enable chat</span>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        conversationMessages.map((msg) => (
          <ChatMessageItem
            key={msg.id}
            message={msg}
            onSelectAction={onSelectAction}
            onRetry={onRetry}
            onFeedback={onFeedback}
          />
        ))
      )}

      <div ref={bottomRef} />
    </div>
  );
}
