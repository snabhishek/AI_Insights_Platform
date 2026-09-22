export const PIPELINE_NAMES = {
  DATA_INGESTION: "Data Ingestion",
  FEATURE_ENGINEERING: "Feature Engineering",
  MODEL_TRAINING_VALIDATION: "Model Training & Validation",
} as const;

export type PipelineName = typeof PIPELINE_NAMES[keyof typeof PIPELINE_NAMES];

const SUBSTEP_TO_PIPELINE: Record<string, PipelineName> = {
  // Data Ingestion
  "inspect": PIPELINE_NAMES.DATA_INGESTION,
  "profileData": PIPELINE_NAMES.DATA_INGESTION,
  "preprocess": PIPELINE_NAMES.DATA_INGESTION,
  "resolveSchema": PIPELINE_NAMES.DATA_INGESTION,
  "Data Inspection": PIPELINE_NAMES.DATA_INGESTION,
  "Data Profiling": PIPELINE_NAMES.DATA_INGESTION,
  "Schema Resolver": PIPELINE_NAMES.DATA_INGESTION,
  "Data Ingestion": PIPELINE_NAMES.DATA_INGESTION,

  // Feature Engineering
  "Hierarchy Mapper": PIPELINE_NAMES.FEATURE_ENGINEERING,
  "hierarchyMapper": PIPELINE_NAMES.FEATURE_ENGINEERING,
  "hierarchyMapperNode": PIPELINE_NAMES.FEATURE_ENGINEERING,
  "Feature Architect": PIPELINE_NAMES.FEATURE_ENGINEERING,
  "featureArchitect": PIPELINE_NAMES.FEATURE_ENGINEERING,
  "featureArchitectNode": PIPELINE_NAMES.FEATURE_ENGINEERING,
  "Feature Validator": PIPELINE_NAMES.FEATURE_ENGINEERING,
  "featureValidator": PIPELINE_NAMES.FEATURE_ENGINEERING,
  "featureValidatorNode": PIPELINE_NAMES.FEATURE_ENGINEERING,
  "Exogenous Scout": PIPELINE_NAMES.FEATURE_ENGINEERING,
  "exogenousScout": PIPELINE_NAMES.FEATURE_ENGINEERING,
  "exogenous": PIPELINE_NAMES.FEATURE_ENGINEERING,
  "Feature Engineering": PIPELINE_NAMES.FEATURE_ENGINEERING,

  // Model Training & Validation
  "Model Selection": PIPELINE_NAMES.MODEL_TRAINING_VALIDATION,
  "modelSelection": PIPELINE_NAMES.MODEL_TRAINING_VALIDATION,
  "modelSelectionNode": PIPELINE_NAMES.MODEL_TRAINING_VALIDATION,
  "Training Configuration": PIPELINE_NAMES.MODEL_TRAINING_VALIDATION,
  "trainingConfiguration": PIPELINE_NAMES.MODEL_TRAINING_VALIDATION,
  "trainingConfigurationNode": PIPELINE_NAMES.MODEL_TRAINING_VALIDATION,
  "Pre Flight": PIPELINE_NAMES.MODEL_TRAINING_VALIDATION,
  "preFlight": PIPELINE_NAMES.MODEL_TRAINING_VALIDATION,
  "preFlightNode": PIPELINE_NAMES.MODEL_TRAINING_VALIDATION,
  "Model Training": PIPELINE_NAMES.MODEL_TRAINING_VALIDATION,
  "modelTraining": PIPELINE_NAMES.MODEL_TRAINING_VALIDATION,
  "modelTrainingNode": PIPELINE_NAMES.MODEL_TRAINING_VALIDATION,
  "Model Evaluation": PIPELINE_NAMES.MODEL_TRAINING_VALIDATION,
  "modelEvaluation": PIPELINE_NAMES.MODEL_TRAINING_VALIDATION,
  "modelEvaluationNode": PIPELINE_NAMES.MODEL_TRAINING_VALIDATION,
  "Model Validation": PIPELINE_NAMES.MODEL_TRAINING_VALIDATION,
  "modelValidation": PIPELINE_NAMES.MODEL_TRAINING_VALIDATION,
  "modelValidationNode": PIPELINE_NAMES.MODEL_TRAINING_VALIDATION,
  "Model Training & Validation": PIPELINE_NAMES.MODEL_TRAINING_VALIDATION,
};

/**
 * Dynamically resolves the pipeline domain category for any given substep or node name.
 */
export function getPipelineForSubstep(substepOrNode?: string | null): PipelineName {
  if (!substepOrNode) return PIPELINE_NAMES.DATA_INGESTION;
  return SUBSTEP_TO_PIPELINE[substepOrNode] ?? PIPELINE_NAMES.DATA_INGESTION;
}

/**
 * Defensively resolves the LangGraph predecessor node when restoring checkpointer state.
 * Validates that prerequisite stages have actually completed in savedState before
 * allowing the checkpointer to be anchored at a downstream node.
 */
export function resolveSafePredecessorNode(
  requestedStep: string | undefined,
  savedState: any
): string {
  const step = (requestedStep || "").trim();
  const stageOutputs = savedState?.stageOutputs || {};
  const stageStatuses = savedState?.stageStatuses || {};

  const hasFeatureEngineering = Boolean(
    stageOutputs.hierarchyMapper ||
    stageOutputs.featureArchitect ||
    stageOutputs.exogenousScout ||
    savedState?.hierarchyMapper ||
    savedState?.featureArchitect ||
    stageStatuses.hierarchyMapper === "Completed" ||
    stageStatuses.featureArchitect === "Completed"
  );

  const hasModelSelection = Boolean(
    stageOutputs.modelSelection?.candidates?.length > 0 ||
    stageOutputs.modelSelection?.models?.length > 0 ||
    savedState?.modelSelection?.candidates?.length > 0 ||
    savedState?.modelSelection?.models?.length > 0 ||
    stageStatuses.modelSelection === "Completed"
  );

  const isTrainingConfigRequested =
    step === "Training Configuration" ||
    step === "trainingConfigurationNode" ||
    step === "trainingConfiguration";

  const isModelSelectionRequested =
    step === "Model Training & Validation" ||
    step === "modelSelection" ||
    step === "modelSelectionNode" ||
    step === "Model Selection";

  const isPreFlightOrTrainingRequested =
    step === "Pre Flight" ||
    step === "preFlightNode" ||
    step === "Model Training" ||
    step === "modelTrainingNode";

  if (isTrainingConfigRequested) {
    // Training Configuration requires Model Selection to have produced candidates
    // AND Feature Engineering to have produced features.
    if (hasModelSelection && hasFeatureEngineering) {
      return "modelSelectionNode";
    }
    if (hasFeatureEngineering) {
      console.warn("[pipelineFlowConfig] Training Configuration requested but Model Selection incomplete. Safe fallback to 'exogenous'.");
      return "exogenous";
    }
    console.warn("[pipelineFlowConfig] Training Configuration requested but Feature Engineering incomplete. Safe fallback to 'resolveSchema'.");
    return "resolveSchema";
  }

  if (isPreFlightOrTrainingRequested) {
    if (hasModelSelection && hasFeatureEngineering) {
      return "modelSelectionNode";
    }
    if (hasFeatureEngineering) {
      return "exogenous";
    }
    return "resolveSchema";
  }

  if (isModelSelectionRequested) {
    if (hasFeatureEngineering) {
      return "exogenous";
    }
    console.warn("[pipelineFlowConfig] Model Selection requested but Feature Engineering incomplete. Safe fallback to 'resolveSchema'.");
    return "resolveSchema";
  }

  // Default: resolveSchema (next scheduled node is hierarchyMapperNode in Feature Engineering)
  return "resolveSchema";
}
