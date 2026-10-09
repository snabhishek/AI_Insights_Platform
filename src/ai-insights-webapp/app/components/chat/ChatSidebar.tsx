"use client";

import React, { useState, useRef, useEffect } from "react";
import { Plus, Search, Pin, Trash2, MessageSquare, Folder, MoreHorizontal, Pencil, Check } from "lucide-react";
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
  onRenameSession?: (id: string, newTitle: string) => void;
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
  onRenameSession,
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
                  onRename={(newTitle) => onRenameSession?.(session.id, newTitle)}
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
                  onRename={(newTitle) => onRenameSession?.(session.id, newTitle)}
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
  onRename,
}: {
  session: ChatSession;
  isActive: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onTogglePin: () => void;
  onRename?: (newTitle: string) => void;
}) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(session.title);
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setEditTitle(session.title);
  }, [session.title]);

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isEditing]);

  useEffect(() => {
    if (!isMenuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isMenuOpen]);

  const handleSaveRename = () => {
    const trimmed = editTitle.trim();
    if (trimmed && trimmed !== session.title && onRename) {
      onRename(trimmed);
    } else {
      setEditTitle(session.title);
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSaveRename();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setEditTitle(session.title);
      setIsEditing(false);
    }
  };

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
          {isEditing ? (
            <div
              className="flex items-center gap-1"
              onClick={(e) => e.stopPropagation()}
            >
              <input
                ref={inputRef}
                type="text"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                onKeyDown={handleKeyDown}
                onBlur={handleSaveRename}
                className="w-full text-xs px-1.5 py-0.5 rounded border border-primary bg-surface text-foreground focus:outline-none"
              />
              <button
                type="button"
                onClick={handleSaveRename}
                className="p-1 text-primary hover:bg-primary/10 rounded transition-colors"
                title="Save"
              >
                <Check className="w-3 h-3" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 min-w-0">
              <p className="text-xs truncate leading-snug">{session.title}</p>
              {session.pinned && (
                <Pin className="w-2.5 h-2.5 text-amber-500 fill-amber-500/20 shrink-0" />
              )}
            </div>
          )}
          {session.projectName && (
            <span className="text-[9px] text-muted-foreground flex items-center gap-1 truncate mt-0.5">
              <Folder className="w-2.5 h-2.5 shrink-0" />
              <span className="truncate">{session.projectName}</span>
            </span>
          )}
        </div>
      </div>

      {/* Horizontal three-dot menu */}
      <div className="relative shrink-0 flex items-center">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setIsMenuOpen(!isMenuOpen);
          }}
          className={`p-1 bg-transparent hover:bg-transparent cursor-pointer rounded transition-all active:scale-90 ${
            isMenuOpen
              ? "text-primary opacity-100"
              : "opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground"
          }`}
          title="Conversation options"
          aria-label="Conversation options"
        >
          <MoreHorizontal className="w-4 h-4" />
        </button>

        {isMenuOpen && (
          <div
            ref={menuRef}
            onClick={(e) => e.stopPropagation()}
            className="absolute right-0 top-full mt-1 w-36 rounded-xl border border-border/80 dark:border-zinc-700 bg-surface/98 dark:bg-zinc-900/98 backdrop-blur-md shadow-lg p-1 z-50 space-y-0.5 animate-in fade-in zoom-in-95 duration-100 select-none text-left"
          >
            <button
              type="button"
              onClick={() => {
                setIsMenuOpen(false);
                onTogglePin();
              }}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium text-foreground hover:bg-surface-muted hover:text-primary transition-colors cursor-pointer group/item text-left"
            >
              <Pin
                className={`w-3.5 h-3.5 ${
                  session.pinned
                    ? "text-amber-500 fill-amber-500/20"
                    : "text-muted-foreground group-hover/item:text-primary"
                }`}
              />
              <span>{session.pinned ? "Unpin" : "Pin"}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setIsMenuOpen(false);
                setIsEditing(true);
              }}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium text-foreground hover:bg-surface-muted hover:text-primary transition-colors cursor-pointer group/item text-left"
            >
              <Pencil className="w-3.5 h-3.5 text-muted-foreground group-hover/item:text-primary" />
              <span>Edit</span>
            </button>

            <div className="h-px bg-border/60 my-0.5" />

            <button
              type="button"
              onClick={() => {
                setIsMenuOpen(false);
                onDelete();
              }}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium text-destructive hover:bg-rose-500/10 transition-colors cursor-pointer group/item text-left"
            >
              <Trash2 className="w-3.5 h-3.5 text-destructive" />
              <span>Delete</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
