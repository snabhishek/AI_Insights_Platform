"use client";

import React, { useRef, useEffect } from "react";
import {
  Search,
  Cpu,
  TrendingUp,
  BarChart3,
  ArrowRight,
  ArrowDown,
  ArrowLeft,
} from "lucide-react";
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
    <div className="flex-1 bg-surface overflow-y-auto relative px-4 sm:px-6 py-4 space-y-4 flex flex-col">
      {!hasUserMessages ? (
        <div className="flex-1 flex flex-col items-center justify-center my-auto p-2 sm:p-4 text-center animate-fade-in select-none">
          <div className="w-full max-w-md mx-auto space-y-3 sm:space-y-3.5 text-center">
            <div className="space-y-0.5">
              <h1 className="text-xl sm:text-2xl font-black text-foreground tracking-tight">
                SPARROW
              </h1>
              <p className="text-[10px] sm:text-xs font-bold uppercase tracking-[0.2em] text-primary">
                AI FOR YOUR DATA
              </p>
              <div className="text-[11px] sm:text-xs text-muted-foreground font-medium leading-snug pt-0.5 space-y-0.5">
                <p>Turn data into models.</p>
                <p>Turn models into decisions.</p>
              </div>
            </div>

            <div className="max-w-md mx-auto">
              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 sm:gap-2.5">
                <div className="p-2.5 sm:p-3 rounded-xl border border-border/80 dark:border-zinc-700/80 bg-surface dark:bg-zinc-900/90 shadow-soft hover:border-primary/40 transition-all duration-200 text-left group">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-mono text-[9px] font-bold text-muted-foreground/70 group-hover:text-primary transition-colors">
                      01
                    </span>
                    <div className="w-5 h-5 rounded-md bg-surface-muted border border-border/80 dark:border-zinc-700/80 flex items-center justify-center text-muted-foreground group-hover:text-primary transition-all">
                      <Search className="w-2.5 h-2.5" />
                    </div>
                  </div>
                  <h3 className="text-xs font-bold text-foreground tracking-wide uppercase group-hover:text-primary transition-colors">
                    DISCOVER
                  </h3>
                  <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">
                    Understand your data
                  </p>
                </div>

                <div className="flex items-center justify-center px-0.5">
                  <div className="w-5 h-5 flex items-center justify-center text-primary/70">
                    <ArrowRight className="w-3 h-3" />
                  </div>
                </div>

                <div className="p-2.5 sm:p-3 rounded-xl border border-border/80 dark:border-zinc-700/80 bg-surface dark:bg-zinc-900/90 shadow-soft hover:border-primary/40 transition-all duration-200 text-left group">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-mono text-[9px] font-bold text-muted-foreground/70 group-hover:text-primary transition-colors">
                      02
                    </span>
                    <div className="w-5 h-5 rounded-md bg-surface-muted border border-border/80 dark:border-zinc-700/80 flex items-center justify-center text-muted-foreground group-hover:text-primary transition-all">
                      <Cpu className="w-2.5 h-2.5" />
                    </div>
                  </div>
                  <h3 className="text-xs font-bold text-foreground tracking-wide uppercase group-hover:text-primary transition-colors">
                    ENGINEER
                  </h3>
                  <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">
                    Build better features
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 sm:gap-2.5 py-0.5">
                <div />
                <div />
                <div className="flex items-center justify-center">
                  <div className="w-5 h-5 flex items-center justify-center text-primary/70">
                    <ArrowDown className="w-3 h-3" />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 sm:gap-2.5">
                <div className="p-2.5 sm:p-3 rounded-xl border border-border/80 dark:border-zinc-700/80 bg-surface dark:bg-zinc-900/90 shadow-soft hover:border-primary/40 transition-all duration-200 text-left group">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-mono text-[9px] font-bold text-muted-foreground/70 group-hover:text-primary transition-colors">
                      04
                    </span>
                    <div className="w-5 h-5 rounded-md bg-surface-muted border border-border/80 dark:border-zinc-700/80 flex items-center justify-center text-muted-foreground group-hover:text-primary transition-all">
                      <BarChart3 className="w-2.5 h-2.5" />
                    </div>
                  </div>
                  <h3 className="text-xs font-bold text-foreground tracking-wide uppercase group-hover:text-primary transition-colors">
                    INSIGHT
                  </h3>
                  <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">
                    Explain &amp; simulate
                  </p>
                </div>

                <div className="flex items-center justify-center px-0.5">
                  <div className="w-5 h-5 flex items-center justify-center text-primary/70">
                    <ArrowLeft className="w-3 h-3" />
                  </div>
                </div>

                <div className="p-2.5 sm:p-3 rounded-xl border border-border/80 dark:border-zinc-700/80 bg-surface dark:bg-zinc-900/90 shadow-soft hover:border-primary/40 transition-all duration-200 text-left group">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-mono text-[9px] font-bold text-muted-foreground/70 group-hover:text-primary transition-colors">
                      03
                    </span>
                    <div className="w-5 h-5 rounded-md bg-surface-muted border border-border/80 dark:border-zinc-700/80 flex items-center justify-center text-muted-foreground group-hover:text-primary transition-all">
                      <TrendingUp className="w-2.5 h-2.5" />
                    </div>
                  </div>
                  <h3 className="text-xs font-bold text-foreground tracking-wide uppercase group-hover:text-primary transition-colors">
                    PREDICT
                  </h3>
                  <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">
                    Train &amp; validate
                  </p>
                </div>
              </div>
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
