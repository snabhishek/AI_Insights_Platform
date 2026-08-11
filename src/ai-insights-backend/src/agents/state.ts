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
  traceHelper: AgentTraceHelper;
  agentThinkingService?: any;
  projectId?: string;
  pipeline?: string;
}

export const AgentState = Annotation.Root({
  connectorId: Annotation<string[]>,
  projectId: Annotation<string>({
    reducer: (left, right) => (typeof right === "string" ? right : left),
    default: () => "",
  }),
  status: Annotation<string>,
  summary: Annotation<string>,
  userPrompt: Annotation<string>({
    reducer: (left, right) => (typeof right === "string" ? right : left),
    default: () => "",
  }),
  inspection: Annotation<Record<string, unknown>>({ reducer: (left, right) => ({ ...left, ...right }), default: () => ({}) }),
  schemaResolution: Annotation<Record<string, unknown>>({ reducer: (left, right) => ({ ...left, ...right }), default: () => ({}) }),
  dataProfile: Annotation<Record<string, unknown>>({ reducer: (left, right) => ({ ...left, ...right }), default: () => ({}) }),
  preprocessing: Annotation<Record<string, unknown>>({ reducer: (left, right) => ({ ...left, ...right }), default: () => ({}) }),
  exogenousScout: Annotation<Record<string, unknown>>({ reducer: (left, right) => ({ ...left, ...right }), default: () => ({}) }),
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
      if (right && Object.keys(right).length === 0) {
        return {};
      }
      return { ...left, ...right };
    },
    default: () => ({}),
  }),
  stageStatuses: Annotation<Record<string, string>>({
    reducer: (left, right) => {
      if (right && Object.keys(right).length === 0) {
        return {
          inspect: "Pending",
          profileData: "Pending",
          preprocess: "Pending",
          resolveSchema: "Pending",
        };
      }
      return { ...left, ...right };
    },
    default: () => ({
      inspect: "Pending",
      profileData: "Pending",
      preprocess: "Pending",
      resolveSchema: "Pending",
      exogenousScout: "Pending",
    }),
  }),
});

export type AgentStateType = typeof AgentState.State;
