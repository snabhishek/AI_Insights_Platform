"use client";

import React, { useMemo, useState } from "react";
import type { PipelineStatus } from "../types";
import ModelTrainingStepOutput from "./ModelTrainingStepOutput";

interface ModelTrainingExecutionStepOutputProps {
  status: PipelineStatus;
  modelTraining?: Record<string, unknown>;
  trainingConfiguration?: Record<string, unknown>;
  modelSelection?: Record<string, unknown>;
  selectedModels?: string[];
  projectId?: string;
  activeRunTimestamp?: string;
  isExecuting?: boolean;
  onExecute?: (selectedModels: string[]) => void;
}

type ModelCandidate = string | {
  model_id?: string;
  id?: string;
  enabled?: boolean;
  displayName?: string;
  display_name?: string;
  algorithm?: string;
  name?: string;
  framework?: string;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function getModels(
  trainingConfiguration: Record<string, unknown> | undefined,
  modelSelection: Record<string, unknown> | undefined
) {
  const configuration = asRecord(trainingConfiguration?.configuration);
  const modelSelectionConfig = asRecord(configuration?.model_selection);
  const configuredModels = [
    trainingConfiguration?.models,
    modelSelectionConfig?.models,
    configuration?.models,
  ].find((models): models is ModelCandidate[] => Array.isArray(models) && models.length > 0);
  const candidates =
    configuredModels ||
    (Array.isArray(modelSelection?.candidates) ? modelSelection.candidates as ModelCandidate[] : undefined) ||
    (Array.isArray(modelSelection?.models) ? modelSelection.models as ModelCandidate[] : undefined) ||
    [];

  return candidates
    .filter((model) => {
      if (typeof model === "string") return true;
      return Boolean(model) && model.enabled !== false;
    })
    .flatMap((model) => {
      const id = String(typeof model === "string" ? model : model.model_id || model.id || "").trim();
      if (!id) return [];
      return [{
        id,
        name: typeof model === "string"
          ? model
          : model.displayName || model.display_name || model.algorithm || model.name || id,
        framework: typeof model === "string" ? "" : model.framework || "",
      }];
    });
}

export default function ModelTrainingExecutionStepOutput({
  status,
  modelTraining,
  trainingConfiguration,
  modelSelection,
  selectedModels: savedSelectedModels,
  projectId,
  activeRunTimestamp,
  isExecuting = false,
  onExecute,
}: ModelTrainingExecutionStepOutputProps) {
  const models = useMemo(
    () => getModels(trainingConfiguration, modelSelection),
    [trainingConfiguration, modelSelection]
  );
  const modelIds = useMemo(() => models.map((model) => model.id), [models]);
  const modelIdsKey = modelIds.join("|");
  const savedSelectionKey = (savedSelectedModels || []).join("|");
  const [selectedModelIds, setSelectedModelIds] = useState<string[] | null>(null);
  const availableModelIds = modelIdsKey.split("|").filter(Boolean);
  const configuredSelection = savedSelectionKey
    .split("|")
    .filter((id) => id && availableModelIds.includes(id));
  const selectedModels = selectedModelIds === null
    ? configuredSelection.length > 0 ? configuredSelection : availableModelIds
    : selectedModelIds.filter((id) => availableModelIds.includes(id));
  const canSelectModels = status === "User Input" && !isExecuting;
  const trainingReport = asRecord(modelTraining?.report);
  const summary = typeof modelTraining?.summary === "string" ? modelTraining.summary : undefined;
  const executionLogs = typeof modelTraining?.executionLogs === "string" ? modelTraining.executionLogs : undefined;

  if (status === "Completed") {
    const hasExecutionResults = Boolean(
      modelTraining?.executionCompleted === true ||
      (Array.isArray(trainingReport?.model_results) && trainingReport.model_results.length > 0) ||
      (Array.isArray(trainingReport?.candidate_model_results) && trainingReport.candidate_model_results.length > 0)
    );
    if (hasExecutionResults) {
      return (
        <ModelTrainingStepOutput
          modelTraining={modelTraining}
          trainingConfiguration={trainingConfiguration}
          projectId={projectId}
          activeRunTimestamp={activeRunTimestamp}
        />
      );
    }
    return (
      <div className="rounded-xl border border-amber-300 bg-amber-50 p-5 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-200">
        Training is marked complete, but no model execution metrics were returned.
      </div>
    );
  }

  if (status === "Failed") {
    return (
      <div className="space-y-3 rounded-xl border border-red-300 bg-red-50 p-5 text-sm text-red-900 dark:border-red-800 dark:bg-red-950/30 dark:text-red-200">
        <h3 className="font-bold">Model training failed</h3>
        <p>{summary || "The model training step failed before producing results."}</p>
        {executionLogs && (
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-black/5 p-3 text-xs dark:bg-black/20">
            {executionLogs}
          </pre>
        )}
      </div>
    );
  }

  if (status !== "In-Progress" && status !== "User Input") {
    return (
      <div className="flex min-h-52 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-surface-muted/20 p-8 text-center">
        <h3 className="text-base font-bold text-foreground">Model training code has not been generated</h3>
        <p className="mt-2 max-w-lg text-sm text-muted-foreground">
          Complete the preceding workflow steps to generate and validate the model training code. Model selection and execution controls will appear when code generation starts.
        </p>
      </div>
    );
  }

  const isGenerationRunning = status === "In-Progress";
  const isWaitingForSelection = status === "User Input";

  return (
    <section className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-border bg-surface p-5">
        <div>
          <h3 className="text-lg font-bold text-foreground">Model Training &amp; AutoML Execution</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Generated training code is validated before selected models run in the project-mounted Docker environment.
          </p>
        </div>
        <span className={`rounded-full px-3 py-1.5 text-xs font-bold ${
          isGenerationRunning
            ? "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
            : isWaitingForSelection
              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
              : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
        }`}>
          {isGenerationRunning
            ? "Generating and validating training code"
            : isWaitingForSelection
              ? "Ready to execute"
              : status}
        </span>
      </header>

      <div className="rounded-xl border border-border bg-surface p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h4 className="font-bold text-foreground">Training configuration models</h4>
            <p className="mt-1 text-xs text-muted-foreground">
              {canSelectModels
                ? "Select the models you want to train."
                : "Model selection and execution are enabled after code generation completes."}
            </p>
          </div>
          <span className="text-xs font-semibold text-muted-foreground">
            {models.length} enabled model{models.length === 1 ? "" : "s"}
          </span>
        </div>

        {models.length > 0 ? (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {models.map((model) => {
              const checked = selectedModels.includes(model.id);
              return (
                <li key={model.id}>
                  <label className={`flex items-center gap-3 px-4 py-3 ${
                    canSelectModels ? "cursor-pointer" : "cursor-not-allowed opacity-60"
                  }`}>
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={!canSelectModels}
                      onChange={(event) => {
                        setSelectedModelIds((current) =>
                          event.target.checked
                            ? [...(current ?? selectedModels), model.id]
                            : (current ?? selectedModels).filter((id) => id !== model.id)
                        );
                      }}
                      className="h-4 w-4 accent-primary"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-foreground">{model.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {model.framework ? `${model.framework} · ` : ""}{model.id}
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="rounded-lg border border-dashed border-border p-5 text-sm text-muted-foreground">
            No enabled models are available in the training configuration.
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          <p className="text-xs text-muted-foreground">
            {isGenerationRunning
              ? "Code generation must finish before models can be selected."
              : isWaitingForSelection
                ? "Selected models will run in Docker with the project folder mounted."
                : "Run the workflow through Pre Flight to generate model training code."}
          </p>
          <button
            type="button"
            disabled={!canSelectModels || selectedModels.length === 0 || models.length === 0}
            onClick={() => onExecute?.(selectedModels)}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-45"
          >
            {isExecuting ? (
              <>
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent" />
                Training selected models...
              </>
            ) : (
              <>Execute Training in Docker ({selectedModels.length} model{selectedModels.length === 1 ? "" : "s"})</>
            )}
          </button>
        </div>
      </div>
    </section>
  );
}
