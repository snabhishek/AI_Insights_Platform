import { PipelineStatuses, PipelineStatus } from "./types";

export const PIPELINE_PHASES = {
  DATA_INGESTION: "Data Ingestion",
  FEATURE_ENGINEERING: "Feature Engineering",
  MODEL_TRAINING_VALIDATION: "Model Training & Validation",
} as const;

export type PipelinePhase = typeof PIPELINE_PHASES[keyof typeof PIPELINE_PHASES];

export const PHASE_SEQUENCE: readonly PipelinePhase[] = [
  PIPELINE_PHASES.DATA_INGESTION,
  PIPELINE_PHASES.FEATURE_ENGINEERING,
  PIPELINE_PHASES.MODEL_TRAINING_VALIDATION,
];

export const SUBSTEP_TO_PIPELINE_MAP: Record<string, PipelinePhase> = {
  // Data Ingestion
  "inspect": PIPELINE_PHASES.DATA_INGESTION,
  "profileData": PIPELINE_PHASES.DATA_INGESTION,
  "preprocess": PIPELINE_PHASES.DATA_INGESTION,
  "resolveSchema": PIPELINE_PHASES.DATA_INGESTION,
  "Data Inspection": PIPELINE_PHASES.DATA_INGESTION,
  "Data Profiling": PIPELINE_PHASES.DATA_INGESTION,
  "Schema Resolver": PIPELINE_PHASES.DATA_INGESTION,
  "Data Ingestion": PIPELINE_PHASES.DATA_INGESTION,

  // Feature Engineering
  "Hierarchy Mapper": PIPELINE_PHASES.FEATURE_ENGINEERING,
  "hierarchyMapper": PIPELINE_PHASES.FEATURE_ENGINEERING,
  "hierarchyMapperNode": PIPELINE_PHASES.FEATURE_ENGINEERING,
  "Feature Architect": PIPELINE_PHASES.FEATURE_ENGINEERING,
  "featureArchitect": PIPELINE_PHASES.FEATURE_ENGINEERING,
  "featureArchitectNode": PIPELINE_PHASES.FEATURE_ENGINEERING,
  "Feature Validator": PIPELINE_PHASES.FEATURE_ENGINEERING,
  "featureValidator": PIPELINE_PHASES.FEATURE_ENGINEERING,
  "featureValidatorNode": PIPELINE_PHASES.FEATURE_ENGINEERING,
  "Exogenous Scout": PIPELINE_PHASES.FEATURE_ENGINEERING,
  "exogenousScout": PIPELINE_PHASES.FEATURE_ENGINEERING,
  "exogenous": PIPELINE_PHASES.FEATURE_ENGINEERING,
  "Feature Engineering": PIPELINE_PHASES.FEATURE_ENGINEERING,

  // Model Training & Validation
  "Model Selection": PIPELINE_PHASES.MODEL_TRAINING_VALIDATION,
  "modelSelection": PIPELINE_PHASES.MODEL_TRAINING_VALIDATION,
  "modelSelectionNode": PIPELINE_PHASES.MODEL_TRAINING_VALIDATION,
  "Training Configuration": PIPELINE_PHASES.MODEL_TRAINING_VALIDATION,
  "trainingConfiguration": PIPELINE_PHASES.MODEL_TRAINING_VALIDATION,
  "trainingConfigurationNode": PIPELINE_PHASES.MODEL_TRAINING_VALIDATION,
  "Pre Flight": PIPELINE_PHASES.MODEL_TRAINING_VALIDATION,
  "preFlight": PIPELINE_PHASES.MODEL_TRAINING_VALIDATION,
  "preFlightNode": PIPELINE_PHASES.MODEL_TRAINING_VALIDATION,
  "Model Training Code Generation": PIPELINE_PHASES.MODEL_TRAINING_VALIDATION,
  "modelTrainingCode": PIPELINE_PHASES.MODEL_TRAINING_VALIDATION,
  "modelTrainingCodeNode": PIPELINE_PHASES.MODEL_TRAINING_VALIDATION,
  "Model Training Execution": PIPELINE_PHASES.MODEL_TRAINING_VALIDATION,
  "modelTrainingExec": PIPELINE_PHASES.MODEL_TRAINING_VALIDATION,
  "modelTrainingExecNode": PIPELINE_PHASES.MODEL_TRAINING_VALIDATION,
  "Model Training": PIPELINE_PHASES.MODEL_TRAINING_VALIDATION,
  "modelTraining": PIPELINE_PHASES.MODEL_TRAINING_VALIDATION,
  "modelTrainingNode": PIPELINE_PHASES.MODEL_TRAINING_VALIDATION,
  "Model Validation": PIPELINE_PHASES.MODEL_TRAINING_VALIDATION,
  "modelValidation": PIPELINE_PHASES.MODEL_TRAINING_VALIDATION,
  "modelValidationNode": PIPELINE_PHASES.MODEL_TRAINING_VALIDATION,
  "Model Training & Validation": PIPELINE_PHASES.MODEL_TRAINING_VALIDATION,
};

export const STEP_TO_NODE_MAP: Record<string, string> = {
  // Data Ingestion
  "Data Inspection": "inspect",
  "Data Profiling": "profileData",
  "Schema Resolver": "resolveSchema",
  "inspect": "inspect",
  "profileData": "profileData",
  "resolveSchema": "resolveSchema",

  // Feature Engineering
  "Hierarchy Mapper": "hierarchyMapperNode",
  "hierarchyMapper": "hierarchyMapperNode",
  "hierarchyMapperNode": "hierarchyMapperNode",
  "Feature Architect": "featureArchitectNode",
  "featureArchitect": "featureArchitectNode",
  "featureArchitectNode": "featureArchitectNode",
  "Feature Validator": "featureArchitectNode",
  "featureValidator": "featureArchitectNode",
  "featureValidatorNode": "featureArchitectNode",
  "Exogenous Scout": "exogenous",
  "exogenous": "exogenous",
  "exogenousScout": "exogenous",
  "Feature Engineering": "hierarchyMapperNode",

  // Model Training & Validation
  "Model Selection": "modelSelectionNode",
  "modelSelection": "modelSelectionNode",
  "modelSelectionNode": "modelSelectionNode",
  "Model Training & Validation": "modelSelectionNode",
  "Training Configuration": "trainingConfigurationNode",
  "trainingConfiguration": "trainingConfigurationNode",
  "trainingConfigurationNode": "trainingConfigurationNode",
  "Pre Flight": "preFlightNode",
  "preFlight": "preFlightNode",
  "preFlightNode": "preFlightNode",
  "Model Training Code Generation": "modelTrainingCodeNode",
  "modelTrainingCode": "modelTrainingCodeNode",
  "modelTrainingCodeNode": "modelTrainingCodeNode",
  "Model Training Execution": "modelTrainingExecNode",
  "modelTrainingExec": "modelTrainingExecNode",
  "modelTrainingExecNode": "modelTrainingExecNode",
  "Model Training": "modelTrainingCodeNode",
  "modelTraining": "modelTrainingCodeNode",
  "modelTrainingNode": "modelTrainingCodeNode",
  "Model Validation": "modelValidationNode",
  "modelValidation": "modelValidationNode",
  "modelValidationNode": "modelValidationNode",
};

export function getPipelineForSubstep(substepOrNode: string | null | undefined): PipelinePhase {
  if (!substepOrNode) return PIPELINE_PHASES.DATA_INGESTION;
  return SUBSTEP_TO_PIPELINE_MAP[substepOrNode] ?? PIPELINE_PHASES.DATA_INGESTION;
}

export interface ResolveNextPhaseParams {
  approvalNextStep?: string | null;
  overrideTargetPhase?: unknown;
  currentStatuses?: PipelineStatuses;
  stageOutputs?: Record<string, unknown>;
}

export interface ResolveNextPhaseResult {
  targetPhase: string;
  stepNode: string;
  statusesToUpdate: Record<string, PipelineStatus>;
  outputsToClear: string[];
}

/**
 * Resolves the next workflow phase and step payload for approval actions,
 * preventing stale downstream state from hijacking upstream stages.
 */
export function resolveNextWorkflowPhase(params: ResolveNextPhaseParams): ResolveNextPhaseResult {
  const { approvalNextStep, overrideTargetPhase } = params;

  // 1. Explicit user override (e.g. from candidate model selection modal)
  const validOverride =
    typeof overrideTargetPhase === "string" && overrideTargetPhase.trim().length > 0
      ? overrideTargetPhase.trim()
      : undefined;

  let targetPhase = "Feature Engineering";

  if (validOverride) {
    targetPhase = validOverride;
  } else {
    const nextStepLower = (approvalNextStep || "").toLowerCase().trim();

    if (
      nextStepLower === "training configuration" ||
      nextStepLower === "trainingconfiguration" ||
      nextStepLower === "trainingconfigurationnode"
    ) {
      targetPhase = "Training Configuration";
    } else if (
      nextStepLower === "pre flight" ||
      nextStepLower === "preflight" ||
      nextStepLower === "preflightnode"
    ) {
      targetPhase = "Pre Flight";
    } else if (
      nextStepLower === "model training code generation" ||
      nextStepLower === "modeltrainingcode" ||
      nextStepLower === "modeltrainingcodenode" ||
      nextStepLower === "model training" ||
      nextStepLower === "modeltraining" ||
      nextStepLower === "modeltrainingnode"
    ) {
      targetPhase = "Model Training Code Generation";
    } else if (
      nextStepLower === "model training execution" ||
      nextStepLower === "modeltrainingexec" ||
      nextStepLower === "modeltrainingexecnode"
    ) {
      targetPhase = "Model Training Execution";
    } else if (
      nextStepLower.includes("validation")
    ) {
      targetPhase = "Model Validation";
    } else if (
      nextStepLower.includes("model") ||
      nextStepLower.includes("selection")
    ) {
      targetPhase = "Model Selection";
    } else {
      // Default transition after Data Ingestion approval
      targetPhase = "Feature Engineering";
    }
  }

  const stepNode = STEP_TO_NODE_MAP[targetPhase] || targetPhase;

  // 2. Determine state cleanups and status updates based on target phase
  const statusesToUpdate: Record<string, PipelineStatus> = {};
  const outputsToClear: string[] = [];

  if (targetPhase === "Feature Engineering") {
    // Starting Feature Engineering: earlier phase Data Ingestion is complete
    statusesToUpdate["Data Ingestion"] = "Completed";
    statusesToUpdate["Data Inspection"] = "Completed";
    statusesToUpdate["Data Profiling"] = "Completed";
    statusesToUpdate["Schema Resolver"] = "Completed";

    statusesToUpdate["Feature Engineering"] = "In Progress";
    statusesToUpdate["Hierarchy Mapper"] = "In Progress";
    statusesToUpdate["Feature Architect"] = "Pending";
    statusesToUpdate["Feature Validator"] = "Pending";
    statusesToUpdate["Exogenous Scout"] = "Pending";
    statusesToUpdate["Model Training & Validation"] = "Pending";
    statusesToUpdate["Model Selection"] = "Pending";
    statusesToUpdate["Training Configuration"] = "Pending";
    statusesToUpdate["Pre Flight"] = "Pending";
    statusesToUpdate["Model Training"] = "Pending";
    statusesToUpdate["Model Validation"] = "Pending";

    outputsToClear.push(
      "modelSelection",
      "trainingConfiguration",
      "preFlight",
      "modelTrainingCode",
      "modelTraining",
      "modelValidation"
    );
  } else if (targetPhase === "Model Selection") {
    // Starting Model Phase: Data Ingestion and Feature Engineering are complete
    statusesToUpdate["Data Ingestion"] = "Completed";
    statusesToUpdate["Data Inspection"] = "Completed";
    statusesToUpdate["Data Profiling"] = "Completed";
    statusesToUpdate["Schema Resolver"] = "Completed";
    statusesToUpdate["Feature Engineering"] = "Completed";
    statusesToUpdate["Hierarchy Mapper"] = "Completed";
    statusesToUpdate["Feature Architect"] = "Completed";
    statusesToUpdate["Feature Validator"] = "Completed";
    statusesToUpdate["Exogenous Scout"] = "Completed";

    statusesToUpdate["Model Training & Validation"] = "In Progress";
    statusesToUpdate["Model Selection"] = "In Progress";
    statusesToUpdate["Training Configuration"] = "Pending";
    statusesToUpdate["Pre Flight"] = "Pending";
    statusesToUpdate["Model Training"] = "Pending";
    statusesToUpdate["Model Validation"] = "Pending";

    outputsToClear.push(
      "modelSelection",
      "trainingConfiguration",
      "preFlight",
      "modelTrainingCode",
      "modelTraining",
      "modelValidation"
    );
  } else if (targetPhase === "Training Configuration") {
    statusesToUpdate["Training Configuration"] = "In Progress";
    statusesToUpdate["Pre Flight"] = "Pending";
    statusesToUpdate["Model Training"] = "Pending";
    statusesToUpdate["Model Validation"] = "Pending";

    outputsToClear.push("trainingConfiguration", "preFlight", "modelTrainingCode", "modelTraining", "modelValidation");
  } else if (targetPhase === "Pre Flight") {
    statusesToUpdate["Pre Flight"] = "In Progress";
    statusesToUpdate["Model Training"] = "Pending";
    statusesToUpdate["Model Validation"] = "Pending";

    outputsToClear.push("preFlight", "modelTrainingCode", "modelTraining", "modelValidation");
  } else if (targetPhase === "Model Training Code Generation" || targetPhase === "Model Training") {
    statusesToUpdate["Model Training"] = "In Progress";
    statusesToUpdate["Model Validation"] = "Pending";

    outputsToClear.push("modelTrainingCode", "modelTraining", "modelValidation");
  } else if (targetPhase === "Model Training Execution") {
    statusesToUpdate["Model Training"] = "In Progress";
    outputsToClear.push("modelTraining", "modelValidation");
  } else if (targetPhase === "Model Validation") {
    statusesToUpdate["Model Validation"] = "In Progress";
    outputsToClear.push("modelValidation");
  }

  return {
    targetPhase,
    stepNode,
    statusesToUpdate,
    outputsToClear,
  };
}

