"use client";

import React, { useState } from "react";
import { ChatSession, AgentPersonaId } from "./types";
import { AGENT_PERSONAS } from "./constants";
import { Project } from "../providers/AppContext";

interface ChatSidebarProps {
  sessions: ChatSession[];
  activeSessionId: string;
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
  onDeleteSession: (id: string) => void;
  onTogglePinSession: (id: string) => void;
  selectedPersonaId: AgentPersonaId;
  onSelectPersona: (personaId: AgentPersonaId) => void;
  projects?: Project[];
  selectedProjectId?: string;
  onSelectProject?: (projectId: string) => void;
}

export default function ChatSidebar({
  sessions,
  activeSessionId,
  onSelectSession,
  onNewSession,
  onDeleteSession,
  onTogglePinSession,
  selectedPersonaId,
  onSelectPersona,
  projects = [],
  selectedProjectId = "",
  onSelectProject,
}: ChatSidebarProps) {
  const [searchQuery, setSearchQuery] = useState("");

  const filteredSessions = sessions.filter((s) =>
    s.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const pinnedSessions = filteredSessions.filter((s) => s.pinned);
  const recentSessions = filteredSessions.filter((s) => !s.pinned);

  return (
    <div className="w-full sm:w-[270px] lg:w-[300px] border-r border-border bg-surface flex flex-col h-full shrink-0 select-none">
      {/* Top Action: Project Selector & New Chat Button */}
      <div className="p-4 border-b border-border/80 space-y-3 shrink-0">
        {/* Project Selector Dropdown above New Conversation button */}
        <div className="space-y-1.5">
          <label className="block text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Project Scope <span className="text-destructive">*</span>
          </label>
          <div className="relative">
            <select
              value={selectedProjectId}
              onChange={(e) => onSelectProject?.(e.target.value)}
              className={`w-full h-9 pl-3 pr-8 rounded-xl border text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-primary/40 transition cursor-pointer appearance-none ${
                selectedProjectId
                  ? "border-border bg-surface-muted/60 text-foreground"
                  : "border-amber-500/60 bg-amber-500/5 text-foreground"
              }`}
            >
              <option value="">-- Choose a project --</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  📊 {p.name}
                </option>
              ))}
            </select>
            <div className="absolute right-2.5 top-2.5 pointer-events-none text-muted-foreground">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          </div>
          {!selectedProjectId && (
            <p className="text-[10px] text-amber-500 font-medium">
              Choose a project to enable chat & load models.
            </p>
          )}
        </div>

        {/* New Conversation Button */}
        <button
          type="button"
          onClick={onNewSession}
          disabled={!selectedProjectId}
          className={`w-full py-2.5 px-4 rounded-xl text-xs font-bold transition-all shadow-md flex items-center justify-center gap-2 ${
            selectedProjectId
              ? "bg-primary hover:bg-primary/90 text-primary-foreground cursor-pointer active:scale-98 shadow-primary/20"
              : "bg-surface-muted text-muted-foreground/60 border border-border cursor-not-allowed shadow-none"
          }`}
          title={!selectedProjectId ? "Please choose a project first" : "Start a new conversation"}
        >
          <span className="text-base font-extrabold">+</span>
          <span>New AI Conversation</span>
        </button>

        {/* Search input */}
        <div className="relative">
          <input
            type="text"
            placeholder="Search conversations..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-border/80 bg-surface-muted/50 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <svg
            className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-muted-foreground pointer-events-none"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth="2.5"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </div>
      </div>

      {/* Session List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {/* Pinned Section */}
        {pinnedSessions.length > 0 && (
          <div className="space-y-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground px-2">
              📌 Pinned Inquiries
            </span>
            <div className="space-y-1">
              {pinnedSessions.map((session) => (
                <SessionItem
                  key={session.id}
                  session={session}
                  isActive={session.id === activeSessionId}
                  onSelect={() => onSelectSession(session.id)}
                  onDelete={() => onDeleteSession(session.id)}
                  onTogglePin={() => onTogglePinSession(session.id)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Recent Conversations */}
        <div className="space-y-1">
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground px-2">
            💬 Recent Sessions
          </span>
          {recentSessions.length === 0 && pinnedSessions.length === 0 ? (
            <div className="text-center py-8 text-xs text-muted-foreground">
              No conversations found.
            </div>
          ) : (
            <div className="space-y-1">
              {recentSessions.map((session) => (
                <SessionItem
                  key={session.id}
                  session={session}
                  isActive={session.id === activeSessionId}
                  onSelect={() => onSelectSession(session.id)}
                  onDelete={() => onDeleteSession(session.id)}
                  onTogglePin={() => onTogglePinSession(session.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* <div className="p-3 border-t border-border bg-surface-muted/30 shrink-0 space-y-2">
        <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground px-1">
          Select Active Persona:
        </span>
        <div className="grid grid-cols-6 gap-1">
          {Object.values(AGENT_PERSONAS).map((p) => {
            const isSelected = p.id === selectedPersonaId;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => onSelectPersona(p.id)}
                title={`${p.name} - ${p.role}`}
                className={`w-9 h-9 rounded-xl flex items-center justify-center text-sm transition-all cursor-pointer ${
                  isSelected
                    ? "bg-primary text-primary-foreground shadow-sm ring-2 ring-primary/30 scale-105"
                    : "bg-surface border border-border/80 text-foreground hover:bg-surface-muted"
                }`}
              >
                {p.avatar}
              </button>
            );
          })}
        </div>
      </div> */}
    </div>
  );
}

function SessionItem({
  session,
  isActive,
  onSelect,
  onDelete,
  onTogglePin,
}: {
  session: ChatSession;
  isActive: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onTogglePin: () => void;
}) {
  const persona = AGENT_PERSONAS[session.agentPersona] || AGENT_PERSONAS.orchestrator;

  return (
    <div
      onClick={onSelect}
      className={`group relative flex items-center justify-between gap-2 p-2.5 rounded-xl cursor-pointer transition-all ${
        isActive
          ? "bg-primary/10 border border-primary/30 text-primary font-semibold shadow-xs"
          : "hover:bg-surface-muted/60 text-foreground/80 border border-transparent"
      }`}
    >
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <span className="text-sm shrink-0">{persona.avatar}</span>
        <div className="min-w-0 flex-1">
          <p className="text-xs truncate leading-snug">{session.title}</p>
          {session.projectName && (
            <span className="text-[9px] text-muted-foreground block truncate">
              📁 {session.projectName}
            </span>
          )}
        </div>
      </div>

      <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1 transition-opacity shrink-0">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onTogglePin();
          }}
          className="p-1 hover:bg-surface rounded text-muted-foreground hover:text-foreground text-[10px]"
          title={session.pinned ? "Unpin session" : "Pin session"}
        >
          {session.pinned ? "📌" : "📍"}
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="p-1 hover:bg-rose-500/10 hover:text-rose-500 rounded text-muted-foreground text-[10px]"
          title="Delete conversation"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
