"use client";

import React, { useState } from "react";

interface PreFlightStepOutputProps {
  preFlight: any;
  projectId?: string;
  activeRunTimestamp?: string;
}

// ─── Inline SVG Icons ────────────────────────────────────────────────────────
function CheckCircleIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  );
}

function AlertTriangleIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function XCircleIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="15" y1="9" x2="9" y2="15" />
      <line x1="9" y1="9" x2="15" y2="15" />
    </svg>
  );
}

function CpuIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <rect x="9" y="9" width="6" height="6" />
      <line x1="9" y1="1" x2="9" y2="4" />
      <line x1="15" y1="1" x2="15" y2="4" />
      <line x1="9" y1="20" x2="9" y2="23" />
      <line x1="15" y1="20" x2="15" y2="23" />
      <line x1="20" y1="9" x2="23" y2="9" />
      <line x1="20" y1="14" x2="23" y2="14" />
      <line x1="1" y1="9" x2="4" y2="9" />
      <line x1="1" y1="14" x2="4" y2="14" />
    </svg>
  );
}

function ClockIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function HardDriveIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="22" y1="12" x2="2" y2="12" />
      <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
      <line x1="6" y1="16" x2="6.01" y2="16" />
      <line x1="10" y1="16" x2="10.01" y2="16" />
    </svg>
  );
}

function ServerIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
      <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
      <line x1="6" y1="6" x2="6.01" y2="6" />
      <line x1="6" y1="18" x2="6.01" y2="18" />
    </svg>
  );
}

function ZapIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  );
}

function LayersIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 2 7 12 12 22 7 12 2" />
      <polyline points="2 17 12 22 22 17" />
      <polyline points="2 12 12 17 22 12" />
    </svg>
  );
}

function ArrowRightIcon({ className = "w-3 h-3" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  );
}

export default function PreFlightStepOutput({ preFlight }: PreFlightStepOutputProps) {
  const [filterCategory, setFilterCategory] = useState<string>("ALL");

  if (!preFlight) {
    return (
      <div className="p-8 text-center text-muted-foreground flex flex-col items-center justify-center min-h-[200px]">
        <ServerIcon className="w-8 h-8 text-muted-foreground/50 mb-2" />
        <p className="text-sm font-semibold text-foreground">Pre Flight Analysis</p>
        <p className="text-xs text-muted-foreground mt-1">
          Pre-flight verification output has not been produced yet.
        </p>
      </div>
    );
  }

  const decision = preFlight.decision || (preFlight.status === "Failed" ? "BLOCKED" : "APPROVED");
  const checks: any[] = Array.isArray(preFlight.checks) ? preFlight.checks : [];
  const recs: any[] = Array.isArray(preFlight.recommendations) ? preFlight.recommendations : [];
  const system = preFlight.system || {};
  const estimates = preFlight.estimates || {};

  const passedCount = checks.filter((c) => c.status === "PASSED").length;
  const warningCount = checks.filter((c) => c.status === "WARNING").length;
  const failedCount = checks.filter((c) => c.status === "FAILED").length;

  const getDecisionBadge = () => {
    switch (decision) {
      case "APPROVED":
        return {
          bg: "bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400",
          icon: <CheckCircleIcon className="w-5 h-5 text-emerald-500" />,
          label: "APPROVED FOR TRAINING",
        };
      case "APPROVED_WITH_WARNINGS":
        return {
          bg: "bg-amber-500/10 border-amber-500/30 text-amber-600 dark:text-amber-400",
          icon: <AlertTriangleIcon className="w-5 h-5 text-amber-500" />,
          label: "APPROVED WITH WARNINGS",
        };
      case "REQUIRES_CONFIGURATION_CHANGE":
        return {
          bg: "bg-orange-500/10 border-orange-500/30 text-orange-600 dark:text-orange-400",
          icon: <AlertTriangleIcon className="w-5 h-5 text-orange-500" />,
          label: "CONFIGURATION CHANGE REQUIRED",
        };
      case "REQUIRES_USER_CONFIRMATION":
        return {
          bg: "bg-purple-500/10 border-purple-500/30 text-purple-600 dark:text-purple-400",
          icon: <CpuIcon className="w-5 h-5 text-purple-500" />,
          label: "AWAITING CONFIRMATION",
        };
      case "BLOCKED":
      case "FAILED":
      default:
        return {
          bg: "bg-rose-500/10 border-rose-500/30 text-rose-600 dark:text-rose-400",
          icon: <XCircleIcon className="w-5 h-5 text-rose-500" />,
          label: "BLOCKED / FAILED",
        };
    }
  };

  const decisionBadge = getDecisionBadge();

  // Filter checks
  const filteredChecks = checks.filter((c) => {
    if (filterCategory === "ALL") return true;
    if (filterCategory === "WARNINGS_FAILED") return c.status === "WARNING" || c.status === "FAILED";
    if (filterCategory === "RESOURCE_SAFETY") return c.stage === 6 || c.stage === 7;
    if (filterCategory === "CONFIGURATION") return c.stage === 2 || c.stage === 3;
    if (filterCategory === "DATA_FEATURES") return c.stage === 4;
    return true;
  });

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* 1. Decision Status Header */}
      <div className={`p-5 rounded-2xl border ${decisionBadge.bg} flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-sm backdrop-blur-sm`}>
        <div className="flex items-start gap-3.5">
          <div className="p-2 rounded-xl bg-surface/80 border border-border shadow-xs mt-0.5">
            {decisionBadge.icon}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-black tracking-wider uppercase">Pre-Flight Assessment</span>
              <span className="text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider bg-surface border border-border">
                {decisionBadge.label}
              </span>
              {preFlight.pythonServiceStatus && (
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase ${
                  preFlight.pythonServiceStatus === "online"
                    ? "bg-emerald-500/10 text-emerald-600 border border-emerald-500/20"
                    : preFlight.pythonServiceStatus === "fallback_cli"
                    ? "bg-blue-500/10 text-blue-600 border border-blue-500/20"
                    : "bg-muted text-muted-foreground border border-border"
                }`}>
                  PyService: {preFlight.pythonServiceStatus}
                </span>
              )}
            </div>
            <p className="text-sm font-semibold text-foreground mt-1">
              {preFlight.summary || "Pre-flight verification completed."}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Verified: {preFlight.verifiedAt ? new Date(preFlight.verifiedAt).toLocaleString() : "Just now"} • {preFlight.modelCount || 1} candidate model(s) assessed
            </p>
          </div>
        </div>

        {/* Action / Gate Indicator */}
        <div className="flex items-center gap-2 self-end md:self-center">
          <div className="px-3 py-1.5 rounded-lg bg-surface/90 border border-border text-right text-xs">
            <span className="text-[10px] uppercase font-bold text-muted-foreground block">Gate State</span>
            <span className="font-bold text-foreground">
              {decision.startsWith("APPROVED") ? "Proceed to Training" : "Pipeline Gated"}
            </span>
          </div>
        </div>
      </div>

      {/* 2. Key Metrics & Estimation Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {/* Checks Ratio */}
        <div className="p-4 rounded-xl border border-border bg-surface shadow-xs">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-semibold uppercase tracking-wider">Health Checks</span>
            <CheckCircleIcon className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="text-2xl font-black text-foreground">{passedCount}</span>
            <span className="text-xs text-muted-foreground font-semibold">/ {checks.length} passed</span>
          </div>
          <div className="mt-2 flex items-center gap-2 text-[11px]">
            {warningCount > 0 && (
              <span className="text-amber-500 font-bold">{warningCount} warnings</span>
            )}
            {failedCount > 0 && (
              <span className="text-rose-500 font-bold">{failedCount} blocked</span>
            )}
            {warningCount === 0 && failedCount === 0 && (
              <span className="text-emerald-500 font-bold">100% clean check</span>
            )}
          </div>
        </div>

        {/* RAM Projection */}
        <div className="p-4 rounded-xl border border-border bg-surface shadow-xs">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-semibold uppercase tracking-wider">Memory Allocation</span>
            <CpuIcon className="w-4 h-4 text-blue-500" />
          </div>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="text-2xl font-black text-foreground">
              {estimates.ram_gb ? `${estimates.ram_gb} GB` : "2.0 GB"}
            </span>
            <span className="text-xs text-muted-foreground font-semibold">
              of {system.ram_available_gb ? `${system.ram_available_gb} GB` : `${system.ram_total_gb || 8} GB`} avail
            </span>
          </div>
          <div className="mt-2 text-[11px] text-muted-foreground">
            Confidence: <span className="font-bold text-foreground capitalize">{estimates.confidence || "calculated"}</span>
          </div>
        </div>

        {/* Estimated Duration */}
        <div className="p-4 rounded-xl border border-border bg-surface shadow-xs">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-semibold uppercase tracking-wider">Estimated Time</span>
            <ClockIcon className="w-4 h-4 text-purple-500" />
          </div>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="text-2xl font-black text-foreground">
              {estimates.training_time_seconds
                ? `~${Math.ceil(estimates.training_time_seconds / 60)} min`
                : "< 2 min"}
            </span>
            <span className="text-xs text-muted-foreground font-semibold">
              ({estimates.training_time_seconds || 45}s)
            </span>
          </div>
          <div className="mt-2 text-[11px] text-muted-foreground">
            Bottleneck: <span className="font-bold text-foreground uppercase">{estimates.bottleneck || "None"}</span>
          </div>
        </div>

        {/* Disk & Artifacts */}
        <div className="p-4 rounded-xl border border-border bg-surface shadow-xs">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-semibold uppercase tracking-wider">Artifact Footprint</span>
            <HardDriveIcon className="w-4 h-4 text-teal-500" />
          </div>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="text-2xl font-black text-foreground">
              {estimates.model_size_mb ? `~${estimates.model_size_mb} MB` : "~25 MB"}
            </span>
            <span className="text-xs text-muted-foreground font-semibold">
              ({system.disk_free_gb ? `${system.disk_free_gb} GB` : "Safe"} free)
            </span>
          </div>
          <div className="mt-2 text-[11px] text-muted-foreground">
            Scratch disk: <span className="font-bold text-foreground">{estimates.disk_gb || 0.5} GB</span>
          </div>
        </div>
      </div>

      {/* 3. System Hardware & Runtime Environment */}
      <div className="rounded-xl border border-border bg-surface p-5 shadow-xs">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <ServerIcon className="w-4 h-4 text-foreground" />
            <h4 className="text-sm font-bold text-foreground">Hardware & Profiler Snapshot</h4>
          </div>
          <span className="text-xs text-muted-foreground font-medium">
            Host: {system.os_name || "Platform"} ({system.architecture || "x64"})
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <div className="p-3 rounded-lg bg-surface-muted/60 border border-border/80">
            <span className="text-[10px] uppercase font-bold text-muted-foreground block">CPU Cores</span>
            <span className="text-sm font-bold text-foreground mt-0.5 block">
              {system.cpu_logical || 4} Cores ({system.cpu_physical || 4} Physical)
            </span>
          </div>
          <div className="p-3 rounded-lg bg-surface-muted/60 border border-border/80">
            <span className="text-[10px] uppercase font-bold text-muted-foreground block">Host Memory</span>
            <span className="text-sm font-bold text-foreground mt-0.5 block">
              {system.ram_total_gb ? `${system.ram_total_gb} GB Total` : "N/A"}
            </span>
          </div>
          <div className="p-3 rounded-lg bg-surface-muted/60 border border-border/80">
            <span className="text-[10px] uppercase font-bold text-muted-foreground block">Disk Storage</span>
            <span className="text-sm font-bold text-foreground mt-0.5 block">
              {system.disk_free_gb ? `${system.disk_free_gb} GB Free` : "Sufficient"}
            </span>
          </div>
          <div className="p-3 rounded-lg bg-surface-muted/60 border border-border/80">
            <span className="text-[10px] uppercase font-bold text-muted-foreground block">Accelerator</span>
            <span className="text-sm font-bold text-foreground mt-0.5 block truncate">
              {system.gpus && system.gpus.length > 0
                ? `${system.gpus[0].name} (${system.gpus[0].total_vram_gb} GB)`
                : "CPU Execution Engine"}
            </span>
          </div>
        </div>
      </div>

      {/* 4. Optimization Recommendations (if present) */}
      {recs.length > 0 && (
        <div className="rounded-xl border border-border bg-surface p-5 shadow-xs">
          <div className="flex items-center gap-2 mb-3">
            <ZapIcon className="w-4 h-4 text-amber-500" />
            <h4 className="text-sm font-bold text-foreground">Optimization & Change Proposals</h4>
            <span className="text-xs px-2 py-0.5 rounded-full font-bold bg-amber-500/10 text-amber-600 border border-amber-500/20">
              {recs.length} Action Item(s)
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-border bg-surface-muted/50 text-[11px] font-bold text-muted-foreground">
                  <th className="p-2.5">Priority</th>
                  <th className="p-2.5">Optimization</th>
                  <th className="p-2.5">Diff (Current → Proposed)</th>
                  <th className="p-2.5">Rationale & Impact</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {recs.map((rec, idx) => (
                  <tr key={rec.id || idx} className="hover:bg-surface-muted/30">
                    <td className="p-2.5 whitespace-nowrap">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                        rec.priority === "CRITICAL"
                          ? "bg-rose-500/10 text-rose-600 border border-rose-500/20"
                          : rec.priority === "RECOMMENDED"
                          ? "bg-amber-500/10 text-amber-600 border border-amber-500/20"
                          : "bg-surface-muted text-muted-foreground border border-border"
                      }`}>
                        {rec.priority}
                      </span>
                    </td>
                    <td className="p-2.5 font-semibold text-foreground whitespace-nowrap">
                      {rec.name}
                      <span className="block text-[10px] text-muted-foreground">{rec.category}</span>
                    </td>
                    <td className="p-2.5 whitespace-nowrap">
                      <div className="flex items-center gap-1.5 font-mono text-[11px]">
                        <span className="px-1.5 py-0.5 rounded bg-surface-muted border border-border text-muted-foreground">
                          {String(rec.currentValue ?? "default")}
                        </span>
                        <ArrowRightIcon className="w-3 h-3 text-muted-foreground" />
                        <span className="px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 font-bold">
                          {String(rec.proposedValue ?? "optimized")}
                        </span>
                      </div>
                    </td>
                    <td className="p-2.5 text-muted-foreground">
                      <p className="font-medium text-foreground">{rec.reason}</p>
                      {rec.expectedImpact && (
                        <p className="text-[11px] text-emerald-600 dark:text-emerald-400 mt-0.5">
                          Impact: {rec.expectedImpact}
                        </p>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 5. 10-Stage Detailed Pre-Flight Checks */}
      <div className="rounded-xl border border-border bg-surface p-5 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2">
            <LayersIcon className="w-4 h-4 text-foreground" />
            <h4 className="text-sm font-bold text-foreground">Pre-Flight Verification Checks</h4>
            <span className="text-xs text-muted-foreground">({checks.length} checks performed)</span>
          </div>

          {/* Filter Pills */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              onClick={() => setFilterCategory("ALL")}
              className={`text-[11px] px-2.5 py-1 rounded-lg font-semibold transition-colors ${
                filterCategory === "ALL"
                  ? "bg-foreground text-background"
                  : "bg-surface-muted text-muted-foreground hover:text-foreground"
              }`}
            >
              All ({checks.length})
            </button>
            <button
              onClick={() => setFilterCategory("WARNINGS_FAILED")}
              className={`text-[11px] px-2.5 py-1 rounded-lg font-semibold transition-colors ${
                filterCategory === "WARNINGS_FAILED"
                  ? "bg-amber-500 text-white"
                  : "bg-surface-muted text-muted-foreground hover:text-foreground"
              }`}
            >
              Issues ({warningCount + failedCount})
            </button>
            <button
              onClick={() => setFilterCategory("RESOURCE_SAFETY")}
              className={`text-[11px] px-2.5 py-1 rounded-lg font-semibold transition-colors ${
                filterCategory === "RESOURCE_SAFETY"
                  ? "bg-foreground text-background"
                  : "bg-surface-muted text-muted-foreground hover:text-foreground"
              }`}
            >
              Safety & Resources
            </button>
            <button
              onClick={() => setFilterCategory("CONFIGURATION")}
              className={`text-[11px] px-2.5 py-1 rounded-lg font-semibold transition-colors ${
                filterCategory === "CONFIGURATION"
                  ? "bg-foreground text-background"
                  : "bg-surface-muted text-muted-foreground hover:text-foreground"
              }`}
            >
              Configuration
            </button>
            <button
              onClick={() => setFilterCategory("DATA_FEATURES")}
              className={`text-[11px] px-2.5 py-1 rounded-lg font-semibold transition-colors ${
                filterCategory === "DATA_FEATURES"
                  ? "bg-foreground text-background"
                  : "bg-surface-muted text-muted-foreground hover:text-foreground"
              }`}
            >
              Data & Features
            </button>
          </div>
        </div>

        {/* Checks List */}
        <div className="space-y-2.5">
          {filteredChecks.length === 0 ? (
            <div className="p-6 text-center text-muted-foreground text-xs">
              No checks match the selected filter.
            </div>
          ) : (
            filteredChecks.map((check, idx) => (
              <div
                key={check.id || idx}
                className="p-3 rounded-xl bg-surface-muted/40 border border-border hover:border-border/80 transition-colors flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-foreground">{check.name}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface border border-border text-muted-foreground font-mono">
                      {check.category || `Stage ${check.stage}`}
                    </span>
                  </div>
                  <p className="text-muted-foreground text-[11px]">{check.details}</p>
                  {check.remediation && (
                    <p className="text-[11px] text-amber-600 dark:text-amber-400 font-medium">
                      Remediation: {check.remediation}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-3 self-end md:self-center shrink-0">
                  {check.metric && (
                    <span className="text-[11px] font-mono text-muted-foreground bg-surface px-2 py-0.5 rounded border border-border">
                      {check.metric}
                    </span>
                  )}
                  <span
                    className={`text-[10px] font-black px-2.5 py-1 rounded-md uppercase tracking-wider ${
                      check.status === "PASSED"
                        ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
                        : check.status === "WARNING"
                        ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20"
                        : check.status === "FAILED"
                        ? "bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20"
                        : "bg-surface text-muted-foreground border border-border"
                    }`}
                  >
                    {check.status}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
