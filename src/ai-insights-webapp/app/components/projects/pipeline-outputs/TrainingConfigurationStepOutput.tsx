"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import dynamic from "next/dynamic";
import { Badge } from "./utils";
import { BACKEND_URL } from "../../providers/AppContext";

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

  // Candidate models re-selection state
  const [selectedModelIds, setSelectedModelIds] = useState<string[]>([]);
  const [hasUserEditedSelection, setHasUserEditedSelection] = useState<boolean>(false);
  const [isApplyingModels, setIsApplyingModels] = useState<boolean>(false);
  const [applySuccessMsg, setApplySuccessMsg] = useState<string | null>(null);
  const [expandedModelId, setExpandedModelId] = useState<string | null>(null);

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
      const url = `${BACKEND_URL}/training-config/${projectId}${
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
      const res = await fetch(`${BACKEND_URL}/training-config/${projectId}`, {
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
  const confirmedModels = useMemo(() => {
    if (Array.isArray(parsedData.model_selection?.models) && parsedData.model_selection.models.length > 0) {
      return parsedData.model_selection.models;
    }
    if (Array.isArray(modelSelection?.userSelection?.selectedModelIds) && modelSelection.userSelection.selectedModelIds.length > 0) {
      return modelSelection.userSelection.selectedModelIds;
    }
    if (Array.isArray(trainingConfiguration?.models) && trainingConfiguration.models.length > 0) {
      return trainingConfiguration.models;
    }
    if (Array.isArray(modelSelection?.selectedModelIds) && modelSelection.selectedModelIds.length > 0) {
      return modelSelection.selectedModelIds;
    }
    if (Array.isArray(modelSelection?.models) && modelSelection.models.length > 0) {
      return modelSelection.models;
    }
    return [];
  }, [parsedData.model_selection?.models, modelSelection, trainingConfiguration]);

  const artifacts = parsedData.artifacts || {};

  // Build a consolidated candidate pool from modelSelection and parsedData
  const candidatePool = useMemo(() => {
    const rawCandidates: any[] =
      modelSelection?.decision?.candidates ||
      modelSelection?.candidates ||
      modelSelection?.decision?.all_candidates ||
      [];

    const map = new Map<string, any>();
    for (const c of rawCandidates) {
      const id = c?.model_id || c?.id;
      if (id) {
        map.set(id, {
          ...c,
          model_id: id,
          algorithm: c.algorithm || c.displayName || id,
          framework: c.framework || "custom",
          suitability_score: c.suitability_score ?? c.score,
        });
      }
    }

    if (Array.isArray(parsedData.model_selection?.models)) {
      for (const m of parsedData.model_selection.models) {
        const id = typeof m === "string" ? m : (m?.model_id || m?.id);
        if (id) {
          if (!map.has(id)) {
            map.set(id, {
              ...(typeof m === "string" ? {} : m),
              model_id: id,
              algorithm: typeof m === "string" ? m : (m.algorithm || id),
              framework: typeof m === "string" ? "custom" : (m.framework || "custom"),
              suitability_score: typeof m === "string" ? 0.9 : m.suitability_score,
            });
          }
        }
      }
    }

    if (Array.isArray(confirmedModels)) {
      for (const m of confirmedModels) {
        const id = typeof m === "string" ? m : (m?.model_id || m?.id);
        if (id && !map.has(id)) {
          map.set(id, {
            ...(typeof m === "string" ? {} : m),
            model_id: id,
            algorithm: typeof m === "string" ? m : (m.algorithm || m.displayName || id),
            framework: typeof m === "string" ? "custom" : (m.framework || "custom"),
            suitability_score: typeof m === "string" ? 0.9 : m.suitability_score,
          });
        }
      }
    }

    return Array.from(map.values());
  }, [modelSelection, parsedData.model_selection, confirmedModels]);

  // Synchronize initial selection from contract or modelSelection
  useEffect(() => {
    if (hasUserEditedSelection) return;

    // 1. First priority: parsedData.model_selection.models
    if (Array.isArray(parsedData.model_selection?.models) && parsedData.model_selection.models.length > 0) {
      const ids = parsedData.model_selection.models
        .filter((m: any) => m.enabled !== false)
        .map((m: any) => (typeof m === "string" ? m : (m.model_id || m.id)))
        .filter(Boolean);
      if (ids.length > 0) {
        setSelectedModelIds(ids);
        return;
      }
    }

    // 2. Second priority: modelSelection user selection
    const msUserSelection =
      modelSelection?.userSelection?.selectedModelIds ||
      modelSelection?.selectedModelIds;
    if (Array.isArray(msUserSelection) && msUserSelection.length > 0) {
      setSelectedModelIds(msUserSelection);
      return;
    }

    // 3. Third priority: trainingConfiguration.models
    if (Array.isArray(trainingConfiguration?.models) && trainingConfiguration.models.length > 0) {
      const ids = trainingConfiguration.models
        .map((m: any) => (typeof m === "string" ? m : (m.model_id || m.id)))
        .filter(Boolean);
      if (ids.length > 0) {
        setSelectedModelIds(ids);
        return;
      }
    }

    // 4. Fourth priority: confirmedModels
    if (Array.isArray(confirmedModels) && confirmedModels.length > 0) {
      const ids = confirmedModels
        .map((m: any) => (typeof m === "string" ? m : (m.model_id || m.id)))
        .filter(Boolean);
      if (ids.length > 0) {
        setSelectedModelIds(ids);
        return;
      }
    }

    // 5. Fifth priority: If no prior selection exists anywhere, default strictly to recommended model (rank 1)
    if (candidatePool.length > 0) {
      const rec = candidatePool.find((c: any) => c.is_recommended || c.rank === 1);
      if (rec?.model_id) {
        setSelectedModelIds([rec.model_id]);
      } else {
        setSelectedModelIds([candidatePool[0].model_id]);
      }
    }
  }, [parsedData.model_selection, modelSelection, trainingConfiguration, confirmedModels, candidatePool, hasUserEditedSelection]);

  const toggleModel = (modelId: string) => {
    setHasUserEditedSelection(true);
    setSelectedModelIds((prev) => {
      if (prev.includes(modelId)) {
        if (prev.length <= 1) {
          setErrorMsg("At least one candidate model must remain selected for training.");
          setTimeout(() => setErrorMsg(null), 3000);
          return prev;
        }
        return prev.filter((id) => id !== modelId);
      } else {
        return [...prev, modelId];
      }
    });
  };

  const selectAllCandidates = () => {
    setHasUserEditedSelection(true);
    setSelectedModelIds(candidatePool.map((c) => c.model_id));
  };

  const selectRecommendedCandidates = () => {
    setHasUserEditedSelection(true);
    const recommended = candidatePool.filter((c) => c.is_recommended || c.rank === 1);
    if (recommended.length > 0) {
      setSelectedModelIds(recommended.map((c) => c.model_id));
    } else {
      setSelectedModelIds(candidatePool.slice(0, 2).map((c) => c.model_id));
    }
  };

  const currentlyPersistedIds: string[] = useMemo(() => {
    if (Array.isArray(parsedData.model_selection?.models) && parsedData.model_selection.models.length > 0) {
      return parsedData.model_selection.models
        .filter((m: any) => m.enabled !== false)
        .map((m: any) => (typeof m === "string" ? m : (m.model_id || m.id)))
        .filter(Boolean);
    }
    return confirmedModels.map((m: any) => (typeof m === "string" ? m : (m.model_id || m.id))).filter(Boolean);
  }, [parsedData.model_selection, confirmedModels]);

  const hasSelectionChanged = useMemo(() => {
    if (selectedModelIds.length !== currentlyPersistedIds.length) return true;
    const currentSet = new Set(currentlyPersistedIds);
    return selectedModelIds.some((id) => !currentSet.has(id));
  }, [selectedModelIds, currentlyPersistedIds]);

  const handleApplyModels = async () => {
    if (!projectId) {
      setErrorMsg("Project ID is missing. Cannot apply models to contract.");
      return;
    }
    if (selectedModelIds.length === 0) {
      setErrorMsg("Please select at least one candidate model.");
      return;
    }

    setIsApplyingModels(true);
    setErrorMsg(null);
    setApplySuccessMsg(null);

    try {
      const decisionId = modelSelection?.id || modelSelection?.decision?.id;
      const endpoint = decisionId
        ? `${BACKEND_URL}/model-selection/${decisionId}/select`
        : `${BACKEND_URL}/model-selection/project/${projectId}/select`;

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selectedModelIds }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || "Failed to apply selected models to training contract");
      }

      // Re-fetch fresh YAML contract from file server
      await fetchContract();

      setHasUserEditedSelection(false);
      setApplySuccessMsg(`Successfully updated contract with ${selectedModelIds.length} candidate model(s)!`);
      setTimeout(() => setApplySuccessMsg(null), 4000);

      if (onConfigSaved && data.data?.parsedConfig) {
        onConfigSaved(data.data.parsedConfig);
      }
    } catch (err: any) {
      console.error("[TrainingConfig] Apply models error:", err);
      setErrorMsg(err?.message || "Failed to apply models to training contract");
    } finally {
      setIsApplyingModels(false);
    }
  };

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

          {/* Section 3: Candidate Models Selection & Contract Customization */}
          <div className="rounded-2xl border border-border bg-surface p-5 shadow-xs space-y-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3 border-b border-border/70">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl bg-primary/10 text-primary flex items-center justify-center font-bold text-xs shrink-0">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                    <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                    <line x1="12" y1="22.08" x2="12" y2="12" />
                  </svg>
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h4 className="text-sm font-bold text-foreground">Candidate Models & Training Selection</h4>
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
                      {selectedModelIds.length} of {candidatePool.length} Selected
                    </span>
                    {hasSelectionChanged && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30 animate-pulse">
                        Unsaved Contract Changes
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Customize which models are compiled into the Training Contract directly here without needing to navigate back.
                  </p>
                </div>
              </div>

              {/* Quick action buttons & Apply Button */}
              <div className="flex items-center gap-2 self-start md:self-auto shrink-0 flex-wrap">
                {candidatePool.length > 2 && (
                  <>
                    <button
                      type="button"
                      onClick={selectAllCandidates}
                      className="px-2.5 py-1 text-[11px] font-medium rounded-lg bg-surface-muted hover:bg-surface border border-border text-muted-foreground hover:text-foreground transition-all cursor-pointer"
                    >
                      Select All ({candidatePool.length})
                    </button>
                    <button
                      type="button"
                      onClick={selectRecommendedCandidates}
                      className="px-2.5 py-1 text-[11px] font-medium rounded-lg bg-surface-muted hover:bg-surface border border-border text-muted-foreground hover:text-foreground transition-all cursor-pointer"
                    >
                      Recommended Only
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={handleApplyModels}
                  disabled={isApplyingModels || !hasSelectionChanged}
                  className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer shadow-xs ${
                    hasSelectionChanged
                      ? "bg-primary text-primary-foreground hover:bg-primary/90 shadow-md ring-2 ring-primary/40 animate-pulse"
                      : "bg-surface-muted text-muted-foreground border border-border cursor-not-allowed opacity-60"
                  }`}
                >
                  {isApplyingModels ? (
                    <>
                      <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                      </svg>
                      <span>Applying to Contract...</span>
                    </>
                  ) : (
                    <>
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      <span>{hasSelectionChanged ? "Apply Models to Contract" : "Contract In Sync"}</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Apply Success Notification */}
            {applySuccessMsg && (
              <div className="p-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs font-semibold flex items-center justify-between animate-fadeIn">
                <div className="flex items-center gap-2">
                  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  <span>{applySuccessMsg}</span>
                </div>
                <span className="text-[10px] font-mono text-muted-foreground">Contract refreshed</span>
              </div>
            )}

            {candidatePool.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
                {candidatePool.map((model: any, index: number) => {
                  const modelId = model.model_id || `model_${index + 1}`;
                  const isSelected = selectedModelIds.includes(modelId);
                  const isExpanded = expandedModelId === modelId;
                  const score = model.suitability_score != null ? Math.round(model.suitability_score * 100) : null;
                  const isRecommended = model.is_recommended || model.rank === 1;

                  return (
                    <div
                      key={modelId}
                      onClick={() => toggleModel(modelId)}
                      className={`relative p-4 rounded-xl border transition-all cursor-pointer flex flex-col justify-between select-none ${
                        isSelected
                          ? "border-primary/50 bg-primary/5 dark:bg-primary/10 ring-1 ring-primary/30 shadow-xs"
                          : "border-border/70 bg-surface-muted/40 hover:bg-surface-muted hover:border-border opacity-70 hover:opacity-100"
                      }`}
                    >
                      <div>
                        <div className="flex items-start justify-between gap-2 mb-2.5">
                          <div className="flex items-center gap-2.5">
                            <div
                              className={`w-4 h-4 rounded-md border flex items-center justify-center transition-all ${
                                isSelected
                                  ? "bg-primary border-primary text-primary-foreground"
                                  : "border-border bg-surface"
                              }`}
                            >
                              {isSelected && (
                                <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="3.5">
                                  <polyline points="20 6 9 17 4 12" />
                                </svg>
                              )}
                            </div>
                            <div>
                              <span className="text-xs font-bold text-foreground font-mono block leading-tight truncate max-w-[160px]">
                                {modelId}
                              </span>
                              <span className="text-[11px] text-muted-foreground block truncate max-w-[160px]">
                                {model.algorithm || model.displayName || modelId}
                              </span>
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            {isRecommended && (
                              <Badge variant="purple" className="text-[9px]">
                                Top Pick
                              </Badge>
                            )}
                            <Badge variant={isSelected ? "success" : "neutral"} className="text-[9px]">
                              {isSelected ? "Selected" : "Omitted"}
                            </Badge>
                          </div>
                        </div>

                        <div className="space-y-1.5 text-[11px] text-muted-foreground pt-2 border-t border-border/50">
                          <div className="flex items-center justify-between">
                            <span>Framework:</span>
                            <span className="font-semibold text-foreground uppercase tracking-wide">
                              {model.framework || "Custom"}
                            </span>
                          </div>
                          {score != null && (
                            <div className="flex items-center justify-between">
                              <span>Suitability Score:</span>
                              <div className="flex items-center gap-1.5">
                                <div className="w-14 h-1.5 rounded-full bg-surface-muted overflow-hidden">
                                  <div
                                    className="h-full bg-emerald-500 rounded-full"
                                    style={{ width: `${score}%` }}
                                  />
                                </div>
                                <span className="font-bold text-emerald-600 dark:text-emerald-400 font-mono">
                                  {score}%
                                </span>
                              </div>
                            </div>
                          )}
                          {model.training_speed && (
                            <div className="flex items-center justify-between">
                              <span>Training Speed:</span>
                              <span className="font-medium text-foreground">{model.training_speed}</span>
                            </div>
                          )}
                        </div>
                      </div>

                      {(model.tradeoffs?.pros || model.tradeoffs?.cons) && (
                        <div className="mt-3 pt-2.5 border-t border-border/40">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setExpandedModelId(isExpanded ? null : modelId);
                            }}
                            className="w-full text-[10px] text-primary hover:underline flex items-center justify-between font-semibold cursor-pointer"
                          >
                            <span>{isExpanded ? "Hide Trade-offs" : "Inspect Trade-offs"}</span>
                            <svg
                              viewBox="0 0 24 24"
                              width="12"
                              height="12"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              className={`transition-transform ${isExpanded ? "rotate-180" : ""}`}
                            >
                              <polyline points="6 9 12 15 18 9" />
                            </svg>
                          </button>

                          {isExpanded && (
                            <div className="mt-2 space-y-1.5 text-[10px] animate-fadeIn" onClick={(e) => e.stopPropagation()}>
                              {Array.isArray(model.tradeoffs?.pros) && model.tradeoffs.pros.length > 0 && (
                                <div>
                                  <span className="font-bold text-emerald-600 dark:text-emerald-400 block mb-0.5">Pros:</span>
                                  <ul className="space-y-0.5 text-foreground/80 pl-2">
                                    {model.tradeoffs.pros.map((pro: string, i: number) => (
                                      <li key={i} className="list-disc list-outside">{pro}</li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                              {Array.isArray(model.tradeoffs?.cons) && model.tradeoffs.cons.length > 0 && (
                                <div className="mt-1.5">
                                  <span className="font-bold text-amber-600 dark:text-amber-400 block mb-0.5">Cons:</span>
                                  <ul className="space-y-0.5 text-foreground/80 pl-2">
                                    {model.tradeoffs.cons.map((con: string, i: number) => (
                                      <li key={i} className="list-disc list-outside">{con}</li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="p-6 text-center text-xs text-muted-foreground">
                No candidate models available in configuration.
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
