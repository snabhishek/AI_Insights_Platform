"use client";

import React, { useState } from "react";
import { Sparkles, X } from "lucide-react";
import { PromptTemplate } from "./types";
import { PROMPT_TEMPLATES, AGENT_PERSONAS } from "./constants";
import PersonaIcon from "./PersonaIcon";

interface ChatPromptTemplatesProps {
  onSelectTemplate: (template: PromptTemplate) => void;
  onClose?: () => void;
}

export default function ChatPromptTemplates({
  onSelectTemplate,
  onClose,
}: ChatPromptTemplatesProps) {
  const [activeCategory, setActiveCategory] = useState<string>("All");

  const categories = ["All", "Discovery", "Features", "Models", "Validation", "SQL & Hygiene"];

  const filteredTemplates =
    activeCategory === "All"
      ? PROMPT_TEMPLATES
      : PROMPT_TEMPLATES.filter((t) => t.category === activeCategory);

  return (
    <div className="p-4 sm:p-5 bg-surface border border-border rounded-2xl shadow-xl space-y-4 max-w-2xl w-full select-none">
      <div className="flex items-center justify-between pb-2 border-b border-border/80">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-primary shrink-0" />
          <div>
            <h3 className="text-xs font-bold text-foreground">AI Insight Prompt Library</h3>
            <p className="text-[10px] text-muted-foreground">Select a curated prompt template to jump-start your analytical query</p>
          </div>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-surface-muted text-muted-foreground hover:text-foreground text-xs transition-colors cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {categories.map((cat) => (
          <button
            key={cat}
            type="button"
            onClick={() => setActiveCategory(cat)}
            className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              activeCategory === cat
                ? "bg-primary text-primary-foreground shadow-xs"
                : "bg-surface-muted text-muted-foreground hover:text-foreground hover:bg-surface-muted/80"
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-72 overflow-y-auto pr-1">
        {filteredTemplates.map((template) => {
          const recPersona = AGENT_PERSONAS[template.recommendedPersona];
          return (
            <div
              key={template.id}
              onClick={() => onSelectTemplate(template)}
              className="p-3 rounded-xl border border-border/70 bg-surface-muted/20 hover:bg-surface hover:border-primary/50 transition-all cursor-pointer flex flex-col justify-between space-y-2 group shadow-xs hover:shadow-md"
            >
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-1">
                  <span className="text-xs font-bold text-foreground group-hover:text-primary transition-colors flex items-center gap-1.5 truncate">
                    <PersonaIcon icon={template.icon} className="w-3.5 h-3.5 shrink-0 text-primary" />
                    <span className="truncate">{template.title}</span>
                  </span>
                  <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-surface border border-border/80 text-muted-foreground shrink-0">
                    {template.category}
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground line-clamp-2 leading-relaxed">
                  {template.prompt}
                </p>
              </div>

              {recPersona && (
                <div className="flex items-center gap-1.5 text-[10px] text-primary font-medium pt-1 border-t border-border/40">
                  <PersonaIcon icon={recPersona.avatar} className="w-3 h-3 shrink-0" />
                  <span>Recommended: {recPersona.name}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
