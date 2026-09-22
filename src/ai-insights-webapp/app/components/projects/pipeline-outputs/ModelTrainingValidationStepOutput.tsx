"use client";

import React from "react";
import ModelSelectionStepOutput from "./ModelSelectionStepOutput";
import TrainingConfigurationStepOutput from "./TrainingConfigurationStepOutput";
import PreFlightStepOutput from "./PreFlightStepOutput";
import ModelTrainingStepOutput from "./ModelTrainingStepOutput";

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
  onApproveTraining?: (selectedModels: string[], splitStartDate?: string, splitEndDate?: string) => void;
  isApproving?: boolean;
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
  onApproveTraining,
  isApproving,
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

  // 3. Pre Flight (Comprehensive 10-Stage Dashboard)
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
      <PreFlightStepOutput
        preFlight={preFlight}
        projectId={projectId}
        activeRunTimestamp={activeRunTimestamp}
      />
    );
  }

  // 4. Model Training or Model Validation
  if (activeSubstep === "Model Training" || activeSubstep === "Model Validation" || modelTraining || modelValidation) {
    return (
      <ModelTrainingStepOutput
        modelTraining={modelTraining || modelValidation}
        trainingConfiguration={trainingConfiguration}
        modelSelection={modelSelection}
        projectId={projectId}
        activeRunTimestamp={activeRunTimestamp}
        onApproveTraining={onApproveTraining}
        isApproving={isApproving}
      />
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
