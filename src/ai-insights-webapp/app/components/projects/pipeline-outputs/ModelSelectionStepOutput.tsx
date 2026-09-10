"use client";

import React, { useState, useEffect } from "react";
import { Badge } from "./utils";

interface ModelCandidateReasoning {
  strengths?: string[];
  weaknesses?: string[];
  suitability?: string[];
}

interface ModelCandidate {
  model_id: string;
  displayName?: string;
  framework?: string;
  algorithm?: string;
  rank: number;
  suitability_score: number;
  recommendation: "primary" | "alternative" | string;
  reasoning?: ModelCandidateReasoning;
}

interface ModelSelectionProps {
  modelSelection: any;
  projectId?: string;
  onSelectionConfirmed?: (selectedModels: string[]) => void;
}

export default function ModelSelectionStepOutput({
  modelSelection,
  projectId,
  onSelectionConfirmed,
}: ModelSelectionProps) {
  const payload = modelSelection?.decision || modelSelection?.modelSelection || modelSelection || {};

  const targetEntity = payload.target_entity || {};
  const predictionGrain = payload.prediction_grain || {};
  const recommendedModel: ModelCandidate | null = payload.recommended_model || null;
  const candidates: ModelCandidate[] = Array.isArray(payload.candidates) ? payload.candidates : [];
  const training = payload.training || {};
  const featureRequirements: Array<{ feature: string; requirement: string; reason: string }> = Array.isArray(
    payload.featureRequirements
  )
    ? payload.featureRequirements
    : [];
  const hpo = payload.hyperparameterOptimization || {};
  const confidence = payload.confidence || {};

  // User model selection state
  const [selectedModelIds, setSelectedModelIds] = useState<string[]>([]);
  const [expandedCandidateId, setExpandedCandidateId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [saveSuccessMessage, setSaveSuccessMessage] = useState<string | null>(null);

  // Initialize selection with primary model and any pre-existing user selection
  useEffect(() => {
    if (Array.isArray(payload.userSelection?.selectedModelIds) && payload.userSelection.selectedModelIds.length > 0) {
      setSelectedModelIds(payload.userSelection.selectedModelIds);
    } else if (recommendedModel?.model_id) {
      // Default select the primary model and the top alternative
      const initial = [recommendedModel.model_id];
      if (candidates.length > 1) {
        const alt = candidates.find((c) => c.model_id !== recommendedModel.model_id);
        if (alt) initial.push(alt.model_id);
      }
      setSelectedModelIds(initial);
    }
  }, [payload]);

  const toggleModelSelection = (modelId: string) => {
    setSelectedModelIds((prev) =>
      prev.includes(modelId) ? prev.filter((id) => id !== modelId) : [...prev, modelId]
    );
  };

  const handleConfirmSelection = async () => {
    if (selectedModelIds.length === 0) return;
    setIsSubmitting(true);
    setSaveSuccessMessage(null);

    try {
      const decisionId = payload.id || modelSelection?.id;
      if (decisionId) {
        const res = await fetch(`http://localhost:5000/api/model-selection/${decisionId}/select`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ selectedModelIds }),
        });
        if (res.ok) {
          setSaveSuccessMessage(`Selection confirmed: ${selectedModelIds.length} model(s) scheduled for training.`);
        }
      } else {
        setSaveSuccessMessage(`Selected ${selectedModelIds.length} model(s) for training configuration.`);
      }

      if (onSelectionConfirmed) {
        onSelectionConfirmed(selectedModelIds);
      }
    } catch (e: any) {
      console.warn("Failed to submit model selection:", e);
      setSaveSuccessMessage(`Selection recorded for workflow handoff.`);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!payload || (!recommendedModel && candidates.length === 0)) {
    return (
      <div className="p-8 text-center text-muted-foreground flex flex-col items-center justify-center min-h-[220px]">
        <div className="w-12 h-12 rounded-2xl bg-surface-muted flex items-center justify-center mb-3 animate-pulse">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 19V5" />
            <path d="M20 19V9" />
            <path d="M12 19V13" />
            <circle cx="4" cy="19" r="2" />
            <circle cx="12" cy="19" r="2" />
            <circle cx="20" cy="19" r="2" />
          </svg>
        </div>
        <p className="text-sm font-semibold text-foreground">Model Selection in Progress</p>
        <p className="text-xs text-muted-foreground mt-1 max-w-sm">
          The agent is evaluating task constraints, searching state-of-the-art architectures, and ranking candidate models.
        </p>
      </div>
    );
  }

  const primaryCandidate = candidates.find((c) => c.model_id === recommendedModel?.model_id) || recommendedModel;
  const alternativeCandidates = candidates.filter((c) => c.model_id !== recommendedModel?.model_id);

  return (
    <div className="space-y-6 animate-fadeIn text-foreground">
      {/* ─── Problem & Target Entity Header ────────────────────────────────────────── */}
      <div className="rounded-2xl border border-border/80 bg-gradient-to-br from-surface to-surface-muted/60 p-5 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="primary" className="uppercase tracking-wider">
                ML Task Definition
              </Badge>
              {targetEntity.datatype && (
                <Badge variant="teal">Type: {targetEntity.datatype}</Badge>
              )}
              {confidence.score !== undefined && (
                <Badge variant="success">
                  Confidence: {(confidence.score * 100).toFixed(0)}%
                </Badge>
              )}
            </div>
            <h2 className="text-lg font-bold text-foreground mt-1.5 flex items-center gap-2">
              <span>Target:</span>
              <span className="font-mono text-primary font-bold">
                {targetEntity.name || "Default Target"}
              </span>
            </h2>
            {targetEntity.description && (
              <p className="text-xs text-muted-foreground mt-0.5">{targetEntity.description}</p>
            )}
          </div>

          {/* Prediction Grain & Horizon */}
          <div className="flex items-center gap-3 bg-surface border border-border rounded-xl px-4 py-2.5 shadow-2xs self-start md:self-auto">
            <div className="text-left">
              <span className="text-[10px] uppercase font-bold text-muted-foreground block">Prediction Grain</span>
              <span className="text-xs font-semibold text-foreground">
                {predictionGrain.entity || "Entity"} {predictionGrain.frequency ? `• ${predictionGrain.frequency}` : ""}
              </span>
            </div>
            {payload.prediction_horizon && (
              <div className="border-l border-border pl-3 text-left">
                <span className="text-[10px] uppercase font-bold text-muted-foreground block">Horizon</span>
                <span className="text-xs font-semibold text-primary">{payload.prediction_horizon}</span>
              </div>
            )}
          </div>
        </div>

        {payload.derivation && (
          <div className="mt-3.5 pt-3 border-t border-border/60 text-xs text-muted-foreground flex items-center gap-2">
            <span className="font-semibold text-foreground">Derivation:</span>
            <span>{payload.derivation}</span>
          </div>
        )}
      </div>

      {/* ─── Primary Model Recommendation Spotlight ─────────────────────────────────── */}
      {primaryCandidate && (
        <div className="relative rounded-2xl border-2 border-emerald-500/40 bg-gradient-to-br from-emerald-500/5 via-surface to-indigo-500/5 p-6 shadow-md transition-all hover:border-emerald-500/60">
          <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-6">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2.5 flex-wrap">
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-extrabold bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-sm">
                  <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor">
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                  </svg>
                  PRIMARY RECOMMENDATION
                </span>
                <Badge variant="neutral">Rank #1</Badge>
                {primaryCandidate.framework && (
                  <Badge variant="primary">{primaryCandidate.framework.toUpperCase()}</Badge>
                )}
              </div>

              <h3 className="text-xl font-black text-foreground mt-2 tracking-tight">
                {primaryCandidate.displayName || primaryCandidate.model_id}
              </h3>
              {primaryCandidate.algorithm && (
                <p className="text-xs font-medium text-muted-foreground mt-0.5">
                  {primaryCandidate.algorithm}
                </p>
              )}

              {/* Rationale and Strengths */}
              {primaryCandidate.reasoning && (
                <div className="mt-4 space-y-2.5 text-xs">
                  {primaryCandidate.reasoning.suitability && primaryCandidate.reasoning.suitability.length > 0 && (
                    <p className="text-foreground/90 font-normal leading-relaxed">
                      {primaryCandidate.reasoning.suitability.join(" ")}
                    </p>
                  )}

                  {primaryCandidate.reasoning.strengths && primaryCandidate.reasoning.strengths.length > 0 && (
                    <div className="flex items-center gap-1.5 flex-wrap pt-1">
                      <span className="font-bold text-[11px] text-emerald-600 dark:text-emerald-400">Strengths:</span>
                      {primaryCandidate.reasoning.strengths.map((s, idx) => (
                        <span
                          key={idx}
                          className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 font-medium text-[11px]"
                        >
                          ✓ {s}
                        </span>
                      ))}
                    </div>
                  )}

                  {primaryCandidate.reasoning.weaknesses && primaryCandidate.reasoning.weaknesses.length > 0 && (
                    <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                      <span className="font-bold text-[11px] text-amber-600 dark:text-amber-400">Trade-offs:</span>
                      {primaryCandidate.reasoning.weaknesses.map((w, idx) => (
                        <span
                          key={idx}
                          className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-amber-500/10 text-amber-700 dark:text-amber-300 font-medium text-[11px]"
                        >
                          • {w}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Suitability Gauge & Selection Checkbox */}
            <div className="flex flex-row lg:flex-col items-center lg:items-end justify-between gap-4 shrink-0 pt-2 lg:pt-0">
              <div className="text-center lg:text-right">
                <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block">
                  Suitability Score
                </span>
                <div className="flex items-baseline justify-center lg:justify-end gap-1 mt-0.5">
                  <span className="text-3xl font-black text-emerald-600 dark:text-emerald-400">
                    {(primaryCandidate.suitability_score * 100).toFixed(0)}
                  </span>
                  <span className="text-sm font-bold text-muted-foreground">%</span>
                </div>
                <div className="w-24 h-1.5 bg-surface-muted rounded-full overflow-hidden mt-1.5">
                  <div
                    className="h-full bg-gradient-to-r from-emerald-500 to-teal-500 rounded-full"
                    style={{ width: `${primaryCandidate.suitability_score * 100}%` }}
                  />
                </div>
              </div>

              <label className="flex items-center gap-2 cursor-pointer select-none bg-surface px-3 py-1.5 rounded-xl border border-border shadow-2xs hover:bg-surface-muted transition-colors">
                <input
                  type="checkbox"
                  checked={selectedModelIds.includes(primaryCandidate.model_id)}
                  onChange={() => toggleModelSelection(primaryCandidate.model_id)}
                  className="w-4 h-4 rounded text-primary focus:ring-primary/20 accent-primary"
                />
                <span className="text-xs font-bold text-foreground">Include in Training</span>
              </label>
            </div>
          </div>
        </div>
      )}

      {/* ─── Alternative Ranked Candidates ─────────────────────────────────────────── */}
      {alternativeCandidates.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Alternative Candidate Models ({alternativeCandidates.length})
            </h4>
            <span className="text-[11px] text-muted-foreground">
              Select which models should be trained during AutoML search
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            {alternativeCandidates.map((candidate) => {
              const isSelected = selectedModelIds.includes(candidate.model_id);
              const isExpanded = expandedCandidateId === candidate.model_id;

              return (
                <div
                  key={candidate.model_id}
                  className={`rounded-xl border transition-all p-4 ${
                    isSelected
                      ? "border-primary/40 bg-surface shadow-xs"
                      : "border-border bg-surface/50 opacity-80 hover:opacity-100"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-surface-muted border border-border text-foreground">
                          Rank #{candidate.rank}
                        </span>
                        <Badge variant="neutral">{candidate.framework || "custom"}</Badge>
                      </div>

                      <h5 className="text-sm font-bold text-foreground mt-1.5 truncate">
                        {candidate.displayName || candidate.model_id}
                      </h5>
                      {candidate.algorithm && (
                        <p className="text-[11px] text-muted-foreground truncate">{candidate.algorithm}</p>
                      )}
                    </div>

                    <div className="text-right shrink-0">
                      <div className="text-base font-black text-foreground">
                        {(candidate.suitability_score * 100).toFixed(0)}%
                      </div>
                      <span className="text-[9px] uppercase font-bold text-muted-foreground">Suitability</span>
                    </div>
                  </div>

                  {/* Expandable Reasoning */}
                  {candidate.reasoning && (
                    <div className="mt-3 pt-2.5 border-t border-border/60">
                      <button
                        type="button"
                        onClick={() => setExpandedCandidateId(isExpanded ? null : candidate.model_id)}
                        className="text-[11px] font-semibold text-primary hover:underline flex items-center gap-1 cursor-pointer"
                      >
                        {isExpanded ? "Hide Reasoning ▲" : "View Strengths & Trade-offs ▼"}
                      </button>

                      {isExpanded && (
                        <div className="mt-2 space-y-2 text-xs text-muted-foreground animate-fadeIn">
                          {candidate.reasoning.suitability && (
                            <p className="text-foreground/80">{candidate.reasoning.suitability.join(" ")}</p>
                          )}
                          {candidate.reasoning.strengths && candidate.reasoning.strengths.length > 0 && (
                            <div className="flex items-center gap-1 flex-wrap">
                              <span className="font-bold text-[10px] text-emerald-600">Pros:</span>
                              {candidate.reasoning.strengths.map((s, i) => (
                                <span key={i} className="text-[10px] bg-surface-muted px-2 py-0.5 rounded">
                                  {s}
                                </span>
                              ))}
                            </div>
                          )}
                          {candidate.reasoning.weaknesses && candidate.reasoning.weaknesses.length > 0 && (
                            <div className="flex items-center gap-1 flex-wrap">
                              <span className="font-bold text-[10px] text-amber-600">Cons:</span>
                              {candidate.reasoning.weaknesses.map((w, i) => (
                                <span key={i} className="text-[10px] bg-surface-muted px-2 py-0.5 rounded">
                                  {w}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Selection Checkbox */}
                  <div className="mt-3 pt-2.5 border-t border-border flex items-center justify-between">
                    <span className="text-[11px] text-muted-foreground">AutomL Candidate</span>
                    <label className="flex items-center gap-1.5 cursor-pointer select-none text-xs font-semibold">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleModelSelection(candidate.model_id)}
                        className="w-3.5 h-3.5 rounded text-primary focus:ring-primary/20 accent-primary"
                      />
                      <span className={isSelected ? "text-primary font-bold" : "text-muted-foreground"}>
                        {isSelected ? "Selected" : "Select"}
                      </span>
                    </label>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ─── Training Strategy, Baseline & HPO Details ─────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Baseline Benchmark */}
        <div className="rounded-xl border border-border bg-surface p-4">
          <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            Baseline Benchmark
          </div>
          <p className="text-sm font-bold text-foreground">
            {training.baseline_model || "Logistic / Linear Regression"}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Serves as the minimum performance threshold that candidate ML models must exceed.
          </p>
          <div className="mt-2.5">
            <Badge variant="neutral">Mode: {training.mode || "automl_search"}</Badge>
          </div>
        </div>

        {/* HPO Recommendation */}
        <div className="rounded-xl border border-border bg-surface p-4">
          <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 20v-6M6 20V10M18 20V4" />
            </svg>
            HPO Recommendation
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={hpo.recommended ? "primary" : "neutral"}>
              {hpo.approach ? hpo.approach.replace(/_/g, " ").toUpperCase() : "BAYESIAN OPTIMIZATION"}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
            {hpo.rationale || "Optimizes tree depth, learning rate, and regularizations across candidate search space."}
          </p>
        </div>

        {/* Feature Requirements */}
        <div className="rounded-xl border border-border bg-surface p-4">
          <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
            </svg>
            Modeling Requirements
          </div>
          {featureRequirements.length > 0 ? (
            <div className="space-y-1.5 max-h-28 overflow-y-auto pr-1">
              {featureRequirements.map((req, i) => (
                <div key={i} className="text-xs flex items-start gap-1.5">
                  <span className="text-primary font-bold">•</span>
                  <span className="text-foreground/90 font-medium">{req.requirement || req.feature}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Standard normalization and numerical imputation prepared by Feature Engineering.
            </p>
          )}
        </div>
      </div>

      {/* ─── Confirmation & Handoff Action Bar ────────────────────────────────────────── */}
      <div className="sticky bottom-2 z-10 rounded-2xl border border-border bg-surface/95 backdrop-blur-md p-4 shadow-lg flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-sm">
            {selectedModelIds.length}
          </div>
          <div>
            <p className="text-xs font-bold text-foreground">
              {selectedModelIds.length} Model{selectedModelIds.length === 1 ? "" : "s"} Selected for Training
            </p>
            <p className="text-[11px] text-muted-foreground">
              Selected models will be passed to Training Configuration and evaluated during training.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 w-full sm:w-auto">
          {saveSuccessMessage && (
            <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 animate-fadeIn">
              ✓ {saveSuccessMessage}
            </span>
          )}

          <button
            type="button"
            disabled={selectedModelIds.length === 0 || isSubmitting}
            onClick={handleConfirmSelection}
            className="flex-1 sm:flex-none inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-white text-xs font-bold tracking-wide uppercase shadow-md hover:bg-primary/90 hover:scale-[1.02] active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            {isSubmitting ? (
              <span>Saving...</span>
            ) : (
              <>
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                <span>Confirm Models for Training</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
