"use client";

import React, { useEffect, useState } from "react";
import ModelValidationStepOutput from "./ModelValidationStepOutput";

interface Candidate {
  modelId?: string;
  model_id?: string;
  status?: string;
  failureCount?: number;
  summary?: string;
  metrics?: Record<string, unknown>;
  qualityAssessment?: string;
}

interface LifecycleValidationResult {
  status?: string;
  summary?: string;
  candidates?: Candidate[];
  qualityRecommendations?: string[];
  championCandidateId?: string;
  candidateRankings?: string[];
}

interface ModelLifecycleValidationOutputProps {
  result: LifecycleValidationResult;
  modelTraining?: unknown;
  trainingConfiguration?: unknown;
  modelSelection?: unknown;
  projectId?: string;
  activeRunTimestamp?: string;
  onApproveValidation?: (horizon: number, frequency: string, startDate?: string) => void;
  nextStepInProgress?: boolean;
  isApproving?: boolean;
}

export default function ModelLifecycleValidationOutput({
  result,
  modelTraining,
  trainingConfiguration,
  modelSelection,
  projectId,
  activeRunTimestamp,
  onApproveValidation,
  nextStepInProgress = false,
  isApproving,
}: ModelLifecycleValidationOutputProps) {
  const [showConfiguration, setShowConfiguration] = useState(false);
  useEffect(() => setShowConfiguration(false), [result]);
  if (showConfiguration) {
    return (
      <ModelValidationStepOutput
        modelTraining={modelTraining}
        trainingConfiguration={trainingConfiguration}
        modelSelection={modelSelection}
        projectId={projectId}
        activeRunTimestamp={activeRunTimestamp}
        onApproveValidation={onApproveValidation}
        nextStepInProgress={nextStepInProgress}
        isApproving={isApproving}
      />
    );
  }

  const candidates = result.candidates || [];
  return (
    <section className="space-y-5 rounded-2xl border border-border bg-card p-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-foreground">Model validation results</h3>
          <p className="mt-1 text-xs text-muted-foreground">{result.summary || "Validation run finished."}</p>
        </div>
        <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${
          result.status === "Failed"
            ? "border-rose-500/30 bg-rose-500/10 text-rose-600"
            : result.status === "Partial"
              ? "border-amber-500/30 bg-amber-500/10 text-amber-700"
              : "border-emerald-500/30 bg-emerald-500/10 text-emerald-600"
        }`}>
          {result.status || "Completed"}
        </span>
      </header>

      {result.championCandidateId && (
        <p className="text-xs text-foreground">
          Champion candidate: <strong>{result.championCandidateId}</strong>
        </p>
      )}
      {Array.isArray(result.candidateRankings) && result.candidateRankings.length > 0 && (
        <div className="text-xs text-muted-foreground">
          <strong className="text-foreground">LLM ranking:</strong> {result.candidateRankings.join(" → ")}
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[620px] text-left text-xs">
          <thead className="bg-surface-muted text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-semibold">Candidate</th>
              <th className="px-3 py-2 font-semibold">Status</th>
              <th className="px-3 py-2 font-semibold">Failures</th>
              <th className="px-3 py-2 font-semibold">Metrics</th>
              <th className="px-3 py-2 font-semibold">Assessment</th>
            </tr>
          </thead>
          <tbody>
            {candidates.map((candidate, index) => {
              const modelId = candidate.modelId || candidate.model_id || `Candidate ${index + 1}`;
              const metrics = Object.entries(candidate.metrics || {});
              const badgeColor = candidate.status === "Skipped"
                ? "text-amber-700"
                : candidate.status === "Failed" ? "text-rose-600" : "text-emerald-600";
              return (
                <tr key={`${modelId}-${index}`} className="border-t border-border align-top">
                  <td className="px-3 py-2 font-medium text-foreground">{modelId}</td>
                  <td className={`px-3 py-2 font-semibold ${badgeColor}`}>{candidate.status || "Unknown"}</td>
                  <td className="px-3 py-2 text-muted-foreground">{candidate.failureCount ?? 0}</td>
                  <td className="px-3 py-2">
                    {metrics.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {metrics.map(([name, value]) => (
                          <span key={name} className="rounded border border-border bg-surface-muted px-1.5 py-0.5 font-mono">
                            {name}: {typeof value === "number" ? value.toPrecision(5) : String(value)}
                          </span>
                        ))}
                      </div>
                    ) : "—"}
                  </td>
                  <td className="max-w-sm px-3 py-2 text-muted-foreground">
                    {candidate.summary || candidate.qualityAssessment || "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {Array.isArray(result.qualityRecommendations) && result.qualityRecommendations.length > 0 && (
        <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-3">
          <h4 className="text-xs font-semibold text-foreground">Quality improvement recommendations</h4>
          <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-muted-foreground">
            {result.qualityRecommendations.map((recommendation, index) => (
              <li key={`${index}-${recommendation}`}>{recommendation}</li>
            ))}
          </ul>
        </div>
      )}

      {onApproveValidation && (
        <button
          type="button"
          onClick={() => setShowConfiguration(true)}
          disabled={nextStepInProgress || isApproving}
          className="rounded-lg border border-border bg-surface-muted px-3 py-2 text-xs font-semibold text-foreground hover:bg-surface-raised disabled:opacity-50"
        >
          Reconfigure and validate again
        </button>
      )}
    </section>
  );
}
