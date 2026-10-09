export type PipelineStepStatus =
  | "None"
  | "Pending"
  | "In-Progress"
  | "Awaiting Approval"
  | "User Input"
  | "Completed"
  | "Failed"
  | "Stopped"
  | "Paused";

export type StageKey = "dataIngestion" | "featureEngineering" | "modelTrainingValidation";

export const GRAPH_NODE_KEYS = [
  "inspect",
  "profileData",
  "resolveSchema",
  "hierarchyMapperNode",
  "featureArchitectNode",
  "exogenous",
  "modelSelectionNode",
  "trainingConfigurationNode",
  "preFlightNode",
  "modelTrainingCodeNode",
  "modelTrainingExecNode",
] as const;

export type GraphNodeKey = (typeof GRAPH_NODE_KEYS)[number];
export type TrackedAgentKey = GraphNodeKey | "featureValidatorNode";

export const TRACKED_AGENT_KEYS = [
  ...GRAPH_NODE_KEYS,
  "featureValidatorNode",
] as const satisfies readonly TrackedAgentKey[];

export const STAGE_CONFIG = {
  dataIngestion: {
    id: "dataIngestion",
    displayName: "Data Ingestion",
    steps: ["inspect", "profileData", "resolveSchema"],
  },
  featureEngineering: {
    id: "featureEngineering",
    displayName: "Feature Engineering",
    steps: ["hierarchyMapperNode", "featureArchitectNode", "featureValidatorNode", "exogenous"],
  },
  modelTrainingValidation: {
    id: "modelTrainingValidation",
    displayName: "Model Training & Validation",
    steps: [
      "modelSelectionNode",
      "trainingConfigurationNode",
      "preFlightNode",
      "modelTrainingCodeNode",
      "modelTrainingExecNode",
    ],
  },
} as const satisfies Record<StageKey, {
  id: StageKey;
  displayName: string;
  steps: readonly TrackedAgentKey[];
}>;

export const NODE_CONFIG = {
  inspect: { id: "inspect", stage: "dataIngestion", displayName: "Data Inspection", metric: "Inspect" },
  profileData: { id: "profileData", stage: "dataIngestion", displayName: "Data Profiling", metric: "Profile" },
  resolveSchema: { id: "resolveSchema", stage: "dataIngestion", displayName: "Schema Resolver", metric: "Resolve" },
  hierarchyMapperNode: { id: "hierarchyMapperNode", stage: "featureEngineering", displayName: "Hierarchy Mapper", metric: "Hierarchy Mapper" },
  featureArchitectNode: { id: "featureArchitectNode", stage: "featureEngineering", displayName: "Feature Architect", metric: "Feature Architect" },
  featureValidatorNode: { id: "featureValidatorNode", stage: "featureEngineering", displayName: "Feature Validator", metric: "Feature Validator" },
  exogenous: { id: "exogenous", stage: "featureEngineering", displayName: "Exogenous Scout", metric: "Exogenous Scout" },
  modelSelectionNode: { id: "modelSelectionNode", stage: "modelTrainingValidation", displayName: "Model Selection", metric: "Select" },
  trainingConfigurationNode: { id: "trainingConfigurationNode", stage: "modelTrainingValidation", displayName: "Training Configuration", metric: "Configure" },
  preFlightNode: { id: "preFlightNode", stage: "modelTrainingValidation", displayName: "Pre Flight", metric: "Validate" },
  modelTrainingCodeNode: { id: "modelTrainingCodeNode", stage: "modelTrainingValidation", displayName: "Model Training Code Generation", metric: "Generate Code" },
  modelTrainingExecNode: { id: "modelTrainingExecNode", stage: "modelTrainingValidation", displayName: "Model Training Execution", metric: "Train" },
} as const satisfies Record<TrackedAgentKey, {
  id: TrackedAgentKey;
  stage: StageKey;
  displayName: string;
  metric: string;
}>;

export type GroupedStageStatuses = Record<StageKey, { status: PipelineStepStatus } & Partial<Record<TrackedAgentKey, PipelineStepStatus>>>;
export type FlatStageStatuses = Partial<Record<TrackedAgentKey, PipelineStepStatus>>;

export type AgentOutput = Record<string, unknown>;

export interface WorkflowDecisionOutput extends AgentOutput {
  targetColumn?: string;
  problemType?: string;
}

export interface FeatureValidatorOutput extends AgentOutput {
  validatedFeatureSet?: {
    kept?: unknown[];
  };
}

export interface FeatureArchitectOutput extends AgentOutput {
  targetColumn?: string;
  problemType?: string;
  orchestrationDecision?: WorkflowDecisionOutput;
  finalOutput?: {
    orchestrationDecision?: WorkflowDecisionOutput;
  };
  featureValidator?: FeatureValidatorOutput;
}

export interface HierarchyMapperOutput extends AgentOutput {
  relationshipBuilder?: AgentOutput;
  formBuilder?: AgentOutput;
}

export interface TrainingConfigurationOutput extends AgentOutput {
  contractPath?: string;
  contractFileName?: string;
  configuration?: TrainingConfigurationValues;
}

export interface ModelTrainingExecutionOutput extends AgentOutput {
  report?: AgentOutput;
  modelValidation?: AgentOutput;
}

export interface InspectedColumnOutput extends AgentOutput {
  name?: string | { technicalName?: string; expandedName?: string; name?: string };
  technicalName?: string;
  dataType?: string;
  nullable?: boolean;
}

export interface InspectedTableOutput extends AgentOutput {
  id?: string;
  name?: string;
  tableName?: string;
  businessDomain?: string;
  domain?: string;
  columns?: Array<string | InspectedColumnOutput>;
}

export interface InspectionSourceOutput extends AgentOutput {
  connectorId?: string;
  connectorName?: string;
  schemaType?: string;
  tables?: InspectedTableOutput[];
}

export interface InspectionOutput extends AgentOutput {
  sources?: InspectionSourceOutput[];
  tables?: InspectedTableOutput[];
}

export interface ProfilingOutput extends AgentOutput {
  sources?: Array<InspectionSourceOutput & { tables?: AgentOutput[] }>;
  profile?: { tables?: AgentOutput[] };
  tables?: AgentOutput[];
}

export interface TrainingConfigurationValues extends AgentOutput {
  split?: AgentOutput;
}

export type StageOutputs = Partial<{
  inspect: InspectionOutput;
  profileData: ProfilingOutput;
  resolveSchema: AgentOutput;
  hierarchyMapperNode: HierarchyMapperOutput;
  featureArchitectNode: FeatureArchitectOutput;
  featureValidatorNode: FeatureValidatorOutput;
  exogenous: AgentOutput;
  modelSelectionNode: AgentOutput;
  trainingConfigurationNode: TrainingConfigurationOutput;
  preFlightNode: AgentOutput;
  modelTrainingCodeNode: AgentOutput;
  modelTrainingExecNode: ModelTrainingExecutionOutput;
}>;

export interface WorkflowAgentState {
  [key: string]: any;
  status?: PipelineStepStatus;
  summary?: string;
  message?: string;
  currentNode?: string;
  currentStage?: string;
  nextStep?: string;
  requiresApproval?: boolean;
  sessionId?: string;
  runTimestamp?: string;
  lastRunTime?: string;
  updatedAt?: string;
  stageStatuses?: GroupedStageStatuses;
  stageOutputs?: StageOutputs;
  inspection?: InspectionOutput;
  schemaResolution?: AgentOutput;
  dataProfile?: ProfilingOutput;
  hierarchyMapper?: HierarchyMapperOutput;
  relationshipBuilder?: AgentOutput;
  formBuilder?: AgentOutput;
  exogenousScout?: AgentOutput;
  featureArchitect?: FeatureArchitectOutput;
  featureValidator?: FeatureValidatorOutput;
  inspect?: InspectionOutput;
  profileData?: ProfilingOutput;
  resolveSchema?: AgentOutput;
  hierarchyMapperNode?: HierarchyMapperOutput;
  featureArchitectNode?: FeatureArchitectOutput;
  featureValidatorNode?: FeatureValidatorOutput;
  exogenous?: AgentOutput;
  modelSelectionNode?: AgentOutput;
  trainingConfigurationNode?: TrainingConfigurationOutput;
  preFlightNode?: AgentOutput;
  modelTrainingCodeNode?: AgentOutput;
  modelTrainingExecNode?: ModelTrainingExecutionOutput;
  modelSelection?: AgentOutput;
  trainingConfiguration?: TrainingConfigurationOutput;
  preFlight?: AgentOutput;
  modelTraining?: ModelTrainingExecutionOutput;
  modelValidation?: AgentOutput;
  splitDate?: string;
  splitEndDate?: string;
  agentThinking?: Record<string, Array<{ time: string; text: string; done: boolean }>>;
}

const STATUS_PRIORITY: readonly PipelineStepStatus[] = [
  "User Input",
  "Awaiting Approval",
  "Failed",
  "Stopped",
  "Paused",
  "In-Progress",
];

export function calculateStageStatus(
  stepStatuses: FlatStageStatuses,
  stageKey: StageKey
): PipelineStepStatus {
  const statuses = STAGE_CONFIG[stageKey].steps.map((step) => stepStatuses[step] ?? "None");
  if (statuses.every((status) => status === "None")) return "None";
  if (statuses.every((status) => status === "Completed")) return "Completed";
  const prioritized = STATUS_PRIORITY.find((status) => statuses.includes(status));
  if (prioritized) return prioritized;
  if (statuses.some((status) => status === "Completed")) return "In-Progress";
  return statuses.some((status) => status === "Pending") ? "Pending" : "None";
}

export function buildGroupedStageStatuses(
  stepStatuses: FlatStageStatuses,
  stageOverrides: Partial<Record<StageKey, PipelineStepStatus>> = {}
): GroupedStageStatuses {
  return Object.fromEntries(
    Object.entries(STAGE_CONFIG).map(([stageKey, config]) => {
      const key = stageKey as StageKey;
      const steps = Object.fromEntries(
        config.steps.map((step) => [step, stepStatuses[step] ?? "None"])
      ) as Partial<Record<TrackedAgentKey, PipelineStepStatus>>;
      return [key, {
        status: stageOverrides[key] ?? calculateStageStatus(stepStatuses, key),
        ...steps,
      }];
    })
  ) as GroupedStageStatuses;
}

export function applyPauseToStageStatuses(
  currentStatuses: unknown,
  pausedStep?: string
): GroupedStageStatuses {
  const flat = normalizeFlatStageStatuses(currentStatuses);
  let resolvedStepKey: TrackedAgentKey | undefined = undefined;

  if (pausedStep && pausedStep in NODE_CONFIG) {
    resolvedStepKey = pausedStep as TrackedAgentKey;
  } else if (pausedStep && pausedStep in LEGACY_AGENT_KEY_ALIASES) {
    resolvedStepKey = LEGACY_AGENT_KEY_ALIASES[pausedStep];
  }

  // If no paused step given, find the first in-progress or active step
  if (!resolvedStepKey) {
    for (const key of TRACKED_AGENT_KEYS) {
      if (flat[key] === "In-Progress") {
        resolvedStepKey = key;
        break;
      }
    }
  }

  // Check if a step was already paused
  if (!resolvedStepKey) {
    for (const key of TRACKED_AGENT_KEYS) {
      if (flat[key] === "Paused") {
        resolvedStepKey = key;
        break;
      }
    }
  }

  // Find the first non-completed step
  if (!resolvedStepKey) {
    for (const key of TRACKED_AGENT_KEYS) {
      if (flat[key] !== "Completed") {
        resolvedStepKey = key;
        break;
      }
    }
  }

  // Fallback to first step if nothing was found
  if (!resolvedStepKey) {
    resolvedStepKey = "inspect";
  }

  flat[resolvedStepKey] = "Paused";
  const parentStage = NODE_CONFIG[resolvedStepKey]?.stage;
  const stageOverrides: Partial<Record<StageKey, PipelineStepStatus>> = {};
  if (parentStage) {
    stageOverrides[parentStage] = "Paused";
  }

  return buildGroupedStageStatuses(flat, stageOverrides);
}

export function findPausedStep(
  currentStatuses: unknown,
  fallbackNode?: string
): TrackedAgentKey | undefined {
  const flat = normalizeFlatStageStatuses(currentStatuses);
  for (const key of TRACKED_AGENT_KEYS) {
    if (flat[key] === "Paused") {
      return key;
    }
  }
  for (const key of TRACKED_AGENT_KEYS) {
    if (flat[key] === "In-Progress") {
      return key;
    }
  }
  if (fallbackNode && fallbackNode in NODE_CONFIG) {
    return fallbackNode as TrackedAgentKey;
  }
  if (fallbackNode && fallbackNode in LEGACY_AGENT_KEY_ALIASES) {
    return LEGACY_AGENT_KEY_ALIASES[fallbackNode];
  }
  for (const key of TRACKED_AGENT_KEYS) {
    if (flat[key] !== "Completed") {
      return key;
    }
  }
  return undefined;
}

export function applyResumeToStageStatuses(
  currentStatuses: unknown,
  resumeStep?: string
): GroupedStageStatuses {
  const flat = normalizeFlatStageStatuses(currentStatuses);
  let resolvedStepKey: TrackedAgentKey | undefined = undefined;

  if (resumeStep && resumeStep in NODE_CONFIG) {
    resolvedStepKey = resumeStep as TrackedAgentKey;
  } else if (resumeStep && resumeStep in LEGACY_AGENT_KEY_ALIASES) {
    resolvedStepKey = LEGACY_AGENT_KEY_ALIASES[resumeStep];
  }

  if (!resolvedStepKey) {
    resolvedStepKey = findPausedStep(currentStatuses);
  }

  if (!resolvedStepKey) {
    resolvedStepKey = "inspect";
  }

  for (const key of TRACKED_AGENT_KEYS) {
    if (flat[key] === "Paused") {
      flat[key] = key === resolvedStepKey ? "In-Progress" : "Pending";
    }
  }
  flat[resolvedStepKey] = "In-Progress";

  const parentStage = NODE_CONFIG[resolvedStepKey]?.stage;
  const stageOverrides: Partial<Record<StageKey, PipelineStepStatus>> = {};
  if (parentStage) {
    stageOverrides[parentStage] = "In-Progress";
  }

  return buildGroupedStageStatuses(flat, stageOverrides);
}

export const LEGACY_AGENT_KEY_ALIASES: Readonly<Record<string, TrackedAgentKey>> = {
  inspectNode: "inspect",
  inspection: "inspect",
  dataProfile: "profileData",
  schemaResolution: "resolveSchema",
  schemaResolverNode: "resolveSchema",
  hierarchyMapper: "hierarchyMapperNode",
  relationshipBuilder: "hierarchyMapperNode",
  formBuilder: "hierarchyMapperNode",
  featureArchitect: "featureArchitectNode",
  featureValidator: "featureValidatorNode",
  exogenousScout: "exogenous",
  modelSelection: "modelSelectionNode",
  trainingConfiguration: "trainingConfigurationNode",
  preFlight: "preFlightNode",
  modelTrainingCode: "modelTrainingCodeNode",
  modelTrainingExec: "modelTrainingExecNode",
  modelTraining: "modelTrainingExecNode",
  modelTrainingNode: "modelTrainingExecNode",
  modelEvaluation: "modelTrainingExecNode",
};

export function normalizePipelineStepStatus(value: unknown): PipelineStepStatus | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase().replace(/[\s_]+/g, "-");
  switch (normalized) {
    case "none":
      return "None";
    case "pending":
      return "Pending";
    case "in-progress":
    case "running":
    case "retrying":
      return "In-Progress";
    case "awaiting-approval":
      return "Awaiting Approval";
    case "user-input":
      return "User Input";
    case "completed":
    case "success":
    case "done":
      return "Completed";
    case "failed":
      return "Failed";
    case "stopped":
      return "Stopped";
    case "paused":
      return "Paused";
    default:
      return undefined;
  }
}

export function normalizeFlatStageStatuses(value: unknown): FlatStageStatuses {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const raw = value as Record<string, unknown>;
  const normalized: FlatStageStatuses = {};

  const assign = (key: string, statusValue: unknown) => {
    if (!TRACKED_AGENT_KEYS.includes(key as TrackedAgentKey)) return;
    const status = normalizePipelineStepStatus(statusValue);
    if (status) normalized[key as TrackedAgentKey] = status;
  };

  for (const groupKey of Object.keys(STAGE_CONFIG) as StageKey[]) {
    const group = raw[groupKey];
    if (!group || typeof group !== "object" || Array.isArray(group)) continue;
    for (const [key, status] of Object.entries(group)) assign(key, status);
  }
  for (const key of TRACKED_AGENT_KEYS) {
    if (raw[key] !== undefined) assign(key, raw[key]);
  }
  for (const [alias, key] of Object.entries(LEGACY_AGENT_KEY_ALIASES)) {
    if (normalized[key] === undefined && raw[alias] !== undefined) assign(key, raw[alias]);
  }
  return normalized;
}

export function normalizeGroupedStageStatuses(value: unknown): GroupedStageStatuses {
  const raw = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const overrides: Partial<Record<StageKey, PipelineStepStatus>> = {};
  for (const key of Object.keys(STAGE_CONFIG) as StageKey[]) {
    const group = raw[key];
    if (!group || typeof group !== "object" || Array.isArray(group)) continue;
    const status = normalizePipelineStepStatus((group as Record<string, unknown>).status);
    if (status) overrides[key] = status;
  }
  return buildGroupedStageStatuses(normalizeFlatStageStatuses(value), overrides);
}

export function normalizeStageOutputs(value: unknown): StageOutputs {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const raw = value as Record<string, unknown>;
  const normalized: StageOutputs = {};
  const isAgentOutput = (output: unknown): output is AgentOutput =>
    Boolean(output) && typeof output === "object" && !Array.isArray(output);

  for (const key of TRACKED_AGENT_KEYS) {
    const output = raw[key];
    if (isAgentOutput(output)) {
      normalized[key] = output as AgentOutput;
    }
  }
  for (const [alias, key] of Object.entries(LEGACY_AGENT_KEY_ALIASES)) {
    const output = raw[alias];
    if (normalized[key] === undefined && isAgentOutput(output)) {
      normalized[key] = output as AgentOutput;
    }
  }
  const hierarchyOutput = normalized.hierarchyMapperNode;
  if (hierarchyOutput) {
    normalized.hierarchyMapperNode = {
      ...(hierarchyOutput as Record<string, unknown>),
      ...(isAgentOutput(raw.relationshipBuilder) ? { relationshipBuilder: raw.relationshipBuilder } : {}),
      ...(isAgentOutput(raw.formBuilder) ? { formBuilder: raw.formBuilder } : {}),
    };
  }
  const trainingOutput = normalized.modelTrainingExecNode;
  if (trainingOutput && isAgentOutput(raw.modelValidation)) {
    normalized.modelTrainingExecNode = {
      ...(trainingOutput as Record<string, unknown>),
      modelValidation: raw.modelValidation,
    };
  }
  return normalized;
}
