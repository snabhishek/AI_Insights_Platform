"use client";

import React, { useRef, useEffect } from "react";
import { ChatMessage, AgentPersona } from "./types";
import ChatMessageItem from "./ChatMessageItem";

interface ChatMessageListProps {
  messages: ChatMessage[];
  activePersona: AgentPersona;
  isGenerating?: boolean;
  onSelectAction?: (actionText: string) => void;
  onRetry?: (messageId: string) => void;
  onFeedback?: (messageId: string, type: "like" | "dislike") => void;
  onSelectSuggestedQuestion?: (question: string) => void;
}

export default function ChatMessageList({
  messages,
  activePersona,
  isGenerating = false,
  onSelectAction,
  onRetry,
  onFeedback,
  onSelectSuggestedQuestion,
}: ChatMessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isGenerating]);

  return (
    <div className="flex-1 bg-surface overflow-y-auto relative px-4 sm:px-6 py-6 space-y-4">
      {messages.length === 0 ? (
        /* Empty Conversation State with Persona Welcome Card */
        <div className="flex flex-col items-center justify-center min-h-[380px] max-w-2xl mx-auto text-center p-6 space-y-6 animate-fade-in">
          <div className="w-16 h-16 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 flex items-center justify-center text-3xl shadow-sm">
            {activePersona.avatar}
          </div>

          <div className="space-y-1.5">
            <h2 className="text-lg font-bold text-foreground">
              Chat with {activePersona.name}
            </h2>
            <p className="text-xs text-muted-foreground max-w-md mx-auto leading-relaxed">
              {activePersona.description}
            </p>
          </div>

          {/* Persona Capabilities */}
          <div className="flex flex-wrap justify-center gap-2 max-w-lg">
            {activePersona.capabilities.map((cap, idx) => (
              <span
                key={idx}
                className="text-[11px] font-medium px-2.5 py-1 rounded-lg bg-surface border border-border/80 text-foreground/80 shadow-xs"
              >
                ✨ {cap}
              </span>
            ))}
          </div>

          {/* Quick Questions */}
          <div className="w-full space-y-2 pt-2 text-left">
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block text-center">
              Suggested Questions for this Persona:
            </span>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {activePersona.suggestedQuestions.map((q, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => onSelectSuggestedQuestion?.(q)}
                  className="p-3 rounded-xl border border-border/80 bg-surface/70 hover:bg-surface hover:border-primary/40 text-left text-xs text-foreground/90 transition-all cursor-pointer shadow-xs hover:shadow-sm group active:scale-98"
                >
                  <span className="text-primary font-bold mr-1.5">›</span>
                  <span className="group-hover:text-primary transition-colors">{q}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : (
        /* Message Items */
        messages.map((msg) => (
          <ChatMessageItem
            key={msg.id}
            message={msg}
            onSelectAction={onSelectAction}
            onRetry={onRetry}
            onFeedback={onFeedback}
          />
        ))
      )}

      {/* Generating Spinner Pill */}
      {isGenerating && (
        <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-surface border border-indigo-500/30 text-indigo-400 text-xs font-semibold w-fit animate-pulse shadow-sm">
          <span className="inline-block w-3 h-3 rounded-full border-2 border-indigo-400 border-t-transparent animate-spin" />
          <span>Generating AI response & executing pipeline tools...</span>
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
}
