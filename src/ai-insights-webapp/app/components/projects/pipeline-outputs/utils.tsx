"use client";

import React from "react";

// ─── Custom Badge ────────────────────────────────────────────────────────────
interface BadgeProps {
  children: React.ReactNode;
  variant?: "success" | "warning" | "error" | "info" | "primary" | "secondary" | "neutral" | "purple" | "teal";
  className?: string;
}

export function Badge({ children, variant = "neutral", className = "" }: BadgeProps) {
  const baseClasses = "inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold border transition-all select-none";
  
  const variantClasses: Record<string, string> = {
    success: "bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400 border-emerald-100 dark:border-emerald-900/60 shadow-sm",
    warning: "bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-400 border-amber-100 dark:border-amber-900/60 shadow-sm",
    error: "bg-rose-50 dark:bg-rose-950/20 text-rose-700 dark:text-rose-400 border-rose-100 dark:border-rose-900/60 shadow-sm",
    info: "bg-sky-50 dark:bg-sky-950/20 text-sky-700 dark:text-sky-400 border-sky-100 dark:border-sky-900/60 shadow-sm",
    primary: "bg-indigo-50 dark:bg-indigo-950/20 text-indigo-700 dark:text-indigo-400 border-indigo-100 dark:border-indigo-900/60 shadow-sm",
    secondary: "bg-violet-50 dark:bg-violet-950/20 text-violet-700 dark:text-violet-400 border-violet-100 dark:border-violet-900/60 shadow-sm",
    purple: "bg-fuchsia-50 dark:bg-fuchsia-950/20 text-fuchsia-700 dark:text-fuchsia-400 border-fuchsia-100 dark:border-fuchsia-900/60 shadow-sm",
    teal: "bg-teal-50 dark:bg-teal-950/20 text-teal-700 dark:text-teal-400 border-teal-100 dark:border-teal-900/60 shadow-sm",
    neutral: "bg-surface-muted border-border text-muted-foreground shadow-sm",
  };

  return (
    <span className={`${baseClasses} ${variantClasses[variant]} ${className}`}>
      {children}
    </span>
  );
}

// ─── Data Type Icon ───────────────────────────────────────────────────────────
interface DataTypeIconProps {
  type?: string;
  className?: string;
}

export function DataTypeIcon({ type = "string", className = "w-3.5 h-3.5" }: DataTypeIconProps) {
  const normType = type.toLowerCase();
  
  if (normType.includes("int") || normType.includes("num") || normType.includes("float") || normType.includes("double") || normType.includes("decimal")) {
    return (
      <svg viewBox="0 0 24 24" className={`${className} text-blue-500`} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M9 17v-8l-2 1M14 9h3M14 13h3M14 17h3" />
      </svg>
    );
  }

  if (normType.includes("date") || normType.includes("time") || normType.includes("timestamp")) {
    return (
      <svg viewBox="0 0 24 24" className={`${className} text-emerald-500`} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
      </svg>
    );
  }

  if (normType.includes("bool") || normType.includes("bit")) {
    return (
      <svg viewBox="0 0 24 24" className={`${className} text-teal-500`} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
        <polyline points="22 4 12 14.01 9 11.01" />
      </svg>
    );
  }

  // Fallback as String / Categorical Text
  return (
    <svg viewBox="0 0 24 24" className={`${className} text-indigo-500`} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7V4h16v3M9 20h6M12 4v16" />
    </svg>
  );
}

// ─── Value Distribution Bar Chart ─────────────────────────────────────────────
interface MiniBarChartProps {
  percentage: number;
  value: string;
  count: number;
  barColorClass?: string;
}

export function MiniBarChart({ percentage, value, count, barColorClass = "bg-indigo-500/80 dark:bg-indigo-400/80" }: MiniBarChartProps) {
  return (
    <div className="space-y-1 w-full text-[11px]">
      <div className="flex justify-between font-medium text-foreground select-all">
        <span className="truncate max-w-[70%] font-mono pr-2" title={value}>
          {value === "" ? <span className="italic text-muted-foreground/60">[empty string]</span> : value}
        </span>
        <span className="text-muted-foreground font-mono shrink-0 select-none">
          {count} ({percentage.toFixed(1)}%)
        </span>
      </div>
      <div className="w-full h-2 rounded-full bg-surface-muted border border-border/40 overflow-hidden select-none">
        <div 
          className={`h-full rounded-full ${barColorClass} transition-all duration-500`}
          style={{ width: `${Math.min(100, Math.max(0, percentage))}%` }}
        />
      </div>
    </div>
  );
}

// ─── Stat Card Component ──────────────────────────────────────────────────────
interface StatCardProps {
  label: string;
  value: string | number;
  subtext?: string;
  icon?: React.ReactNode;
  variant?: "indigo" | "emerald" | "amber" | "rose" | "slate";
}

export function StatCard({ label, value, subtext, icon, variant = "slate" }: StatCardProps) {
  const gradientStyles: Record<string, string> = {
    indigo: "from-indigo-500/5 to-violet-500/5 border-indigo-500/10 dark:border-indigo-400/10 hover:border-indigo-500/20",
    emerald: "from-emerald-500/5 to-teal-500/5 border-emerald-500/10 dark:border-emerald-400/10 hover:border-emerald-500/20",
    amber: "from-amber-500/5 to-orange-500/5 border-amber-500/10 dark:border-amber-400/10 hover:border-amber-500/20",
    rose: "from-rose-500/5 to-pink-500/5 border-rose-500/10 dark:border-rose-400/10 hover:border-rose-500/20",
    slate: "from-slate-500/5 to-zinc-500/5 border-border hover:border-muted-foreground/30",
  };

  return (
    <div className={`p-4 rounded-xl border bg-gradient-to-br bg-surface/50 shadow-soft transition-all duration-200 flex items-start justify-between gap-3 ${gradientStyles[variant]}`}>
      <div className="space-y-1 min-w-0">
        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block truncate">
          {label}
        </span>
        <span className="text-xl font-extrabold tracking-tight text-foreground font-mono select-all truncate block">
          {value}
        </span>
        {subtext && (
          <span className="text-[10px] text-muted-foreground/80 block truncate font-medium">
            {subtext}
          </span>
        )}
      </div>
      {icon && (
        <div className="p-1.5 rounded-lg bg-surface border border-border/50 shrink-0 text-muted-foreground shadow-sm">
          {icon}
        </div>
      )}
    </div>
  );
}

// ─── Section Header ───────────────────────────────────────────────────────────
interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  badgeText?: string;
}

export function SectionHeader({ title, subtitle, badgeText }: SectionHeaderProps) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border/60 pb-3 mb-4 select-none">
      <div>
        <h3 className="text-sm font-bold text-foreground tracking-tight">{title}</h3>
        {subtitle && <p className="text-[10px] text-muted-foreground mt-0.5">{subtitle}</p>}
      </div>
      {badgeText && (
        <span className="px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-wider rounded border border-border bg-surface-muted text-muted-foreground">
          {badgeText}
        </span>
      )}
    </div>
  );
}

// ─── Dynamic JSON Table Renderer ──────────────────────────────────────────────
export function DynamicTable({ data, className = "" }: { data: any[]; className?: string }) {
  if (!Array.isArray(data) || data.length === 0) {
    return (
      <div className="p-4 text-center text-xs text-muted-foreground bg-surface-muted/20 border border-dashed border-border select-none">
        No preview data available.
      </div>
    );
  }

  // Get all unique keys across all JSON objects in the array
  const keys = Array.from(new Set(data.flatMap(item => Object.keys(item || {}))));

  const formatHeader = (key: string): string => {
    return key
      .replace(/([A-Z])/g, " $1")
      .replace(/_/g, " ")
      .trim()
      .replace(/^\w/, (c) => c.toUpperCase());
  };

  const renderCell = (key: string, val: any) => {
    if (val === null || val === undefined) return <span className="text-muted-foreground/60">—</span>;

    // Custom Formatter 1: Data Type or Inferred Type
    if ((key === "dataType" || key === "inferredType") && typeof val === "string") {
      return (
        <span className="inline-flex items-center gap-1 font-mono font-bold text-foreground">
          <DataTypeIcon type={val} className="w-3 h-3" />
          <span className="capitalize">{val}</span>
        </span>
      );
    }

    // Custom Formatter 2: Technical Name / Column / Field Names
    if ((key === "technicalName" || key === "name" || key === "datasetField" || key === "columnName") && typeof val === "string") {
      return <span className="font-mono font-bold text-foreground select-all">{val}</span>;
    }
    if ((key === "technicalName" || key === "name" || key === "datasetField" || key === "columnName") && typeof val === "object") {
      const resolvedName = val.technicalName || val.name || "unknown";
      return <span className="font-mono font-bold text-foreground select-all">{resolvedName}</span>;
    }

    // Custom Formatter 3: Nullable
    if (key === "nullable") {
      const isNullable = val === true || val === "YES" || val === "YES/NO/POSSIBLE" || String(val).toLowerCase() === "yes";
      return (
        <Badge variant={isNullable ? "neutral" : "error"} className="font-mono font-medium">
          {isNullable ? "nullable" : "not null"}
        </Badge>
      );
    }

    // Custom Formatter 4: Confidence or Business Importance
    if ((key === "confidence" || key === "businessImportance" || key === "importance" || key === "priority") && typeof val === "string") {
      const normVal = val.toUpperCase();
      return (
        <Badge variant={normVal === "HIGH" ? "primary" : normVal === "MEDIUM" ? "warning" : "neutral"}>
          {val}
        </Badge>
      );
    }

    // Custom Formatter 5: Candidate Business Key
    if (key === "candidateBusinessKey" && typeof val === "string") {
      const isKey = val === "YES" || val === "POSSIBLE";
      if (!isKey) return <span className="text-muted-foreground/60">—</span>;
      return (
        <Badge variant="purple" className="text-[9px]">
          Key: {val}
        </Badge>
      );
    }

    // Custom Formatter 6: Target Analytical Topic
    if (key === "targetTopic" && typeof val === "string") {
      const getTopicBadgeVariant = (topic: string) => {
        const norm = topic.toLowerCase();
        if (norm.includes("customer")) return "primary";
        if (norm.includes("order") || norm.includes("sale") || norm.includes("revenue")) return "teal";
        if (norm.includes("product") || norm.includes("inventory")) return "purple";
        if (norm.includes("finance") || norm.includes("payment")) return "success";
        return "neutral";
      };
      return (
        <Badge variant={getTopicBadgeVariant(val)}>
          {val}
        </Badge>
      );
    }

    // Custom Formatter 7: Top Values Distribution list or Sample Values list
    if (key === "topValues" && Array.isArray(val)) {
      if (val.length === 0) return <span className="text-muted-foreground/60 italic text-[10px]">No values</span>;
      return (
        <div className="space-y-1.5 py-1 min-w-[200px] select-text">
          {val.slice(0, 3).map((tv: any, tvIdx: number) => {
            const valStr = typeof tv === "object" && tv !== null ? String(tv.value ?? "") : String(tv);
            const count = typeof tv === "object" && tv !== null ? (tv.count ?? 0) : 0;
            const pct = typeof tv === "object" && tv !== null ? (tv.percentage ?? 0) : 0;
            return (
              <MiniBarChart 
                key={tvIdx} 
                percentage={pct} 
                value={valStr} 
                count={count}
              />
            );
          })}
          {val.length > 3 && (
            <span className="text-[9px] text-muted-foreground block text-right font-bold select-none">
              + {val.length - 3} more
            </span>
          )}
        </div>
      );
    }

    if (key === "sampleValues" && Array.isArray(val)) {
      if (val.length === 0) return <span className="text-muted-foreground/60 italic text-[10px]">No samples</span>;
      return (
        <div className="flex flex-wrap gap-1 max-w-[250px]">
          {val.slice(0, 5).map((v: any, idx: number) => (
            <span key={idx} className="px-1.5 py-0.5 rounded bg-surface-muted text-foreground border border-border/60 font-mono text-[10px] truncate max-w-[120px]" title={String(v)}>
              {String(v)}
            </span>
          ))}
          {val.length > 5 && (
            <span className="text-[9px] text-muted-foreground font-bold self-center">
              +{val.length - 5}
            </span>
          )}
        </div>
      );
    }

    // Custom Formatter 8: Percentiles & Outliers in Statistics
    if (key === "percentiles" && typeof val === "object" && val !== null) {
      const p = val as Record<string, any>;
      return (
        <span className="font-mono text-[10px] text-foreground/90">
          p25: {p.p25 ?? "n/a"} | p50: {p.p50 ?? "n/a"} | p75: {p.p75 ?? "n/a"}
        </span>
      );
    }

    if (key === "outliers" && typeof val === "object" && val !== null) {
      const o = val as Record<string, any>;
      const count = o.count ?? 0;
      return (
        <Badge variant={count > 0 ? "error" : "success"}>
          {count > 0 ? `${count} Outliers` : "None"}
        </Badge>
      );
    }

    // Custom Formatter 9: Constraints Array
    if (key === "constraints" && Array.isArray(val)) {
      if (val.length === 0) return <span className="text-muted-foreground/60">—</span>;
      return (
        <div className="flex flex-wrap gap-1">
          {val.map((c: any, cIdx: number) => (
            <Badge key={cIdx} variant="secondary" className="font-mono text-[9px]">
              {String(c.type || c)}
            </Badge>
          ))}
        </div>
      );
    }

    // Custom Formatter 10: Patterns Array
    if (key === "patterns" && Array.isArray(val)) {
      if (val.length === 0) return <span className="text-muted-foreground/60">—</span>;
      return (
        <div className="flex flex-wrap gap-1">
          {val.map((p: any, pIdx: number) => (
            <Badge key={pIdx} variant="teal" className="font-mono text-[9px]">
              {String(p)}
            </Badge>
          ))}
        </div>
      );
    }

    // Default renderer
    if (typeof val === "object") {
      if (Array.isArray(val)) {
        if (val.length === 0) return <span className="text-muted-foreground/60 italic text-[10px]">—</span>;
        if (val.every(x => typeof x !== "object")) return val.join(", ");
        return `[${val.length} items]`;
      }
      return JSON.stringify(val);
    }

    return <span className="text-foreground/90">{String(val)}</span>;
  };

  return (
    <div className={`overflow-x-auto border border-border/80 bg-surface select-none ${className}`}>
      <table className="w-full text-left border-collapse text-[11px]">
        <thead>
          <tr className="border-b border-border text-muted-foreground text-[10px] uppercase font-black bg-surface-muted/30 select-none">
            {keys.map((key) => (
              <th key={key} className="py-2.5 px-3 font-semibold tracking-wider whitespace-nowrap">
                {formatHeader(key)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60 bg-surface">
          {data.map((row, rIdx) => (
            <tr key={rIdx} className="hover:bg-surface-muted/20 transition-colors select-text">
              {keys.map((key) => (
                <td key={key} className="py-3 px-3 align-top leading-relaxed select-all">
                  {renderCell(key, row[key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

