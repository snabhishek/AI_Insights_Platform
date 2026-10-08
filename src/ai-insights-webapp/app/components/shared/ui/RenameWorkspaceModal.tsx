"use client";

import React, { useState, useEffect } from "react";
import { Workspace } from "../../providers/AppContext";

interface RenameWorkspaceModalProps {
  isOpen: boolean;
  workspace: Workspace | null;
  workspaces: Workspace[];
  onClose: () => void;
  onRename: (id: string, newName: string) => Promise<void>;
  onSendAgentMessage?: (text: string) => void;
}

export default function RenameWorkspaceModal({
  isOpen,
  workspace,
  workspaces,
  onClose,
  onRename,
  onSendAgentMessage,
}: RenameWorkspaceModalProps) {
  const [name, setName] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (isOpen && workspace) {
      setName(workspace.name);
      setError("");
      setIsLoading(false);
    }
  }, [isOpen, workspace]);

  if (!isOpen || !workspace) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();

    if (!trimmed) {
      setError("Workspace name cannot be empty.");
      return;
    }

    // AC 1: Workspace names should be unique (case-insensitive check)
    const isDuplicate = workspaces.some(
      (w) => w.id !== workspace.id && w.name.trim().toLowerCase() === trimmed.toLowerCase()
    );

    if (isDuplicate) {
      setError(`Workspace name "${trimmed}" already exists. Workspace names must be unique.`);
      return;
    }

    setIsLoading(true);
    setError("");

    try {
      await onRename(workspace.id, trimmed);
      
      // AC 3: Save - primary btn - sends text to agent
      if (onSendAgentMessage) {
        onSendAgentMessage(`Workspace renamed from "${workspace.name}" to "${trimmed}".`);
      }

      onClose();
    } catch (err: any) {
      setError(err.message || "Failed to rename workspace.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-slate-950/50 backdrop-blur-md animate-fade-in"
      onKeyDown={handleKeyDown}
    >
      <div className="relative w-full max-w-md overflow-hidden rounded-xl border border-border bg-surface shadow-2xl flex flex-col">

        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-border/80 px-5 py-3 bg-surface-muted/60">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg border shrink-0 bg-primary/10 border-primary/20 text-primary">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </div>
            <h3 className="text-sm font-bold text-foreground">Rename Workspace</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-background hover:text-foreground transition-colors cursor-pointer"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Modal Body */}
        <form onSubmit={handleSubmit}>
          <div className="p-5 flex flex-col gap-3.5">
            <p className="text-xs text-muted-foreground leading-relaxed">
              Enter a new unique name for your workspace.
            </p>
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                Workspace Name
              </label>
              <input
                autoFocus
                type="text"
                value={name}
                onChange={(e) => { setName(e.target.value); setError(""); }}
                placeholder="Enter new workspace name..."
                className="h-9 w-full rounded-lg border border-border bg-background px-3 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-all"
              />
              {error && (
                <p className="text-xs text-red-500 font-medium mt-0.5">{error}</p>
              )}
            </div>
          </div>

          {/* Modal Footer: Cancel & Save Buttons */}
          <div className="flex items-center justify-end gap-2.5 border-t border-border/80 px-5 py-3 bg-surface-muted/30">
            <button
              type="button"
              onClick={onClose}
              className="h-8 px-3.5 rounded-lg border border-border bg-background text-xs font-semibold text-foreground hover:bg-surface-muted transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading || !name.trim()}
              className="h-8 px-4 rounded-lg bg-primary text-xs font-semibold text-white hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm cursor-pointer flex items-center gap-2"
            >
              {isLoading ? (
                <>
                  <svg className="animate-spin h-3.5 w-3.5 text-white" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  <span>Saving...</span>
                </>
              ) : (
                <span>Save</span>
              )}
            </button>
          </div>
        </form>

      </div>
    </div>
  );
}
