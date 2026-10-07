"use client";

import React, { useState } from "react";
import { Plus, Search, Pin, Trash2, MessageSquare, Folder } from "lucide-react";
import { ChatSession, AgentPersonaId } from "./types";
import { Project } from "../providers/AppContext";
import ModernSelect from "../shared/ui/ModernSelect";
import PersonaIcon from "./PersonaIcon";

interface ChatSidebarProps {
  sessions: ChatSession[];
  activeSessionId: string;
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
  onDeleteSession: (id: string) => void;
  onTogglePinSession: (id: string) => void;
  selectedPersonaId: AgentPersonaId;
  onSelectPersona: (id: AgentPersonaId) => void;
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
  projects = [],
  selectedProjectId = "",
  onSelectProject,
}: ChatSidebarProps) {
  const [searchQuery, setSearchQuery] = useState("");

  const filteredSessions = sessions.filter((s) => {
    const matchesSearch =
      s.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.messages.some((m) => m.content.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchesSearch;
  });

  const pinnedSessions = filteredSessions.filter((s) => s.pinned);
  const recentSessions = filteredSessions.filter((s) => !s.pinned);

  const projectOptions = projects.map((p) => ({
    value: p.id,
    label: p.projectName || p.name,
    icon: <Folder className="w-3.5 h-3.5 text-primary" />,
    description: p.projectName && p.projectName !== p.name ? p.name : (p.useCase || p.status),
  }));

  return (
    <div className="w-full sm:w-[270px] lg:w-[300px] border-r border-border bg-surface flex flex-col h-full shrink-0 select-none">
      <div className="p-4 border-b border-border/80 space-y-3 shrink-0">
        <div className="space-y-1.5">
          <label className="block text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Project Scope <span className="text-destructive">*</span>
          </label>
          <ModernSelect
            value={selectedProjectId}
            onChange={(val) => onSelectProject?.(val)}
            options={projectOptions}
            placeholder="Select a project"
            icon={<Folder className="w-3.5 h-3.5" />}
          />
          {!selectedProjectId && (
            <p className="text-[10px] text-amber-500 font-medium">
              Choose a project to enable chat & load models.
            </p>
          )}
        </div>

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
          <Plus className="w-4 h-4" />
          <span>New AI Conversation</span>
        </button>

        <div className="relative">
          <input
            type="text"
            placeholder="Search conversations..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-border/80 bg-surface-muted/50 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-muted-foreground pointer-events-none" />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-4">
        {pinnedSessions.length > 0 && (
          <div className="space-y-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground px-2 flex items-center gap-1.5">
              <Pin className="w-3 h-3 text-amber-500" />
              <span>Pinned</span>
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

        <div className="space-y-1">
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground px-2 flex items-center gap-1.5">
            <MessageSquare className="w-3 h-3 text-primary" />
            <span>Recent Sessions</span>
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
  return (
    <div
      onClick={onSelect}
      className={`group relative flex items-center justify-between gap-2 p-2.5 rounded-xl cursor-pointer transition-all ${
        isActive
          ? "bg-primary/10 border border-primary/30 text-primary font-semibold shadow-xs"
          : "hover:bg-surface-muted/60 text-foreground/80 border border-transparent"
      }`}
    >
      <div className="flex items-center gap-2.5 min-w-0 flex-1">
        <div className="w-6 h-6 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0 text-primary">
          <PersonaIcon id={session.agentPersona} className="w-3.5 h-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs truncate leading-snug">{session.title}</p>
          {session.projectName && (
            <span className="text-[9px] text-muted-foreground flex items-center gap-1 truncate mt-0.5">
              <Folder className="w-2.5 h-2.5 shrink-0" />
              <span className="truncate">{session.projectName}</span>
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
          className={`p-1.5 hover:bg-surface rounded-lg transition-colors ${
            session.pinned ? "text-amber-500" : "text-muted-foreground hover:text-foreground"
          }`}
          title={session.pinned ? "Unpin session" : "Pin session"}
        >
          <Pin className="w-3 h-3" />
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="p-1.5 hover:bg-rose-500/10 text-muted-foreground hover:text-rose-500 rounded-lg transition-colors"
          title="Delete session"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}
