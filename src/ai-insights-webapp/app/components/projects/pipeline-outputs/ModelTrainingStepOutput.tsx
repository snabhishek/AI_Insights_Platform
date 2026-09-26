"use client";

import React, { useState, useEffect } from "react";
import { BACKEND_URL } from "../../providers/AppContext";

export interface CandidateModelItem {
  model_id: string;
  displayName?: string;
  framework?: string;
  algorithm?: string;
  status?: "Completed" | "Failed";
  score?: number;
  durationSeconds?: number;
  validationMetrics?: Record<string, number>;
  testMetrics?: Record<string, number>;
  error?: string;
  artifact?: string;
  plots?: Record<string, string>;
}

export interface ModelTrainingStepOutputProps {
  modelTraining: any;
  trainingConfiguration?: any;
  modelSelection?: any;
  projectId?: string;
  activeRunTimestamp?: string;
  onApproveTraining?: (selectedModels: string[], splitStartDate?: string, splitEndDate?: string) => void;
  onApproveValidation?: (selectedModels: string[]) => void;
  onNavigateToValidation?: (selectedModels: string[]) => void;
  isApproving?: boolean;
}

// ─── Inline Icons ─────────────────────────────────────────────────────────────

function TrophyIcon({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
      <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
      <path d="M4 22h16" />
      <path d="M10 14.66V17c0 .55-.45 1-1 1H7c-.55 0-1 .45-1 1v1c0 .55.45 1 1 1h10c.55 0 1-.45 1-1v-1c0-.55-.45-1-1-1h-2c-.55 0-1-.45-1-1v-2.34" />
      <path d="M6 4h12a2 2 0 0 1 2 2v3a6 6 0 0 1-6 6h-4a6 6 0 0 1-6-6V6a2 2 0 0 1 2-2Z" />
    </svg>
  );
}

function CheckCircleIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
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

function BoxIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
      <line x1="12" y1="22.08" x2="12" y2="12" />
    </svg>
  );
}

function CopyIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function MaximizeIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 3 21 3 21 9" />
      <polyline points="9 21 3 21 3 15" />
      <line x1="21" y1="3" x2="14" y2="10" />
      <line x1="3" y1="21" x2="10" y2="14" />
    </svg>
  );
}

const MONTHS = [
  { value: 1, name: "January", short: "Jan" },
  { value: 2, name: "February", short: "Feb" },
  { value: 3, name: "March", short: "Mar" },
  { value: 4, name: "April", short: "Apr" },
  { value: 5, name: "May", short: "May" },
  { value: 6, name: "June", short: "Jun" },
  { value: 7, name: "July", short: "Jul" },
  { value: 8, name: "August", short: "Aug" },
  { value: 9, name: "September", short: "Sep" },
  { value: 10, name: "October", short: "Oct" },
  { value: 11, name: "November", short: "Nov" },
  { value: 12, name: "December", short: "Dec" },
];

export interface DateRangeInfo {
  hasTemporalData: boolean;
  timeColumn: string | null;
  minDate?: string;
  maxDate?: string;
  minYear?: number;
  maxYear?: number;
  minMonth?: number;
  maxMonth?: number;
  availableYears?: number[];
}

const fileServerBase = BACKEND_URL.replace(/\/api\/?$/, "");

function resolvePlotUrl(rawUrl: string): string {
  if (!rawUrl) return "";
  if (rawUrl.startsWith("http://") || rawUrl.startsWith("https://")) return rawUrl;
  const cleanPath = rawUrl.startsWith("/") ? rawUrl : `/${rawUrl}`;
  return `${fileServerBase}${cleanPath}`;
}

export default function ModelTrainingStepOutput({
  modelTraining,
  trainingConfiguration,
  modelSelection,
  projectId,
  activeRunTimestamp,
  onApproveTraining,
  onApproveValidation,
  onNavigateToValidation,
  isApproving = false,
}: ModelTrainingStepOutputProps) {
  const [copiedArtifact, setCopiedArtifact] = useState<string | null>(null);
  const [activePlotModal, setActivePlotModal] = useState<{ title: string; url: string } | null>(null);

  // Dynamic Date Range from Dataset
  const [dateRangeInfo, setDateRangeInfo] = useState<DateRangeInfo | null>(null);
  const [isLoadingDateRange, setIsLoadingDateRange] = useState<boolean>(true);

  // Extract candidate models with full support for all report schemas, snake_case and camelCase
  let reportCandidates: any[] = [];
  const rawReportPayload =
    modelTraining?.report?.candidate_model_results ||
    modelTraining?.report?.runs ||
    modelTraining?.report?.candidate_models ||
    modelTraining?.report?.models ||
    modelTraining?.report?.leaderboard ||
    modelTraining?.report?.results ||
    modelTraining?.report?.candidates ||
    modelTraining?.report?.trained_models ||
    modelTraining?.report?.evaluations;

  if (Array.isArray(rawReportPayload)) {
    reportCandidates = rawReportPayload;
  } else if (rawReportPayload && typeof rawReportPayload === "object") {
    reportCandidates = Object.entries(rawReportPayload).map(([key, val]: [string, any]) => {
      if (val && typeof val === "object") {
        return {
          model_id: val.model_id || key,
          ...val,
        };
      }
      return { model_id: key, value: val };
    });
  }

  const sourceCandidates: any[] =
    (reportCandidates.length > 0)
      ? reportCandidates
      : (Array.isArray(modelTraining?.rankedCandidates) && modelTraining.rankedCandidates.length > 0)
        ? modelTraining.rankedCandidates
        : (Array.isArray(modelTraining?.candidates) && modelTraining.candidates.length > 0)
          ? modelTraining.candidates
          : (Array.isArray(trainingConfiguration?.configuration?.model_selection?.models) && trainingConfiguration.configuration.model_selection.models.length > 0)
            ? trainingConfiguration.configuration.model_selection.models
            : (Array.isArray(trainingConfiguration?.configuration?.model_selection?.candidates) && trainingConfiguration.configuration.model_selection.candidates.length > 0)
              ? trainingConfiguration.configuration.model_selection.candidates
              : (Array.isArray(modelSelection?.candidates) && modelSelection.candidates.length > 0)
                ? modelSelection.candidates
                : (Array.isArray(modelSelection?.models) && modelSelection.models.length > 0)
                  ? modelSelection.models
                  : [];

  const primaryMetricKey = modelTraining?.report?.primary_metric || modelTraining?.report?.primary_metric_name;

  const rawCandidateList: CandidateModelItem[] = sourceCandidates.map((c: any, idx: number) => {
    const modelId = String(typeof c === "string" ? c : (c.model_id || c.id || c.name || c.model_name || `candidate_${idx + 1}`));
    const displayName = String(typeof c === "string" ? c : (c.displayName || c.display_name || c.algorithm || c.name || modelId));
    const framework = String(typeof c === "string" ? "sklearn" : (c.framework || "sklearn"));
    const status = c.status === "SUCCESS" || c.status === "Completed" ? "Completed" : c.status || (c.error ? "Failed" : "Completed");

    // Extract metrics from validation_metrics, validationMetrics, metrics, test_metrics, etc.
    const validationMetrics = c.validationMetrics || c.validation_metrics || c.metrics || c.val_metrics || {};
    const testMetrics = c.testMetrics || c.test_metrics || {};

    // Extract score prioritizing regression and classification primary metrics
    const isValidNumber = (value: unknown): value is number => typeof value === "number" && !Number.isNaN(value);

    const candidates = [
      c,
      c.score,
      c.val_score,
      c.validation_score,
      c.metric_score,
      c.primary_metric_value,
      primaryMetricKey && validationMetrics?.[primaryMetricKey],
      primaryMetricKey && testMetrics?.[primaryMetricKey],
      c.test_score,
      validationMetrics?.roc_auc,
      validationMetrics?.accuracy,
      validationMetrics?.f1_score,
      validationMetrics?.f1_weighted,
      validationMetrics?.r2,
      validationMetrics?.rmse,
      testMetrics?.roc_auc,
      testMetrics?.accuracy,
      testMetrics?.f1_score,
      testMetrics?.r2,
      c.suitability_score,
    ];

    let score = candidates.find(isValidNumber);

    if (score === undefined) {
      score = Object.values(validationMetrics ?? {}).find(isValidNumber);
    }

    // Extract duration seconds
    const durationSeconds =
      c.durationSeconds ??
      c.duration_seconds ??
      (c.fit_time_seconds != null ? Number(c.fit_time_seconds) + Number(c.scoring_time_seconds || 0) : undefined) ??
      c.fit_time_seconds ??
      c.training_metadata?.training_time_seconds ??
      c.training_time_seconds ??
      c.training_time ??
      c.duration ??
      c.time_taken ??
      (c.duration_ms ? c.duration_ms / 1000 : undefined);

    const artifact = c.artifact || c.model_path || c.artifact_path || c.model_artifact;
    const plots = c.plots || c.comparison_plots || c.plot_paths;

    return {
      model_id: modelId,
      displayName,
      framework,
      status,
      score,
      durationSeconds,
      validationMetrics,
      testMetrics,
      artifact,
      plots,
      error: c.error,
    };
  });

  // Unique candidates by model_id
  const uniqueCandidateMap = new Map<string, CandidateModelItem>();
  for (const c of rawCandidateList) {
    if (!uniqueCandidateMap.has(c.model_id)) {
      uniqueCandidateMap.set(c.model_id, c);
    }
  }
  const candidateModels = Array.from(uniqueCandidateMap.values());

  // Model selection and Month/Year split state for HITL gate
  const [selectedModelIds, setSelectedModelIds] = useState<string[]>(() => {
    return candidateModels.map((c) => c.model_id);
  });

  // Selected models for Held-Out Model Validation
  const [selectedModelsForValidation, setSelectedModelsForValidation] = useState<string[]>(() => {
    return candidateModels.map((c) => c.model_id);
  });

  // Keep validation selection updated when candidateModels arrive
  useEffect(() => {
    if (candidateModels.length > 0) {
      setSelectedModelsForValidation((prev) => (prev.length === 0 ? candidateModels.map((c) => c.model_id) : prev));
    }
  }, [candidateModels]);

  const [selectedYear, setSelectedYear] = useState<number>(() => {
    const existing = modelTraining?.splitEndDate || modelTraining?.splitDate;
    if (existing && typeof existing === "string") {
      const y = parseInt(existing.split("-")[0], 10);
      if (!isNaN(y)) return y;
    }
    return new Date().getFullYear();
  });

  const [selectedMonth, setSelectedMonth] = useState<number>(() => {
    const existing = modelTraining?.splitEndDate || modelTraining?.splitDate;
    if (existing && typeof existing === "string") {
      const parts = existing.split("-");
      if (parts.length >= 2) {
        const m = parseInt(parts[1], 10);
        if (!isNaN(m)) return m;
      }
    }
    return 9; // September default
  });

  // Fetch date range dynamically from project dataset and training config
  useEffect(() => {
    if (!projectId) {
      setIsLoadingDateRange(false);
      return;
    }
    let isCancelled = false;
    async function loadDateRange() {
      setIsLoadingDateRange(true);
      try {
        const url = `${BACKEND_URL}/training-config/${projectId}/date-range${
          activeRunTimestamp ? `?timestamp=${encodeURIComponent(activeRunTimestamp)}` : ""
        }`;
        const res = await fetch(url);
        if (!res.ok) throw new Error("Failed to load date range");
        const json = await res.json();
        if (!isCancelled && json.success && json.data) {
          const data: DateRangeInfo = json.data;
          setDateRangeInfo(data);
          if (data.hasTemporalData && data.minYear && data.maxYear) {
            // Default to maxYear or 80% through available range
            const defaultY = data.maxYear;
            setSelectedYear((prev) => {
              if (prev >= data.minYear! && prev <= data.maxYear!) return prev;
              return defaultY;
            });
            if (data.maxMonth) {
              setSelectedMonth((prev) => prev || data.maxMonth || 9);
            }
          }
        }
      } catch (e) {
        console.warn("[ModelTrainingStepOutput] Date range fetch error:", e);
      } finally {
        if (!isCancelled) setIsLoadingDateRange(false);
      }
    }

    loadDateRange();
    return () => {
      isCancelled = true;
    };
  }, [projectId, activeRunTimestamp]);

  const toggleModelSelection = (modelId: string) => {
    setSelectedModelIds((prev) =>
      prev.includes(modelId) ? prev.filter((id) => id !== modelId) : [...prev, modelId]
    );
  };

  const selectAll = () => {
    setSelectedModelIds(candidateModels.map((c) => c.model_id));
  };

  const deselectAll = () => {
    setSelectedModelIds([]);
  };

  const handleCopyPath = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedArtifact(text);
    setTimeout(() => setCopiedArtifact(null), 2000);
  };

  // Compute available years list
  const minYearLimit = dateRangeInfo?.minYear ?? 2000;
  const maxYearLimit = dateRangeInfo?.maxYear ?? new Date().getFullYear();
  const availableYearsList = dateRangeInfo?.availableYears && dateRangeInfo.availableYears.length > 0
    ? dateRangeInfo.availableYears
    : Array.from({ length: maxYearLimit - minYearLimit + 1 }, (_, i) => minYearLimit + i);

  // Filter months if at min/max year boundaries
  const availableMonthsList = MONTHS.filter((m) => {
    if (!dateRangeInfo?.hasTemporalData) return true;
    if (selectedYear === dateRangeInfo.minYear && dateRangeInfo.minMonth && m.value < dateRangeInfo.minMonth) {
      return false;
    }
    if (selectedYear === dateRangeInfo.maxYear && dateRangeInfo.maxMonth && m.value > dateRangeInfo.maxMonth) {
      return false;
    }
    return true;
  });

  const selectedMonthObj = MONTHS.find((m) => m.value === selectedMonth) || MONTHS[8];
  const formattedSplitCutoff = `${selectedYear}-${String(selectedMonth).padStart(2, "0")}`;

  // Determine phase state
  const hasExecutionReport = Boolean(modelTraining?.report || modelTraining?.selectedModel || (modelTraining?.status === "Completed" && modelTraining?.validationMetrics));
  const hasCodeGenerated = Boolean(
    modelTraining?.projectDirectory ||
    modelTraining?.filesCreated ||
    modelTraining?.status === "Code Generated" ||
    modelTraining?.phase === "Model Training Code Generation" ||
    modelTraining?.files
  );

  const report = modelTraining?.report;
  const championModelId =
    modelTraining?.selectedModel ||
    report?.selectedModel ||
    report?.champion_model ||
    report?.best_model_id ||
    report?.champion_model_id ||
    candidateModels[0]?.model_id;

  const championArtifact =
    modelTraining?.selectedModelArtifact ||
    report?.selectedModelArtifact ||
    report?.champion_artifact ||
    report?.artifacts?.selected_model ||
    candidateModels.find((c) => c.model_id === championModelId)?.artifact ||
    `artifacts/models/${championModelId || "model"}.joblib`;

  const championCandidate = candidateModels.find((c) => c.model_id === championModelId) || candidateModels[0];

  // Visual plots collection from report, modelTraining, and candidate plots
  const candidatePlots: Record<string, string> = {};
  for (const c of candidateModels) {
    if (c.plots && typeof c.plots === "object") {
      for (const [pKey, pVal] of Object.entries(c.plots)) {
        if (typeof pVal === "string" && pVal.trim()) {
          const plotKey = `${c.model_id}_${pKey}`;
          candidatePlots[plotKey] = pVal;
        }
      }
    }
  }

  const plots: Record<string, string> = {
    ...(typeof report?.comparison_plot === "string" ? { cross_model_comparison: report.comparison_plot } : {}),
    ...(typeof report?.comparison_plots === "object" && report?.comparison_plots ? report.comparison_plots : {}),
    ...(typeof report?.comparisonPlots === "object" && report?.comparisonPlots ? report.comparisonPlots : {}),
    ...(typeof report?.plots === "object" && report?.plots ? report.plots : {}),
    ...(modelTraining?.plots || {}),
    ...candidatePlots,
  };

  return (
    <div className="p-6 space-y-6">
      {/* ─── Header & Stage Summary ─── */}
      <div className="rounded-2xl border border-border bg-surface p-5 shadow-xs transition-all">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="p-2 rounded-xl bg-primary/10 text-primary dark:bg-white/10 dark:text-white">
                <BoxIcon className="w-5 h-5" />
              </span>
              <div>
                <h3 className="text-base font-bold text-foreground">Model Training & AutoML Execution</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Docker isolated containerized model fitting, sequential execution, and metric benchmark
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {hasExecutionReport ? (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                <CheckCircleIcon className="w-3.5 h-3.5" />
                Training Complete
              </span>
            ) : hasCodeGenerated ? (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                Ready for Docker Execution: Select Models
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
                <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                Awaiting Train Split Date (Month / Year)
              </span>
            )}

            <div className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-border bg-surface-muted/60 text-xs font-medium text-muted-foreground">
              <CpuIcon className="w-3.5 h-3.5 text-primary" />
              <span>Isolated Docker Sandbox</span>
            </div>
          </div>
        </div>

        {modelTraining?.summary && (
          <div className="mt-4 pt-4 border-t border-border text-xs text-foreground/85 leading-relaxed bg-surface-muted/30 rounded-xl p-3">
            {modelTraining.summary}
          </div>
        )}
      </div>

      {/* ─── Candidate Model Selection & Docker Execution Gate ─── */}
      {!hasExecutionReport && (
        <div className="rounded-2xl border-2 border-primary/30 bg-primary/5 dark:bg-primary/10 p-5 space-y-5 animate-fadeIn">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-border/80">
            <div>
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-0.5 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-bold text-xs">
                  ✓ Ready for Execution
                </span>
                <span className="text-xs font-bold text-foreground">
                  Select Models to Train in Docker Sandbox
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Choose which candidate models to execute inside the isolated Docker container. Selected models will be fit and scored against the evaluation dataset.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={selectAll}
                className="px-2.5 py-1 text-xs font-medium rounded-lg border border-border bg-surface hover:bg-surface-muted text-foreground transition-all cursor-pointer"
              >
                Select All ({candidateModels.length})
              </button>
              <button
                type="button"
                onClick={deselectAll}
                className="px-2.5 py-1 text-xs font-medium rounded-lg border border-border bg-surface hover:bg-surface-muted text-foreground transition-all cursor-pointer"
              >
                Deselect All
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
            {candidateModels.map((candidate) => {
              const isChecked = selectedModelIds.includes(candidate.model_id);
              return (
                <div
                  key={candidate.model_id}
                  onClick={() => toggleModelSelection(candidate.model_id)}
                  className={`p-4 rounded-xl border transition-all cursor-pointer select-none flex items-start gap-3.5 ${
                    isChecked
                      ? "border-primary/50 bg-surface dark:bg-surface shadow-xs ring-1 ring-primary/30"
                      : "border-border bg-surface/70 hover:border-border/80 opacity-70"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => {}} // handled by parent div
                    className="mt-0.5 w-4 h-4 rounded-md border-border text-primary focus:ring-0 cursor-pointer"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-bold text-foreground truncate">
                        {candidate.displayName || candidate.model_id}
                      </span>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-surface-muted border border-border text-muted-foreground">
                        {candidate.framework || "sklearn"}
                      </span>
                    </div>

                    <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="font-mono text-[11px] truncate">ID: {candidate.model_id}</span>
                      {typeof candidate.score === "number" && (
                        <span className="text-emerald-600 dark:text-emerald-400 font-semibold ml-auto">
                          Suitability: {(candidate.score * 100).toFixed(0)}%
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="pt-3 border-t border-border/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              {selectedModelIds.length} candidate model(s) selected for containerized training.
            </p>

            <button
              type="button"
              disabled={selectedModelIds.length === 0 || isApproving}
              onClick={() => {
                if (onApproveTraining) {
                  onApproveTraining(selectedModelIds);
                }
              }}
              className="px-5 py-2.5 rounded-xl bg-primary text-primary-foreground font-semibold text-xs tracking-wide hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed shadow-md cursor-pointer transition-all flex items-center justify-center gap-2"
            >
              {isApproving ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                  <span>Running Training in Docker Sandbox...</span>
                </>
              ) : (
                <>
                  <CpuIcon className="w-4 h-4" />
                  <span>Execute Training in Docker ({selectedModelIds.length} Models)</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* ─── Champion Model Card ─── */}
      {hasExecutionReport && championCandidate && (
        <div className="relative overflow-hidden rounded-2xl border-2 border-emerald-500/30 bg-gradient-to-br from-emerald-500/10 via-surface to-surface p-6 shadow-sm">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-500 text-white shadow-xs">
                  <TrophyIcon className="w-3.5 h-3.5" />
                  Champion Model
                </span>
                <span className="text-xs font-mono text-muted-foreground">
                  Framework: {championCandidate.framework || "sklearn"}
                </span>
              </div>

              <h4 className="text-xl font-bold text-foreground">
                {championCandidate.displayName || championCandidate.model_id}
              </h4>
              <p className="text-xs text-muted-foreground">
                Selected as best-performing estimator based on held-out validation metrics and inference efficiency.
              </p>
            </div>

            {/* Score Highlight Badge */}
            {typeof championCandidate.score === "number" && (
              <div className="p-4 rounded-xl bg-surface border border-emerald-500/30 text-center shrink-0 min-w-[140px]">
                <span className="text-[10px] uppercase font-bold text-muted-foreground block tracking-wider">
                  Benchmark Score
                </span>
                <span className="text-2xl font-black text-emerald-600 dark:text-emerald-400">
                  {(championCandidate.score * 100).toFixed(1)}%
                </span>
              </div>
            )}
          </div>

          {/* Validation Metrics Grid */}
          {(championCandidate.validationMetrics || championCandidate.testMetrics) && (
            <div className="mt-5 pt-4 border-t border-border grid grid-cols-2 sm:grid-cols-4 gap-3">
              {Object.entries(championCandidate.testMetrics || championCandidate.validationMetrics || {}).map(
                ([metricName, val]) => (
                  <div key={metricName} className="p-2.5 rounded-xl bg-surface/80 border border-border text-center">
                    <span className="text-[10px] uppercase font-bold text-muted-foreground block truncate">
                      {metricName}
                    </span>
                    <span className="text-sm font-extrabold text-foreground">
                      {typeof val === "number" ? val.toFixed(4) : String(val)}
                    </span>
                  </div>
                )
              )}
            </div>
          )}

          {/* Artifact File Banner */}
          {championArtifact && (
            <div className="mt-4 pt-3 border-t border-border/80 flex items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2 truncate text-muted-foreground">
                <BoxIcon className="w-4 h-4 text-emerald-500 shrink-0" />
                <span className="font-semibold text-foreground shrink-0">Model Artifact:</span>
                <span className="font-mono text-xs truncate bg-surface-muted px-2 py-0.5 rounded border border-border">
                  {championArtifact}
                </span>
              </div>

              <button
                type="button"
                onClick={() => handleCopyPath(championArtifact)}
                className="shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-border bg-surface hover:bg-surface-muted text-foreground transition-all cursor-pointer font-medium"
              >
                <CopyIcon className="w-3.5 h-3.5" />
                <span>{copiedArtifact === championArtifact ? "Copied!" : "Copy Path"}</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* ─── Model Metrics Leaderboard Table ─── */}
      {hasExecutionReport && candidateModels.length > 0 && (
        <div className="rounded-2xl border border-border bg-surface overflow-hidden shadow-xs">
          <div className="p-4 border-b border-border flex items-center justify-between">
            <div>
              <h4 className="text-sm font-bold text-foreground">Candidate Model Benchmark Leaderboard</h4>
              <p className="text-xs text-muted-foreground mt-0.5">
                Comparative ranking across trained models evaluated on the held-out test dataset
              </p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-surface-muted/60 text-muted-foreground uppercase font-semibold text-[10px] border-b border-border tracking-wider">
                <tr>
                  <th className="py-3 px-4">Rank</th>
                  <th className="py-3 px-4">Model & Algorithm</th>
                  <th className="py-3 px-4">Framework</th>
                  <th className="py-3 px-4">Score</th>
                  <th className="py-3 px-4">Validation Metrics</th>
                  <th className="py-3 px-4">Duration</th>
                  <th className="py-3 px-4 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {candidateModels.map((m, idx) => {
                  const isChampion = m.model_id === championModelId;
                  const metrics =
                    m.validationMetrics && Object.keys(m.validationMetrics).length > 0
                      ? m.validationMetrics
                      : m.testMetrics && Object.keys(m.testMetrics).length > 0
                      ? m.testMetrics
                      : {};
                  return (
                    <tr
                      key={m.model_id}
                      className={`hover:bg-surface-muted/40 transition-colors ${
                        isChampion ? "bg-emerald-500/5 font-semibold" : ""
                      }`}
                    >
                      <td className="py-3 px-4 font-mono font-bold">
                        {isChampion ? (
                          <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                            <TrophyIcon className="w-3.5 h-3.5" />
                            #1
                          </span>
                        ) : (
                          `#${idx + 1}`
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex flex-col">
                          <span className="font-bold text-foreground">
                            {m.displayName || m.model_id}
                          </span>
                          <span className="font-mono text-[10px] text-muted-foreground">{m.model_id}</span>
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <span className="px-2 py-0.5 rounded-md bg-surface-muted border border-border font-mono text-[10px]">
                          {m.framework || "sklearn"}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-extrabold text-foreground">
                        {typeof m.score === "number"
                          ? m.score >= 0 && m.score <= 1
                            ? `${(m.score * 100).toFixed(1)}%`
                            : m.score.toFixed(3)
                          : typeof metrics.roc_auc === "number"
                          ? `${(metrics.roc_auc * 100).toFixed(1)}%`
                          : typeof metrics.accuracy === "number"
                          ? `${(metrics.accuracy * 100).toFixed(1)}%`
                          : typeof metrics.r2 === "number"
                          ? metrics.r2.toFixed(3)
                          : typeof metrics.rmse === "number"
                          ? metrics.rmse.toFixed(2)
                          : "—"}
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex flex-wrap gap-1.5">
                          {Object.keys(metrics).length > 0 ? (
                            Object.entries(metrics).slice(0, 3).map(([k, v]) => (
                              <span
                                key={k}
                                className="px-1.5 py-0.5 rounded bg-surface border border-border font-mono text-[10px]"
                              >
                                {k}: {typeof v === "number" ? (v >= 0 && v <= 1 ? `${(v * 100).toFixed(1)}%` : v.toFixed(3)) : String(v)}
                              </span>
                            ))
                          ) : (
                            <span className="text-muted-foreground/60 font-mono text-[11px]">—</span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-muted-foreground font-mono">
                        {m.durationSeconds != null ? `${Number(m.durationSeconds).toFixed(1)}s` : "—"}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                          <CheckCircleIcon className="w-3 h-3" />
                          {m.status || "Completed"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ─── Handoff to Model Validation with Model Selection ─── */}
      {hasExecutionReport && candidateModels.length > 0 && (onNavigateToValidation || onApproveValidation) && (
        <div className="rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/5 via-surface to-surface p-5 space-y-4 shadow-sm animate-fadeIn">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-border/80">
            <div>
              <h4 className="text-sm font-bold text-foreground flex items-center gap-2">
                <CheckCircleIcon className="w-4 h-4 text-primary" />
                Select Models for Held-Out Model Validation
              </h4>
              <p className="text-xs text-muted-foreground mt-0.5">
                Choose which trained estimators to validate on the held-out verification dataset. Only selected models will be validated.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setSelectedModelsForValidation(candidateModels.map((c) => c.model_id))}
                className="px-2.5 py-1 text-xs font-medium rounded-lg border border-border bg-surface hover:bg-surface-muted text-foreground transition-all cursor-pointer"
              >
                Select All
              </button>
              <button
                type="button"
                onClick={() => setSelectedModelsForValidation([])}
                className="px-2.5 py-1 text-xs font-medium rounded-lg border border-border bg-surface hover:bg-surface-muted text-foreground transition-all cursor-pointer"
              >
                Deselect All
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            {candidateModels.map((candidate) => {
              const isChecked = selectedModelsForValidation.includes(candidate.model_id);
              const isChamp = candidate.model_id === championModelId;
              return (
                <div
                  key={candidate.model_id}
                  onClick={() => {
                    setSelectedModelsForValidation((prev) =>
                      prev.includes(candidate.model_id)
                        ? prev.filter((id) => id !== candidate.model_id)
                        : [...prev, candidate.model_id]
                    );
                  }}
                  className={`p-3.5 rounded-xl border transition-all cursor-pointer select-none flex items-start gap-3 ${
                    isChecked
                      ? "border-primary bg-primary/5 dark:bg-primary/10 shadow-xs ring-1 ring-primary/20"
                      : "border-border bg-surface/70 hover:border-border/80 opacity-70"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => {}}
                    className="mt-0.5 w-4 h-4 rounded text-primary border-border focus:ring-0 cursor-pointer"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1.5">
                      <span className="text-xs font-bold text-foreground truncate">
                        {candidate.displayName || candidate.model_id}
                      </span>
                      {isChamp && (
                        <span className="text-[9px] uppercase font-black px-1.5 py-0.5 rounded bg-emerald-500 text-white shrink-0">
                          Champion
                        </span>
                      )}
                    </div>
                    <div className="flex items-center justify-between mt-1 text-[11px] text-muted-foreground">
                      <span className="font-mono">{candidate.framework || "sklearn"}</span>
                      {typeof candidate.score === "number" && (
                        <span className="text-emerald-600 dark:text-emerald-400 font-semibold font-mono">
                          {(candidate.score * 100).toFixed(1)}%
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="pt-3 border-t border-border flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              {selectedModelsForValidation.length} model(s) selected for Model Validation evaluation.
            </p>

            <button
              type="button"
              disabled={selectedModelsForValidation.length === 0 || isApproving}
              onClick={() => {
                if (onNavigateToValidation) {
                  onNavigateToValidation(selectedModelsForValidation);
                } else if (onApproveValidation) {
                  onApproveValidation(selectedModelsForValidation);
                }
              }}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl bg-primary text-white text-xs font-bold tracking-wide uppercase shadow-md hover:bg-primary/90 hover:scale-[1.02] active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              <span>Proceed to Model Validation ({selectedModelsForValidation.length} Models)</span>
            </button>
          </div>
        </div>
      )}

      {/* ─── Artifacts & Visualizations Gallery ─── */}
      {hasExecutionReport && Object.keys(plots).length > 0 && (
        <div className="rounded-2xl border border-border bg-surface p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="text-sm font-bold text-foreground">Evaluation Plots & Artifact Visualizations</h4>
              <p className="text-xs text-muted-foreground mt-0.5">
                Diagnostic figures (ROC/PR curves, residuals, feature importance, cross-model comparison) generated during evaluation
              </p>
            </div>
            <span className="text-xs font-mono px-2.5 py-1 rounded-lg bg-surface-muted text-muted-foreground border border-border">
              {Object.keys(plots).length} Plot(s)
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {Object.entries(plots).map(([name, url]) => (
              <div
                key={name}
                onClick={() => setActivePlotModal({ title: name, url })}
                className="group relative rounded-xl border border-border bg-surface-muted/30 overflow-hidden hover:border-primary/50 transition-all cursor-pointer"
              >
                <div className="h-44 w-full bg-surface-muted flex items-center justify-center overflow-hidden">
                  <img
                    src={resolvePlotUrl(url)}
                    alt={name}
                    className="object-contain w-full h-full transition-transform group-hover:scale-105"
                    onError={(e) => {
                      (e.target as HTMLElement).style.display = "none";
                    }}
                  />
                </div>
                <div className="p-3 border-t border-border flex items-center justify-between bg-surface">
                  <span className="text-xs font-bold text-foreground truncate capitalize">
                    {name.replace(/_/g, " ")}
                  </span>
                  <MaximizeIcon className="w-3.5 h-3.5 text-muted-foreground group-hover:text-primary transition-colors" />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── Plot Preview Modal ─── */}
      {activePlotModal && (
        <div
          onClick={() => setActivePlotModal(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 cursor-pointer"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative max-w-4xl w-full rounded-2xl border border-border bg-surface p-5 shadow-2xl cursor-default space-y-4"
          >
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h4 className="text-sm font-bold text-foreground capitalize">
                {activePlotModal.title.replace(/_/g, " ")}
              </h4>
              <button
                type="button"
                onClick={() => setActivePlotModal(null)}
                className="px-2 py-1 rounded-lg border border-border text-xs text-muted-foreground hover:bg-surface-muted cursor-pointer font-bold"
              >
                Close ✕
              </button>
            </div>
            <div className="w-full flex items-center justify-center p-2 bg-black/5 dark:bg-black/30 rounded-xl overflow-hidden max-h-[75vh]">
              <img
                src={resolvePlotUrl(activePlotModal.url)}
                alt={activePlotModal.title}
                className="max-h-[70vh] w-auto object-contain rounded-lg"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
