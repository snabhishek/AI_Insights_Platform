"use client";

import React, { useState, useRef, useEffect } from "react";
import { Project } from "../providers/AppContext";
import { AgentPersona } from "./types";

interface ChatInputAreaProps {
  onSendMessage: (text: string) => void;
  isGenerating?: boolean;
  onStopGenerating?: () => void;
  selectedProject?: Project | null;
  activePersona: AgentPersona;
  onOpenTemplates: () => void;
  onOpenPersonaModal: () => void;
}

export default function ChatInputArea({
  onSendMessage,
  isGenerating = false,
  onStopGenerating,
  selectedProject,
  activePersona,
  onOpenTemplates,
  onOpenPersonaModal,
}: ChatInputAreaProps) {
  const [inputText, setInputText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea height
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 160)}px`;
    }
  }, [inputText]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleSubmit = () => {
    if (!inputText.trim() || isGenerating) return;
    onSendMessage(inputText.trim());
    setInputText("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  };

  return (
    <div className="w-full bg-surface border-border px-4 sm:px-6 py-3.5 space-y-2 shrink-0 select-none">
      {/* Context info bar */}
      <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground px-1">
        <div className="flex items-center gap-2 truncate">
          <button
            type="button"
            onClick={onOpenPersonaModal}
            className="flex items-center gap-1.5 hover:text-foreground transition-colors cursor-pointer text-indigo-400 font-semibold truncate"
          >
            <span>{activePersona.avatar}</span>
            <span>{activePersona.name}</span>
          </button>
          <span>•</span>
        </div>

        {/* <button
          type="button"
          onClick={onOpenTemplates}
          className="flex items-center gap-1 hover:text-primary transition-colors cursor-pointer shrink-0 font-medium"
        >
          <span>💡</span>
          <span>Prompt Templates</span>
        </button> */}
      </div>

      {/* Main Textarea Container */}
      <div className="relative flex items-end gap-2 bg-surface-muted/40 border border-border/80 focus-within:border-primary/80 focus-within:ring-2 focus-within:ring-primary/15 rounded-2xl p-2 transition-all shadow-inner">
        <textarea
          ref={textareaRef}
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={`Ask ${activePersona.name} anything about features, models, data profiling or forecasts... (Press Enter to send, Shift+Enter for newline)`}
          rows={1}
          className="w-full resize-none bg-transparent px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground/70 focus:outline-none max-h-40 min-h-[38px] leading-relaxed"
        />

        {/* Action Button: Send or Stop */}
        {isGenerating ? (
          <button
            type="button"
            onClick={onStopGenerating}
            className="p-2.5 rounded-xl bg-rose-500 hover:bg-rose-600 text-white text-xs font-bold transition-all shadow-md active:scale-95 cursor-pointer shrink-0 flex items-center justify-center"
            title="Stop generating"
          >
            <span className="w-3 h-3 bg-white rounded-xs" />
          </button>
        ) : (
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!inputText.trim()}
            className={`p-2.5 rounded-xl text-white text-xs font-bold transition-all shadow-md active:scale-95 cursor-pointer shrink-0 flex items-center justify-center ${
              inputText.trim()
                ? "bg-primary hover:bg-primary/90 text-primary-foreground"
                : "bg-muted-foreground/30 text-muted-foreground/60 cursor-not-allowed shadow-none"
            }`}
            title="Send query"
          >
            <svg
              className="w-4 h-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
