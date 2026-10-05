import { Annotation } from "@langchain/langgraph";
import { ConnectorService } from "../services/connector/connector.service";
import { ConnectionTesterService } from "../services/connector/connectionTester.service";
import { IFileService } from "../services/file/file.service.interface";
import { ProjectService } from "../services/project/project.service";
import { AgentTraceHelper } from "./utils/agentUtils";

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

export type StageStatusKey =
  | "inspect"
  | "profileData"
  | "resolveSchema"
  | "hierarchyMapper"
  | "featureArchitect"
  | "featureValidator"
  | "exogenousScout"
  | "modelSelection"
  | "trainingConfiguration"
  | "preFlight"
  | "modelTrainingCode"
  | "modelTrainingExec"
  | "modelTraining"
  | "modelEvaluation"
  | "modelValidation"
  | "dataProfile"
  | "schemaResolution"
  | "relationshipBuilder"
  | "formBuilder"
  | "exogenous"
  | "modelSelectionNode"
  | "preFlightNode"
  | "modelTrainingNode"
  | "modelTrainingExecNode"
  | "modelTrainingCodeNode"
  | "modelEvaluationNode"
  | "modelValidationNode"
  | "trainingConfigurationNode"
  | "hierarchyMapperNode"
  | "featureArchitectNode"
  | "featureValidatorNode";

export type StageStatusValue =
  | "Pending"
  | "In Progress"
  | "Running"
  | "Completed"
  | "Success"
  | "Failed"
  | "Retrying"
  | "Paused"
  | "Skipped";

export const INITIAL_STAGE_STATUSES: Record<StageStatusKey, StageStatusValue> = {
  inspect: "Pending",
  profileData: "Pending",
  resolveSchema: "Pending",
  hierarchyMapper: "Pending",
  featureArchitect: "Pending",
  featureValidator: "Pending",
  exogenousScout: "Pending",
  modelSelection: "Pending",
  trainingConfiguration: "Pending",
  preFlight: "Pending",
  modelTrainingCode: "Pending",
  modelTrainingExec: "Pending",
  modelTraining: "Pending",
  modelEvaluation: "Pending",
  modelValidation: "Pending",
  dataProfile: "Pending",
  schemaResolution: "Pending",
  relationshipBuilder: "Pending",
  formBuilder: "Pending",
  exogenous: "Pending",
  modelSelectionNode: "Pending",
  preFlightNode: "Pending",
  modelTrainingNode: "Pending",
  modelTrainingExecNode: "Pending",
  modelTrainingCodeNode: "Pending",
  modelEvaluationNode: "Pending",
  modelValidationNode: "Pending",
  trainingConfigurationNode: "Pending",
  hierarchyMapperNode: "Pending",
  featureArchitectNode: "Pending",
  featureValidatorNode: "Pending",
};

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
  status: Annotation<string>,
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
  inspection: Annotation<Record<string, unknown>>({ reducer: mergeOutputOrReset, default: () => ({}) }),
  schemaResolution: Annotation<Record<string, unknown>>({ reducer: mergeOutputOrReset, default: () => ({}) }),
  dataProfile: Annotation<Record<string, unknown>>({ reducer: mergeOutputOrReset, default: () => ({}) }),
  hierarchyMapper: Annotation<Record<string, unknown>>({ reducer: mergeOutputOrReset, default: () => ({}) }),
  relationshipBuilder: Annotation<Record<string, unknown>>({ reducer: mergeOutputOrReset, default: () => ({}) }),
  formBuilder: Annotation<Record<string, unknown>>({ reducer: mergeOutputOrReset, default: () => ({}) }),
  exogenousScout: Annotation<Record<string, unknown>>({ reducer: mergeOutputOrReset, default: () => ({}) }),
  featureArchitect: Annotation<Record<string, unknown>>({ reducer: mergeOutputOrReset, default: () => ({}) }),
  featureValidator: Annotation<Record<string, unknown>>({ reducer: mergeOutputOrReset, default: () => ({}) }),
  trainingConfiguration: Annotation<Record<string, unknown>>({ reducer: mergeOutputOrReset, default: () => ({}) }),
  preFlight: Annotation<Record<string, unknown>>({ reducer: mergeOutputOrReset, default: () => ({}) }),
  modelTraining: Annotation<Record<string, unknown>>({ reducer: mergeOutputOrReset, default: () => ({}) }),
  modelEvaluation: Annotation<Record<string, unknown>>({ reducer: mergeOutputOrReset, default: () => ({}) }),
  modelValidation: Annotation<Record<string, unknown>>({ reducer: mergeOutputOrReset, default: () => ({}) }),
  modelSelection: Annotation<Record<string, unknown>>({ reducer: mergeOutputOrReset, default: () => ({}) }),
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
  steps: Annotation<Array<{ name: string; status: string; summary: string }>>({
    reducer: (left = [], right = []) => {
      if (Array.isArray(right) && right.length === 0) {
        return [];
      }
      const stepMap = new Map<string, { name: string; status: string; summary: string }>();
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
  stageOutputs: Annotation<Record<string, unknown>>({
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
export type AgentStateType = typeof AgentState.State;
