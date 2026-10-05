"use client";

import React, { useState, useRef, useEffect } from "react";
import { Project } from "../providers/AppContext";
import { AgentPersona, TrainedModelOption } from "./types";

interface ChatInputAreaProps {
  onSendMessage: (
    text: string,
    options?: { modelId?: string; attachments?: File[] }
  ) => void;
  isGenerating?: boolean;
  onStopGenerating?: () => void;
  selectedProject?: Project | null;
  activePersona: AgentPersona;
  onOpenTemplates?: () => void;
  onOpenPersonaModal?: () => void;
  isChatEnabled?: boolean;
  trainedModels?: TrainedModelOption[];
  suggestions?: string[];
  onSelectSuggestion?: (suggestion: string) => void;
}

export default function ChatInputArea({
  onSendMessage,
  isGenerating = false,
  onStopGenerating,
  selectedProject,
  activePersona,
  onOpenTemplates,
  onOpenPersonaModal,
  isChatEnabled = true,
  trainedModels = [],
  suggestions = [],
  onSelectSuggestion,
}: ChatInputAreaProps) {
  const [inputText, setInputText] = useState("");
  const [selectedModelId, setSelectedModelId] = useState<string>("any");
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const modelDropdownRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.max(
        Math.min(textareaRef.current.scrollHeight, 220),
        84
      )}px`;
    }
  }, [inputText]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        modelDropdownRef.current &&
        !modelDropdownRef.current.contains(e.target as Node)
      ) {
        setIsModelDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {}
      }
    };
  }, []);

  useEffect(() => {
    setSelectedModelId("any");
  }, [selectedProject?.id]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleSubmit = () => {
    if (!inputText.trim() || isGenerating || !isChatEnabled) return;

    onSendMessage(inputText.trim(), {
      modelId: selectedModelId,
      attachments: attachedFiles,
    });

    setInputText("");
    setAttachedFiles([]);
    if (textareaRef.current) {
      textareaRef.current.style.height = "84px";
    }
  };

  const handleToggleVoice = () => {
    if (!isChatEnabled) return;

    const SpeechRecognition =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      alert("Speech recognition is not supported in this browser. Please use Chrome or Edge.");
      return;
    }

    if (isListening) {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {}
      }
      setIsListening(false);
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.lang = "en-US";

      recognition.onstart = () => {
        setIsListening(true);
      };

      recognition.onresult = (event: any) => {
        const transcript = Array.from(event.results)
          .map((r: any) => r[0].transcript)
          .join("");
        if (transcript) {
          setInputText((prev) => (prev ? `${prev} ${transcript}` : transcript));
        }
      };

      recognition.onerror = (event: any) => {
        console.warn("Speech recognition error:", event.error);
        setIsListening(false);
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (err) {
      console.warn("Speech recognition startup error:", err);
      setIsListening(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const newFiles = Array.from(e.target.files);
      setAttachedFiles((prev) => [...prev, ...newFiles]);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleRemoveFile = (index: number) => {
    setAttachedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSuggestionClick = (suggestion: string) => {
    if (onSelectSuggestion) {
      onSelectSuggestion(suggestion);
    } else {
      setInputText(suggestion);
      if (textareaRef.current) {
        textareaRef.current.focus();
      }
    }
  };

  const selectedModelOption =
    trainedModels.find((m) => m.id === selectedModelId) || {
      id: "any",
      displayName: "Any (Auto)",
      framework: "Auto inference",
      isChampion: false,
    };

  return (
    <div className="w-full bg-surface border-t border-border/40 px-4 sm:px-6 pt-2 pb-4 space-y-2.5 shrink-0 select-none">

      {suggestions.length > 0 && (
        <div className="w-full flex items-center gap-2 overflow-x-auto py-1 scrollbar-none no-scrollbar">
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground shrink-0 pl-0.5">
            Suggestions:
          </span>
          {suggestions.map((suggestion, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => handleSuggestionClick(suggestion)}
              disabled={!isChatEnabled}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium transition-all whitespace-nowrap shrink-0 group ${
                isChatEnabled
                  ? "border-border/80 bg-surface hover:bg-surface-muted hover:border-primary/40 text-foreground cursor-pointer shadow-2xs hover:shadow-xs active:scale-98"
                  : "border-border/40 bg-surface-muted/30 text-muted-foreground/60 cursor-not-allowed opacity-60"
              }`}
            >
              <span className="text-amber-500">💡</span>
              <span className="group-hover:text-primary transition-colors">
                {suggestion}
              </span>
            </button>
          ))}
        </div>
      )}

      <div
        className={`relative rounded-3xl border transition-all p-3 sm:p-4 space-y-2.5 shadow-sm ${
          isChatEnabled
            ? "border-border/80 bg-surface-muted/50 dark:bg-zinc-900/90 focus-within:border-primary/80 focus-within:ring-2 focus-within:ring-primary/10"
            : "border-border/40 bg-surface-muted/30 opacity-70 cursor-not-allowed"
        }`}
      >

        {attachedFiles.length > 0 && (
          <div className="flex flex-wrap gap-2 pb-1">
            {attachedFiles.map((file, idx) => (
              <div
                key={idx}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-surface border border-border/80 text-[11px] font-medium text-foreground shadow-2xs"
              >
                <span>📎</span>
                <span className="truncate max-w-[140px]">{file.name}</span>
                <span className="text-[10px] text-muted-foreground">
                  ({(file.size / 1024).toFixed(0)} KB)
                </span>
                <button
                  type="button"
                  onClick={() => handleRemoveFile(idx)}
                  className="ml-1 text-muted-foreground hover:text-destructive cursor-pointer"
                  title="Remove attachment"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        <textarea
          ref={textareaRef}
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={!isChatEnabled}
          placeholder={
            isChatEnabled
              ? "Ask anything, @ to mention, / for actions"
              : "Choose a project from the sidebar dropdown above to enable chat..."
          }
          rows={3}
          style={{ minHeight: "84px" }}
          className={`w-full resize-none bg-transparent px-1 py-1 text-sm text-foreground focus:outline-none max-h-56 leading-relaxed ${
            isChatEnabled
              ? "placeholder:text-muted-foreground/60"
              : "placeholder:text-muted-foreground/40 cursor-not-allowed"
          }`}
        />

        <div className="flex items-center justify-between gap-2 pt-1">

          <div className="flex items-center gap-2">

            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              multiple
              className="hidden"
            />

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={!isChatEnabled}
              className={`p-2 rounded-xl text-muted-foreground hover:text-foreground hover:bg-surface transition-colors flex items-center justify-center ${
                isChatEnabled ? "cursor-pointer" : "cursor-not-allowed opacity-50"
              }`}
              title={isChatEnabled ? "Attach documents (.csv, .parquet, .json, .txt, .pdf)" : "Select a project to enable"}
            >
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth="2.5"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
            </button>

            <div className="relative" ref={modelDropdownRef}>
              <button
                type="button"
                onClick={() => setIsModelDropdownOpen(!isModelDropdownOpen)}
                disabled={!isChatEnabled}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold transition-all select-none ${
                  isChatEnabled
                    ? "border-border/80 bg-surface/80 hover:bg-surface hover:border-primary/40 text-foreground cursor-pointer shadow-2xs"
                    : "border-border/40 bg-surface-muted text-muted-foreground/50 cursor-not-allowed"
                }`}
                title="Select model for inference (Default: Any)"
              >
                <span className="text-primary font-bold">
                  {selectedModelOption.id === "any" ? "✨" : "🤖"}
                </span>
                <span className="truncate max-w-[120px] sm:max-w-[170px]">
                  {selectedModelOption.displayName}
                </span>
                {selectedModelOption.isChampion && (
                  <span className="text-[9px] px-1 py-0.2 rounded bg-amber-500 text-white font-extrabold uppercase shrink-0">
                    Champ
                  </span>
                )}
                <svg
                  className={`w-3.5 h-3.5 text-muted-foreground transition-transform duration-200 ${
                    isModelDropdownOpen ? "rotate-180 text-primary" : ""
                  }`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth="2.5"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {isModelDropdownOpen && isChatEnabled && (
                <div className="absolute left-0 bottom-full mb-2 w-72 max-h-64 overflow-y-auto rounded-2xl border border-border/80 bg-surface shadow-2xl p-1.5 space-y-1 z-[150] animate-scale-up">
                  <div className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground border-b border-border/60">
                    Inference Model Selection
                  </div>

                  <div
                    onClick={() => {
                      setSelectedModelId("any");
                      setIsModelDropdownOpen(false);
                    }}
                    className={`flex items-start justify-between p-2 rounded-xl cursor-pointer text-xs transition-colors ${
                      selectedModelId === "any"
                        ? "bg-primary text-primary-foreground font-semibold shadow-xs"
                        : "hover:bg-surface-muted text-foreground"
                    }`}
                  >
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span>✨</span>
                        <span className="font-bold">Any (Auto Selection)</span>
                      </div>
                      <p className={`text-[10px] mt-0.5 ${selectedModelId === "any" ? "text-primary-foreground/80" : "text-muted-foreground"}`}>
                        Agent automatically routes to best-suited model
                      </p>
                    </div>
                    {selectedModelId === "any" && (
                      <span className="font-bold text-sm">✓</span>
                    )}
                  </div>

                  {trainedModels
                    .filter((m) => m.id !== "any")
                    .map((m) => {
                      const isSelected = selectedModelId === m.id;
                      return (
                        <div
                          key={m.id}
                          onClick={() => {
                            setSelectedModelId(m.id);
                            setIsModelDropdownOpen(false);
                          }}
                          className={`flex items-start justify-between p-2 rounded-xl cursor-pointer text-xs transition-colors ${
                            isSelected
                              ? "bg-primary text-primary-foreground font-semibold shadow-xs"
                              : "hover:bg-surface-muted text-foreground"
                          }`}
                        >
                          <div className="min-w-0 pr-2">
                            <div className="flex items-center gap-1.5">
                              <span className="font-bold truncate">{m.displayName}</span>
                              {m.isChampion && (
                                <span className="text-[9px] px-1 py-0.2 rounded bg-amber-500 text-white font-black uppercase shrink-0">
                                  Champ
                                </span>
                              )}
                            </div>
                            {m.framework && (
                              <span className={`text-[10px] font-mono block ${isSelected ? "text-primary-foreground/80" : "text-muted-foreground"}`}>
                                {m.framework}
                              </span>
                            )}
                          </div>
                          {isSelected && <span className="font-bold text-sm">✓</span>}
                        </div>
                      );
                    })}

                  {trainedModels.filter((m) => m.id !== "any").length === 0 && (
                    <div className="px-2.5 py-2 text-[11px] text-muted-foreground italic text-center">
                      No trained models found for this project yet.
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">

            <button
              type="button"
              onClick={handleToggleVoice}
              disabled={!isChatEnabled}
              className={`p-2 rounded-full transition-all flex items-center justify-center ${
                isListening
                  ? "bg-rose-500 text-white animate-pulse shadow-md cursor-pointer"
                  : isChatEnabled
                  ? "text-muted-foreground hover:text-foreground hover:bg-surface cursor-pointer"
                  : "text-muted-foreground/40 cursor-not-allowed"
              }`}
              title={
                isListening
                  ? "Listening... Click to stop"
                  : isChatEnabled
                  ? "Click to speak (Voice typing)"
                  : "Select a project to enable voice typing"
              }
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
                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" x2="12" y1="19" y2="22" />
              </svg>
            </button>

            {isGenerating ? (
              <button
                type="button"
                onClick={onStopGenerating}
                className="w-8 h-8 rounded-full bg-rose-500 hover:bg-rose-600 text-white text-xs font-bold transition-all shadow-md active:scale-95 cursor-pointer flex items-center justify-center"
                title="Stop generating"
              >
                <span className="w-2.5 h-2.5 bg-white rounded-xs" />
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!inputText.trim() || !isChatEnabled}
                className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${
                  inputText.trim() && isChatEnabled
                    ? "bg-primary hover:bg-primary/90 text-primary-foreground shadow-sm cursor-pointer active:scale-95"
                    : "bg-surface-muted text-muted-foreground/40 cursor-not-allowed border border-border/40"
                }`}
                title={
                  !isChatEnabled
                    ? "Choose a project from the sidebar above to start"
                    : inputText.trim()
                    ? "Send message (Enter)"
                    : "Type a query to send"
                }
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
                  <line x1="5" y1="12" x2="19" y2="12" />
                  <polyline points="12 5 19 12 12 19" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
