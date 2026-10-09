import { Annotation } from "@langchain/langgraph";
import { ConnectorService } from "../services/connector/connector.service";
import { ConnectionTesterService } from "../services/connector/connectionTester.service";
import { IFileService } from "../services/file/file.service.interface";
import { ProjectService } from "../services/project/project.service";
import { AgentTraceHelper } from "./utils/agentUtils";
import {
  AgentOutput,
  FeatureArchitectOutput,
  FeatureValidatorOutput,
  GroupedStageStatuses,
  InspectionOutput,
  HierarchyMapperOutput,
  ModelTrainingExecutionOutput,
  PipelineStepStatus,
  ProfilingOutput,
  StageOutputsUpdate,
  TrackedAgentKey,
  TRACKED_AGENT_KEYS,
  TrainingConfigurationOutput,
  INITIAL_STAGE_STATUSES,
} from "./pipelineNames";

export interface BatchedTableState {
  tableName: string;
  status: string;
  node: string;
  summary: string;
}

export interface WorkflowSessionMeta {
  threadId: string;
  connectorId: string[];
  userPrompt: string;
  projectId?: string;
}

export interface IngestionServices {
  connectorService: ConnectorService;
  connectionTester: ConnectionTesterService;
  fileService: IFileService;
  projectService: ProjectService;
  duckDBService?: any;
  traceHelper: AgentTraceHelper;
  agentThinkingService?: any;
  projectId?: string;
  projectName?: string;
  workspaceName?: string;
  folderPath?: string;
  pipeline?: string;
  runTimestamp?: string;
  onThinkingUpdate?: (substep: string) => Promise<void> | void;
  isCancelled?: () => boolean;
  abortSignal?: AbortSignal;
  predictionHorizon?: number;
  predictionFrequency?: string;
  predictionObjectiveStartDate?: string;
  prediction_target_column?: string;
}

export type StageStatusKey = TrackedAgentKey;
export type StageStatusValue = PipelineStepStatus;

const OUTPUT_RESET_MARKER = "__resetOutput";

const mergeOutputOrReset = (
  left: Record<string, unknown> = {},
  right: Record<string, unknown> = {}
): Record<string, unknown> => {
  if (right?.[OUTPUT_RESET_MARKER] === true) {
    return Object.fromEntries(Object.entries(right).filter(([key]) => key !== OUTPUT_RESET_MARKER));
  }
  return { ...left, ...right };
};

export const AgentState = Annotation.Root({
  connectorId: Annotation<string[]>,
  projectId: Annotation<string>({
    reducer: (left, right) => (typeof right === "string" ? right : left),
    default: () => "",
  }),
  runTimestamp: Annotation<string>({
    reducer: (left, right) => (typeof right === "string" && right.trim().length > 0 ? right : left),
    default: () => "",
  }),
  status: Annotation<PipelineStepStatus>({
    reducer: (left, right) => (typeof right === "string" && right.trim().length > 0 ? (right as PipelineStepStatus) : left),
    default: () => "None",
  }),
  summary: Annotation<string>,
  userPrompt: Annotation<string>({
    reducer: (left, right) => (typeof right === "string" ? right : left),
    default: () => "",
  }),
  prediction_target_column: Annotation<string>({
    reducer: (left, right) => (typeof right === "string" && right.trim().length > 0 ? right : left),
    default: () => "",
  }),
  splitDate: Annotation<string>({
    reducer: (left, right) => (typeof right === "string" && right.trim().length > 0 ? right : left),
    default: () => "",
  }),
  splitEndDate: Annotation<string>({
    reducer: (left, right) => (typeof right === "string" && right.trim().length > 0 ? right : left),
    default: () => "",
  }),
  selectedModels: Annotation<string[]>({
    reducer: (left, right) => (Array.isArray(right) ? right : left),
    default: () => [],
  }),
  predictionHorizon: Annotation<number>({
    reducer: (left, right) => (typeof right === "number" && !isNaN(right) ? right : left),
    default: () => 12,
  }),
  predictionFrequency: Annotation<string>({
    reducer: (left, right) => (typeof right === "string" && right.trim().length > 0 ? right : left),
    default: () => "Weekly",
  }),
  predictionObjectiveStartDate: Annotation<string>({
    reducer: (left, right) => (typeof right === "string" && right.trim().length > 0 ? right : left),
    default: () => "",
  }),
  direction: Annotation<string>({
    reducer: (left, right) => (typeof right === "string" && right.trim().length > 0 ? right : left),
    default: () => "",
  }),
  primaryMetric: Annotation<string>({
    reducer: (left, right) => (typeof right === "string" && right.trim().length > 0 ? right : left),
    default: () => "",
  }),
  targetColumn: Annotation<string>({
    reducer: (left, right) => (typeof right === "string" && right.trim().length > 0 ? right : left),
    default: () => "",
  }),
  problemType: Annotation<string>({
    reducer: (left, right) => (typeof right === "string" && right.trim().length > 0 ? right : left),
    default: () => "",
  }),
  inspection: Annotation<InspectionOutput>({ reducer: mergeOutputOrReset, default: () => ({}) }),
  schemaResolution: Annotation<AgentOutput>({ reducer: mergeOutputOrReset, default: () => ({}) }),
  dataProfile: Annotation<ProfilingOutput>({ reducer: mergeOutputOrReset, default: () => ({}) }),
  hierarchyMapper: Annotation<HierarchyMapperOutput>({ reducer: mergeOutputOrReset, default: () => ({}) }),
  relationshipBuilder: Annotation<AgentOutput>({ reducer: mergeOutputOrReset, default: () => ({}) }),
  formBuilder: Annotation<AgentOutput>({ reducer: mergeOutputOrReset, default: () => ({}) }),
  exogenousScout: Annotation<AgentOutput>({ reducer: mergeOutputOrReset, default: () => ({}) }),
  featureArchitect: Annotation<FeatureArchitectOutput>({ reducer: mergeOutputOrReset, default: () => ({}) }),
  featureValidator: Annotation<FeatureValidatorOutput>({ reducer: mergeOutputOrReset, default: () => ({}) }),
  trainingConfiguration: Annotation<TrainingConfigurationOutput>({ reducer: mergeOutputOrReset, default: () => ({}) }),
  preFlight: Annotation<AgentOutput>({ reducer: mergeOutputOrReset, default: () => ({}) }),
  modelTraining: Annotation<ModelTrainingExecutionOutput>({ reducer: mergeOutputOrReset, default: () => ({}) }),
  modelEvaluation: Annotation<AgentOutput>({ reducer: mergeOutputOrReset, default: () => ({}) }),
  modelValidation: Annotation<AgentOutput>({ reducer: mergeOutputOrReset, default: () => ({}) }),
  modelSelection: Annotation<AgentOutput>({ reducer: mergeOutputOrReset, default: () => ({}) }),
  batchedTables: Annotation<BatchedTableState[]>({
    reducer: (left = [], right = []) => {
      if (Array.isArray(right) && right.length === 0) {
        return [];
      }
      const mergedMap = new Map<string, BatchedTableState>();
      for (const entry of left || []) {
        if (entry.tableName) {
          mergedMap.set(entry.tableName, entry);
        }
      }
      for (const entry of right || []) {
        if (!entry.tableName) {
          continue;
        }
        const existingEntry = mergedMap.get(entry.tableName);
        mergedMap.set(entry.tableName, existingEntry ? { ...existingEntry, ...entry } : entry);
      }
      return Array.from(mergedMap.values());
    },
    default: () => [],
  }),
  steps: Annotation<Array<{ name: string; status: PipelineStepStatus; summary: string }>>({
    reducer: (left = [], right = []) => {
      if (Array.isArray(right) && right.length === 0) {
        return [];
      }
      const stepMap = new Map<string, { name: string; status: PipelineStepStatus; summary: string }>();
      for (const step of left || []) {
        if (step.name) stepMap.set(step.name, step);
      }
      for (const step of right || []) {
        if (step.name) stepMap.set(step.name, step);
      }
      return Array.from(stepMap.values());
    },
    default: () => [],
  }),
  stageOutputs: Annotation<StageOutputsUpdate>({
    reducer: (left, right) => {
      if (right?.__replaceStageOutputs === true) {
        return Object.fromEntries(Object.entries(right).filter(([key]) => key !== "__replaceStageOutputs"));
      }
      if (right && Object.keys(right).length === 0) {
        return left || {};
      }
      return { ...(left || {}), ...right };
    },
    default: () => ({}),
  }),
  stageStatuses: Annotation<Partial<Record<StageStatusKey, StageStatusValue>>>({
    reducer: (left, right) => {
      if (right && Object.keys(right).length === 0) {
        return { ...INITIAL_STAGE_STATUSES };
      }
      return { ...left, ...right };
    },
    default: () => ({ ...INITIAL_STAGE_STATUSES }),
  }),
});

export type StageStatuses = Partial<Record<StageStatusKey, StageStatusValue>>;
export type GraphAgentStateType = typeof AgentState.State;
export type AgentState = typeof AgentState.State & {
  currentNode?: string;
  currentStage?: string;
  nextStep?: string;
  requiresApproval?: boolean;
  sessionId?: string;
  lastRunTime?: string;
  updatedAt?: string;
  [key: string]: any;
};
export type AgentStateType = Omit<GraphAgentStateType, "stageStatuses"> & {
  stageStatuses: GroupedStageStatuses;
};
