"use client";

import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Archive, Box, ChevronDown, Download, FileCode, Loader2 } from "lucide-react";
import { BACKEND_URL } from "../../providers/AppContext";

interface ModelExportFormat {
  formatId: string;
  extension: string;
  formatName?: string;
  filename?: string;
}

interface ModelExportButtonProps {
  projectId?: string;
  runTimestamp?: string;
  modelId: string;
  displayName: string;
}

interface DropdownCoords {
  top: number;
  left: number;
  openUpwards: boolean;
}

export default function ModelExportButton({
  projectId,
  runTimestamp,
  modelId,
  displayName,
}: ModelExportButtonProps) {
  const menuId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const [isOpen, setIsOpen] = useState(false);
  const [formats, setFormats] = useState<ModelExportFormat[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [coords, setCoords] = useState<DropdownCoords | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const getExportUrl = useCallback(() => {
    if (!projectId || !runTimestamp) throw new Error("Project and run timestamp are required.");
    return `${BACKEND_URL}/model-exports/${encodeURIComponent(projectId)}/models/${encodeURIComponent(
      modelId
    )}?${new URLSearchParams({ runTimestamp })}`;
  }, [projectId, runTimestamp, modelId]);

  const updatePosition = useCallback(() => {
    if (!buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const menuWidth = 288;
    const menuEstimatedHeight = 240;
    const spaceBelow = window.innerHeight - rect.bottom;
    const openUpwards = spaceBelow < menuEstimatedHeight && rect.top > menuEstimatedHeight;

    let left = rect.right - menuWidth + window.scrollX;
    if (left < 10) left = 10;
    if (left + menuWidth > window.innerWidth - 10) {
      left = window.innerWidth - menuWidth - 10;
    }

    const top = openUpwards
      ? rect.top + window.scrollY - 6
      : rect.bottom + window.scrollY + 6;

    setCoords({ top, left, openUpwards });
  }, []);

  const fetchFormats = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(getExportUrl(), { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`Unable to load model formats (${response.status}).`);
      }
      const result: { formats: ModelExportFormat[] } = await response.json();
      setFormats(result.formats || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [getExportUrl]);

  const toggleMenu = async () => {
    if (isOpen) {
      setIsOpen(false);
      return;
    }
    updatePosition();
    setIsOpen(true);
    if (formats.length === 0 && !loading) {
      void fetchFormats();
    }
  };

  useEffect(() => {
    if (!isOpen) return;

    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (
        menuRef.current &&
        !menuRef.current.contains(target) &&
        buttonRef.current &&
        !buttonRef.current.contains(target)
      ) {
        setIsOpen(false);
      }
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setIsOpen(false);
      }
    }

    function handleScrollOrResize() {
      updatePosition();
    }

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("scroll", handleScrollOrResize, true);
    window.addEventListener("resize", handleScrollOrResize);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("scroll", handleScrollOrResize, true);
      window.removeEventListener("resize", handleScrollOrResize);
    };
  }, [isOpen, updatePosition]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        disabled={!projectId || !runTimestamp}
        onClick={() => void toggleMenu()}
        aria-haspopup="menu"
        aria-controls={isOpen ? menuId : undefined}
        aria-expanded={isOpen}
        className={`group inline-flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all duration-200 select-none ${
          !projectId || !runTimestamp
            ? "opacity-40 cursor-not-allowed border-border/50 bg-surface-muted/40 text-muted-foreground"
            : isOpen
            ? "border-primary ring-2 ring-primary/20 bg-primary/10 text-primary shadow-xs cursor-pointer"
            : "border-border/80 bg-surface hover:bg-surface-muted text-foreground hover:border-primary/50 hover:text-primary shadow-2xs hover:shadow-xs active:scale-95 cursor-pointer"
        }`}
        title={`Export ${displayName} artifacts`}
      >
        <Download
          size={14}
          className={`transition-transform duration-200 shrink-0 ${
            isOpen ? "text-primary scale-110" : "text-muted-foreground group-hover:text-primary group-hover:scale-110"
          }`}
        />
        <span className="tracking-tight">Export</span>
        <ChevronDown
          size={13}
          className={`transition-transform duration-200 shrink-0 ${
            isOpen ? "rotate-180 text-primary" : "text-muted-foreground/70 group-hover:text-primary"
          }`}
        />
      </button>

      {isOpen &&
        mounted &&
        coords &&
        createPortal(
          <div
            id={menuId}
            ref={menuRef}
            style={{
              top: coords.openUpwards ? undefined : `${coords.top}px`,
              bottom: coords.openUpwards ? `${window.innerHeight - coords.top}px` : undefined,
              left: `${coords.left}px`,
            }}
            className="fixed z-[99999] w-72 rounded-2xl border border-border/80 bg-surface/98 dark:bg-zinc-900/98 backdrop-blur-xl shadow-2xl p-1.5 text-foreground animate-scale-up select-none ring-1 ring-black/5 dark:ring-white/5"
            role="menu"
            aria-orientation="vertical"
          >
            {/* Header */}
            <div className="px-3 py-2 border-b border-border/50 flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 min-w-0">
                <Box size={13} className="text-primary shrink-0" />
                <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground truncate">
                  Available Formats
                </span>
              </div>
              {formats.length > 0 && !loading && (
                <span className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 shrink-0">
                  {formats.length} files
                </span>
              )}
            </div>

            {/* Loading State */}
            {loading && (
              <div className="py-6 px-3 flex flex-col items-center justify-center gap-2 text-xs text-muted-foreground">
                <Loader2 size={18} className="animate-spin text-primary" />
                <span>Loading export formats...</span>
              </div>
            )}

            {/* Error State */}
            {error && !loading && (
              <div className="p-3 my-1 rounded-xl bg-destructive/10 border border-destructive/20 text-xs text-destructive space-y-1.5">
                <div className="font-semibold flex items-center gap-1.5">
                  <span>Failed to load formats</span>
                </div>
                <p className="text-[11px] text-muted-foreground break-words">{error}</p>
                <button
                  type="button"
                  onClick={() => void fetchFormats()}
                  className="text-[11px] font-semibold text-primary hover:underline cursor-pointer pt-0.5 inline-block"
                >
                  Retry
                </button>
              </div>
            )}

            {/* Empty State */}
            {!loading && !error && formats.length === 0 && (
              <div className="py-5 px-3 text-center text-xs text-muted-foreground">
                No export formats available for this model
              </div>
            )}

            {/* Format Items List */}
            {!loading && !error && formats.length > 0 && (
              <div className="py-1 space-y-0.5 max-h-56 overflow-y-auto">
                {formats.map((format) => (
                  <a
                    key={format.formatId}
                    href={`${getExportUrl()}&${new URLSearchParams({ format: format.formatId })}`}
                    onClick={() => setIsOpen(false)}
                    download
                    className="group flex items-center justify-between gap-2.5 px-2.5 py-2 rounded-xl text-xs hover:bg-surface-muted dark:hover:bg-zinc-800/90 text-foreground transition-all duration-150 cursor-pointer border border-transparent hover:border-border/60"
                    role="menuitem"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-7 h-7 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-primary group-hover:scale-105 transition-transform shrink-0">
                        <FileCode size={14} />
                      </div>
                      <div className="min-w-0">
                        <div className="font-semibold text-foreground truncate text-xs group-hover:text-primary transition-colors">
                          {format.formatName || format.formatId}
                        </div>
                        <div className="text-[10px] text-muted-foreground truncate font-mono">
                          {format.filename || format.formatId}
                        </div>
                      </div>
                    </div>
                    <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded bg-muted/80 dark:bg-zinc-800 text-foreground border border-border/80 shrink-0">
                      {format.extension}
                    </span>
                  </a>
                ))}
              </div>
            )}

            {/* Download All Footer */}
            {!loading && !error && formats.length > 0 && (
              <div className="pt-1 mt-1 border-t border-border/50">
                <a
                  href={`${getExportUrl()}&format=all`}
                  onClick={() => setIsOpen(false)}
                  download
                  className="group flex items-center justify-between gap-2 px-2.5 py-2 rounded-xl text-xs font-semibold bg-primary/10 hover:bg-primary/20 text-primary border border-primary/25 hover:border-primary/40 transition-all duration-150 cursor-pointer"
                  role="menuitem"
                >
                  <div className="flex items-center gap-2">
                    <Archive size={14} className="group-hover:scale-110 transition-transform" />
                    <span>Download All Formats</span>
                  </div>
                  <span className="text-[9px] font-mono uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-primary text-primary-foreground shadow-2xs">
                    ZIP
                  </span>
                </a>
              </div>
            )}
          </div>,
          document.body
        )}
    </>
  );
}
