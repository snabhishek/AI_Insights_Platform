"use client";

import React from "react";
import ModelSelectionStepOutput from "./ModelSelectionStepOutput";

interface ModelTrainingValidationOutputProps {
  modelSelection?: any;
  modelTraining?: any;
  modelValidation?: any;
  trainingConfiguration?: any;
  projectId?: string;
  activeSubstep?: string;
  onSelectionConfirmed?: (selectedModels: string[]) => void;
}

export default function ModelTrainingValidationStepOutput({
  modelSelection,
  modelTraining,
  modelValidation,
  trainingConfiguration,
  projectId,
  activeSubstep,
  onSelectionConfirmed,
}: ModelTrainingValidationOutputProps) {
  // If activeSubstep is Training Configuration and trainingConfiguration is present
  if (activeSubstep === "Training Configuration" && trainingConfiguration) {
    const config = trainingConfiguration.configuration || {};
    const models = Array.isArray(config.models) ? config.models : (config.candidate_models || []);
    return (
      <div className="p-6 space-y-4">
        <div className="rounded-xl border border-border bg-surface p-5">
          <h4 className="text-sm font-bold text-foreground">Training Configuration</h4>
          <p className="text-xs text-muted-foreground mt-1">
            {trainingConfiguration.summary || "Training environment and dataset splits configured."}
          </p>
          <div className="mt-4 pt-3 border-t border-border grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-2.5 rounded-lg bg-surface-muted border border-border text-center">
              <span className="text-[10px] uppercase font-bold text-muted-foreground block">Target Column</span>
              <span className="text-xs font-bold text-foreground">{trainingConfiguration.targetColumn || "N/A"}</span>
            </div>
            <div className="p-2.5 rounded-lg bg-surface-muted border border-border text-center">
              <span className="text-[10px] uppercase font-bold text-muted-foreground block">Problem Type</span>
              <span className="text-xs font-bold text-foreground uppercase">{trainingConfiguration.problemType || "N/A"}</span>
            </div>
            <div className="p-2.5 rounded-lg bg-surface-muted border border-border text-center">
              <span className="text-[10px] uppercase font-bold text-muted-foreground block">CV Folds</span>
              <span className="text-xs font-bold text-foreground">{config.cvFolds ?? 5}</span>
            </div>
            <div className="p-2.5 rounded-lg bg-surface-muted border border-border text-center">
              <span className="text-[10px] uppercase font-bold text-muted-foreground block">Test Split</span>
              <span className="text-xs font-bold text-foreground">{((config.testSplitRatio ?? 0.3) * 100).toFixed(0)}%</span>
            </div>
          </div>
          {models.length > 0 && (
            <div className="mt-4 pt-3 border-t border-border">
              <span className="text-xs font-semibold text-foreground block mb-2">Models Configured for Training:</span>
              <div className="flex flex-wrap gap-2">
                {models.map((m: string) => (
                  <span key={m} className="px-2.5 py-1 rounded-md bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 text-xs font-semibold">
                    {m}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // If modelSelection is present, render the ModelSelectionStepOutput
  if (modelSelection) {
    return (
      <ModelSelectionStepOutput
        modelSelection={modelSelection}
        projectId={projectId}
        onSelectionConfirmed={onSelectionConfirmed}
      />
    );
  }

  // If training or validation completed
  if (modelTraining || modelValidation) {
    return (
      <div className="p-6 space-y-4">
        <div className="rounded-xl border border-border bg-surface p-5">
          <h4 className="text-sm font-bold text-foreground">Model Training & Validation Overview</h4>
          <p className="text-xs text-muted-foreground mt-1">
            {modelValidation?.summary || modelTraining?.summary || "Model training artifacts prepared."}
          </p>
          {modelValidation?.testMetrics && (
            <div className="mt-4 pt-3 border-t border-border grid grid-cols-2 sm:grid-cols-4 gap-3">
              {Object.entries(modelValidation.testMetrics).map(([k, v]) => (
                <div key={k} className="p-2.5 rounded-lg bg-surface-muted border border-border text-center">
                  <span className="text-[10px] uppercase font-bold text-muted-foreground block">{k}</span>
                  <span className="text-sm font-bold text-foreground">
                    {typeof v === "number" ? v.toFixed(4) : String(v)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 text-center text-muted-foreground flex flex-col items-center justify-center min-h-[200px]">
      <p className="text-sm font-semibold text-foreground">Model Training & Validation</p>
      <p className="text-xs text-muted-foreground mt-1">
        Run the pipeline to generate model recommendations and commence AutoML training.
      </p>
    </div>
  );
}
