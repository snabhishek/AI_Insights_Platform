"use client";

import React from "react";
import ModelSelectionStepOutput from "./ModelSelectionStepOutput";
import TrainingConfigurationStepOutput from "./TrainingConfigurationStepOutput";

interface ModelTrainingValidationOutputProps {
  modelSelection?: any;
  modelTraining?: any;
  modelValidation?: any;
  trainingConfiguration?: any;
  preFlight?: any;
  projectId?: string;
  activeSubstep?: string;
  activeRunTimestamp?: string;
  onSelectionConfirmed?: (selectedModels: string[]) => void;
}

export default function ModelTrainingValidationStepOutput({
  modelSelection,
  modelTraining,
  modelValidation,
  trainingConfiguration,
  preFlight,
  projectId,
  activeSubstep,
  activeRunTimestamp,
  onSelectionConfirmed,
}: ModelTrainingValidationOutputProps) {
  // 1. Model Selection (UI is actively worked on)
  if (activeSubstep === "Model Selection" || (modelSelection && !trainingConfiguration && !preFlight && !modelTraining && !modelValidation)) {
    if (!modelSelection) {
      return (
        <div className="p-8 text-center text-muted-foreground flex flex-col items-center justify-center min-h-[200px]">
          <p className="text-sm font-semibold text-foreground">Model Selection</p>
          <p className="text-xs text-muted-foreground mt-1">
            Run the pipeline to generate model recommendations.
          </p>
        </div>
      );
    }
    return (
      <ModelSelectionStepOutput
        modelSelection={modelSelection}
        projectId={projectId}
        onSelectionConfirmed={onSelectionConfirmed}
      />
    );
  }

  // 2. Training Configuration (UI is actively worked on)
  if (activeSubstep === "Training Configuration" || (Boolean(trainingConfiguration?.contractPath || trainingConfiguration?.status === "Completed") && !preFlight && !modelTraining && !modelValidation)) {
    if (!trainingConfiguration) {
      return (
        <div className="p-8 text-center text-muted-foreground flex flex-col items-center justify-center min-h-[200px]">
          <p className="text-sm font-semibold text-foreground">Training Configuration</p>
          <p className="text-xs text-muted-foreground mt-1">
            Training configuration contract has not been generated yet.
          </p>
        </div>
      );
    }
    return (
      <TrainingConfigurationStepOutput
        projectId={projectId}
        trainingConfiguration={trainingConfiguration}
        modelSelection={modelSelection}
        activeRunTimestamp={activeRunTimestamp}
      />
    );
  }

  // 3. Pre Flight (Maintained simply like Model Training, no fake defaults)
  if (activeSubstep === "Pre Flight" || (preFlight && !modelTraining && !modelValidation)) {
    if (!preFlight) {
      return (
        <div className="p-8 text-center text-muted-foreground flex flex-col items-center justify-center min-h-[200px]">
          <p className="text-sm font-semibold text-foreground">Pre Flight</p>
          <p className="text-xs text-muted-foreground mt-1">
            Pre-flight verification output has not been produced yet.
          </p>
        </div>
      );
    }
    return (
      <div className="p-6 space-y-4">
        <div className="rounded-xl border border-border bg-surface p-5">
          <h4 className="text-sm font-bold text-foreground">Pre Flight Overview</h4>
          <p className="text-xs text-muted-foreground mt-1">
            {preFlight.summary || "Pre-flight validation completed."}
          </p>
          {preFlight.checks && Array.isArray(preFlight.checks) && preFlight.checks.length > 0 && (
            <div className="mt-4 pt-3 border-t border-border space-y-2">
              {preFlight.checks.map((check: any, idx: number) => (
                <div key={check.id || idx} className="p-2.5 rounded-lg bg-surface-muted border border-border flex items-center justify-between">
                  <div>
                    <span className="text-xs font-medium text-foreground block">{check.name || check.id}</span>
                    {check.details && <span className="text-[11px] text-muted-foreground">{check.details}</span>}
                  </div>
                  {check.status && (
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                      check.status === "PASSED"
                        ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
                        : "bg-surface text-muted-foreground border border-border"
                    }`}>
                      {check.status}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // 4. Model Training or Model Validation
  if (activeSubstep === "Model Training" || activeSubstep === "Model Validation" || modelTraining || modelValidation) {
    const isValidationSubstep = activeSubstep === "Model Validation";
    const title = isValidationSubstep
      ? "Model Validation Overview"
      : activeSubstep === "Model Training"
      ? "Model Training Overview"
      : "Model Training & Validation Overview";

    const summary = isValidationSubstep
      ? modelValidation?.summary || "Model validation completed."
      : modelTraining?.summary || modelValidation?.summary || "Model training artifacts prepared.";

    return (
      <div className="p-6 space-y-4">
        <div className="rounded-xl border border-border bg-surface p-5">
          <h4 className="text-sm font-bold text-foreground">{title}</h4>
          <p className="text-xs text-muted-foreground mt-1">{summary}</p>
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
      <p className="text-sm font-semibold text-foreground">
        {activeSubstep || "Model Training & Validation"}
      </p>
      <p className="text-xs text-muted-foreground mt-1">
        Run the pipeline to generate model recommendations and commence AutoML training.
      </p>
    </div>
  );
}
