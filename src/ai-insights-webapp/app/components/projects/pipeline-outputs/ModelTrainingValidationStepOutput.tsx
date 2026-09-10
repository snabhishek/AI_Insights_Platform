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
