"use client";

import { useEffect, useRef } from "react";

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

const CheckIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
    className="shrink-0">
    <polyline points="20 6 9 17 4 12" />
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

interface WorkspaceSwitcherInternalProps extends WorkspaceSwitcherProps {
  open: boolean;
  setOpen: (v: boolean) => void;
}

export function WorkspaceSwitcherDropdown({
  workspaces,
  selectedId,
  onSelect,
  onCreate,
  open,
  setOpen,
}: WorkspaceSwitcherInternalProps) {
  const containerRef = useRef<HTMLDivElement>(null);

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
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="inline-flex h-9 items-center gap-2 rounded-lg bg-surface-muted px-3 text-sm font-medium text-foreground shadow-soft transition-[transform,box-shadow] hover:shadow-soft-hover max-w-[220px]"
      >
        {selected?.isDefault && (
          <span className="text-primary opacity-70 shrink-0">{LockIcon}</span>
        )}
        <span className="truncate">{selected?.name ?? "Select workspace"}</span>
        <ChevronIcon open={open} />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute left-0 top-[calc(100%+8px)] z-50 w-64 overflow-hidden rounded-xl border border-border bg-surface p-1 shadow-2xl"
        >
          {/* Section label */}
          <div className="px-3 py-1.5 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
            Workspaces
          </div>

          {workspaces.map((workspace) => {
            const isActive = workspace.id === selectedId;
            return (
              <button
                key={workspace.id}
                type="button"
                role="option"
                aria-selected={isActive}
                onClick={() => handleSelect(workspace.id)}
                className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-left text-sm transition-colors ${
                  isActive ? "bg-primary/10 text-primary" : "text-foreground hover:bg-background"
                }`}
              >
                <span className="flex items-center gap-2 truncate min-w-0">
                  {workspace.isDefault && (
                    <span className="text-muted-foreground shrink-0">{LockIcon}</span>
                  )}
                  <span className="truncate">{workspace.name}</span>
                  {workspace.isDefault && (
                    <span className="ml-1 text-[10px] font-semibold text-muted-foreground bg-surface-muted border border-border rounded px-1 py-0.5 shrink-0">
                      Default
                    </span>
                  )}
                </span>
                {isActive && (
                  <span className="text-primary shrink-0">{CheckIcon}</span>
                )}
              </button>
            );
          })}

          <div className="my-1 h-px bg-border" />

          <button
            type="button"
            onClick={handleCreate}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-primary transition-colors hover:bg-background"
          >
            {PlusIcon}
            <span>Create workspace</span>
          </button>
        </div>
      )}
    </div>
  );
}

import { useState } from "react";

export default function WorkspaceSwitcher(props: WorkspaceSwitcherProps) {
  const [open, setOpen] = useState(false);
  return <WorkspaceSwitcherDropdown {...props} open={open} setOpen={setOpen} />;
}
