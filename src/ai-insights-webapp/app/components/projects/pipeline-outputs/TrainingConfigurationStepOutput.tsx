"use client";

import React, { useState, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import { Badge } from "./utils";

// Dynamically import Monaco Editor without SSR to prevent hydration mismatches
const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => (
    <div className="h-[600px] w-full flex items-center justify-center bg-surface-muted/50 rounded-xl border border-border">
      <div className="flex items-center gap-2.5 text-xs text-muted-foreground font-medium animate-pulse">
        <svg className="animate-spin h-4 w-4 text-primary" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
        </svg>
        <span>Loading Monaco Code Editor...</span>
      </div>
    </div>
  ),
});

interface TrainingConfigurationStepOutputProps {
  projectId?: string;
  trainingConfiguration?: any;
  modelSelection?: any;
  activeRunTimestamp?: string;
  onConfigSaved?: (updatedConfig: Record<string, any>) => void;
}

export default function TrainingConfigurationStepOutput({
  projectId,
  trainingConfiguration,
  modelSelection,
  activeRunTimestamp,
  onConfigSaved,
}: TrainingConfigurationStepOutputProps) {
  const [activeTab, setActiveTab] = useState<"view" | "edit">("view");
  const [yamlContent, setYamlContent] = useState<string>("");
  const [originalYaml, setOriginalYaml] = useState<string>("");
  const [parsedData, setParsedData] = useState<Record<string, any>>({});
  const [fileName, setFileName] = useState<string>("TrainingJobContract.yaml");
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState<boolean>(false);

  // Fetch contract from backend
  const fetchContract = useCallback(async () => {
    if (!projectId) {
      // Fallback from prop
      const config = trainingConfiguration?.configuration || trainingConfiguration || {};
      setParsedData(config);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setErrorMsg(null);
    try {
      const url = `http://localhost:5000/api/training-config/${projectId}${
        activeRunTimestamp ? `?timestamp=${encodeURIComponent(activeRunTimestamp)}` : ""
      }`;
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`Failed to load training contract (${res.statusText})`);
      }
      const json = await res.json();
      if (json.success && json.data) {
        setYamlContent(json.data.yamlContent || "");
        setOriginalYaml(json.data.yamlContent || "");
        setParsedData(json.data.parsedConfig || {});
        if (json.data.filename) {
          setFileName(json.data.filename);
        }
      }
    } catch (err: any) {
      console.warn("[TrainingConfig] Could not fetch contract from API:", err);
      // Fallback to trainingConfiguration prop
      const config = trainingConfiguration?.configuration || trainingConfiguration || {};
      setParsedData(config);
      setErrorMsg("Could not fetch remote YAML. Showing loaded memory configuration.");
    } finally {
      setIsLoading(false);
    }
  }, [projectId, activeRunTimestamp, trainingConfiguration]);

  useEffect(() => {
    fetchContract();
  }, [fetchContract]);

  // Handle saving YAML back to file server
  const handleSaveYaml = async () => {
    if (!projectId) {
      setErrorMsg("Project ID is missing. Cannot save contract to file server.");
      return;
    }
    setIsSaving(true);
    setErrorMsg(null);
    setSaveSuccessMsg(null);

    try {
      const res = await fetch(`http://localhost:5000/api/training-config/${projectId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          yamlContent,
          timestamp: activeRunTimestamp,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || "Failed to save YAML contract to file server");
      }

      setOriginalYaml(yamlContent);
      setParsedData(data.data?.parsedConfig || parsedData);
      if (data.data?.filename) {
        setFileName(data.data.filename);
      }
      setSaveSuccessMsg("Successfully saved to file server!");
      setTimeout(() => setSaveSuccessMsg(null), 4000);

      if (onConfigSaved && data.data?.parsedConfig) {
        onConfigSaved(data.data.parsedConfig);
      }
    } catch (err: any) {
      console.error("[TrainingConfig] Save error:", err);
      setErrorMsg(err?.message || "Failed to save contract to file server");
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = () => {
    setYamlContent(originalYaml);
    setErrorMsg(null);
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(yamlContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const isDirty = yamlContent !== originalYaml;

  // Extract structured contract sections
  const trainingJob = parsedData.training_job || {};
  const task = parsedData.task || {};
  const split = parsedData.split || {};
  const imbalance = parsedData.imbalance || {};
  const hpo = parsedData.hyperparameter_optimization || {};
  const evaluation = parsedData.evaluation || {};
  const validationGates = parsedData.validation_gates || {};
  const modelSel = parsedData.model_selection || modelSelection || {};
  const confirmedModels = Array.isArray(modelSel.models) && modelSel.models.length > 0
    ? modelSel.models
    : (Array.isArray(modelSel.candidates) ? modelSel.candidates : []);
  const artifacts = parsedData.artifacts || {};

  const primaryMetricName =
    parsedData["x-primary-metric-name"] ||
    parsedData.primary_metric_name ||
    evaluation.primary_metric?.value ||
    modelSel.primary_metric ||
    "f1_score";

  const primaryMetricDef =
    parsedData["x-primary-metric-def"] ||
    evaluation.primary_metric ||
    {};

  const trainRatio = split.train_ratio != null ? Math.round(split.train_ratio * 100) : 70;
  const valRatio = split.validation_ratio != null ? Math.round(split.validation_ratio * 100) : 15;
  const testRatio = split.test_ratio != null ? Math.round(split.test_ratio * 100) : 15;

  return (
    <div className="space-y-6 animate-fadeIn text-foreground">
      {/* ─── Top Control Bar: Mode Toggle & File Header ───────────────────────── */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-4 rounded-2xl border border-border bg-gradient-to-r from-surface to-surface-muted shadow-xs">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center font-bold shrink-0">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="2" y="3" width="20" height="14" rx="2" />
              <line x1="8" y1="21" x2="16" y2="21" />
              <line x1="12" y1="17" x2="12" y2="21" />
            </svg>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-foreground">Training Job Contract</h3>
              <span className="text-[11px] font-mono px-2 py-0.5 rounded-md bg-surface-muted border border-border text-muted-foreground">
                {fileName}
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Automated ML training contract schema stored on file server.
            </p>
          </div>
        </div>

        {/* Mode Switcher Tabs */}
        <div className="flex items-center bg-surface-muted border border-border p-1 rounded-xl shadow-2xs self-stretch sm:self-auto justify-center">
          <button
            type="button"
            onClick={() => setActiveTab("view")}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              activeTab === "view"
                ? "bg-surface text-foreground shadow-xs font-bold"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
            <span>View Mode</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("edit")}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              activeTab === "edit"
                ? "bg-surface text-foreground shadow-xs font-bold"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="16 18 22 12 16 6" />
              <polyline points="8 6 2 12 8 18" />
            </svg>
            <span>Code Edit Mode</span>
            {isDirty && (
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" title="Unsaved changes" />
            )}
          </button>
        </div>
      </div>

      {/* ─── Feedback Alerts ────────────────────────────────────────────────── */}
      {saveSuccessMsg && (
        <div className="p-3.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs font-semibold flex items-center justify-between animate-fadeIn">
          <div className="flex items-center gap-2">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            <span>{saveSuccessMsg}</span>
          </div>
          <span className="text-[10px] text-muted-foreground font-mono">{fileName}</span>
        </div>
      )}

      {errorMsg && (
        <div className="p-3.5 rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400 text-xs font-semibold flex items-center gap-2 animate-fadeIn">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span>{errorMsg}</span>
        </div>
      )}

      {/* ─── Mode 1: View Mode ──────────────────────────────────────────────── */}
      {activeTab === "view" && (
        <div className="space-y-6 animate-fadeIn">
          {/* Section 1: ML Task & Job Details Banner */}
          <div className="rounded-2xl border border-border/80 bg-surface p-5 shadow-xs">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 flex-wrap mb-1.5">
                  <Badge variant="primary" className="uppercase tracking-wider">
                    {task.task_type || "Classification"}
                  </Badge>
                  {task.task_subtype && (
                    <Badge variant="teal">Subtype: {task.task_subtype}</Badge>
                  )}
                  {task.learning_type && (
                    <Badge variant="neutral">Learning: {task.learning_type}</Badge>
                  )}
                  <Badge variant="purple">Version: {trainingJob.version || "1.0.0"}</Badge>
                </div>
                <h2 className="text-base font-bold text-foreground flex items-center gap-2">
                  <span>Experiment:</span>
                  <span className="text-primary font-mono font-bold">
                    {trainingJob.experiment_name || trainingJob.job_id || "Training Experiment"}
                  </span>
                </h2>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                  {trainingJob.description || "Training pipeline configuration contract generated for candidate models."}
                </p>
              </div>

              <div className="bg-surface-muted border border-border rounded-xl px-4 py-3 shadow-2xs self-start md:self-auto min-w-[200px]">
                <span className="text-[10px] uppercase font-bold text-muted-foreground block">Job Identifier</span>
                <span className="text-xs font-mono font-bold text-foreground block truncate max-w-[240px]">
                  {trainingJob.job_id || "job_training_contract"}
                </span>
                <span className="text-[10px] text-muted-foreground mt-1 block">
                  Created by: {trainingJob.created_by || "AutoML Platform"}
                </span>
              </div>
            </div>
          </div>

          {/* Section 2: Primary Metric & Data Splitting Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* Primary Metric Card */}
            <div className="rounded-2xl border border-border bg-surface p-5 shadow-xs flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                    </svg>
                    Primary Metric & Goal
                  </div>
                  <Badge variant="success" className="uppercase">
                    Direction: {parsedData.objective?.direction || "maximize"}
                  </Badge>
                </div>

                <div className="flex items-baseline gap-3 my-2">
                  <span className="text-2xl font-extrabold font-mono text-primary tracking-tight">
                    {primaryMetricName}
                  </span>
                  {primaryMetricDef.confidence && (
                    <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                      {((primaryMetricDef.confidence as number) * 100).toFixed(0)}% Confidence
                    </span>
                  )}
                </div>

                <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
                  {primaryMetricDef.rationale || "Optimizes predictive performance balanced against generalization criteria."}
                </p>

                {Array.isArray(primaryMetricDef.evidence) && primaryMetricDef.evidence.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-border/60">
                    <span className="text-[10px] uppercase font-bold text-muted-foreground block mb-1">Evidence & Business Rationale</span>
                    <ul className="space-y-1">
                      {primaryMetricDef.evidence.map((item: string, i: number) => (
                        <li key={i} className="text-xs text-foreground/80 flex items-start gap-1.5">
                          <span className="text-primary font-bold">•</span>
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              {/* Secondary Metrics */}
              {Array.isArray(evaluation.secondary_metrics) && evaluation.secondary_metrics.length > 0 && (
                <div className="mt-4 pt-3 border-t border-border flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] uppercase font-bold text-muted-foreground">Secondary Metrics:</span>
                  {evaluation.secondary_metrics.map((m: string) => (
                    <Badge key={m} variant="neutral">{m}</Badge>
                  ))}
                </div>
              )}
            </div>

            {/* Data Splitting & Stratification Card */}
            <div className="rounded-2xl border border-border bg-surface p-5 shadow-xs flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="3" y="3" width="18" height="18" rx="2" />
                      <line x1="9" y1="3" x2="9" y2="21" />
                      <line x1="15" y1="3" x2="15" y2="21" />
                    </svg>
                    Data Splitting Strategy
                  </div>
                  <Badge variant="primary" className="uppercase">
                    {split.strategy || "Random Stratified"}
                  </Badge>
                </div>

                {/* Visual Segmented Progress Bar */}
                <div className="my-3 space-y-1.5">
                  <div className="flex items-center justify-between text-[11px] font-semibold">
                    <span className="text-indigo-600 dark:text-indigo-400">Train ({trainRatio}%)</span>
                    <span className="text-violet-600 dark:text-violet-400">Validation ({valRatio}%)</span>
                    <span className="text-teal-600 dark:text-teal-400">Test ({testRatio}%)</span>
                  </div>
                  <div className="h-3 w-full rounded-full bg-surface-muted overflow-hidden flex shadow-inner">
                    <div style={{ width: `${trainRatio}%` }} className="h-full bg-indigo-500" title={`Train: ${trainRatio}%`} />
                    <div style={{ width: `${valRatio}%` }} className="h-full bg-violet-500" title={`Validation: ${valRatio}%`} />
                    <div style={{ width: `${testRatio}%` }} className="h-full bg-teal-500" title={`Test: ${testRatio}%`} />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 mt-4">
                  <div className="p-3 rounded-xl bg-surface-muted border border-border">
                    <span className="text-[10px] uppercase font-bold text-muted-foreground block">Random Seed</span>
                    <span className="text-xs font-mono font-bold text-foreground">{split.random_seed ?? 42}</span>
                  </div>
                  <div className="p-3 rounded-xl bg-surface-muted border border-border">
                    <span className="text-[10px] uppercase font-bold text-muted-foreground block">Cross-Validation</span>
                    <span className="text-xs font-semibold text-foreground">
                      {split.cross_validation?.enabled
                        ? `${split.cross_validation.folds || 5}-Fold (${split.cross_validation.strategy || "K-Fold"})`
                        : "Hold-out split"}
                    </span>
                  </div>
                </div>

                {/* Class Imbalance Section */}
                <div className="mt-3 pt-3 border-t border-border flex items-center justify-between text-xs">
                  <span className="text-muted-foreground font-medium">Class Imbalance:</span>
                  <div className="flex items-center gap-2">
                    <Badge variant={imbalance.detected ? "warning" : "success"}>
                      {imbalance.detected ? `Detected (Ratio: ${imbalance.ratio || "N/A"})` : "Balanced"}
                    </Badge>
                    {imbalance.sampling?.method && imbalance.sampling.method !== "none" && (
                      <Badge variant="neutral">Sampling: {imbalance.sampling.method}</Badge>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Section 3: Confirmed Models for Training */}
          <div className="rounded-2xl border border-border bg-surface p-5 shadow-xs">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-primary/10 text-primary flex items-center justify-center font-bold text-xs">
                  {confirmedModels.length}
                </div>
                <div>
                  <h4 className="text-sm font-bold text-foreground">Confirmed Models for Training</h4>
                  <p className="text-[11px] text-muted-foreground">
                    Only these selected model architectures are persisted in the contract for training.
                  </p>
                </div>
              </div>
              <Badge variant="purple" className="uppercase">
                AutoML Search
              </Badge>
            </div>

            {confirmedModels.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
                {confirmedModels.map((model: any, index: number) => {
                  const modelId = model.model_id || `model_${index + 1}`;
                  const isEnabled = model.enabled !== false;
                  return (
                    <div
                      key={modelId}
                      className="p-4 rounded-xl border border-border bg-surface-muted/60 hover:bg-surface-muted transition-all"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-bold text-foreground font-mono truncate max-w-[180px]">
                          {modelId}
                        </span>
                        <Badge variant={isEnabled ? "success" : "neutral"}>
                          {isEnabled ? "Enabled" : "Disabled"}
                        </Badge>
                      </div>

                      <div className="space-y-1 text-[11px] text-muted-foreground">
                        <div className="flex items-center justify-between">
                          <span>Framework:</span>
                          <span className="font-semibold text-foreground uppercase">{model.framework || "Custom"}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span>Algorithm:</span>
                          <span className="font-semibold text-foreground truncate max-w-[140px]">
                            {model.algorithm || model.displayName || modelId}
                          </span>
                        </div>
                        {model.suitability_score && (
                          <div className="flex items-center justify-between">
                            <span>Score:</span>
                            <span className="font-bold text-emerald-600 dark:text-emerald-400">
                              {(model.suitability_score * 100).toFixed(0)}%
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="p-6 text-center text-xs text-muted-foreground">
                No models currently confirmed in contract. Return to Model Selection to choose candidate models.
              </div>
            )}
          </div>

          {/* Section 4: HPO & Validation Gates Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* Hyperparameter Optimization */}
            <div className="rounded-2xl border border-border bg-surface p-5 shadow-xs">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                  </svg>
                  Hyperparameter Optimization (HPO)
                </div>
                <Badge variant={hpo.enabled ? "primary" : "neutral"}>
                  {hpo.enabled ? "Enabled" : "Disabled"}
                </Badge>
              </div>

              <div className="grid grid-cols-2 gap-3 mt-3">
                <div className="p-3 rounded-xl bg-surface-muted border border-border">
                  <span className="text-[10px] uppercase font-bold text-muted-foreground block">Search Method</span>
                  <span className="text-xs font-bold text-foreground uppercase">{hpo.method || "Bayesian"}</span>
                </div>
                <div className="p-3 rounded-xl bg-surface-muted border border-border">
                  <span className="text-[10px] uppercase font-bold text-muted-foreground block">Max Trials</span>
                  <span className="text-xs font-mono font-bold text-foreground">{hpo.max_trials ?? 25}</span>
                </div>
              </div>

              {parsedData.search_space && Object.keys(parsedData.search_space).length > 0 && (
                <div className="mt-3 pt-3 border-t border-border">
                  <span className="text-[10px] uppercase font-bold text-muted-foreground block mb-2">Search Space Parameters</span>
                  <div className="flex flex-wrap gap-1.5">
                    {Object.keys(parsedData.search_space).map((paramKey) => (
                      <Badge key={paramKey} variant="neutral" className="font-mono">
                        {paramKey}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Validation Gates */}
            <div className="rounded-2xl border border-border bg-surface p-5 shadow-xs">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  </svg>
                  Validation Gates & Thresholds
                </div>
                <Badge variant="teal" className="uppercase">
                  {validationGates.pass_condition || "All Gates Pass"}
                </Badge>
              </div>

              <div className="space-y-2 mt-3 text-xs">
                <div className="p-2.5 rounded-lg bg-surface-muted border border-border flex items-center justify-between">
                  <span className="text-muted-foreground">Max Overfitting Gap:</span>
                  <span className="font-mono font-bold text-foreground">
                    {validationGates.maximum_overfitting_gap != null ? `${validationGates.maximum_overfitting_gap}` : "0.08 (8%)"}
                  </span>
                </div>
                <div className="p-2.5 rounded-lg bg-surface-muted border border-border flex items-center justify-between">
                  <span className="text-muted-foreground">Max Latency Constraint:</span>
                  <span className="font-mono font-bold text-foreground">
                    {validationGates.maximum_latency || "50ms"}
                  </span>
                </div>
                <div className="p-2.5 rounded-lg bg-surface-muted border border-border flex items-center justify-between">
                  <span className="text-muted-foreground">Export Format:</span>
                  <span className="font-mono font-bold text-primary uppercase">
                    {artifacts.serialization_format || "onnx"}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── Mode 2: Code Edit Mode (Monaco YAML Editor) ────────────────────── */}
      {activeTab === "edit" && (
        <div className="rounded-2xl border border-border bg-surface shadow-sm overflow-hidden animate-fadeIn">
          {/* Editor Action Toolbar */}
          <div className="p-3.5 border-b border-border bg-surface-muted flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className="text-xs font-mono font-bold text-foreground">
                {fileName}
              </span>
              {isDirty ? (
                <Badge variant="warning">Unsaved Changes</Badge>
              ) : (
                <Badge variant="success">Saved to File Server</Badge>
              )}
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={handleCopy}
                className="px-3 py-1.5 rounded-lg bg-surface hover:bg-surface/80 border border-border text-xs font-semibold text-foreground transition-all cursor-pointer shadow-2xs inline-flex items-center gap-1.5"
              >
                {copied ? (
                  <>
                    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-emerald-500">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    <span>Copied!</span>
                  </>
                ) : (
                  <>
                    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                    </svg>
                    <span>Copy YAML</span>
                  </>
                )}
              </button>

              <button
                type="button"
                disabled={!isDirty || isSaving}
                onClick={handleReset}
                className="px-3 py-1.5 rounded-lg bg-surface hover:bg-surface/80 border border-border text-xs font-semibold text-muted-foreground hover:text-foreground transition-all cursor-pointer shadow-2xs disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Reset
              </button>

              <button
                type="button"
                disabled={isSaving}
                onClick={handleSaveYaml}
                className="px-4 py-1.5 rounded-lg bg-primary hover:bg-primary/90 text-white text-xs font-bold tracking-wide transition-all shadow-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
              >
                {isSaving ? (
                  <>
                    <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                    <span>Saving...</span>
                  </>
                ) : (
                  <>
                    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                      <polyline points="17 21 17 13 7 13 7 21" />
                      <polyline points="7 3 7 8 15 8" />
                    </svg>
                    <span>Save YAML to File Server</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Monaco Editor Container */}
          <div className="h-[650px] w-full bg-[#1e1e1e]">
            <MonacoEditor
              height="100%"
              language="yaml"
              theme="vs-dark"
              value={yamlContent}
              onChange={(value) => setYamlContent(value || "")}
              options={{
                lineNumbers: "on",
                minimap: { enabled: true },
                scrollBeyondLastLine: false,
                wordWrap: "on",
                fontSize: 13,
                tabSize: 2,
                automaticLayout: true,
                renderWhitespace: "selection",
                folding: true,
                padding: { top: 12, bottom: 12 },
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
