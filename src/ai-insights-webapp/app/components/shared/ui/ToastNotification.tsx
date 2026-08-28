"use client";

import React, { useEffect, useState } from "react";

export interface ToastItem {
  id: string;
  title: string;
  message: string;
  type: "success" | "error" | "info" | "warning";
  duration?: number;
}

interface ToastNotificationProps {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
}

const ToastCard = ({
  toast,
  onDismiss,
}: {
  toast: ToastItem;
  onDismiss: (id: string) => void;
}) => {
  const [progress, setProgress] = useState(100);
  const duration = toast.duration || 4500;

  useEffect(() => {
    const startTime = Date.now();
    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const remaining = Math.max(0, 100 - (elapsed / duration) * 100);
      setProgress(remaining);
      if (remaining <= 0) {
        clearInterval(interval);
        onDismiss(toast.id);
      }
    }, 40);

    return () => clearInterval(interval);
  }, [toast.id, duration, onDismiss]);

  const getVariantStyles = () => {
    switch (toast.type) {
      case "success":
        return {
          wrapper: "border-emerald-500/30 dark:border-emerald-500/40 bg-gradient-to-br from-emerald-500/10 via-surface to-surface shadow-emerald-500/10",
          iconBg: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 ring-1 ring-emerald-500/30 shadow-sm shadow-emerald-500/20",
          badge: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20",
          bar: "bg-emerald-500",
          icon: (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
          ),
        };
      case "error":
        return {
          wrapper: "border-rose-500/30 dark:border-rose-500/40 bg-gradient-to-br from-rose-500/10 via-surface to-surface shadow-rose-500/10",
          iconBg: "bg-rose-500/15 text-rose-600 dark:text-rose-400 ring-1 ring-rose-500/30 shadow-sm shadow-rose-500/20",
          badge: "bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/20",
          bar: "bg-rose-500",
          icon: (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          ),
        };
      case "warning":
        return {
          wrapper: "border-amber-500/30 dark:border-amber-500/40 bg-gradient-to-br from-amber-500/10 via-surface to-surface shadow-amber-500/10",
          iconBg: "bg-amber-500/15 text-amber-600 dark:text-amber-400 ring-1 ring-amber-500/30 shadow-sm shadow-amber-500/20",
          badge: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20",
          bar: "bg-amber-500",
          icon: (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
          ),
        };
      case "info":
      default:
        return {
          wrapper: "border-sky-500/30 dark:border-sky-500/40 bg-gradient-to-br from-sky-500/10 via-surface to-surface shadow-sky-500/10",
          iconBg: "bg-sky-500/15 text-sky-600 dark:text-sky-400 ring-1 ring-sky-500/30 shadow-sm shadow-sky-500/20",
          badge: "bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/20",
          bar: "bg-sky-500",
          icon: (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
            </svg>
          ),
        };
    }
  };

  const style = getVariantStyles();

  return (
    <div
      className={`relative overflow-hidden rounded-xl border backdrop-blur-xl shadow-xl transition-all duration-300 transform translate-x-0 opacity-100 flex flex-col p-4 pointer-events-auto min-w-[320px] max-w-[400px] ${style.wrapper}`}
      style={{
        animation: "slideInRight 0.32s cubic-bezier(0.16, 1, 0.3, 1) forwards",
      }}
    >
      <div className="flex items-start gap-3.5">
        {/* Modern Icon Badge */}
        <div className={`p-2 rounded-xl shrink-0 flex items-center justify-center transition-transform hover:scale-105 ${style.iconBg}`}>
          {style.icon}
        </div>

        {/* Content Body */}
        <div className="flex-1 min-w-0 pr-1">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-sm font-bold text-foreground tracking-tight leading-snug truncate">
              {toast.title}
            </h4>
            <button
              onClick={() => onDismiss(toast.id)}
              className="rounded-lg p-1 text-muted-foreground hover:bg-background/80 hover:text-foreground transition-colors cursor-pointer shrink-0"
              aria-label="Dismiss notification"
            >
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          {toast.message && (
            <p className="mt-1 text-xs text-muted-foreground leading-relaxed line-clamp-3 font-normal">
              {toast.message}
            </p>
          )}
        </div>
      </div>

      {/* Subtle Auto-Dismiss Progress Bar */}
      <div className="absolute bottom-0 left-0 right-0 h-[2.5px] bg-foreground/5 overflow-hidden">
        <div
          className={`h-full transition-all duration-75 ease-linear ${style.bar}`}
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
};

export default function ToastNotification({
  toasts,
  onDismiss,
}: ToastNotificationProps) {
  if (!toasts || toasts.length === 0) return null;

  return (
    <>
      <style jsx global>{`
        @keyframes slideInRight {
          from {
            opacity: 0;
            transform: translateX(32px) scale(0.96);
          }
          to {
            opacity: 1;
            transform: translateX(0) scale(1);
          }
        }
      `}</style>
      <div className="fixed top-5 right-5 z-[250] flex flex-col gap-3 pointer-events-none select-none max-w-full">
        {toasts.map((toast) => (
          <ToastCard key={toast.id} toast={toast} onDismiss={onDismiss} />
        ))}
      </div>
    </>
  );
}
