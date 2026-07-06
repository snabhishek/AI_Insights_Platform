"use client";

import { useEffect, useRef, useState } from "react";

export interface Workspace {
  id: string;
  name: string;
}

interface WorkspaceSwitcherProps {
  workspaces?: Workspace[];
  selectedId?: string;
  onSelect?: (id: string) => void;
  onCreate?: () => void;
}

const DEFAULT_WORKSPACES: Workspace[] = [
  { id: "personal", name: "Personal Workspace" },
  { id: "team", name: "Team Workspace" },
];

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
    className={`shrink-0 transition-transform duration-200 ${
      open ? "rotate-180" : ""
    }`}
  >
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

const CheckIcon = (
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
    className="shrink-0"
  >
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const PlusIcon = (
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
    className="shrink-0"
  >
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

export default function WorkspaceSwitcher({
  workspaces = DEFAULT_WORKSPACES,
  selectedId,
  onSelect,
  onCreate,
}: WorkspaceSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [activeId, setActiveId] = useState(selectedId ?? workspaces[0]?.id);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
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
  }, [open]);

  const selected = workspaces.find((w) => w.id === activeId) ?? workspaces[0];

  const handleSelect = (id: string) => {
    setActiveId(id);
    setOpen(false);
    onSelect?.(id);
  };

  const handleCreate = () => {
    setOpen(false);
    onCreate?.();
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="inline-flex h-9 items-center gap-2 rounded-lg bg-surface-muted px-3 text-sm font-medium text-foreground shadow-soft transition-[transform,box-shadow] hover:shadow-soft-hover"
      >
        <span className="max-w-[160px] truncate">{selected?.name}</span>
        <ChevronIcon open={open} />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute left-0 top-[calc(100%+8px)] z-50 w-60 overflow-hidden rounded-lg border border-border bg-surface p-1 shadow-soft-hover"
        >
          {workspaces.map((workspace) => {
            const isActive = workspace.id === selected?.id;
            return (
              <button
                key={workspace.id}
                type="button"
                role="option"
                aria-selected={isActive}
                onClick={() => handleSelect(workspace.id)}
                className="flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-background"
              >
                <span className="truncate">{workspace.name}</span>
                {isActive && (
                  <span className="text-primary">{CheckIcon}</span>
                )}
              </button>
            );
          })}

          <div className="my-1 h-px bg-border" />

          <button
            type="button"
            onClick={handleCreate}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm font-medium text-primary transition-colors hover:bg-background"
          >
            {PlusIcon}
            <span>Create workspace</span>
          </button>
        </div>
      )}
    </div>
  );
}
