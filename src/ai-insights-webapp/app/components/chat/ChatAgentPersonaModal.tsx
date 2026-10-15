"use client";

import React from "react";
import { Bot, X, Check } from "lucide-react";
import { AgentPersonaId } from "./types";
import { AGENT_PERSONAS } from "./constants";
import PersonaIcon from "./PersonaIcon";

interface ChatAgentPersonaModalProps {
  isOpen: boolean;
  selectedPersonaId: AgentPersonaId;
  onSelectPersona: (personaId: AgentPersonaId) => void;
  onClose: () => void;
}

export default function ChatAgentPersonaModal({
  isOpen,
  selectedPersonaId,
  onSelectPersona,
  onClose,
}: ChatAgentPersonaModalProps) {
  if (!isOpen) return null;

  const personas = Object.values(AGENT_PERSONAS);

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in select-none">
      <div className="relative w-full max-w-2xl bg-surface border border-border rounded-2xl shadow-2xl p-6 space-y-5 animate-scale-up max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between border-b border-border pb-3 shrink-0">
          <div>
            <h2 className="text-base font-bold text-foreground flex items-center gap-2">
              <Bot className="w-5 h-5 text-primary" />
              <span>Select Specialized AI Agent Persona</span>
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Each persona utilizes targeted domain prompts, specialized pipeline tools, and focused analytics.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-surface-muted text-muted-foreground hover:text-foreground text-sm transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 overflow-y-auto p-1">
          {personas.map((persona) => {
            const isSelected = persona.id === selectedPersonaId;
            return (
              <div
                key={persona.id}
                onClick={() => {
                  onSelectPersona(persona.id);
                  onClose();
                }}
                className={`p-4 rounded-xl border transition-all cursor-pointer flex flex-col justify-between space-y-3 shadow-xs hover:shadow-md ${
                  isSelected
                    ? "border-primary ring-2 ring-primary/20 bg-primary/5 dark:bg-primary/10"
                    : "border-border/80 bg-surface hover:border-border hover:bg-surface-muted/50"
                }`}
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-lg bg-surface-muted border border-border/80 flex items-center justify-center">
                        <PersonaIcon icon={persona.avatar} className="w-4 h-4" />
                      </div>
                      <div>
                        <h4 className="text-xs font-bold text-foreground leading-tight">
                          {persona.name}
                        </h4>
                        <span className="text-[10px] text-muted-foreground">{persona.role}</span>
                      </div>
                    </div>
                    {isSelected && (
                      <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-primary text-primary-foreground shadow-xs">
                        <Check className="w-2.5 h-2.5" />
                        Active
                      </span>
                    )}
                  </div>

                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    {persona.description}
                  </p>
                </div>

                <div className="space-y-1.5 pt-2 border-t border-border/50">
                  <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
                    Core Capabilities:
                  </span>
                  <div className="flex flex-wrap gap-1">
                    {persona.capabilities.slice(0, 2).map((cap, cIdx) => (
                      <span
                        key={cIdx}
                        className="text-[10px] px-1.5 py-0.5 rounded bg-surface border border-border/60 text-foreground/80 truncate max-w-full"
                      >
                        • {cap}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
