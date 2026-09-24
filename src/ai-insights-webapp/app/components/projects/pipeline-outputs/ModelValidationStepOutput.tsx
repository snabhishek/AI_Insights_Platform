"use client";

import React, { useState, useMemo } from "react";
import { Badge } from "./utils";

// ─── Types ───────────────────────────────────────────────────────────────────

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
  champion_model_id: string;
  models: Record<string, CandidateModelValidationRun>;
  ranked_models: CandidateModelValidationRun[];
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

// ─── Inline Icons ─────────────────────────────────────────────────────────────

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

// ─── Component ───────────────────────────────────────────────────────────────

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
  // Extract agent state / report
  const rawReport: ModelValidationReport | undefined =
    modelValidation?.report ||
    modelValidation?.data?.report ||
    (modelValidation?.ranked_models ? modelValidation : undefined);

  const candidates: CandidateModelValidationRun[] = useMemo(() => {
    if (rawReport?.ranked_models && Array.isArray(rawReport.ranked_models)) {
      return rawReport.ranked_models;
    }
    if (modelValidation?.candidates && Array.isArray(modelValidation.candidates)) {
      return modelValidation.candidates;
    }
    if (rawReport?.models && typeof rawReport.models === "object") {
      return Object.values(rawReport.models);
    }
    return [];
  }, [rawReport, modelValidation]);

  const championModelId = rawReport?.champion_model_id || modelValidation?.championModel?.model_id || candidates[0]?.model_id;

  // Active selected candidate model for tabs
  const [selectedModelId, setSelectedModelId] = useState<string>("");

  React.useEffect(() => {
    if (candidates.length > 0) {
      if (!selectedModelId || !candidates.some((c) => c.model_id === selectedModelId)) {
        setSelectedModelId(championModelId || candidates[0].model_id);
      }
    }
  }, [candidates, championModelId, selectedModelId]);

  const activeCandidate = useMemo(() => {
    return candidates.find((c) => c.model_id === selectedModelId) || candidates[0] || null;
  }, [candidates, selectedModelId]);

  // Calculative start date derivation
  const defaultCalculatedStartDate = useMemo(() => {
    if (rawReport?.prediction_objective_start_date) {
      return rawReport.prediction_objective_start_date;
    }
    if (modelValidation?.predictionObjectiveStartDate) {
      return modelValidation.predictionObjectiveStartDate;
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
        // fallback
      }
    }
    const today = new Date();
    return today.toISOString().split("T")[0];
  }, [rawReport, modelValidation, trainingConfiguration]);

  // Validation Form Inputs
  const [horizonInput, setHorizonInput] = useState<number>(
    rawReport?.prediction_objective_horizon || modelValidation?.predictionObjectiveHorizon || 12
  );
  const [frequencyInput, setFrequencyInput] = useState<"Weekly" | "Monthly" | "Yearly">(
    (rawReport?.prediction_objective_frequency as any) || modelValidation?.predictionObjectiveFrequency || "Weekly"
  );
  const [startDateInput, setStartDateInput] = useState<string>(defaultCalculatedStartDate);

  // Dynamic Mode Calculation
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

  // Tooltip hover state for chart
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const handleRunValidation = () => {
    if (onApproveValidation) {
      onApproveValidation(horizonInput, frequencyInput, startDateInput);
    }
  };

  // ─── Render Chart ──────────────────────────────────────────────────────────
  const chartData = activeCandidate?.chartData;
  const dates = chartData?.dates || [];
  const actuals = chartData?.actualSeries || [];
  const forecasts = chartData?.predictedSeries || [];

  // Compute SVG layout parameters
  const svgWidth = 850;
  const svgHeight = 270;
  const padLeft = 65;
  const padRight = 35;
  const padTop = 25;
  const padBottom = 45;
  const plotWidth = svgWidth - padLeft - padRight;
  const plotHeight = svgHeight - padTop - padBottom;

  const { yMin, yMax, yTicks, xPoints, actualPath, forecastPath } = useMemo(() => {
    if (dates.length === 0 || forecasts.length === 0) {
      return { yMin: 0, yMax: 100, yTicks: [0, 50, 100], xPoints: [], actualPath: "", forecastPath: "" };
    }

    const allValues: number[] = [];
    forecasts.forEach((v) => { if (typeof v === "number" && !isNaN(v)) allValues.push(v); });
    actuals.forEach((v) => { if (typeof v === "number" && !isNaN(v)) allValues.push(v); });

    const rawMin = allValues.length > 0 ? Math.min(...allValues) : 0;
    const rawMax = allValues.length > 0 ? Math.max(...allValues) : 100;
    const range = rawMax - rawMin || 10;
    const computedMin = Math.max(0, Math.floor(rawMin - range * 0.15));
    const computedMax = Math.ceil(rawMax + range * 0.15);

    const step = (computedMax - computedMin) / 4 || 1;
    const ticks = [
      computedMin,
      Math.round(computedMin + step),
      Math.round(computedMin + step * 2),
      Math.round(computedMin + step * 3),
      computedMax,
    ];

    const getX = (idx: number) => {
      if (dates.length <= 1) return padLeft + plotWidth / 2;
      return padLeft + (idx / (dates.length - 1)) * plotWidth;
    };

    const getY = (val: number | null) => {
      if (val === null || isNaN(val)) return padTop + plotHeight;
      const normalized = (val - computedMin) / (computedMax - computedMin || 1);
      return padTop + plotHeight - normalized * plotHeight;
    };

    const points = dates.map((d, i) => ({
      date: d,
      x: getX(i),
      actualY: actuals[i] !== null && actuals[i] !== undefined ? getY(actuals[i]) : null,
      forecastY: getY(forecasts[i]),
      actualVal: actuals[i],
      forecastVal: forecasts[i],
    }));

    // Build smooth SVG paths
    const buildSmoothPath = (pts: Array<{ x: number; y: number }>) => {
      if (pts.length === 0) return "";
      if (pts.length === 1) return `M ${pts[0].x} ${pts[0].y}`;

      let path = `M ${pts[0].x} ${pts[0].y}`;
      for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[i === 0 ? 0 : i - 1];
        const p1 = pts[i];
        const p2 = pts[i + 1];
        const p3 = pts[i + 2] || p2;

        const cp1x = p1.x + (p2.x - p0.x) / 6;
        const cp1y = p1.y + (p2.y - p0.y) / 6;
        const cp2x = p2.x - (p3.x - p1.x) / 6;
        const cp2y = p2.y - (p3.y - p1.y) / 6;

        path += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
      }
      return path;
    };

    const actualValidPts = points
      .filter((p) => p.actualY !== null)
      .map((p) => ({ x: p.x, y: p.actualY as number }));

    const forecastValidPts = points.map((p) => ({ x: p.x, y: p.forecastY }));

    return {
      yMin: computedMin,
      yMax: computedMax,
      yTicks: ticks,
      xPoints: points,
      actualPath: buildSmoothPath(actualValidPts),
      forecastPath: buildSmoothPath(forecastValidPts),
    };
  }, [dates, actuals, forecasts, padLeft, padRight, padTop, padBottom, plotWidth, plotHeight]);

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* ─── Top Control Card: Validation Horizon & Mode Configuration ─── */}
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

          {/* Active Mode Pill */}
          <div className="flex items-center gap-2">
            <Badge variant={isBacktesting ? "success" : "info"} className="text-xs py-1 px-3">
              <span className="w-1.5 h-1.5 rounded-full bg-current mr-1 animate-pulse" />
              {isBacktesting ? "Backtesting Mode" : "Future Prediction Mode"}
            </Badge>
          </div>
        </div>

        {/* Configuration Form Controls */}
        <div className="mt-5 grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-4 gap-4 pt-4 border-t border-border/60">
          {/* 1. Prediction Horizon */}
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

          {/* 2. Frequency */}
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

          {/* 3. Objective Start Date */}
          <div>
            <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
              Objective Start Date
            </label>
            <div className="relative">
              <input
                type="date"
                value={startDateInput}
                onChange={(e) => setStartDateInput(e.target.value)}
                className="w-full h-9 px-3 rounded-lg border border-border bg-background text-sm font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 transition cursor-pointer"
              />
            </div>
          </div>

          {/* 4. Action Trigger Button */}
          <div className="flex items-end">
            <button
              type="button"
              disabled={isApproving}
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

        {/* Dynamic Mode Helper Text */}
        <div className="mt-3 text-xs text-muted-foreground flex items-center gap-1.5">
          <CalendarIcon className="w-3.5 h-3.5 text-muted-foreground/80" />
          <span>
            {isBacktesting
              ? `Start date (${startDateInput}) is historical: computing ground-truth metrics (WAPE, MAE, RMSE) against observed test values.`
              : `Start date (${startDateInput}) is in the future: generating forward predictions for ${horizonInput} ${frequencyInput.toLowerCase()} periods.`}
          </span>
        </div>
      </div>

      {/* ─── If No Candidate Results Yet ─── */}
      {candidates.length === 0 && (
        <div className="p-10 rounded-2xl bg-surface-raised border border-dashed border-border text-center flex flex-col items-center justify-center min-h-[260px]">
          <div className="w-12 h-12 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary mb-3">
            <TrendingUpIcon className="w-6 h-6" />
          </div>
          <h4 className="text-sm font-bold text-foreground">Model Validation Awaiting Execution</h4>
          <p className="text-xs text-muted-foreground max-w-md mt-1 mb-5">
            Model training has finalized. Set your forecast horizon and frequency above, then click &ldquo;Run Model Validation&rdquo; to evaluate candidate models on out-of-sample data.
          </p>
          <button
            type="button"
            disabled={isApproving}
            onClick={handleRunValidation}
            className="px-5 py-2.5 rounded-xl bg-primary text-primary-foreground font-semibold text-xs tracking-wide hover:opacity-90 disabled:opacity-50 shadow-md cursor-pointer transition flex items-center gap-2"
          >
            {isApproving ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                <span>Validating Candidate Models...</span>
              </>
            ) : (
              <>
                <PlayIcon className="w-4 h-4" />
                <span>Launch Model Validation ({horizonInput} {frequencyInput})</span>
              </>
            )}
          </button>
        </div>
      )}

      {/* ─── Model Validation Results Display ─── */}
      {candidates.length > 0 && activeCandidate && (
        <div className="space-y-4">
          {/* Candidate Switcher Tabs */}
          {candidates.length > 1 && (
            <div className="flex items-center gap-2 overflow-x-auto pb-1">
              <span className="text-xs font-semibold text-muted-foreground whitespace-nowrap mr-1">
                Candidate Models:
              </span>
              {candidates.map((cand) => {
                const isSelected = cand.model_id === selectedModelId;
                const isChampion = cand.model_id === championModelId;
                return (
                  <button
                    key={cand.model_id}
                    onClick={() => setSelectedModelId(cand.model_id)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-all cursor-pointer flex items-center gap-1.5 whitespace-nowrap ${
                      isSelected
                        ? "bg-primary text-primary-foreground border-primary shadow-sm"
                        : "bg-surface-raised border-border text-foreground hover:bg-surface-muted"
                    }`}
                  >
                    {isChampion && <TrophyIcon className={`w-3.5 h-3.5 ${isSelected ? "text-amber-300" : "text-amber-500"}`} />}
                    <span>{cand.displayName || cand.model_id}</span>
                    {cand.score !== undefined && (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${isSelected ? "bg-primary-foreground/20 text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                        {cand.score.toFixed(3)}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {/* ─── Primary Reference Card UI (Matches media_1790185107669.png) ─── */}
          <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
            {/* Card Header: Model Name, Score Badge, and Legend */}
            <div className="p-5 pb-3 border-b border-border/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                {activeCandidate.model_id === championModelId && (
                  <span className="p-1 rounded-lg bg-amber-500/10 text-amber-500 border border-amber-500/20">
                    <TrophyIcon className="w-4 h-4" />
                  </span>
                )}
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold text-foreground">
                      Selected Model: {activeCandidate.displayName || activeCandidate.model_id}
                    </h3>
                    {activeCandidate.score !== undefined && (
                      <Badge variant="primary" className="text-[11px] font-bold py-0.5 px-2">
                        {activeCandidate.primaryMetricName || "Score"}: {activeCandidate.score.toFixed(4)}
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Framework: {activeCandidate.framework || "AutoML"} • Evaluation Horizon: {dates.length} periods ({frequencyInput})
                  </p>
                </div>
              </div>

              {/* Top Right Chart Legend */}
              <div className="flex items-center gap-4 text-xs font-semibold">
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" />
                  <span className="border-b-2 border-dashed border-emerald-500 w-3 inline-block" />
                  <span className="text-muted-foreground">Actual</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-slate-800 dark:bg-sky-400 inline-block" />
                  <span className="border-b-2 border-slate-800 dark:border-sky-400 w-3 inline-block" />
                  <span className="text-muted-foreground">Forecast</span>
                </div>
              </div>
            </div>

            {/* Middle Section: SVG Curve Chart */}
            <div className="p-5 relative select-none">
              {dates.length > 0 ? (
                <div className="w-full overflow-x-auto">
                  <svg
                    viewBox={`0 0 ${svgWidth} ${svgHeight}`}
                    className="w-full h-auto min-w-[650px] max-h-[300px]"
                  >
                    <defs>
                      <linearGradient id="forecastGlow" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.25" />
                        <stop offset="100%" stopColor="#38bdf8" stopOpacity="0.0" />
                      </linearGradient>
                    </defs>

                    {/* Horizontal Grid lines and Y-axis labels */}
                    {yTicks.map((tickVal, i) => {
                      const yPos = padTop + plotHeight - ((tickVal - yMin) / (yMax - yMin || 1)) * plotHeight;
                      return (
                        <g key={i}>
                          <line
                            x1={padLeft}
                            y1={yPos}
                            x2={svgWidth - padRight}
                            y2={yPos}
                            stroke="currentColor"
                            className="text-border/60"
                            strokeDasharray="3 3"
                            strokeWidth="1"
                          />
                          <text
                            x={padLeft - 10}
                            y={yPos + 4}
                            textAnchor="end"
                            className="text-[11px] fill-muted-foreground font-medium"
                          >
                            {formatNumber(tickVal, 0)}
                          </text>
                        </g>
                      );
                    })}

                    {/* Actual Series Path (Dashed Emerald Line) */}
                    {actualPath && (
                      <path
                        d={actualPath}
                        fill="none"
                        stroke="#10b981"
                        strokeWidth="2.5"
                        strokeDasharray="5 4"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    )}

                    {/* Forecast Series Path (Solid Dark Navy / Sky Line) */}
                    {forecastPath && (
                      <path
                        d={forecastPath}
                        fill="none"
                        stroke="currentColor"
                        className="text-slate-800 dark:text-sky-400"
                        strokeWidth="2.75"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    )}

                    {/* Point Markers and Hover Hitboxes */}
                    {xPoints.map((pt, idx) => {
                      const isHovered = hoverIndex === idx;
                      return (
                        <g
                          key={idx}
                          onMouseEnter={() => setHoverIndex(idx)}
                          onMouseLeave={() => setHoverIndex(null)}
                          className="cursor-pointer"
                        >
                          {/* Vertical hover guide */}
                          {isHovered && (
                            <line
                              x1={pt.x}
                              y1={padTop}
                              x2={pt.x}
                              y2={padTop + plotHeight}
                              stroke="currentColor"
                              className="text-primary/40"
                              strokeWidth="1.5"
                              strokeDasharray="2 2"
                            />
                          )}

                          {/* Actual point marker */}
                          {pt.actualY !== null && (
                            <circle
                              cx={pt.x}
                              cy={pt.actualY}
                              r={isHovered ? 5.5 : 3.5}
                              fill="#10b981"
                              stroke="#ffffff"
                              strokeWidth="1.5"
                              className="transition-all"
                            />
                          )}

                          {/* Forecast point marker */}
                          <circle
                            cx={pt.x}
                            cy={pt.forecastY}
                            r={isHovered ? 5.5 : 3.5}
                            className="fill-slate-800 dark:fill-sky-400 stroke-white dark:stroke-slate-900 transition-all"
                            strokeWidth="1.5"
                          />

                          {/* Invisible hover hitbox */}
                          <rect
                            x={pt.x - 15}
                            y={padTop}
                            width={30}
                            height={plotHeight}
                            fill="transparent"
                          />
                        </g>
                      );
                    })}

                    {/* X-axis date labels */}
                    {xPoints.map((pt, idx) => {
                      // Show roughly 6-8 evenly spaced labels
                      const stepMod = Math.max(1, Math.floor(xPoints.length / 7));
                      if (idx % stepMod !== 0 && idx !== xPoints.length - 1) return null;
                      return (
                        <text
                          key={idx}
                          x={pt.x}
                          y={svgHeight - 12}
                          textAnchor="middle"
                          className="text-[10px] fill-muted-foreground font-medium"
                        >
                          {pt.date}
                        </text>
                      );
                    })}
                  </svg>

                  {/* Interactive Tooltip Card */}
                  {hoverIndex !== null && xPoints[hoverIndex] && (
                    <div
                      className="absolute z-20 pointer-events-none p-3 rounded-xl bg-popover text-popover-foreground border border-border shadow-xl text-xs space-y-1 backdrop-blur-md"
                      style={{
                        left: `${Math.min(Math.max(xPoints[hoverIndex].x - 60, 20), svgWidth - 180)}px`,
                        top: "20px",
                      }}
                    >
                      <p className="font-bold text-foreground border-b border-border pb-1">
                        Period: {xPoints[hoverIndex].date}
                      </p>
                      <div className="flex items-center justify-between gap-4">
                        <span className="text-emerald-500 font-medium">Actual:</span>
                        <span className="font-semibold">
                          {formatNumber(xPoints[hoverIndex].actualVal)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-4">
                        <span className="text-slate-800 dark:text-sky-400 font-medium">Forecast:</span>
                        <span className="font-semibold">
                          {formatNumber(xPoints[hoverIndex].forecastVal)}
                        </span>
                      </div>
                      {xPoints[hoverIndex].actualVal !== null && (
                        <div className="flex items-center justify-between gap-4 pt-1 border-t border-border/50 text-[11px]">
                          <span className="text-muted-foreground">Variance:</span>
                          <span
                            className={
                              (xPoints[hoverIndex].forecastVal - (xPoints[hoverIndex].actualVal || 0)) >= 0
                                ? "text-amber-500 font-semibold"
                                : "text-emerald-500 font-semibold"
                            }
                          >
                            {(xPoints[hoverIndex].forecastVal - (xPoints[hoverIndex].actualVal || 0)) > 0 ? "+" : ""}
                            {formatNumber(xPoints[hoverIndex].forecastVal - (xPoints[hoverIndex].actualVal || 0))}
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="h-44 flex items-center justify-center text-xs text-muted-foreground">
                  No time series projection data available for this candidate model.
                </div>
              )}
            </div>

            {/* Bottom Section: 3-Row Metric Grid (Exact Match to Reference UI) */}
            <div className="p-5 border-t border-border bg-surface-muted/30">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Row 1, Col 1: ACTUAL TOTAL */}
                <div className="p-3.5 rounded-xl bg-card border border-border shadow-xs">
                  <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                    Actual Total
                  </div>
                  <div className="text-xl font-extrabold text-foreground mt-1">
                    {formatNumber(activeCandidate.totals?.actualTotal)}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    {activeCandidate.actualDataCoverage !== null
                      ? `${activeCandidate.actualDataCoverage}% coverage`
                      : "Out-of-sample ground truth"}
                  </div>
                </div>

                {/* Row 1, Col 2: FORECAST TOTAL */}
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

                {/* Row 1, Col 3: DIFFERENCE (+/- %) */}
                <div className="p-3.5 rounded-xl bg-card border border-border shadow-xs">
                  <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                    Difference (+ / -)
                  </div>
                  <div className="flex items-baseline gap-2 mt-1">
                    <span className="text-xl font-extrabold text-foreground">
                      {activeCandidate.totals?.difference !== null && activeCandidate.totals?.difference !== undefined
                        ? (activeCandidate.totals.difference > 0 ? "+" : "") + formatNumber(activeCandidate.totals.difference)
                        : "N/A"}
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
                    Total aggregate bias
                  </div>
                </div>

                {/* Row 2, Col 1: WAPE */}
                <div className="p-3.5 rounded-xl bg-card border border-border shadow-xs">
                  <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                    WAPE (Weighted Abs Error)
                  </div>
                  <div className="text-xl font-extrabold text-foreground mt-1">
                    {activeCandidate.metrics?.WAPE?.value !== null && activeCandidate.metrics?.WAPE?.value !== undefined
                      ? (activeCandidate.metrics.WAPE.value * 100).toFixed(2) + "%"
                      : "N/A"}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    Primary accuracy metric (lower is better)
                  </div>
                </div>

                {/* Row 2, Col 2: MAE / RMSE */}
                <div className="p-3.5 rounded-xl bg-card border border-border shadow-xs">
                  <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                    MAE / RMSE
                  </div>
                  <div className="text-base font-bold text-foreground mt-1 flex items-center gap-3">
                    <span>
                      MAE:{" "}
                      <span className="text-foreground font-extrabold">
                        {activeCandidate.metrics?.MAE?.value !== null && activeCandidate.metrics?.MAE?.value !== undefined
                          ? activeCandidate.metrics.MAE.value.toFixed(2)
                          : "N/A"}
                      </span>
                    </span>
                    <span className="text-muted-foreground">|</span>
                    <span>
                      RMSE:{" "}
                      <span className="text-foreground font-extrabold">
                        {activeCandidate.metrics?.RMSE?.value !== null && activeCandidate.metrics?.RMSE?.value !== undefined
                          ? activeCandidate.metrics.RMSE.value.toFixed(2)
                          : "N/A"}
                      </span>
                    </span>
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    Mean absolute vs root mean squared error
                  </div>
                </div>

                {/* Row 2, Col 3: PRECISION */}
                <div className="p-3.5 rounded-xl bg-card border border-border shadow-xs">
                  <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                    Precision
                  </div>
                  <div className="text-xl font-extrabold text-foreground mt-1">
                    {activeCandidate.metrics?.Precision?.value !== null && activeCandidate.metrics?.Precision?.value !== undefined
                      ? (activeCandidate.metrics.Precision.value * 100).toFixed(1) + "%"
                      : "N/A"}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    {activeCandidate.metrics?.Precision?.reason || "Classification threshold precision"}
                  </div>
                </div>

                {/* Row 3, Col 1: RECALL */}
                <div className="p-3.5 rounded-xl bg-card border border-border shadow-xs">
                  <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                    Recall
                  </div>
                  <div className="text-xl font-extrabold text-foreground mt-1">
                    {activeCandidate.metrics?.Recall?.value !== null && activeCandidate.metrics?.Recall?.value !== undefined
                      ? (activeCandidate.metrics.Recall.value * 100).toFixed(1) + "%"
                      : "N/A"}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    {activeCandidate.metrics?.Recall?.reason || "Classification sensitivity / true positive rate"}
                  </div>
                </div>

                {/* Row 3, Col 2: F1 SCORE */}
                <div className="p-3.5 rounded-xl bg-card border border-border shadow-xs">
                  <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                    F1 Score
                  </div>
                  <div className="text-xl font-extrabold text-foreground mt-1">
                    {activeCandidate.metrics?.F1?.value !== null && activeCandidate.metrics?.F1?.value !== undefined
                      ? activeCandidate.metrics.F1.value.toFixed(3)
                      : "N/A"}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    {activeCandidate.metrics?.F1?.reason || "Harmonic mean of precision and recall"}
                  </div>
                </div>

                {/* Row 3, Col 3: WEEKS / HORIZON */}
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
            </div>

            {/* Status Footer */}
            <div className="px-5 py-3 border-t border-border/60 bg-muted/20 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-muted-foreground">
              <div className="flex items-center gap-2">
                <CheckCircleIcon className="w-4 h-4 text-emerald-500" />
                <span>
                  Validation executed across {dates.length} records.
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

          {/* ─── Multi-Model Comparison Table ─── */}
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
                      <th className="pb-2">WAPE</th>
                      <th className="pb-2">MAE</th>
                      <th className="pb-2">RMSE</th>
                      <th className="pb-2">Status</th>
                      <th className="pb-2 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {candidates.map((cand, idx) => {
                      const isCandChampion = cand.model_id === championModelId;
                      const isCurrent = cand.model_id === selectedModelId;
                      return (
                        <tr
                          key={cand.model_id}
                          className={`hover:bg-muted/40 transition cursor-pointer ${isCurrent ? "bg-primary/5 font-semibold" : ""}`}
                          onClick={() => setSelectedModelId(cand.model_id)}
                        >
                          <td className="py-2.5 flex items-center gap-1.5">
                            {isCandChampion && <TrophyIcon className="w-3.5 h-3.5 text-amber-500" />}
                            <span>{cand.displayName || cand.model_id}</span>
                            {isCandChampion && (
                              <Badge variant="warning" className="text-[9px] py-0 px-1.5">Champion</Badge>
                            )}
                          </td>
                          <td className="py-2.5 text-muted-foreground">{cand.framework || "AutoML"}</td>
                          <td className="py-2.5 font-bold text-foreground">
                            {cand.score !== undefined ? cand.score.toFixed(4) : "N/A"}
                          </td>
                          <td className="py-2.5">
                            {cand.metrics?.WAPE?.value !== null && cand.metrics?.WAPE?.value !== undefined
                              ? (cand.metrics.WAPE.value * 100).toFixed(2) + "%"
                              : "N/A"}
                          </td>
                          <td className="py-2.5">
                            {cand.metrics?.MAE?.value !== null && cand.metrics?.MAE?.value !== undefined
                              ? cand.metrics.MAE.value.toFixed(2)
                              : "N/A"}
                          </td>
                          <td className="py-2.5">
                            {cand.metrics?.RMSE?.value !== null && cand.metrics?.RMSE?.value !== undefined
                              ? cand.metrics.RMSE.value.toFixed(2)
                              : "N/A"}
                          </td>
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
                                setSelectedModelId(cand.model_id);
                              }}
                              className={`text-[11px] px-2 py-1 rounded-md border transition ${
                                isCurrent
                                  ? "bg-primary text-primary-foreground border-primary"
                                  : "border-border text-foreground hover:bg-muted"
                              }`}
                            >
                              {isCurrent ? "Viewing" : "View Chart"}
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
