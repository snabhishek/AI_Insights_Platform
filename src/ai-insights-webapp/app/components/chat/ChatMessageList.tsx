"use client";

import React, { useState, useRef, useEffect } from "react";
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
  onClarificationReply?: (messageId: string, answer: string) => void;
  onClarificationDraft?: (messageId: string, draft: string) => void;
  onClarificationExpire?: (messageId: string, interactionId: string) => void;
  onFeedback?: (messageId: string, type: "like" | "dislike") => void;
  onSelectSuggestedQuestion?: (question: string) => void;
  selectedProject?: Project | null;
  isChatEnabled?: boolean;
  onScrollStateChange?: (isScrolledUp: boolean) => void;
  onRegisterScrollToBottom?: (scrollToBottomFn: () => void) => void;
}

export default function ChatMessageList({
  messages,
  activePersona,
  isGenerating = false,
  onSelectAction,
  onRetry, onClarificationReply, onClarificationDraft, onClarificationExpire,
  onFeedback,
  selectedProject,
  onScrollStateChange,
  onRegisterScrollToBottom,
}: ChatMessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [isScrolledUp, setIsScrolledUp] = useState(false);

  const hasUserMessages = messages.some((m) => m.role === "user");
  const conversationMessages = messages.filter((m) => m.id !== "msg-welcome-1");

  const scrollToBottom = () => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTo({
        top: scrollContainerRef.current.scrollHeight,
        behavior: "smooth",
      });
    } else {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  };

  useEffect(() => {
    if (onRegisterScrollToBottom) {
      onRegisterScrollToBottom(scrollToBottom);
    }
  }, [onRegisterScrollToBottom]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    setIsScrolledUp(false);
  }, [messages, isGenerating]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    const scrolledUp = scrollHeight - scrollTop - clientHeight > 60;
    setIsScrolledUp(scrolledUp);
    onScrollStateChange?.(scrolledUp);
  };

  return (
    <div className="flex-1 min-h-0 relative flex flex-col bg-background">
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 flex flex-col"
      >
        <div className="w-full max-w-4xl lg:max-w-5xl mx-auto space-y-4 flex-1 flex flex-col pb-8">
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
            isGenerating={isGenerating}
            onClarificationReply={onClarificationReply}
            onClarificationDraft={onClarificationDraft}
            onClarificationExpire={onClarificationExpire}
            onFeedback={onFeedback}
          />
        ))
      )}

        <div ref={bottomRef} className="h-2 shrink-0" />
      </div>
    </div>

    {/* Smooth natural blurred fade at the bottom of the chat window above the chat box */}
    <div className="pointer-events-none absolute bottom-0 inset-x-0 h-10 bg-gradient-to-t from-background via-background/60 to-transparent backdrop-blur-[1px]" />

    {/* Centered scroll to latest shortcut button at the bottom of the chat window */}
    {isScrolledUp && (
      <button
        type="button"
        onClick={scrollToBottom}
        className="absolute bottom-3 left-1/2 -translate-x-1/2 z-30 flex items-center justify-center w-8 h-8 rounded-full bg-surface/95 dark:bg-zinc-800/95 backdrop-blur-md border border-border/80 dark:border-zinc-700 shadow-md hover:bg-surface hover:border-primary/50 text-foreground transition-all duration-200 hover:scale-110 active:scale-95 group cursor-pointer animate-in fade-in zoom-in-95"
        title="Scroll to latest message"
        aria-label="Scroll to latest message"
      >
        <ArrowDown className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
      </button>
    )}
  </div>
);
}
