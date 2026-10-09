import {
  GraphNodeKey,
  PipelineStepStatus,
  TrackedAgentKey,
  normalizeFlatStageStatuses,
  normalizeStageOutputs,
} from "./pipelineNames";

export type PipelineCategory = "Data Ingestion" | "Feature Engineering" | "Model Training & Validation";

export interface StageRuleConfig {
  id: GraphNodeKey;
  displayName: string;
  pipeline: PipelineCategory;
  predecessorNode: GraphNodeKey | "__start__";
  interruptBefore: boolean;
  requiresApproval: boolean;
  statusWhileWaiting?: PipelineStepStatus;
  approvalPrompt?: string;
  nextStepOnApproval?: GraphNodeKey;
  requiredInputsOnApproval?: Array<"selectedModels" | "splitDates" | "yamlConfig">;
  prerequisites?: (state: any) => boolean;
  downstreamOutputsToClearOnRetry?: TrackedAgentKey[];
}

function nodeStatus(state: any, node: TrackedAgentKey): string | undefined {
  return normalizeFlatStageStatuses(state?.stageStatuses)[node];
}

function nodeOutput(state: any, node: TrackedAgentKey): unknown {
  return normalizeStageOutputs(state?.stageOutputs)[node];
}

export const WORKFLOW_STAGE_RULES: readonly StageRuleConfig[] = [
  {
    id: "inspect",
    displayName: "Data Inspection",
    pipeline: "Data Ingestion",
    predecessorNode: "__start__",
    interruptBefore: false,
    requiresApproval: false,
  },
  {
    id: "profileData",
    displayName: "Data Profiling",
    pipeline: "Data Ingestion",
    predecessorNode: "inspect",
    interruptBefore: false,
    requiresApproval: false,
  },
  {
    id: "resolveSchema",
    displayName: "Schema Resolver",
    pipeline: "Data Ingestion",
    predecessorNode: "profileData",
    interruptBefore: false,
    requiresApproval: false,
  },
  {
    id: "hierarchyMapperNode",
    displayName: "Hierarchy Mapper",
    pipeline: "Feature Engineering",
    predecessorNode: "resolveSchema",
    interruptBefore: true,
    requiresApproval: true,
    statusWhileWaiting: "Awaiting Approval",
    approvalPrompt: "Data Ingestion completed successfully. Approve to proceed to Feature Engineering.",
    nextStepOnApproval: "hierarchyMapperNode",
    prerequisites: (state) => Boolean(
      nodeOutput(state, "resolveSchema") ||
      nodeStatus(state, "resolveSchema") === "Completed"
    ),
    downstreamOutputsToClearOnRetry: [
      "hierarchyMapperNode",
      "featureArchitectNode",
      "featureValidatorNode",
      "exogenous",
      "modelSelectionNode",
      "trainingConfigurationNode",
      "preFlightNode",
      "modelTrainingCodeNode",
      "modelTrainingExecNode",
    ],
  },
  {
    id: "featureArchitectNode",
    displayName: "Feature Architect",
    pipeline: "Feature Engineering",
    predecessorNode: "hierarchyMapperNode",
    interruptBefore: false,
    requiresApproval: false,
  },
  {
    id: "exogenous",
    displayName: "Exogenous Scout",
    pipeline: "Feature Engineering",
    predecessorNode: "featureArchitectNode",
    interruptBefore: false,
    requiresApproval: false,
  },
  {
    id: "modelSelectionNode",
    displayName: "Model Selection",
    pipeline: "Model Training & Validation",
    predecessorNode: "exogenous",
    interruptBefore: true,
    requiresApproval: true,
    statusWhileWaiting: "User Input",
    approvalPrompt: "Feature Engineering completed successfully. Approve to run Model Selection agent and discover candidate models.",
    nextStepOnApproval: "modelSelectionNode",
    prerequisites: (state) => Boolean(
      nodeOutput(state, "featureArchitectNode") ||
      nodeOutput(state, "exogenous") ||
      nodeStatus(state, "exogenous") === "Completed"
    ),
    downstreamOutputsToClearOnRetry: [
      "modelSelectionNode",
      "trainingConfigurationNode",
      "preFlightNode",
      "modelTrainingCodeNode",
      "modelTrainingExecNode",
    ],
  },
  {
    id: "trainingConfigurationNode",
    displayName: "Training Configuration",
    pipeline: "Model Training & Validation",
    predecessorNode: "modelSelectionNode",
    interruptBefore: true,
    requiresApproval: true,
    statusWhileWaiting: "User Input",
    approvalPrompt: "Model Selection completed successfully. Select candidate models in the UI and click Send to Training Configuration.",
    nextStepOnApproval: "trainingConfigurationNode",
    requiredInputsOnApproval: ["selectedModels"],
    prerequisites: (state) => Boolean(
      ((nodeOutput(state, "modelSelectionNode") as any)?.candidates?.length ?? 0) > 0 ||
      ((nodeOutput(state, "modelSelectionNode") as any)?.models?.length ?? 0) > 0 ||
      nodeStatus(state, "modelSelectionNode") === "Completed"
    ),
    downstreamOutputsToClearOnRetry: [
      "trainingConfigurationNode",
      "preFlightNode",
      "modelTrainingCodeNode",
      "modelTrainingExecNode",
    ],
  },
  {
    id: "preFlightNode",
    displayName: "Pre Flight",
    pipeline: "Model Training & Validation",
    predecessorNode: "trainingConfigurationNode",
    interruptBefore: true,
    requiresApproval: true,
    statusWhileWaiting: "User Input",
    approvalPrompt: "Training Configuration completed successfully. Review or edit the configuration in the editor, then click Approve & Start Preflight.",
    nextStepOnApproval: "preFlightNode",
    prerequisites: (state) => Boolean(
      ((nodeOutput(state, "trainingConfigurationNode") as any)?.contractPath) ||
      ((nodeOutput(state, "trainingConfigurationNode") as any)?.configuration) ||
      nodeStatus(state, "trainingConfigurationNode") === "Completed"
    ),
    downstreamOutputsToClearOnRetry: [
      "preFlightNode",
      "modelTrainingCodeNode",
      "modelTrainingExecNode",
    ],
  },
  {
    id: "modelTrainingCodeNode",
    displayName: "Model Training Code Generation",
    pipeline: "Model Training & Validation",
    predecessorNode: "preFlightNode",
    interruptBefore: true,
    requiresApproval: true,
    statusWhileWaiting: "User Input",
    approvalPrompt: "Pre Flight completed successfully. Enter train split dates and click Approve & Generate Training Code.",
    nextStepOnApproval: "modelTrainingCodeNode",
    requiredInputsOnApproval: ["splitDates"],
    prerequisites: (state) => Boolean(
      (nodeOutput(state, "preFlightNode") as any)?.decision ||
      nodeStatus(state, "preFlightNode") === "Completed"
    ),
    downstreamOutputsToClearOnRetry: [
      "modelTrainingCodeNode",
      "modelTrainingExecNode",
    ],
  },
  {
    id: "modelTrainingExecNode",
    displayName: "Model Training Execution",
    pipeline: "Model Training & Validation",
    predecessorNode: "modelTrainingCodeNode",
    interruptBefore: true,
    requiresApproval: true,
    statusWhileWaiting: "User Input",
    approvalPrompt: "Training code generated successfully. Select the candidate models to train and click Execute Training in Docker.",
    nextStepOnApproval: "modelTrainingExecNode",
    requiredInputsOnApproval: ["selectedModels"],
    prerequisites: (state) => Boolean(
      nodeOutput(state, "modelTrainingCodeNode") ||
      ((nodeOutput(state, "modelTrainingExecNode") as any)?.filesCreated) ||
      ((nodeOutput(state, "modelTrainingExecNode") as any)?.projectDirectory)
    ),
    downstreamOutputsToClearOnRetry: [
      "modelTrainingExecNode",
    ],
  },
] as const;

export function getInterruptBeforeNodes(): string[] {
  return WORKFLOW_STAGE_RULES.filter((rule) => rule.interruptBefore).map((rule) => rule.id);
}

const SUBSTEP_TO_NODE_RULE_KEY: Record<string, GraphNodeKey> = {
  // Data Ingestion
  "Data Ingestion": "inspect",
  inspect: "inspect",
  dataInspection: "inspect",
  "Data Inspection": "inspect",
  inspection: "inspect",
  profileData: "profileData",
  dataProfile: "profileData",
  dataProfiling: "profileData",
  "Data Profiling": "profileData",
  resolveSchema: "resolveSchema",
  schemaResolution: "resolveSchema",
  schemaResolver: "resolveSchema",
  "Schema Resolver": "resolveSchema",

  // Feature Engineering
  "Feature Engineering": "hierarchyMapperNode",
  hierarchyMapperNode: "hierarchyMapperNode",
  hierarchyMapper: "hierarchyMapperNode",
  "Hierarchy Mapper": "hierarchyMapperNode",
  relationshipBuilder: "hierarchyMapperNode",
  formBuilder: "hierarchyMapperNode",
  featureArchitectNode: "featureArchitectNode",
  featureArchitect: "featureArchitectNode",
  "Feature Architect": "featureArchitectNode",
  featureSupervisor: "featureArchitectNode",
  featureCreation: "featureArchitectNode",
  featureTransformation: "featureArchitectNode",
  featureExtraction: "featureArchitectNode",
  featureSelection: "featureArchitectNode",
  buildDataset: "featureArchitectNode",
  dataValidation: "featureArchitectNode",
  programRectifier: "featureArchitectNode",
  featureValidatorNode: "featureArchitectNode",
  featureValidator: "featureArchitectNode",
  "Feature Validator": "featureArchitectNode",
  exogenous: "exogenous",
  exogenousScout: "exogenous",
  "Exogenous Scout": "exogenous",

  // Model Training & Validation
  "Model Training & Validation": "modelSelectionNode",
  modelSelectionNode: "modelSelectionNode",
  modelSelection: "modelSelectionNode",
  "Model Selection": "modelSelectionNode",
  finalModelSelectionNode: "modelSelectionNode",
  trainingConfigurationNode: "trainingConfigurationNode",
  trainingConfiguration: "trainingConfigurationNode",
  "Training Configuration": "trainingConfigurationNode",
  trainingConfig: "trainingConfigurationNode",
  preFlightNode: "preFlightNode",
  preFlight: "preFlightNode",
  "Pre Flight": "preFlightNode",
  modelTrainingCodeNode: "modelTrainingCodeNode",
  modelTrainingCode: "modelTrainingCodeNode",
  "Model Training Code Generation": "modelTrainingCodeNode",
  modelTrainingExecNode: "modelTrainingExecNode",
  modelTrainingExec: "modelTrainingExecNode",
  modelTraining: "modelTrainingExecNode",
  modelTrainingNode: "modelTrainingExecNode",
  "Model Training Execution": "modelTrainingExecNode",
  "Model Training": "modelTrainingExecNode",
  modelEvaluation: "modelTrainingExecNode",
  modelEvaluationNode: "modelTrainingExecNode",
  modelValidation: "modelTrainingExecNode",
  modelValidationNode: "modelTrainingExecNode",
  "Model Validation": "modelTrainingExecNode",
};

export function getStageRuleByNode(nodeId?: string | null): StageRuleConfig | undefined {
  if (!nodeId) return undefined;
  const mappedKey = SUBSTEP_TO_NODE_RULE_KEY[nodeId];
  if (mappedKey) {
    const found = WORKFLOW_STAGE_RULES.find((rule) => rule.id === mappedKey);
    if (found) return found;
  }
  const normalized = String(nodeId).trim().toLowerCase();
  return WORKFLOW_STAGE_RULES.find(
    (rule) =>
      rule.id.toLowerCase() === normalized ||
      rule.displayName.toLowerCase() === normalized
  );
}

export function getPipelineForSubstep(substepOrNode?: string | null): PipelineCategory {
  if (!substepOrNode) return "Data Ingestion";
  const rule = getStageRuleByNode(substepOrNode);
  if (rule?.pipeline) return rule.pipeline;

  const normalized = String(substepOrNode).trim().toLowerCase();
  if (
    normalized.includes("hierarchy") ||
    normalized.includes("relationship") ||
    normalized.includes("formbuilder") ||
    normalized.includes("architect") ||
    normalized.includes("feature") ||
    normalized.includes("exogenous")
  ) {
    return "Feature Engineering";
  }
  if (
    normalized.includes("model") ||
    normalized.includes("training") ||
    normalized.includes("preflight") ||
    normalized.includes("pre flight") ||
    normalized.includes("configuration") ||
    normalized.includes("validation")
  ) {
    return "Model Training & Validation";
  }
  return "Data Ingestion";
}

export function resolveSafePredecessorNode(
  requestedStep: string | undefined,
  savedState: any
): string {
  const rule = getStageRuleByNode(requestedStep);
  if (!rule) return "resolveSchema";

  if (rule.prerequisites && !rule.prerequisites(savedState)) {
    const predRule = getStageRuleByNode(rule.predecessorNode);
    if (predRule && (!predRule.prerequisites || predRule.prerequisites(savedState))) {
      return predRule.predecessorNode;
    }
    return "resolveSchema";
  }

  return rule.predecessorNode;
}

export function getApprovalGateForNode(nodeIdOrAlias?: string | null): {
  isGate: boolean;
  approvalPrompt: string;
  nextStep: string;
  waitingStatus?: PipelineStepStatus;
  rule?: StageRuleConfig;
} {
  const rule = getStageRuleByNode(nodeIdOrAlias);
  if (!rule || !rule.requiresApproval) {
    return {
      isGate: false,
      approvalPrompt: "",
      nextStep: "",
      rule,
    };
  }

  return {
    isGate: true,
    approvalPrompt: rule.approvalPrompt || `${rule.displayName} requires user confirmation.`,
    nextStep: rule.nextStepOnApproval || rule.id,
    waitingStatus: rule.statusWhileWaiting,
    rule,
  };
}
