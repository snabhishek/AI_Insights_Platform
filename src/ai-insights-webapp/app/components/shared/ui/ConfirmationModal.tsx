"use client";

import React from "react";

interface ConfirmationModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmationModal({
  isOpen,
  title,
  message,
  confirmText = "Yes",
  cancelText = "No",
  onConfirm,
  onCancel,
}: ConfirmationModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-slate-950/50 backdrop-blur-md animate-fade-in">
      <div className="relative w-full max-w-md overflow-hidden rounded-xl border border-border bg-surface shadow-2xl transition-all scale-100 flex flex-col">
        
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-border/80 px-5 py-3 bg-surface-muted/60">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg border shrink-0 bg-amber-500/10 border-amber-500/20 text-amber-500">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01" />
              </svg>
            </div>
            <h3 className="text-sm font-bold text-foreground">{title}</h3>
          </div>
          <button
            onClick={onCancel}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-background hover:text-foreground transition-colors cursor-pointer"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Modal Middle Message Section */}
        <div className="p-5 flex flex-col gap-3 overflow-y-auto text-sm text-foreground">
          <p className="leading-relaxed font-semibold">{message}</p>
        </div>

        {/* Horizontal Line Separator & Footer Section */}
        <div className="border-t border-border/80 px-5 py-3 bg-surface-muted/60 flex justify-end gap-2.5">
          <button
            onClick={onCancel}
            className="h-8 px-4 bg-surface border border-border text-xs font-semibold rounded-lg hover:bg-surface-muted hover:border-foreground/20 text-foreground transition-all cursor-pointer"
          >
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            className="h-8 px-4 bg-red-500 text-white text-xs font-semibold rounded-lg hover:scale-105 active:scale-95 transition-all cursor-pointer"
          >
            {confirmText}
          </button>
        </div>

      </div>
    </div>
  );
}
