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
  "Model Training Execution": PIPELINE_PHASES.MODEL_TRAINING_VALIDATION,
  "modelTrainingExec": PIPELINE_PHASES.MODEL_TRAINING_VALIDATION,
  "modelTrainingExecNode": PIPELINE_PHASES.MODEL_TRAINING_VALIDATION,
  "Model Training": PIPELINE_PHASES.MODEL_TRAINING_VALIDATION,
  "modelTraining": PIPELINE_PHASES.MODEL_TRAINING_VALIDATION,
  "modelTrainingNode": PIPELINE_PHASES.MODEL_TRAINING_VALIDATION,
  "modelEvaluation": PIPELINE_PHASES.MODEL_TRAINING_VALIDATION,
  "modelEvaluationNode": PIPELINE_PHASES.MODEL_TRAINING_VALIDATION,
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
  "Model Training Execution": "modelTrainingExecNode",
  "modelTrainingExec": "modelTrainingExecNode",
  "modelTrainingExecNode": "modelTrainingExecNode",
  "Model Training": "modelTrainingCodeNode",
  "modelTraining": "modelTrainingCodeNode",
  "modelTrainingNode": "modelTrainingCodeNode",
  "modelEvaluation": "modelTrainingExecNode",
  "modelEvaluationNode": "modelTrainingExecNode",
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
      nextStepLower === "model training execution" ||
      nextStepLower === "modeltrainingexec" ||
      nextStepLower === "modeltrainingexecnode"
    ) {
      targetPhase = "Model Training Execution";
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
