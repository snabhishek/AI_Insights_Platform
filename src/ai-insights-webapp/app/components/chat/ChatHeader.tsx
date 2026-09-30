"use client";

import React, { useState, useRef, useEffect } from "react";
import { AgentPersona, AgentPersonaId } from "./types";
import { Project } from "../providers/AppContext";

interface ChatHeaderProps {
  activePersona: AgentPersona;
  selectedProject: Project | null;
  allProjects: Project[];
  onSelectProject: (projectId: string) => void;
  onOpenPersonaModal: () => void;
  onOpenTemplates: () => void;
  onClearSession: () => void;
  onExportSession: () => void;
  isGenerating?: boolean;
}

export default function ChatHeader({
  activePersona,
  selectedProject,
  allProjects,
  onSelectProject,
  onOpenPersonaModal,
  onOpenTemplates,
  onClearSession,
  onExportSession,
  isGenerating = false,
}: ChatHeaderProps) {
  const [isProjectDropdownOpen, setIsProjectDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsProjectDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="w-full border-border bg-surface px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-3 shrink-0 select-none">

      <div className="flex items-center gap-3">
        {/* <button
          type="button"
          onClick={onOpenPersonaModal}
          className="flex items-center gap-2.5 p-1.5 pr-3 rounded-xl border border-border/80 bg-surface-muted/30 hover:bg-surface-muted hover:border-primary/40 transition-all cursor-pointer group shadow-xs active:scale-98"
          title="Click to switch AI Agent Persona"
        >
          <div className="w-8 h-8 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 flex items-center justify-center text-base shrink-0 group-hover:scale-105 transition-transform">
            {activePersona.avatar}
          </div>
          <div className="text-left">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-bold text-foreground group-hover:text-primary transition-colors">
                {activePersona.name}
              </span>
              <span className="text-[9px] font-semibold px-1.5 py-0.2 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                {activePersona.badge}
              </span>
            </div>
            <span className="text-[10px] text-muted-foreground block truncate max-w-[180px]">
              {activePersona.role}
            </span>
          </div>
          <svg
            className="w-3.5 h-3.5 text-muted-foreground ml-0.5 group-hover:text-foreground transition-colors"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth="2.5"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button> */}

        <div className="hidden md:flex items-center gap-1.5 text-[11px] text-muted-foreground font-medium pl-2 border-l border-border/60">
          <span className={`w-2 h-2 rounded-full ${isGenerating ? "bg-amber-500 animate-ping" : "bg-emerald-500"}`} />
          <span>{isGenerating ? "Processing reasoning chain" : "Online & Context Ready"}</span>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {/* <div className="relative" ref={dropdownRef}>
          <button
            type="button"
            onClick={() => setIsProjectDropdownOpen(!isProjectDropdownOpen)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-xl border border-border/80 bg-surface-muted/30 hover:bg-surface-muted hover:border-primary/40 text-xs font-semibold text-foreground transition-all cursor-pointer shadow-xs"
          >
            <span className="text-muted-foreground">📁 Project:</span>
            <span className="font-bold text-primary truncate max-w-[140px] sm:max-w-[180px]">
              {selectedProject ? selectedProject.name : "All Projects (Global)"}
            </span>
            <svg
              className={`w-3.5 h-3.5 text-muted-foreground transition-transform duration-200 ${isProjectDropdownOpen ? "rotate-180 text-primary" : ""
                }`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth="2.5"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {isProjectDropdownOpen && (
            <div className="absolute right-0 top-[calc(100%+6px)] z-[120] min-w-[220px] rounded-xl border border-border/80 bg-surface shadow-2xl p-1 space-y-0.5 animate-scale-up">
              <div
                onClick={() => {
                  onSelectProject("");
                  setIsProjectDropdownOpen(false);
                }}
                className={`flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer text-xs font-medium transition-colors ${!selectedProject
                    ? "bg-primary text-primary-foreground font-semibold"
                    : "text-foreground hover:bg-surface-muted hover:text-primary"
                  }`}
              >
                <span>🌐 All Projects (Global Scope)</span>
                {!selectedProject && <span className="font-bold">✓</span>}
              </div>

              {allProjects.map((p) => {
                const isSelected = selectedProject?.id === p.id;
                return (
                  <div
                    key={p.id}
                    onClick={() => {
                      onSelectProject(p.id);
                      setIsProjectDropdownOpen(false);
                    }}
                    className={`flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer text-xs font-medium transition-colors ${isSelected
                        ? "bg-primary text-primary-foreground font-semibold"
                        : "text-foreground hover:bg-surface-muted hover:text-primary"
                      }`}
                  >
                    <span className="truncate">{p.name}</span>
                    {isSelected && <span className="font-bold shrink-0">✓</span>}
                  </div>
                );
              })}
            </div>
          )}
        </div> */}

        {/* <button
          type="button"
          onClick={onOpenTemplates}
          className="px-2.5 py-1.5 rounded-xl border border-border/80 bg-surface hover:bg-surface-muted text-foreground text-xs font-semibold transition-colors flex items-center gap-1.5 cursor-pointer shadow-xs"
          title="Browse prompt templates"
        >
          <span>💡</span>
          <span className="hidden sm:inline">Templates</span>
        </button> */}

        <button
          type="button"
          onClick={onExportSession}
          className="p-2 rounded-xl border border-border/80 bg-surface hover:bg-surface-muted text-muted-foreground hover:text-foreground text-xs transition-colors cursor-pointer shadow-xs"
          title="Export conversation to Markdown"
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
        </button>

        <button
          type="button"
          onClick={onClearSession}
          className="p-2 rounded-xl border border-border/80 bg-surface hover:bg-rose-500/10 hover:text-rose-500 hover:border-rose-500/30 text-muted-foreground text-xs transition-colors cursor-pointer shadow-xs"
          title="Clear active conversation"
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
        </button>
      </div>
    </div>
  );
}
