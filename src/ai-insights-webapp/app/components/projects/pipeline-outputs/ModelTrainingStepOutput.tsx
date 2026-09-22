"use client";

import React, { useState } from "react";

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

export default function ModelTrainingStepOutput({
  modelTraining,
  trainingConfiguration,
  modelSelection,
  projectId,
  activeRunTimestamp,
  onApproveTraining,
  isApproving = false,
}: ModelTrainingStepOutputProps) {
  const [copiedArtifact, setCopiedArtifact] = useState<string | null>(null);
  const [activePlotModal, setActivePlotModal] = useState<{ title: string; url: string } | null>(null);

  // Extract candidate models available for selection
  const rawCandidateList: CandidateModelItem[] = (
    modelTraining?.candidates ||
    modelTraining?.rankedCandidates ||
    trainingConfiguration?.configuration?.model_selection?.models ||
    trainingConfiguration?.configuration?.model_selection?.candidates ||
    modelSelection?.candidates ||
    modelSelection?.models ||
    []
  ).map((c: any, idx: number) => {
    const modelId = typeof c === "string" ? c : (c.model_id || c.id || `candidate_${idx + 1}`);
    const displayName = typeof c === "string" ? c : (c.displayName || c.algorithm || modelId);
    const framework = typeof c === "string" ? "sklearn" : (c.framework || "sklearn");
    const score = typeof c === "object" && typeof c.score === "number" ? c.score : c?.suitability_score;
    return {
      model_id: modelId,
      displayName,
      framework,
      status: c.status || "Completed",
      score,
      durationSeconds: c.durationSeconds,
      validationMetrics: c.validationMetrics,
      testMetrics: c.testMetrics,
      artifact: c.artifact,
      plots: c.plots,
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

  // Model selection and date split state for HITL gate
  const [selectedModelIds, setSelectedModelIds] = useState<string[]>(() => {
    return candidateModels.map((c) => c.model_id);
  });
  const [splitStartDate, setSplitStartDate] = useState<string>(() => {
    return modelTraining?.splitStartDate || "";
  });
  const [splitEndDate, setSplitEndDate] = useState<string>(() => {
    return modelTraining?.splitEndDate || modelTraining?.splitDate || "";
  });

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

  // Determine stage state
  const isAwaitingSelection =
    modelTraining?.status === "Requires Attention" ||
    (candidateModels.length > 0 && !modelTraining?.report && !modelTraining?.selectedModel);

  const report = modelTraining?.report;
  const championModelId = modelTraining?.selectedModel || report?.selectedModel || candidateModels[0]?.model_id;
  const championArtifact =
    modelTraining?.selectedModelArtifact ||
    report?.selectedModelArtifact ||
    candidateModels.find((c) => c.model_id === championModelId)?.artifact ||
    `artifacts/models/${championModelId || "model"}.joblib`;

  const championCandidate = candidateModels.find((c) => c.model_id === championModelId) || candidateModels[0];

  // Visual plots collection
  const plots: Record<string, string> = {
    ...(modelTraining?.plots || {}),
    ...(report?.comparisonPlots || {}),
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
            {isAwaitingSelection ? (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                Requires Attention: Configure Split & Select Models
              </span>
            ) : modelTraining?.status === "Completed" ? (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                <CheckCircleIcon className="w-3.5 h-3.5" />
                Training Complete
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
                In Progress
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

      {/* ─── HITL Gate: Train Split Dates & Candidate Model Selection Panel ─── */}
      {isAwaitingSelection && (
        <div className="rounded-2xl border-2 border-amber-500/30 bg-amber-500/5 dark:bg-amber-950/10 p-5 space-y-5">
          {/* Section 1: Train Split Dates */}
          <div className="p-4 rounded-xl border border-amber-500/20 bg-surface/80 shadow-xs space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-foreground flex items-center gap-2 uppercase tracking-wider">
                <span className="text-sm">📅</span>
                <span>Train / Test Dataset Split Dates</span>
              </label>
              <span className="text-[11px] text-muted-foreground font-mono">YYYY-MM-DD</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <label className="block text-[11px] font-semibold text-muted-foreground mb-1.5">
                  Train Split Start Date <span className="font-normal lowercase text-[10px]">(optional cutoff)</span>
                </label>
                <input
                  type="date"
                  value={splitStartDate}
                  onChange={(e) => setSplitStartDate(e.target.value)}
                  className="w-full h-10 px-3 rounded-lg border border-border bg-surface text-xs text-foreground focus:outline-none focus:ring-0 focus:border-border transition-all shadow-xs"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-muted-foreground mb-1.5">
                  Train Split End Date <span className="text-amber-500 font-bold">*</span>
                </label>
                <input
                  type="date"
                  value={splitEndDate}
                  onChange={(e) => setSplitEndDate(e.target.value)}
                  className="w-full h-10 px-3 rounded-lg border border-border bg-surface text-xs text-foreground focus:outline-none focus:ring-0 focus:border-border transition-all shadow-xs"
                />
              </div>
            </div>

            <p className="text-[11px] text-muted-foreground leading-relaxed pt-1">
              Data on or before the end date (and on/after start date if provided) is assigned to training. Records after the end date are assigned to test/validation.
              <span className="block mt-1 font-medium text-foreground/80">
                Note: If no date column is present in the dataset, a 70/15/15 ratio split is used automatically.
              </span>
            </p>
          </div>

          {/* Section 2: Candidate Models Selection */}
          <div className="space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h4 className="text-sm font-bold text-foreground flex items-center gap-2">
                  <span>Select Candidate Models to Train</span>
                  <span className="px-2 py-0.5 text-[10px] font-bold rounded-md bg-amber-500/20 text-amber-700 dark:text-amber-300">
                    {selectedModelIds.length} of {candidateModels.length} Selected
                  </span>
                </h4>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Check candidate models you want trained inside the Docker container. Unselected models will be skipped.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={selectAll}
                  className="px-2.5 py-1 text-xs font-medium rounded-lg border border-border bg-surface hover:bg-surface-muted text-foreground transition-all cursor-pointer"
                >
                  Select All
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
                        ? "border-primary/50 bg-primary/5 dark:bg-primary/10 shadow-xs"
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
          </div>

          {/* Section 3: Action Button */}
          <div className="pt-3 border-t border-amber-500/20 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              The Python model training program will only be generated and executed for your selected models.
            </p>

            <button
              type="button"
              disabled={selectedModelIds.length === 0 || isApproving}
              onClick={() => {
                if (onApproveTraining) {
                  onApproveTraining(selectedModelIds, splitStartDate || undefined, splitEndDate || undefined);
                }
              }}
              className="px-5 py-2.5 rounded-xl bg-primary text-primary-foreground font-semibold text-xs tracking-wide hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed shadow-md cursor-pointer transition-all flex items-center justify-center gap-2"
            >
              {isApproving ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                  <span>Generating Code & Launching Training...</span>
                </>
              ) : (
                <>
                  <CheckCircleIcon className="w-4 h-4" />
                  <span>Generate Code & Train Selected Models ({selectedModelIds.length})</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* ─── Champion Model Card ─── */}
      {!isAwaitingSelection && championCandidate && (
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
      {!isAwaitingSelection && candidateModels.length > 0 && (
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
                  const metrics = m.testMetrics || m.validationMetrics || {};
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
                        {typeof m.score === "number" ? `${(m.score * 100).toFixed(1)}%` : "—"}
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex flex-wrap gap-1.5">
                          {Object.entries(metrics).slice(0, 3).map(([k, v]) => (
                            <span
                              key={k}
                              className="px-1.5 py-0.5 rounded bg-surface border border-border font-mono text-[10px]"
                            >
                              {k}: {typeof v === "number" ? v.toFixed(3) : String(v)}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-muted-foreground font-mono">
                        {m.durationSeconds ? `${m.durationSeconds.toFixed(1)}s` : "—"}
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

      {/* ─── Artifacts & Visualizations Gallery ─── */}
      {!isAwaitingSelection && Object.keys(plots).length > 0 && (
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
                    src={url}
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
                src={activePlotModal.url}
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
