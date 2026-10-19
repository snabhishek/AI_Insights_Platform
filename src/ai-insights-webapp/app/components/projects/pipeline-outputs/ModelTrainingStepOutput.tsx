"use client";

import React, { useState } from "react";
import ModelExportButton from "./ModelExportButton";
import { BACKEND_URL } from "../../providers/AppContext";
import { VALIDATION_UI_STRINGS } from "../validationConstants";

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
  onApproveTraining?: (selectedModels: string[], splitEndDate?: string) => void;
  onApproveValidation?: (selectedModels: string[]) => void;
  onNavigateToValidation?: (selectedModels: string[]) => void;
  nextStepInProgress?: boolean;
  isApproving?: boolean;
}

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
  onNavigateToValidation,
  nextStepInProgress = false,
  isApproving = false,
}: ModelTrainingStepOutputProps) {
  const [activePlotModal, setActivePlotModal] = useState<{ title: string; url: string } | null>(null);

  let reportCandidates: any[] = [];
  const rawReportPayload =
    modelTraining?.report?.model_results ||
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
    (Array.isArray(modelTraining?.executedModels) && modelTraining.executedModels.length > 0
      ? modelTraining.executedModels
      : reportCandidates.length > 0
        ? reportCandidates
        : Array.isArray(modelTraining?.rankedCandidates) && modelTraining.rankedCandidates.length > 0
          ? modelTraining.rankedCandidates
          : Array.isArray(modelTraining?.candidates)
            ? modelTraining.candidates
            : []);

  const primaryMetricKey =
    modelTraining?.report?.primary_metric ||
    modelTraining?.report?.primary_metric_name ||
    trainingConfiguration?.configuration?.["x-primary-metric-name"] ||
    trainingConfiguration?.configuration?.objective?.optimization_metric ||
    (typeof trainingConfiguration?.configuration?.["x-primary-metric-def"] === "object"
      ? trainingConfiguration.configuration["x-primary-metric-def"]?.value
      : trainingConfiguration?.configuration?.["x-primary-metric-def"]) ||
    modelSelection?.primary_metric;

  const rawCandidateList: CandidateModelItem[] = sourceCandidates.flatMap((c: any) => {
    const modelId = String(typeof c === "string" ? c : (c.model_id || c.id || c.name || c.model_name || "")).trim();
    if (!modelId) return [];
    const displayName = String(
      (typeof c === "object" ? c.displayName || c.display_name || c.algorithm || c.name : null) || modelId
    );
    const framework = String(
      (typeof c === "object" ? c.framework : null) || ""
    );
    const status = c.status === "SUCCESS" || c.status === "Completed"
      ? "Completed"
      : c.status === "FAILED" || c.status === "Failed" || c.error
        ? "Failed"
        : undefined;

    const validationMetrics = c.validationMetrics || c.validation_metrics || c.metrics || c.val_metrics || {};
    const testMetrics = c.testMetrics || c.test_metrics || {};

    const getMetricValue = (metricsObj: any, metricKey?: string): number | undefined => {
      if (!metricsObj || typeof metricsObj !== "object") return undefined;
      if (metricKey) {
        if (typeof metricsObj[metricKey] === "number" && !Number.isNaN(metricsObj[metricKey])) {
          return metricsObj[metricKey];
        }
        const lower = metricKey.toLowerCase();
        for (const [k, v] of Object.entries(metricsObj)) {
          if (k.toLowerCase() === lower && typeof v === "number" && !Number.isNaN(v)) {
            return v as number;
          }
        }
      }
      if (typeof metricsObj.score === "number" && !Number.isNaN(metricsObj.score)) {
        return metricsObj.score;
      }
      return undefined;
    };

    const testScore = getMetricValue(testMetrics, primaryMetricKey);
    const valScore = getMetricValue(validationMetrics, primaryMetricKey);

    let score: number | undefined = undefined;
    if (typeof c.score === "number" && !Number.isNaN(c.score)) {
      score = c.score;
    } else if (testScore !== undefined) {
      score = testScore;
    } else if (valScore !== undefined) {
      score = valScore;
    } else if (typeof c.primary_metric_value === "number" && !Number.isNaN(c.primary_metric_value)) {
      score = c.primary_metric_value;
    } else if (typeof c.val_score === "number" && !Number.isNaN(c.val_score)) {
      score = c.val_score;
    } else if (typeof c.validation_score === "number" && !Number.isNaN(c.validation_score)) {
      score = c.validation_score;
    } else if (typeof c.metric_score === "number" && !Number.isNaN(c.metric_score)) {
      score = c.metric_score;
    } else {
      const firstTestMetric = Object.values(testMetrics).find((v) => typeof v === "number" && !Number.isNaN(v as number)) as number | undefined;
      const firstValMetric = Object.values(validationMetrics).find((v) => typeof v === "number" && !Number.isNaN(v as number)) as number | undefined;
      if (typeof firstTestMetric === "number") {
        score = firstTestMetric;
      } else if (typeof firstValMetric === "number") {
        score = firstValMetric;
      } else if (typeof c.suitability_score === "number" && !Number.isNaN(c.suitability_score)) {
        score = c.suitability_score;
      }
    }

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

    return [{
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
    }];
  });

  const uniqueCandidateMap = new Map<string, CandidateModelItem>();
  for (const c of rawCandidateList) {
    if (!uniqueCandidateMap.has(c.model_id)) {
      uniqueCandidateMap.set(c.model_id, c);
    }
  }
  const candidateModels = Array.from(uniqueCandidateMap.values());

  const configuredModelLists = [
    trainingConfiguration?.models,
    trainingConfiguration?.configuration?.model_selection?.models,
    trainingConfiguration?.configuration?.models,
  ];
  const configuredModels = configuredModelLists.find(
    (models: unknown): models is unknown[] => Array.isArray(models) && models.length > 0
  );
  const configuredTrainingModelIds: string[] = configuredModels
    ? Array.from(new Set(
        configuredModels
          .filter(
            (model): model is string | Record<string, unknown> =>
              typeof model === "string" ||
              Boolean(model && typeof model === "object" && !Array.isArray(model))
          )
          .filter((model) => typeof model === "string" || model.enabled !== false)
          .map((model) => typeof model === "string" ? model : model.model_id || model.id)
          .filter((modelId: unknown): modelId is string => typeof modelId === "string" && modelId.trim().length > 0)
          .map((modelId) => modelId.trim())
      ))
    : [];

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
    report?.best_model_id ||
    report?.champion_model_id ||
    modelTraining?.selectedModel ||
    report?.selectedModel ||
    report?.champion_model;

  const direction = String(
    report?.direction ||
    trainingConfiguration?.configuration?.["x-primary-metric-def"]?.direction ||
    trainingConfiguration?.configuration?.objective?.direction ||
    trainingConfiguration?.configuration?.model_selection?.direction ||
    modelSelection?.direction ||
    "maximize"
  ).toLowerCase();

  const isMinimize = direction === "minimize";

  const sortedCandidateModels = [...candidateModels].sort((a, b) => {
    if (a.model_id?.toLowerCase() === championModelId?.toLowerCase()) return -1;
    if (b.model_id?.toLowerCase() === championModelId?.toLowerCase()) return 1;
    if (a.score == null && b.score == null) return 0;
    if (a.score == null) return 1;
    if (b.score == null) return -1;
    return isMinimize ? a.score - b.score : b.score - a.score;
  });

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
    <div className="w-full space-y-6">

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
                Preparing Script to train models
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

      {!hasExecutionReport && (
        <div className="rounded-2xl border-2 border-primary/30 bg-primary/5 dark:bg-primary/10 p-5 space-y-5 animate-fadeIn">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-border/80">
            <div>
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-0.5 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-bold text-xs">
                  ✓ Ready for Execution
                </span>
                <span className="text-xs font-bold text-foreground">
                  Training Configuration Models
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Model selection is controlled by the completed backend training configuration.
              </p>
            </div>
            <p className="text-xs font-semibold text-foreground">
              {configuredTrainingModelIds.length} enabled model(s) in the training configuration.
            </p>
          </div>

          <div className="pt-3 border-t border-border/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              Model details will be shown after the backend records the execution output.
            </p>

            <button
              type="button"
              disabled={configuredTrainingModelIds.length === 0 || isApproving || nextStepInProgress}
              onClick={() => {
                if (onApproveTraining) {
                  onApproveTraining(configuredTrainingModelIds);
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
                  <span>Execute Training in Docker ({configuredTrainingModelIds.length} Models)</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}


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
                  <th className="py-3 px-4">{primaryMetricKey ? `${primaryMetricKey} Score` : "Score"}</th>
                  <th className="py-3 px-4">Validation Metrics</th>
                  <th className="py-3 px-4">Duration</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Export</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {sortedCandidateModels.map((m, idx) => {
                  const isChampion = m.model_id?.toLowerCase() === championModelId?.toLowerCase();
                  const metrics =
                    m.testMetrics && Object.keys(m.testMetrics).length > 0
                      ? m.testMetrics
                      : m.validationMetrics && Object.keys(m.validationMetrics).length > 0
                      ? m.validationMetrics
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
                          ? (m.score % 1 !== 0 ? m.score.toFixed(4) : m.score)
                          : typeof metrics.score === "number"
                          ? (metrics.score % 1 !== 0 ? metrics.score.toFixed(4) : metrics.score)
                          : "—"}
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex flex-wrap gap-1.5">
                          {Object.keys(metrics).length > 0 ? (
                            Object.entries(metrics).map(([k, v]) => (
                              <span
                                key={k}
                                className="px-1.5 py-0.5 rounded bg-surface border border-border font-mono text-[10px]"
                              >
                                {k}: {typeof v === "number" ? (v % 1 !== 0 ? v.toFixed(4) : v) : String(v)}
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
                      <td className="py-3 px-4">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                          <CheckCircleIcon className="w-3 h-3" />
                          {m.status || "Status unavailable"}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <ModelExportButton
                          projectId={projectId}
                          runTimestamp={activeRunTimestamp}
                          modelId={m.model_id}
                          displayName={m.displayName || m.model_id}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {hasExecutionReport && (
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 dark:bg-emerald-950/20 p-5 shadow-sm animate-fadeIn">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start sm:items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-600 dark:text-emerald-400 shrink-0">
                <CheckCircleIcon className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-foreground">
                  {VALIDATION_UI_STRINGS.TRAINING_COMPLETED_TITLE}
                </h4>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {VALIDATION_UI_STRINGS.TRAINING_COMPLETED_DESC}
                </p>
              </div>
            </div>

            {onNavigateToValidation && (
              <button
                type="button"
                disabled={nextStepInProgress}
                onClick={() => onNavigateToValidation([])}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-white text-xs font-bold tracking-wide shadow-sm hover:bg-primary/90 transition-all cursor-pointer shrink-0"
              >
                <span>{VALIDATION_UI_STRINGS.NAVIGATE_TO_VALIDATION_BUTTON}</span>
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>
            )}
          </div>
        </div>
      )}

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
                disabled={nextStepInProgress}
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
