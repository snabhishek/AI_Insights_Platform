export type PipelineCategory = "Data Ingestion" | "Feature Engineering" | "Model Training & Validation";

export interface StageRuleConfig {
  id: string;
  displayName: string;
  pipeline: PipelineCategory;
  predecessorNode: string;
  interruptBefore: boolean;
  requiresApproval: boolean;
  approvalPrompt?: string;
  nextStepOnApproval?: string;
  requiredInputsOnApproval?: Array<"selectedModels" | "splitDates" | "yamlConfig">;
  prerequisites?: (state: any) => boolean;
  downstreamOutputsToClearOnRetry?: string[];
  aliases?: string[];
}

export const WORKFLOW_STAGE_RULES: readonly StageRuleConfig[] = [
  {
    id: "inspect",
    displayName: "Data Inspection",
    pipeline: "Data Ingestion",
    predecessorNode: "__start__",
    interruptBefore: false,
    requiresApproval: false,
    aliases: ["inspectNode", "Data Ingestion", "inspection"],
  },
  {
    id: "profileData",
    displayName: "Data Profiling",
    pipeline: "Data Ingestion",
    predecessorNode: "inspect",
    interruptBefore: false,
    requiresApproval: false,
    aliases: ["preprocess", "dataProfile"],
  },
  {
    id: "resolveSchema",
    displayName: "Schema Resolver",
    pipeline: "Data Ingestion",
    predecessorNode: "profileData",
    interruptBefore: false,
    requiresApproval: false,
    aliases: ["schemaResolverNode", "schemaResolution"],
  },
  {
    id: "hierarchyMapperNode",
    displayName: "Hierarchy Mapper",
    pipeline: "Feature Engineering",
    predecessorNode: "resolveSchema",
    interruptBefore: true,
    requiresApproval: true,
    approvalPrompt: "Data Ingestion completed successfully. Approve to proceed to Feature Engineering.",
    nextStepOnApproval: "Feature Engineering",
    prerequisites: (state) => Boolean(
      state?.schemaResolution ||
      state?.stageOutputs?.resolveSchema ||
      state?.stageStatuses?.resolveSchema === "Completed"
    ),
    downstreamOutputsToClearOnRetry: [
      "hierarchyMapper",
      "relationshipBuilder",
      "formBuilder",
      "featureArchitect",
      "featureValidator",
      "exogenousScout",
      "modelSelection",
      "trainingConfiguration",
      "preFlight",
      "modelTrainingCode",
      "modelTraining",
      "modelValidation",
    ],
    aliases: ["hierarchyMapper", "relationshipBuilder", "formBuilder", "Feature Engineering"],
  },
  {
    id: "featureArchitectNode",
    displayName: "Feature Architect",
    pipeline: "Feature Engineering",
    predecessorNode: "hierarchyMapperNode",
    interruptBefore: false,
    requiresApproval: false,
    aliases: ["featureArchitect", "featureValidator", "featureValidatorNode", "featureCreation", "featureTransformation"],
  },
  {
    id: "exogenous",
    displayName: "Exogenous Scout",
    pipeline: "Feature Engineering",
    predecessorNode: "featureArchitectNode",
    interruptBefore: false,
    requiresApproval: false,
    aliases: ["exogenousScout"],
  },
  {
    id: "modelSelectionNode",
    displayName: "Model Selection",
    pipeline: "Model Training & Validation",
    predecessorNode: "exogenous",
    interruptBefore: true,
    requiresApproval: true,
    approvalPrompt: "Feature Engineering completed successfully. Approve to run Model Selection agent and discover candidate models.",
    nextStepOnApproval: "Model Selection",
    prerequisites: (state) => Boolean(
      state?.featureArchitect ||
      state?.stageOutputs?.featureArchitect ||
      state?.stageOutputs?.exogenousScout ||
      state?.stageStatuses?.exogenousScout === "Completed"
    ),
    downstreamOutputsToClearOnRetry: [
      "modelSelection",
      "trainingConfiguration",
      "preFlight",
      "modelTrainingCode",
      "modelTraining",
      "modelValidation",
    ],
    aliases: ["modelSelection", "Model Training & Validation"],
  },
  {
    id: "trainingConfigurationNode",
    displayName: "Training Configuration",
    pipeline: "Model Training & Validation",
    predecessorNode: "modelSelectionNode",
    interruptBefore: true,
    requiresApproval: true,
    approvalPrompt: "Model Selection completed successfully. Select candidate models in the UI and click Send to Training Configuration.",
    nextStepOnApproval: "Training Configuration",
    requiredInputsOnApproval: ["selectedModels"],
    prerequisites: (state) => Boolean(
      state?.modelSelection?.candidates?.length > 0 ||
      state?.modelSelection?.models?.length > 0 ||
      state?.stageOutputs?.modelSelection?.candidates?.length > 0 ||
      state?.stageOutputs?.modelSelection?.models?.length > 0 ||
      state?.stageStatuses?.modelSelection === "Completed"
    ),
    downstreamOutputsToClearOnRetry: [
      "trainingConfiguration",
      "preFlight",
      "modelTrainingCode",
      "modelTraining",
      "modelValidation",
    ],
    aliases: ["trainingConfiguration"],
  },
  {
    id: "preFlightNode",
    displayName: "Pre Flight",
    pipeline: "Model Training & Validation",
    predecessorNode: "trainingConfigurationNode",
    interruptBefore: true,
    requiresApproval: true,
    approvalPrompt: "Training Configuration completed successfully. Review or edit the configuration in the editor, then click Approve & Start Preflight.",
    nextStepOnApproval: "Pre Flight",
    prerequisites: (state) => Boolean(
      state?.trainingConfiguration?.contractPath ||
      state?.trainingConfiguration?.configuration ||
      state?.stageOutputs?.trainingConfiguration?.contractPath ||
      state?.stageOutputs?.trainingConfiguration?.configuration ||
      state?.stageStatuses?.trainingConfiguration === "Completed"
    ),
    downstreamOutputsToClearOnRetry: [
      "preFlight",
      "modelTrainingCode",
      "modelTraining",
      "modelValidation",
    ],
    aliases: ["preFlight", "Pre Flight", "preFlightNode"],
  },
  {
    id: "modelTrainingCodeNode",
    displayName: "Model Training Code Generation",
    pipeline: "Model Training & Validation",
    predecessorNode: "preFlightNode",
    interruptBefore: true,
    requiresApproval: true,
    approvalPrompt: "Pre Flight completed successfully. Enter train split dates and click Approve & Generate Training Code.",
    nextStepOnApproval: "Model Training",
    requiredInputsOnApproval: ["splitDates"],
    prerequisites: (state) => Boolean(
      state?.preFlight?.decision ||
      state?.stageOutputs?.preFlight?.decision ||
      state?.stageStatuses?.preFlight === "Completed"
    ),
    downstreamOutputsToClearOnRetry: [
      "modelTrainingCode",
      "modelTraining",
      "modelValidation",
    ],
    aliases: ["modelTrainingCode", "Model Training", "modelTraining"],
  },
  {
    id: "modelTrainingExecNode",
    displayName: "Model Training Execution",
    pipeline: "Model Training & Validation",
    predecessorNode: "modelTrainingCodeNode",
    interruptBefore: true,
    requiresApproval: true,
    approvalPrompt: "Training code generated successfully. Select the candidate models to train and click Execute Training in Docker.",
    nextStepOnApproval: "Model Training",
    requiredInputsOnApproval: ["selectedModels"],
    prerequisites: (state) => Boolean(
      state?.modelTrainingCode ||
      state?.stageOutputs?.modelTrainingCode ||
      state?.stageOutputs?.modelTraining?.filesCreated ||
      state?.stageOutputs?.modelTraining?.projectDirectory
    ),
    downstreamOutputsToClearOnRetry: [
      "modelTraining",
      "modelValidation",
    ],
    aliases: ["modelTrainingExec", "modelTrainingNode"],
  },
  {
    id: "modelValidationNode",
    displayName: "Model Validation",
    pipeline: "Model Training & Validation",
    predecessorNode: "modelTrainingExecNode",
    interruptBefore: false,
    requiresApproval: false,
    aliases: ["modelValidation"],
  },
] as const;

/**
 * Returns an array of node IDs that require LangGraph to pause before execution.
 */
export function getInterruptBeforeNodes(): string[] {
  return WORKFLOW_STAGE_RULES.filter((rule) => rule.interruptBefore).map((rule) => rule.id);
}

/**
 * Resolves a stage rule by its exact node ID or known aliases.
 */
export function getStageRuleByNode(nodeIdOrAlias?: string | null): StageRuleConfig | undefined {
  if (!nodeIdOrAlias) return undefined;
  const target = nodeIdOrAlias.trim();
  return WORKFLOW_STAGE_RULES.find(
    (rule) =>
      rule.id === target ||
      rule.displayName.toLowerCase() === target.toLowerCase() ||
      rule.aliases?.some((a) => a.toLowerCase() === target.toLowerCase())
  );
}

/**
 * Resolves the pipeline category for any substep, node name, or alias.
 */
export function getPipelineForSubstep(substepOrNode?: string | null): PipelineCategory {
  const rule = getStageRuleByNode(substepOrNode);
  return rule?.pipeline ?? "Data Ingestion";
}

/**
 * Resolves the safe predecessor node to anchor checkpointer state on resume, retry, or approval.
 */
export function resolveSafePredecessorNode(
  requestedStep: string | undefined,
  savedState: any
): string {
  const rule = getStageRuleByNode(requestedStep);
  if (!rule) return "resolveSchema";

  // If node has prerequisites, verify them against state
  if (rule.prerequisites && !rule.prerequisites(savedState)) {
    const predRule = getStageRuleByNode(rule.predecessorNode);
    if (predRule && (!predRule.prerequisites || predRule.prerequisites(savedState))) {
      return predRule.predecessorNode;
    }
    return "resolveSchema";
  }

  return rule.predecessorNode;
}

/**
 * Checks if a given node is an approval gate and returns its gate details.
 */
export function getApprovalGateForNode(nodeIdOrAlias?: string | null): {
  isGate: boolean;
  approvalPrompt: string;
  nextStep: string;
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
    nextStep: rule.nextStepOnApproval || rule.displayName,
    rule,
  };
}
