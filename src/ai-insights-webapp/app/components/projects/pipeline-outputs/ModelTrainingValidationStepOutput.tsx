"use client";

import React from "react";
import ModelSelectionStepOutput from "./ModelSelectionStepOutput";
import TrainingConfigurationStepOutput from "./TrainingConfigurationStepOutput";
import PreFlightStepOutput from "./PreFlightStepOutput";
import ModelTrainingStepOutput from "./ModelTrainingStepOutput";
import ModelValidationStepOutput from "./ModelValidationStepOutput";

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
  onApprove?: (selectedModels?: string[], splitEndDate?: string) => void;
  onApproveValidation?: (horizon: number, frequency: string, startDate?: string, selectedModels?: string[]) => void;
  onApprovePreFlight?: () => void;
  onNavigateToValidation?: (selectedModels: string[]) => void;
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
  onApprove,
  onApproveValidation,
  onApprovePreFlight,
  onNavigateToValidation,
  isApproving,
}: ModelTrainingValidationOutputProps) {
  // 1. Model Selection Substep
  if (
    activeSubstep === "Model Selection" ||
    (!activeSubstep && modelSelection && !trainingConfiguration && !preFlight && !modelTraining && !modelValidation)
  ) {
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

  // 2. Training Configuration Substep
  if (
    activeSubstep === "Training Configuration" ||
    (!activeSubstep && Boolean(trainingConfiguration?.contractPath || trainingConfiguration?.status === "Completed") &&
      !preFlight &&
      !modelTraining &&
      !modelValidation)
  ) {
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
        onApprove={onApprove}
        isApproving={isApproving}
      />
    );
  }

  // 3. Pre Flight Substep
  if (
    activeSubstep === "Pre Flight" ||
    (!activeSubstep && Boolean(preFlight) && !modelTraining && !modelValidation)
  ) {
    if (!preFlight) {
      return (
        <div className="p-8 text-center text-muted-foreground flex flex-col items-center justify-center min-h-[200px]">
          <p className="text-sm font-semibold text-foreground">Pre Flight Verification</p>
          <p className="text-xs text-muted-foreground mt-1">
            Pre-flight verification has not been performed yet.
          </p>
        </div>
      );
    }
    return (
      <PreFlightStepOutput
        preFlight={preFlight}
        projectId={projectId}
        activeRunTimestamp={activeRunTimestamp}
        onApprovePreFlight={onApprovePreFlight}
        isApproving={isApproving}
      />
    );
  }

  // 4. Model Training Substep
  if (
    activeSubstep === "Model Training" ||
    (!activeSubstep && Boolean(modelTraining) && !modelValidation)
  ) {
    return (
      <ModelTrainingStepOutput
        modelTraining={modelTraining || {}}
        trainingConfiguration={trainingConfiguration}
        modelSelection={modelSelection}
        projectId={projectId}
        activeRunTimestamp={activeRunTimestamp}
        onApproveTraining={onApproveTraining}
        onNavigateToValidation={onNavigateToValidation}
        onApproveValidation={(selectedModels) => {
          if (onApproveValidation) {
            onApproveValidation(12, "Weekly", undefined, selectedModels);
          }
        }}
        isApproving={isApproving}
      />
    );
  }

  // 5. Model Validation Substep
  if (
    activeSubstep === "Model Validation" ||
    (!activeSubstep && Boolean(modelValidation))
  ) {
    return (
      <ModelValidationStepOutput
        modelValidation={modelValidation}
        modelTraining={modelTraining}
        trainingConfiguration={trainingConfiguration}
        modelSelection={modelSelection}
        projectId={projectId}
        activeRunTimestamp={activeRunTimestamp}
        onApproveValidation={onApproveValidation}
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
