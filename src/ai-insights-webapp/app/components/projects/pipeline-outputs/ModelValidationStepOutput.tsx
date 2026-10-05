"use client";

import React, { useState, useMemo, useEffect } from "react";
import { Badge } from "./utils";
import { BACKEND_URL } from "../../providers/AppContext";
import ModelValidationApexChart from "./ModelValidationApexChart";

export interface MetricDetail {
  value: number | null;
  status: "available" | "unavailable" | "undefined";
  unit?: string;
  reason?: string;
}

export interface ModelValidationTotals {
  actualTotal: number | null;
  forecastTotal: number;
  difference: number | null;
  differencePercentage: number | null;
}

export interface ModelValidationChartData {
  dates: string[];
  actualSeries: Array<number | null>;
  predictedSeries: number[];
  residuals?: Array<number | null>;
}

export interface CandidateModelValidationRun {
  model_id: string;
  displayName: string;
  framework: string;
  status: "Completed" | "Failed";
  score?: number;
  primaryMetricName?: string;
  metrics: Record<string, MetricDetail>;
  totals: ModelValidationTotals;
  chartData: ModelValidationChartData;
  evaluationRecordCount: number;
  actualDataCoverage: number | null;
  modelArtifactPath?: string;
  error?: string;
}

export interface ModelValidationReport {
  validation_run_id: string;
  project_id: string;
  mode: "backtesting" | "future_prediction";
  prediction_objective_start_date: string;
  prediction_objective_horizon: number;
  prediction_objective_frequency: "Weekly" | "Monthly" | "Yearly";
  time_column: string;
  target_column: string;
  problem_type?: string;
  champion_model_id: string;
  model_results?: Record<string, CandidateModelValidationRun> | CandidateModelValidationRun[];
  models: Record<string, CandidateModelValidationRun> | CandidateModelValidationRun[];
  ranked_models: CandidateModelValidationRun[];
  candidate_models?: any[];
  candidateModels?: any[];
  metadata?: Record<string, any>;
  warnings?: string[];
  created_at: string;
}

export interface ModelValidationStepOutputProps {
  modelValidation?: any;
  modelTraining?: any;
  trainingConfiguration?: any;
  modelSelection?: any;
  projectId?: string;
  activeRunTimestamp?: string;
  onApproveValidation?: (horizon: number, frequency: string, startDate?: string) => void;
  isApproving?: boolean;
}

function TrophyIcon({ className = "w-4 h-4" }: { className?: string }) {
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

function PlayIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor">
      <polygon points="5 3 19 12 5 21 5 3" />
    </svg>
  );
}

function CalendarIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

function TrendingUpIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
      <polyline points="17 6 23 6 23 12" />
    </svg>
  );
}

function formatNumber(val: number | null | undefined, decimals = 1): string {
  if (val === null || val === undefined || isNaN(val)) return "N/A";
  if (Math.abs(val) >= 1_000_000) return `${(val / 1_000_000).toFixed(decimals)}M`;
  if (Math.abs(val) >= 1_000) return `${(val / 1_000).toFixed(decimals)}K`;
  return val.toLocaleString(undefined, { maximumFractionDigits: decimals });
}

function formatPercentage(val: number | null | undefined): string {
  if (val === null || val === undefined || isNaN(val)) return "N/A";
  const prefix = val > 0 ? "+" : "";
  return `${prefix}${val.toFixed(1)}%`;
}

function formatScoreBadge(score: number | undefined, metricName?: string): string {
  if (score === undefined || isNaN(score)) return "N/A";
  if (score > 0 && score <= 1.0) return (score * 100).toFixed(1) + "%";
  if (score >= 10 && score <= 100 && (metricName?.includes("F1") || metricName?.includes("Accuracy") || metricName?.includes("WAPE"))) {
    return `${score.toFixed(1)}%`;
  }
  return score.toFixed(1);
}

function getMetricNumericValue(metricItem: any): number | null {
  if (metricItem === null || metricItem === undefined) return null;
  if (typeof metricItem === "number") {
    return isNaN(metricItem) ? null : metricItem;
  }
  if (typeof metricItem === "object" && metricItem.value !== undefined && metricItem.value !== null) {
    const v = Number(metricItem.value);
    return isNaN(v) ? null : v;
  }
  const parsed = Number(metricItem);
  return isNaN(parsed) ? null : parsed;
}

function resolveMetric(
  metrics: Record<string, any> | undefined,
  ...names: string[]
): { value: number | null; unit?: string; reason?: string } | null {
  if (!metrics || typeof metrics !== "object") return null;
  for (const name of names) {
    if (name in metrics && metrics[name] !== undefined && metrics[name] !== null) {
      const val = getMetricNumericValue(metrics[name]);
      const reason = typeof metrics[name] === "object" ? metrics[name].reason : undefined;
      const unit = typeof metrics[name] === "object" ? metrics[name].unit : undefined;
      return { value: val, unit, reason };
    }
    const foundKey = Object.keys(metrics).find((k) => k.toLowerCase() === name.toLowerCase());
    if (foundKey && metrics[foundKey] !== undefined && metrics[foundKey] !== null) {
      const val = getMetricNumericValue(metrics[foundKey]);
      const reason = typeof metrics[foundKey] === "object" ? metrics[foundKey].reason : undefined;
      const unit = typeof metrics[foundKey] === "object" ? metrics[foundKey].unit : undefined;
      return { value: val, unit, reason };
    }
  }
  return null;
}

function formatMetricValue(
  m: { value: number | null; unit?: string; reason?: string } | null,
  isPercent = false,
  decimals = 1
): string {
  if (!m || m.value === null || m.value === undefined || isNaN(m.value)) return "N/A";
  let v = m.value;
  if (isPercent) {
    if (v > 0 && v <= 1.0) v = v * 100;
    return `${v.toFixed(decimals)}%`;
  }
  return v.toFixed(decimals);
}

function getCandidateScoreInfo(cand: any, isClassification: boolean): { score: number | undefined; primaryMetricName: string } {
  if (typeof cand?.score === "number" && !isNaN(cand.score)) {
    return { score: cand.score, primaryMetricName: cand.primaryMetricName || (isClassification ? "ROC AUC" : "Score") };
  }
  if (isClassification) {
    const roc = resolveMetric(cand?.metrics, "roc_auc", "rocAuc", "roc", "auc");
    if (roc?.value !== null && roc?.value !== undefined) return { score: roc.value, primaryMetricName: "ROC AUC" };
    const acc = resolveMetric(cand?.metrics, "accuracy", "acc");
    if (acc?.value !== null && acc?.value !== undefined) return { score: acc.value, primaryMetricName: "Accuracy" };
    const f1 = resolveMetric(cand?.metrics, "f1_score", "f1Score", "f1");
    if (f1?.value !== null && f1?.value !== undefined) return { score: f1.value, primaryMetricName: "F1 Score" };
  } else {
    const wape = resolveMetric(cand?.metrics, "WAPE", "wape");
    if (wape?.value !== null && wape?.value !== undefined) return { score: wape.value, primaryMetricName: "WAPE" };
    const mae = resolveMetric(cand?.metrics, "MAE", "mae");
    if (mae?.value !== null && mae?.value !== undefined) return { score: mae.value, primaryMetricName: "MAE" };
    const rmse = resolveMetric(cand?.metrics, "RMSE", "rmse");
    if (rmse?.value !== null && rmse?.value !== undefined) return { score: rmse.value, primaryMetricName: "RMSE" };
  }
  return { score: undefined, primaryMetricName: cand?.primaryMetricName || "Score" };
}

export default function ModelValidationStepOutput({
  modelValidation,
  modelTraining,
  trainingConfiguration,
  modelSelection,
  projectId,
  activeRunTimestamp,
  onApproveValidation,
  isApproving,
}: ModelValidationStepOutputProps) {

  const rawReport: ModelValidationReport | undefined =
    modelValidation?.report ||
    modelValidation?.data?.report ||
    (modelValidation?.ranked_models ||
    modelValidation?.model_results ||
    modelValidation?.modelResults ||
    modelValidation?.models ||
    modelValidation?.candidate_models ||
    modelValidation?.candidateModels
      ? modelValidation
      : undefined);

  const candidates: CandidateModelValidationRun[] = useMemo(() => {
    if (rawReport?.ranked_models && Array.isArray(rawReport.ranked_models)) {
      return rawReport.ranked_models;
    }
    if (rawReport?.model_results) {
      return Array.isArray(rawReport.model_results)
        ? rawReport.model_results
        : Object.entries(rawReport.model_results).map(([k, v]: [string, any]) =>
            v && typeof v === "object" ? { model_id: v.model_id || k, ...v } : { model_id: k, value: v }
          );
    }
    if ((rawReport as any)?.modelResults) {
      const mr = (rawReport as any).modelResults;
      return Array.isArray(mr)
        ? mr
        : Object.entries(mr).map(([k, v]: [string, any]) =>
            v && typeof v === "object" ? { model_id: v.model_id || k, ...v } : { model_id: k, value: v }
          );
    }
    if (modelValidation?.candidates && Array.isArray(modelValidation.candidates)) {
      return modelValidation.candidates;
    }
    if (modelValidation?.results && Array.isArray(modelValidation.results)) {
      return modelValidation.results;
    }
    if (rawReport?.models) {
      return Array.isArray(rawReport.models)
        ? rawReport.models
        : Object.entries(rawReport.models).map(([k, v]: [string, any]) =>
            v && typeof v === "object" ? { model_id: v.model_id || k, ...v } : { model_id: k, value: v }
          );
    }
    if (rawReport?.candidate_models && Array.isArray(rawReport.candidate_models)) {
      return rawReport.candidate_models;
    }
    if (rawReport?.candidateModels && Array.isArray(rawReport.candidateModels)) {
      return rawReport.candidateModels;
    }
    return [];
  }, [rawReport, modelValidation]);

  const championModelId =
    rawReport?.champion_model_id ||
    modelValidation?.championModel?.model_id ||
    candidates[0]?.model_id ||
    (candidates[0] as any)?.modelId;

  const problemType = useMemo(() => {
    return (
      rawReport?.problem_type ||
      (rawReport as any)?.metadata?.problemType ||
      modelValidation?.metadata?.problemType ||
      trainingConfiguration?.problemType ||
      trainingConfiguration?.configuration?.problem_type ||
      trainingConfiguration?.contract?.problem_type ||
      "forecasting"
    );
  }, [rawReport, modelValidation, trainingConfiguration]);

  const isClassification = useMemo(() => {
    const pt = (problemType || "").toLowerCase();
    if (pt.includes("class")) return true;
    return candidates.some((c) => {
      const m = c?.metrics;
      return m && (m.accuracy !== undefined || m.roc_auc !== undefined || m.f1_score !== undefined || m.precision !== undefined);
    });
  }, [problemType, candidates]);

  const [selectedModelId, setSelectedModelId] = useState<string>("");

  React.useEffect(() => {
    if (candidates.length > 0) {
      if (!selectedModelId || !candidates.some((c) => (c.model_id || (c as any).modelId) === selectedModelId)) {
        setSelectedModelId(championModelId || candidates[0]?.model_id || (candidates[0] as any)?.modelId);
      }
    }
  }, [candidates, championModelId, selectedModelId]);

  const activeCandidate = useMemo(() => {
    return candidates.find((c) => (c.model_id || (c as any).modelId) === selectedModelId) || candidates[0] || null;
  }, [candidates, selectedModelId]);

  const [dateRangeInfo, setDateRangeInfo] = useState<any>(null);

  useEffect(() => {
    if (!projectId) return;
    let isCancelled = false;
    async function fetchDateRange() {
      try {
        const url = `${BACKEND_URL}/training-config/${projectId}/date-range${
          activeRunTimestamp ? `?timestamp=${encodeURIComponent(activeRunTimestamp)}` : ""
        }`;
        const res = await fetch(url);
        if (res.ok) {
          const json = await res.json();
          if (!isCancelled && json.success && json.data) {
            setDateRangeInfo(json.data);
          }
        }
      } catch (e) {
        console.warn("[ModelValidationStepOutput] Error fetching date range:", e);
      }
    }
    fetchDateRange();
    return () => {
      isCancelled = true;
    };
  }, [BACKEND_URL, projectId, activeRunTimestamp]);

  const effectiveSplitDate = useMemo(() => {
    return (
      trainingConfiguration?.splitDate ||
      trainingConfiguration?.splitEndDate ||
      trainingConfiguration?.configuration?.split?.split_date ||
      trainingConfiguration?.configuration?.split?.cutoff_date ||
      trainingConfiguration?.configuration?.data_splitting?.cutoff_date ||
      trainingConfiguration?.contract?.split?.split_date ||
      modelTraining?.splitEndDate ||
      modelTraining?.splitDate ||
      (trainingConfiguration as any)?.split ||
      null
    );
  }, [trainingConfiguration, modelTraining]);

  const minSelectableDate = useMemo(() => {
    if (!effectiveSplitDate || typeof effectiveSplitDate !== "string") return undefined;
    const trimmed = effectiveSplitDate.trim();
    if (!trimmed) return undefined;

    const ym = /^(\d{4})-(\d{2})/.exec(trimmed);
    if (ym) {
      return `${ym[1]}-${ym[2]}-01`;
    }

    try {
      const d = new Date(trimmed);
      if (!isNaN(d.getTime())) {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, "0");
        return `${y}-${m}-01`;
      }
    } catch {}
    return trimmed.split("T")[0];
  }, [effectiveSplitDate]);

  const maxSelectableDate = useMemo(() => {
    const rawMax =
      trainingConfiguration?.maxDate ||
      trainingConfiguration?.dateRange?.maxDate ||
      trainingConfiguration?.configuration?.maxDate ||
      trainingConfiguration?.configuration?.split?.max_date ||
      dateRangeInfo?.maxDate;

    if (!rawMax || typeof rawMax !== "string") return undefined;
    const trimmed = rawMax.trim();
    if (!trimmed) return undefined;

    try {
      const d = new Date(trimmed);
      if (!isNaN(d.getTime())) {
        return d.toISOString().split("T")[0];
      }
    } catch {}
    return trimmed.split("T")[0].split(" ")[0];
  }, [trainingConfiguration, dateRangeInfo]);

  const defaultCalculatedStartDate = useMemo(() => {
    if (rawReport?.prediction_objective_start_date) {
      return rawReport.prediction_objective_start_date;
    }
    if (modelValidation?.predictionObjectiveStartDate) {
      return modelValidation.predictionObjectiveStartDate;
    }
    if (minSelectableDate) {
      return minSelectableDate;
    }
    const configDate =
      trainingConfiguration?.predictionObjectiveStartDate ||
      trainingConfiguration?.contract?.predictionObjectiveStartDate ||
      trainingConfiguration?.splitEndDate;
    if (configDate) {
      try {
        const d = new Date(configDate);
        if (!isNaN(d.getTime())) {
          d.setDate(d.getDate() + 1);
          return d.toISOString().split("T")[0];
        }
      } catch {

      }
    }
    const today = new Date();
    return today.toISOString().split("T")[0];
  }, [rawReport, modelValidation, minSelectableDate, trainingConfiguration]);

  const [horizonInput, setHorizonInput] = useState<number>(
    rawReport?.prediction_objective_horizon || modelValidation?.predictionObjectiveHorizon || 0
  );
  const [frequencyInput, setFrequencyInput] = useState<"Weekly" | "Monthly" | "Yearly" | "">(
    (rawReport?.prediction_objective_frequency as any) || modelValidation?.predictionObjectiveFrequency || ""
  );
  const [startDateInput, setStartDateInput] = useState<string>(defaultCalculatedStartDate);

  useEffect(() => {
    if (minSelectableDate && (!startDateInput || startDateInput < minSelectableDate)) {
      setStartDateInput(minSelectableDate);
    }
  }, [minSelectableDate]);

  useEffect(() => {
    const reportFreq = rawReport?.prediction_objective_frequency || modelValidation?.predictionObjectiveFrequency;
    if (reportFreq) {
      setFrequencyInput(reportFreq as any);
    }
    const reportHorizon = rawReport?.prediction_objective_horizon || modelValidation?.predictionObjectiveHorizon;
    if (reportHorizon && typeof reportHorizon === "number") {
      setHorizonInput(reportHorizon);
    }
  }, [rawReport, modelValidation]);

  const isDateOutOfRange = useMemo(() => {
    if (!startDateInput) return false;
    if (minSelectableDate && startDateInput < minSelectableDate) return true;
    if (maxSelectableDate && startDateInput > maxSelectableDate) return true;
    return false;
  }, [startDateInput, minSelectableDate, maxSelectableDate]);

  const isBacktesting = useMemo(() => {
    try {
      const target = new Date(startDateInput);
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      return target <= now;
    } catch {
      return true;
    }
  }, [startDateInput]);

  const handleRunValidation = () => {
    if (onApproveValidation) {
      onApproveValidation(horizonInput, frequencyInput, startDateInput);
    }
  };

  const chartData =
    activeCandidate?.chartData ||
    (activeCandidate as any)?.chart_data ||
    (activeCandidate as any)?.plotData ||
    (activeCandidate as any)?.plot_data ||
    (activeCandidate as any)?.predictions_chart;
  const dates: string[] = chartData?.dates || (chartData as any)?.timestamps || (chartData as any)?.time || [];
  const actuals: Array<number | null> =
    chartData?.actualSeries ||
    (chartData as any)?.actual_series ||
    (chartData as any)?.actuals ||
    (chartData as any)?.actual ||
    [];
  const forecasts: number[] =
    chartData?.predictedSeries ||
    (chartData as any)?.predicted_series ||
    (chartData as any)?.forecasts ||
    (chartData as any)?.forecast ||
    (chartData as any)?.predictions ||
    [];

  return (
    <div className="space-y-6 animate-in fade-in duration-300">

      {Boolean(onApproveValidation) && (
      <div className="p-5 rounded-2xl bg-surface-raised border border-border shadow-sm">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
                <TrendingUpIcon className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-foreground">Model Validation Configuration</h3>
                <p className="text-xs text-muted-foreground">
                  Execute model validation across candidate models reusing finalized features and trained artifacts.
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Badge variant={isBacktesting ? "success" : "info"} className="text-xs py-1 px-3">
              <span className="w-1.5 h-1.5 rounded-full bg-current mr-1 animate-pulse" />
              {isBacktesting ? "Backtesting Mode" : "Future Prediction Mode"}
            </Badge>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-4 gap-4 pt-4 border-t border-border/60">

          <div>
            <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
              Forecast Horizon
            </label>
            <div className="relative">
              <input
                type="number"
                min={1}
                max={52}
                value={horizonInput}
                onChange={(e) => setHorizonInput(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-full h-9 px-3 rounded-lg border border-border bg-background text-sm font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 transition"
              />
              <span className="absolute right-3 top-2 text-xs text-muted-foreground pointer-events-none">
                periods
              </span>
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
              Frequency
            </label>
            <select
              value={frequencyInput}
              onChange={(e) => setFrequencyInput(e.target.value as any)}
              className="w-full h-9 px-3 rounded-lg border border-border bg-background text-sm font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 transition cursor-pointer"
            >
              <option value="Weekly">Weekly</option>
              <option value="Monthly">Monthly</option>
              <option value="Yearly">Yearly</option>
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
              Objective Start Date
            </label>
            <div className="relative">
              <input
                type="date"
                min={minSelectableDate}
                max={maxSelectableDate}
                value={startDateInput}
                onChange={(e) => setStartDateInput(e.target.value)}
                className={`w-full h-9 px-3 rounded-lg border ${
                  isDateOutOfRange
                    ? "border-amber-500 focus:ring-amber-500/40 text-amber-500"
                    : "border-border focus:ring-primary/40 text-foreground"
                } bg-background text-sm font-medium focus:outline-none focus:ring-2 transition cursor-pointer`}
              />
            </div>
          </div>

          <div className="flex items-end">
            <button
              type="button"
              disabled={isApproving || isDateOutOfRange}
              onClick={handleRunValidation}
              className="w-full h-9 px-4 rounded-xl bg-primary text-primary-foreground font-semibold text-xs tracking-wide hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm transition-all flex items-center justify-center gap-2 cursor-pointer"
            >
              {isApproving ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                  <span>Validating...</span>
                </>
              ) : (
                <>
                  <PlayIcon className="w-3.5 h-3.5" />
                  <span>{candidates.length > 0 ? "Re-validate Models" : "Run Model Validation"}</span>
                </>
              )}
            </button>
          </div>
        </div>

        <div className="mt-3 flex flex-col sm:flex-row sm:items-center justify-between text-xs text-muted-foreground gap-2">
          <div className="flex items-center gap-1.5">
            <CalendarIcon className="w-3.5 h-3.5 text-muted-foreground/80 flex-shrink-0" />
            <span>
              {isDateOutOfRange ? (
                <span className="text-amber-500 font-medium">
                  Objective start date must be after split date ({minSelectableDate || effectiveSplitDate})
                  {maxSelectableDate ? ` and before dataset maximum date (${maxSelectableDate})` : ""}.
                </span>
              ) : isBacktesting ? (
                `Start date (${startDateInput}) is historical: computing ground-truth metrics (WAPE, MAE, RMSE) against observed test values.`
              ) : (
                `Start date (${startDateInput}) is in the future: generating forward predictions for ${horizonInput} ${frequencyInput.toLowerCase()} periods.`
              )}
            </span>
          </div>
          {(minSelectableDate || maxSelectableDate) && (
            <div className="text-[11px] font-mono text-muted-foreground/80 bg-muted/40 px-2 py-0.5 rounded border border-border/50 self-start sm:self-auto">
              Allowed: {minSelectableDate || "Any"} &rarr; {maxSelectableDate || "Max"}
            </div>
          )}
        </div>
      </div>
      )}

      {candidates.length === 0 && (
        <div className="p-10 rounded-2xl bg-surface-raised border border-dashed border-border text-center flex flex-col items-center justify-center min-h-[220px]">
          <div className="w-12 h-12 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary mb-3">
            <TrendingUpIcon className="w-6 h-6" />
          </div>
          <h4 className="text-sm font-bold text-foreground">Model Validation Awaiting Execution</h4>
          <p className="text-xs text-muted-foreground max-w-md mt-1">
            Model training has finalized. Set your forecast horizon, frequency, and objective start date above, then click &ldquo;Run Model Validation&rdquo; to evaluate candidate models on out-of-sample data.
          </p>
        </div>
      )}

      {candidates.length > 0 && activeCandidate && (
        <div className="space-y-4">

          {candidates.length > 1 && (
            <div className="flex items-center gap-2 overflow-x-auto pb-1">
              <span className="text-xs font-semibold text-muted-foreground whitespace-nowrap mr-1">
                Candidate Models:
              </span>
              {candidates.map((cand) => {
                const candId = cand.model_id || (cand as any).modelId;
                const isSelected = candId === selectedModelId;
                const isChampion = candId === championModelId;
                const candScoreInfo = getCandidateScoreInfo(cand, isClassification);
                return (
                  <button
                    key={candId}
                    onClick={() => setSelectedModelId(candId)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-all cursor-pointer flex items-center gap-1.5 whitespace-nowrap ${
                      isSelected
                        ? "bg-primary text-primary-foreground border-primary shadow-sm"
                        : "bg-surface-raised border-border text-foreground hover:bg-surface-muted"
                    }`}
                  >
                    {isChampion && <TrophyIcon className={`w-3.5 h-3.5 ${isSelected ? "text-amber-300" : "text-amber-500"}`} />}
                    <span>{cand.displayName || candId}</span>
                    {candScoreInfo.score !== undefined && (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-mono ${isSelected ? "bg-primary-foreground/20 text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                        {candScoreInfo.primaryMetricName ? `${candScoreInfo.primaryMetricName.replace(" Score", "")}: ` : ""}{formatScoreBadge(candScoreInfo.score, candScoreInfo.primaryMetricName)}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">

            {(() => {
              const activeCandidateId = activeCandidate.model_id || (activeCandidate as any).modelId;
              const activeScoreInfo = getCandidateScoreInfo(activeCandidate, isClassification);
              return (
                <div className="p-5 pb-3 border-b border-border/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    {activeCandidateId === championModelId && (
                      <span className="p-1 rounded-lg bg-amber-500/10 text-amber-500 border border-amber-500/20">
                        <TrophyIcon className="w-4 h-4" />
                      </span>
                    )}
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-base font-bold text-foreground">
                          Selected Model: {activeCandidate.displayName || activeCandidateId}
                        </h3>
                        {activeScoreInfo.score !== undefined && (
                          <Badge variant="primary" className="text-[11px] font-bold py-0.5 px-2">
                            {activeScoreInfo.primaryMetricName || "Score"}: {formatScoreBadge(activeScoreInfo.score, activeScoreInfo.primaryMetricName)}
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Framework: {activeCandidate.framework || "AutoML"} • Problem Type: {isClassification ? "Classification" : "Forecasting"} {dates.length > 0 ? `• Evaluation Horizon: ${dates.length} periods (${frequencyInput})` : ""}
                      </p>
                    </div>
                  </div>

            </div>
          );
        })()}

            <div className="p-5 select-none">
              {!isClassification && dates.length > 0 ? (
                <ModelValidationApexChart
                  candidates={candidates}
                  activeCandidate={activeCandidate}
                  championModelId={championModelId}
                  frequency={rawReport?.prediction_objective_frequency || modelValidation?.predictionObjectiveFrequency || frequencyInput}
                  isClassification={isClassification}
                />
              ) : isClassification ? (
                <div className="p-6 rounded-xl bg-card border border-border/60">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-border/60">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                        <h4 className="text-sm font-bold text-foreground">Classification Evaluation Metrics</h4>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Target: <span className="font-semibold text-foreground">{rawReport?.target_column || "Target"}</span> • Model: <span className="font-semibold text-foreground">{activeCandidate.displayName || activeCandidate.model_id}</span>
                      </p>
                    </div>
                    <Badge variant="neutral" className="text-xs">
                      Holdout Partition Validation
                    </Badge>
                  </div>

                  <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="p-3 rounded-xl bg-surface-muted/40 border border-border/50 text-center">
                      <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block">
                        Accuracy
                      </span>
                      <span className="text-xl font-extrabold text-foreground mt-1 block">
                        {formatMetricValue(resolveMetric(activeCandidate.metrics, "accuracy", "acc"), true, 1)}
                      </span>
                      <span className="text-[10px] text-muted-foreground">Test Partition</span>
                    </div>

                    <div className="p-3 rounded-xl bg-surface-muted/40 border border-border/50 text-center">
                      <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block">
                        ROC AUC
                      </span>
                      <span className="text-xl font-extrabold text-foreground mt-1 block">
                        {formatMetricValue(resolveMetric(activeCandidate.metrics, "roc_auc", "rocAuc", "auc"), false, 4)}
                      </span>
                      <span className="text-[10px] text-muted-foreground">Discrimination</span>
                    </div>

                    <div className="p-3 rounded-xl bg-surface-muted/40 border border-border/50 text-center">
                      <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block">
                        F1 Score
                      </span>
                      <span className="text-xl font-extrabold text-foreground mt-1 block">
                        {formatMetricValue(resolveMetric(activeCandidate.metrics, "f1_score", "f1"), false, 3)}
                      </span>
                      <span className="text-[10px] text-muted-foreground">Harmonic Mean</span>
                    </div>

                    <div className="p-3 rounded-xl bg-surface-muted/40 border border-border/50 text-center">
                      <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block">
                        Log Loss
                      </span>
                      <span className="text-xl font-extrabold text-foreground mt-1 block">
                        {formatMetricValue(resolveMetric(activeCandidate.metrics, "log_loss", "logLoss"), false, 4)}
                      </span>
                      <span className="text-[10px] text-muted-foreground">Cross-Entropy</span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="h-44 flex items-center justify-center text-xs text-muted-foreground">
                  No time series projection data available for this candidate model.
                </div>
              )}
            </div>

            <div className="p-5 border-t border-border bg-surface-muted/30">
              {isClassification ? (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

                  <div className="p-3.5 rounded-xl bg-card border border-border shadow-xs">
                    <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                      Accuracy
                    </div>
                    <div className="text-xl font-extrabold text-foreground mt-1">
                      {formatMetricValue(resolveMetric(activeCandidate.metrics, "accuracy", "acc"), true, 2)}
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      Overall correct classification rate
                    </div>
                  </div>

                  <div className="p-3.5 rounded-xl bg-card border border-border shadow-xs">
                    <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                      ROC AUC
                    </div>
                    <div className="text-xl font-extrabold text-foreground mt-1">
                      {formatMetricValue(resolveMetric(activeCandidate.metrics, "roc_auc", "rocAuc", "auc"), false, 4)}
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      Area under receiver operating curve
                    </div>
                  </div>

                  <div className="p-3.5 rounded-xl bg-card border border-border shadow-xs">
                    <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                      Log Loss
                    </div>
                    <div className="text-xl font-extrabold text-foreground mt-1">
                      {formatMetricValue(resolveMetric(activeCandidate.metrics, "log_loss", "logLoss"), false, 4)}
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      Cross-entropy loss (lower is better)
                    </div>
                  </div>

                  <div className="p-3.5 rounded-xl bg-card border border-border shadow-xs">
                    <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                      Precision
                    </div>
                    <div className="text-xl font-extrabold text-foreground mt-1">
                      {formatMetricValue(resolveMetric(activeCandidate.metrics, "precision", "prec"), true, 1)}
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      Positive predictive value
                    </div>
                  </div>

                  <div className="p-3.5 rounded-xl bg-card border border-border shadow-xs">
                    <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                      Recall
                    </div>
                    <div className="text-xl font-extrabold text-foreground mt-1">
                      {formatMetricValue(resolveMetric(activeCandidate.metrics, "recall", "rec"), true, 1)}
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      Sensitivity / true positive rate
                    </div>
                  </div>

                  <div className="p-3.5 rounded-xl bg-card border border-border shadow-xs">
                    <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                      F1 Score
                    </div>
                    <div className="text-xl font-extrabold text-foreground mt-1">
                      {formatMetricValue(resolveMetric(activeCandidate.metrics, "f1_score", "f1"), false, 3)}
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      Harmonic mean of precision & recall
                    </div>
                  </div>

                  <div className="p-3.5 rounded-xl bg-card border border-border shadow-xs">
                    <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                      Target Column
                    </div>
                    <div className="text-lg font-bold text-foreground mt-1 truncate">
                      {rawReport?.target_column || "Target"}
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      Problem Type: Classification
                    </div>
                  </div>

                  <div className="p-3.5 rounded-xl bg-card border border-border shadow-xs">
                    <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                      Evaluated Models
                    </div>
                    <div className="text-xl font-extrabold text-foreground mt-1">
                      {candidates.length} Candidate Models
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      Champion: {activeCandidate.displayName || championModelId}
                    </div>
                  </div>

                  <div className="p-3.5 rounded-xl bg-card border border-border shadow-xs">
                    <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                      Validation Status
                    </div>
                    <div className="text-xl font-extrabold text-emerald-600 dark:text-emerald-400 mt-1">
                      {activeCandidate.status || "Completed"}
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      Evaluated on holdout validation split
                    </div>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

                  <div className="p-3.5 rounded-xl bg-card border border-border shadow-xs">
                    <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                      Actual Total
                    </div>
                    <div className="text-xl font-extrabold text-foreground mt-1">
                      {activeCandidate.totals?.actualTotal !== null && activeCandidate.totals?.actualTotal !== undefined
                        ? formatNumber(activeCandidate.totals.actualTotal)
                        : "N/A"}
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      {activeCandidate.totals?.actualTotal !== null && activeCandidate.totals?.actualTotal !== undefined
                        ? (activeCandidate.actualDataCoverage !== null ? `${activeCandidate.actualDataCoverage}% coverage` : "Out-of-sample ground truth")
                        : "Future Mode: Ground truth not yet observed"}
                    </div>
                  </div>

                  <div className="p-3.5 rounded-xl bg-card border border-border shadow-xs">
                    <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                      Forecast Total
                    </div>
                    <div className="text-xl font-extrabold text-foreground mt-1">
                      {formatNumber(activeCandidate.totals?.forecastTotal)}
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      Cumulative projection over horizon
                    </div>
                  </div>

                  <div className="p-3.5 rounded-xl bg-card border border-border shadow-xs">
                    <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                      Difference (+ / -)
                    </div>
                    <div className="flex items-baseline gap-2 mt-1">
                      <span className="text-xl font-extrabold text-foreground">
                        {activeCandidate.totals?.difference !== null && activeCandidate.totals?.difference !== undefined
                          ? (activeCandidate.totals.difference > 0 ? "+" : "") + formatNumber(activeCandidate.totals.difference)
                          : (isBacktesting ? "N/A" : "Forward Forecast")}
                      </span>
                      {activeCandidate.totals?.differencePercentage !== null && activeCandidate.totals?.differencePercentage !== undefined && (
                        <Badge
                          variant={Math.abs(activeCandidate.totals.differencePercentage) < 5 ? "success" : "warning"}
                          className="text-[10px]"
                        >
                          {formatPercentage(activeCandidate.totals.differencePercentage)}
                        </Badge>
                      )}
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      {activeCandidate.totals?.difference !== null && activeCandidate.totals?.difference !== undefined
                        ? "Total aggregate bias"
                        : "Future projection without historical baseline delta"}
                    </div>
                  </div>

                  <div className="p-3.5 rounded-xl bg-card border border-border shadow-xs">
                    <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                      WAPE (Weighted Abs Error)
                    </div>
                    <div className="text-xl font-extrabold text-foreground mt-1">
                      {formatMetricValue(resolveMetric(activeCandidate.metrics, "WAPE", "wape"), true, 1)}
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      {isBacktesting ? "Primary accuracy metric (lower is better)" : "Unavailable in future prediction mode"}
                    </div>
                  </div>

                  <div className="p-3.5 rounded-xl bg-card border border-border shadow-xs">
                    <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                      MAE / RMSE
                    </div>
                    <div className="text-base font-bold text-foreground mt-1 flex items-center gap-3">
                      <span>
                        MAE:{" "}
                        <span className="text-foreground font-extrabold">
                          {formatMetricValue(resolveMetric(activeCandidate.metrics, "MAE", "mae"), false, 2)}
                        </span>
                      </span>
                      <span className="text-muted-foreground">|</span>
                      <span>
                        RMSE:{" "}
                        <span className="text-foreground font-extrabold">
                          {formatMetricValue(resolveMetric(activeCandidate.metrics, "RMSE", "rmse"), false, 2)}
                        </span>
                      </span>
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      Mean absolute vs root mean squared error
                    </div>
                  </div>

                  <div className="p-3.5 rounded-xl bg-card border border-border shadow-xs">
                    <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                      Precision
                    </div>
                    <div className="text-xl font-extrabold text-foreground mt-1">
                      {formatMetricValue(resolveMetric(activeCandidate.metrics, "Precision", "precision"), true, 1)}
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      {resolveMetric(activeCandidate.metrics, "Precision", "precision")?.reason || "Classification threshold precision"}
                    </div>
                  </div>

                  <div className="p-3.5 rounded-xl bg-card border border-border shadow-xs">
                    <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                      Recall
                    </div>
                    <div className="text-xl font-extrabold text-foreground mt-1">
                      {formatMetricValue(resolveMetric(activeCandidate.metrics, "Recall", "recall"), true, 1)}
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      {resolveMetric(activeCandidate.metrics, "Recall", "recall")?.reason || "Classification sensitivity / true positive rate"}
                    </div>
                  </div>

                  <div className="p-3.5 rounded-xl bg-card border border-border shadow-xs">
                    <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                      F1 Score
                    </div>
                    <div className="text-xl font-extrabold text-foreground mt-1">
                      {formatMetricValue(resolveMetric(activeCandidate.metrics, "F1", "f1_score", "f1"), false, 3)}
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      Harmonic mean of precision and recall
                    </div>
                  </div>

                  <div className="p-3.5 rounded-xl bg-card border border-border shadow-xs">
                    <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                      Weeks / Horizon
                    </div>
                    <div className="text-xl font-extrabold text-foreground mt-1">
                      {dates.length > 0 ? `${dates.length} Periods` : `${horizonInput} Periods`}
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      Frequency: {frequencyInput}
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="px-5 py-3 border-t border-border/60 bg-muted/20 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-muted-foreground">
              <div className="flex items-center gap-2">
                <CheckCircleIcon className="w-4 h-4 text-emerald-500" />
                <span>
                  Validation executed across {candidates.length} candidate model(s).
                  {rawReport?.created_at && ` Run at ${new Date(rawReport.created_at).toLocaleString()}`}
                </span>
              </div>
              {rawReport?.validation_run_id && (
                <div className="text-[11px] font-mono text-muted-foreground">
                  Run ID: {rawReport.validation_run_id.slice(0, 18)}...
                </div>
              )}
            </div>
          </div>

          {candidates.length > 1 && (
            <div className="p-5 rounded-2xl bg-card border border-border shadow-sm">
              <h4 className="text-xs font-bold text-foreground uppercase tracking-wider mb-3">
                All Evaluated Candidate Models Comparison
              </h4>
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground font-semibold">
                      <th className="pb-2">Model</th>
                      <th className="pb-2">Framework</th>
                      <th className="pb-2">Score</th>
                      {isClassification ? (
                        <>
                          <th className="pb-2">Accuracy</th>
                          <th className="pb-2">ROC AUC</th>
                          <th className="pb-2">Precision</th>
                          <th className="pb-2">Recall</th>
                          <th className="pb-2">F1 Score</th>
                        </>
                      ) : (
                        <>
                          <th className="pb-2">WAPE</th>
                          <th className="pb-2">MAE</th>
                          <th className="pb-2">RMSE</th>
                        </>
                      )}
                      <th className="pb-2">Status</th>
                      <th className="pb-2 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {candidates.map((cand) => {
                      const candId = cand.model_id || (cand as any).modelId;
                      const isCandChampion = candId === championModelId;
                      const isCurrent = candId === selectedModelId;
                      const candScoreInfo = getCandidateScoreInfo(cand, isClassification);
                      return (
                        <tr
                          key={candId}
                          className={`hover:bg-muted/40 transition cursor-pointer ${isCurrent ? "bg-primary/5 font-semibold" : ""}`}
                          onClick={() => setSelectedModelId(candId)}
                        >
                          <td className="py-2.5 flex items-center gap-1.5">
                            {isCandChampion && <TrophyIcon className="w-3.5 h-3.5 text-amber-500" />}
                            <span>{cand.displayName || candId}</span>
                            {isCandChampion && (
                              <Badge variant="warning" className="text-[9px] py-0 px-1.5">Champion</Badge>
                            )}
                          </td>
                          <td className="py-2.5 text-muted-foreground">{cand.framework || "AutoML"}</td>
                          <td className="py-2.5 font-bold text-foreground">
                            {candScoreInfo.score !== undefined
                              ? formatScoreBadge(candScoreInfo.score, candScoreInfo.primaryMetricName)
                              : "N/A"}
                          </td>
                          {isClassification ? (
                            <>
                              <td className="py-2.5">
                                {formatMetricValue(resolveMetric(cand.metrics, "accuracy", "acc"), true, 1)}
                              </td>
                              <td className="py-2.5">
                                {formatMetricValue(resolveMetric(cand.metrics, "roc_auc", "rocAuc", "auc"), false, 4)}
                              </td>
                              <td className="py-2.5">
                                {formatMetricValue(resolveMetric(cand.metrics, "precision", "prec"), true, 1)}
                              </td>
                              <td className="py-2.5">
                                {formatMetricValue(resolveMetric(cand.metrics, "recall", "rec"), true, 1)}
                              </td>
                              <td className="py-2.5">
                                {formatMetricValue(resolveMetric(cand.metrics, "f1_score", "f1"), false, 3)}
                              </td>
                            </>
                          ) : (
                            <>
                              <td className="py-2.5">
                                {formatMetricValue(resolveMetric(cand.metrics, "WAPE", "wape"), true, 2)}
                              </td>
                              <td className="py-2.5">
                                {formatMetricValue(resolveMetric(cand.metrics, "MAE", "mae"), false, 2)}
                              </td>
                              <td className="py-2.5">
                                {formatMetricValue(resolveMetric(cand.metrics, "RMSE", "rmse"), false, 2)}
                              </td>
                            </>
                          )}
                          <td className="py-2.5">
                            <Badge variant={cand.status === "Completed" ? "success" : "error"}>
                              {cand.status}
                            </Badge>
                          </td>
                          <td className="py-2.5 text-right">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedModelId(candId);
                              }}
                              className={`text-[11px] px-2 py-1 rounded-md border transition ${
                                isCurrent
                                  ? "bg-primary text-primary-foreground border-primary"
                                  : "border-border text-foreground hover:bg-muted"
                              }`}
                            >
                              {isCurrent ? "Viewing" : "View"}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
