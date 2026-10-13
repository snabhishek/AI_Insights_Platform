export const PIPELINE_PHASES = {
  DATA_INGESTION: "Data Ingestion",
  FEATURE_ENGINEERING: "Feature Engineering",
  MODEL_TRAINING_VALIDATION: "Model Training & Validation",
} as const;

export type PipelinePhase = typeof PIPELINE_PHASES[keyof typeof PIPELINE_PHASES];

export const SUBSTEP_TO_PIPELINE_MAP: Record<string, PipelinePhase> = {

  "dataIngestion": PIPELINE_PHASES.DATA_INGESTION,
  "featureEngineering": PIPELINE_PHASES.FEATURE_ENGINEERING,
  "modelTrainingValidation": PIPELINE_PHASES.MODEL_TRAINING_VALIDATION,
  "inspect": PIPELINE_PHASES.DATA_INGESTION,
  "profileData": PIPELINE_PHASES.DATA_INGESTION,
  "dataProfile": PIPELINE_PHASES.DATA_INGESTION,
  "resolveSchema": PIPELINE_PHASES.DATA_INGESTION,
  "schemaResolution": PIPELINE_PHASES.DATA_INGESTION,
  "Data Inspection": PIPELINE_PHASES.DATA_INGESTION,
  "Data Profiling": PIPELINE_PHASES.DATA_INGESTION,
  "Schema Resolver": PIPELINE_PHASES.DATA_INGESTION,
  "Data Ingestion": PIPELINE_PHASES.DATA_INGESTION,

  "Hierarchy Mapper": PIPELINE_PHASES.FEATURE_ENGINEERING,
  "hierarchyMapper": PIPELINE_PHASES.FEATURE_ENGINEERING,
  "hierarchyMapperNode": PIPELINE_PHASES.FEATURE_ENGINEERING,
  "relationshipBuilder": PIPELINE_PHASES.FEATURE_ENGINEERING,
  "formBuilder": PIPELINE_PHASES.FEATURE_ENGINEERING,
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
  "Model Training": PIPELINE_PHASES.MODEL_TRAINING_VALIDATION,
  "modelTraining": PIPELINE_PHASES.MODEL_TRAINING_VALIDATION,
  "modelTrainingNode": PIPELINE_PHASES.MODEL_TRAINING_VALIDATION,
  "Model Validation": PIPELINE_PHASES.MODEL_TRAINING_VALIDATION,
  "modelValidation": PIPELINE_PHASES.MODEL_TRAINING_VALIDATION,
  "modelValidationNode": PIPELINE_PHASES.MODEL_TRAINING_VALIDATION,
  "Model Training & Validation": PIPELINE_PHASES.MODEL_TRAINING_VALIDATION,
};

export const STEP_TO_NODE_MAP: Record<string, string> = {

  "Data Inspection": "inspect",
  "Data Profiling": "profileData",
  "dataProfile": "profileData",
  "Schema Resolver": "resolveSchema",
  "schemaResolution": "resolveSchema",
  "inspect": "inspect",
  "profileData": "profileData",
  "resolveSchema": "resolveSchema",

  "Hierarchy Mapper": "hierarchyMapperNode",
  "hierarchyMapper": "hierarchyMapperNode",
  "hierarchyMapperNode": "hierarchyMapperNode",
  "relationshipBuilder": "hierarchyMapperNode",
  "formBuilder": "hierarchyMapperNode",
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
  "Model Training": "modelTrainingCodeNode",
  "modelTraining": "modelTrainingCodeNode",
  "modelTrainingNode": "modelTrainingCodeNode",
  "Model Validation": "modelValidationNode",
  "modelValidation": "modelValidationNode",
  "modelValidationNode": "modelValidationNode",
};

export interface ResolveNextPhaseParams {
  approvalNextStep?: string | null;
  overrideTargetPhase?: string;
}

export function resolveNextWorkflowPhase(params: ResolveNextPhaseParams): string {
  const { approvalNextStep, overrideTargetPhase } = params;

  const validOverride =
    overrideTargetPhase && overrideTargetPhase.trim().length > 0
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
      nextStepLower === "model selection" ||
      nextStepLower === "modelselection" ||
      nextStepLower === "modelselectionnode" ||
      nextStepLower === "model training & validation" ||
      nextStepLower === "modeltrainingvalidation"
    ) {
      targetPhase = "Model Selection";
    } else {

      targetPhase = "Feature Engineering";
    }
  }

  return targetPhase;
}

export interface ModelTrainingReviewInfo {
  stepId: "modelSelectionNode" | "trainingConfigurationNode" | "preFlightNode" | "modelTrainingCodeNode";
  title: string;
  buttonLabel: string;
}

export function resolveModelTrainingReviewStep(
  statuses: Record<string, any> = {},
  approvalNextStep?: string | null
): ModelTrainingReviewInfo {
  const getStatus = (id: string) => {
    const s = statuses[id];
    return typeof s === "object" ? s?.status : s;
  };

  // 1. If approvalNextStep is provided, map from NEXT step to the COMPLETED step that needs review
  const nextLower = (approvalNextStep || "").toLowerCase().trim();
  if (nextLower.includes("pre flight") || nextLower.includes("preflight") || nextLower === "preflightnode") {
    return { stepId: "trainingConfigurationNode", title: "Training Configuration", buttonLabel: "Review Training Configuration" };
  }
  if (nextLower.includes("training configuration") || nextLower.includes("trainingconfiguration") || nextLower === "trainingconfigurationnode") {
    return { stepId: "modelSelectionNode", title: "Model Selection", buttonLabel: "Review Model Selection" };
  }
  if (nextLower.includes("model training") || nextLower.includes("modeltraining") || nextLower === "modeltrainingnode" || nextLower === "modeltrainingcodenode") {
    return { stepId: "preFlightNode", title: "Pre Flight", buttonLabel: "Review Pre-Flight Verification" };
  }
  if (nextLower.includes("model validation") || nextLower.includes("modelvalidation") || nextLower.includes("modeltrainingexecution")) {
    return { stepId: "modelTrainingCodeNode", title: "Model Training Code Generation", buttonLabel: "Review Model Training Code" };
  }

  // 2. Fallback based on completed statuses in database (reverse chronological order)
  if (getStatus("modelTrainingCodeNode") === "Completed") {
    return { stepId: "modelTrainingCodeNode", title: "Model Training Code Generation", buttonLabel: "Review Model Training Code" };
  }
  if (getStatus("preFlightNode") === "Completed") {
    return { stepId: "preFlightNode", title: "Pre Flight", buttonLabel: "Review Pre-Flight Verification" };
  }
  if (getStatus("trainingConfigurationNode") === "Completed") {
    return { stepId: "trainingConfigurationNode", title: "Training Configuration", buttonLabel: "Review Training Configuration" };
  }
  if (getStatus("modelSelectionNode") === "Completed") {
    return { stepId: "modelSelectionNode", title: "Model Selection", buttonLabel: "Review Model Selection" };
  }

  // 3. Fallback: check if any node is explicitly "User Input" or "Awaiting Approval"
  if (getStatus("modelTrainingCodeNode") === "User Input" || getStatus("modelTrainingCodeNode") === "Awaiting Approval") {
    return { stepId: "modelTrainingCodeNode", title: "Model Training Code Generation", buttonLabel: "Review Model Training Code" };
  }
  if (getStatus("trainingConfigurationNode") === "User Input" || getStatus("trainingConfigurationNode") === "Awaiting Approval") {
    return { stepId: "trainingConfigurationNode", title: "Training Configuration", buttonLabel: "Review Training Configuration" };
  }
  if (getStatus("modelSelectionNode") === "User Input" || getStatus("modelSelectionNode") === "Awaiting Approval") {
    return { stepId: "modelSelectionNode", title: "Model Selection", buttonLabel: "Review Model Selection" };
  }
  if (getStatus("preFlightNode") === "User Input" || getStatus("preFlightNode") === "Awaiting Approval") {
    return { stepId: "preFlightNode", title: "Pre Flight", buttonLabel: "Review Pre-Flight Verification" };
  }

  return { stepId: "modelSelectionNode", title: "Model Selection", buttonLabel: "Review Model Selection" };
}

