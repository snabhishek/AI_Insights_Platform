"use client";

import { useEffect, useRef, useState } from "react";
import { useApp } from "../../providers/AppContext";
import { sendTextToAgent } from "../../../services/aiAgentChatService";
import RenameWorkspaceModal from "./RenameWorkspaceModal";

export interface Workspace {
  id: string;
  name: string;
  isDefault?: boolean;
}

interface WorkspaceSwitcherProps {
  workspaces: Workspace[];
  selectedId: string;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onDelete: (id: string) => void;
}

const ChevronIcon = ({ open }: { open: boolean }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={`shrink-0 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
  >
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

const LockIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
    className="shrink-0">
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
);

const PlusIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
    className="shrink-0">
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

const PencilIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
    className="shrink-0">
    <path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
  </svg>
);

const TrashIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
    className="shrink-0">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
);

interface WorkspaceSwitcherInternalProps extends WorkspaceSwitcherProps {
  open: boolean;
  setOpen: (v: boolean) => void;
}

export function WorkspaceSwitcherDropdown({
  workspaces,
  selectedId,
  onSelect,
  onCreate,
  onDelete,
  open,
  setOpen,
}: WorkspaceSwitcherInternalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { renameWorkspace } = useApp();
  const [editingWorkspace, setEditingWorkspace] = useState<Workspace | null>(null);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, setOpen]);

  const selected = workspaces.find((w) => w.id === selectedId) ?? workspaces[0];

  const handleSelect = (id: string) => {
    setOpen(false);
    onSelect(id);
  };

  const handleCreate = () => {
    setOpen(false);
    onCreate();
  };

  return (
    <>
      <div ref={containerRef} className="relative">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-haspopup="listbox"
          aria-expanded={open}
          className="inline-flex h-9 items-center gap-2 rounded-lg bg-surface-muted px-3 text-sm font-medium text-foreground shadow-soft transition-[transform,box-shadow] hover:shadow-soft-hover max-w-[220px]"
        >
          {selected?.isDefault && (
            <span className="text-primary dark:text-white/80 opacity-90 shrink-0">{LockIcon}</span>
          )}
          <span className="truncate">{selected?.name ?? "Select workspace"}</span>
          <ChevronIcon open={open} />
        </button>

        {open && (
          <div
            role="listbox"
            className="absolute left-0 top-[calc(100%+8px)] z-50 w-64 overflow-hidden rounded-xl border border-border bg-surface p-1 shadow-2xl"
          >

            <div className="px-3 py-1.5 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
              Workspaces
            </div>

            <div className="flex flex-col gap-0.5">
              {workspaces.map((workspace) => {
                const isActive = workspace.id === selectedId;
                const isDeletable = !workspace.isDefault && !isActive;
                const isEditable = !workspace.isDefault;

                return (
                  /* Unified row div - grey background covers name, edit icon, and delete icon in the same div */
                  <div
                    key={workspace.id}
                    className={`group flex items-center justify-between gap-1.5 rounded-lg px-3 py-2 transition-colors ${
                      isActive
                        ? "bg-primary/10 text-primary dark:bg-white/10 dark:text-white font-semibold"
                        : "text-foreground hover:bg-surface-muted dark:hover:bg-white/5"
                    }`}
                  >
                    <button
                      type="button"
                      role="option"
                      aria-selected={isActive}
                      onClick={() => handleSelect(workspace.id)}
                      className="flex flex-1 min-w-0 items-center gap-2 text-left text-sm cursor-pointer py-0.5 focus:outline-none"
                    >
                      {workspace.isDefault && (
                        <span className="text-muted-foreground shrink-0">{LockIcon}</span>
                      )}
                      <span className="truncate">{workspace.name}</span>
                      {workspace.isDefault && (
                        <span className="ml-1 text-[10px] font-semibold text-muted-foreground bg-surface-muted border border-border rounded px-1 py-0.5 shrink-0">
                          Default
                        </span>
                      )}
                    </button>

                    <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                      {isEditable && (
                        <button
                          type="button"
                          title={`Rename ${workspace.name}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpen(false);
                            setEditingWorkspace(workspace);
                          }}
                          className="w-6 h-6 flex items-center justify-center rounded-md text-muted-foreground hover:bg-primary/15 hover:text-primary dark:hover:text-white transition-all cursor-pointer focus:outline-none"
                        >
                          {PencilIcon}
                        </button>
                      )}

                      {isDeletable && (
                        <button
                          type="button"
                          title={`Delete ${workspace.name}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpen(false);
                            onDelete(workspace.id);
                          }}
                          className="w-6 h-6 flex items-center justify-center rounded-md text-muted-foreground hover:bg-red-500/15 hover:text-red-500 transition-all cursor-pointer focus:outline-none"
                        >
                          {TrashIcon}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="my-1 h-px bg-border" />

            <button
              type="button"
              onClick={handleCreate}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-primary dark:text-white transition-colors hover:bg-background dark:hover:bg-white/5 cursor-pointer"
            >
              {PlusIcon}
              <span>Create workspace</span>
            </button>
          </div>
        )}
      </div>

      {/* Rename Workspace Modal */}
      <RenameWorkspaceModal
        isOpen={Boolean(editingWorkspace)}
        workspace={editingWorkspace}
        workspaces={workspaces}
        onClose={() => setEditingWorkspace(null)}
        onRename={async (id, newName) => {
          await renameWorkspace(id, newName);
        }}
        onSendAgentMessage={(text) => {
          sendTextToAgent(text);
        }}
      />
    </>
  );
}

export default function WorkspaceSwitcher(props: WorkspaceSwitcherProps) {
  const [open, setOpen] = useState(false);
  return <WorkspaceSwitcherDropdown {...props} open={open} setOpen={setOpen} />;
}
