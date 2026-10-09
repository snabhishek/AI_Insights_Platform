import type {
  GraphNodeKey,
  AgentOutput,
  GroupedStageStatuses,
  PipelineStepStatus,
  StageKey,
  StageOutputs,
  TrackedAgentKey,
  WorkflowAgentState,
} from "./pipelineNames";

export type PipelineStatus = PipelineStepStatus;
export type RunStatus = PipelineStepStatus;

export type PipelineStatuses = GroupedStageStatuses;
export type { AgentOutput, GraphNodeKey, StageKey, StageOutputs, TrackedAgentKey, WorkflowAgentState };

export interface Workflow {
  id: StageKey;
  title: string;
  description: string;
  color: "green" | "blue" | "purple" | "yellow" | "red" | "pink" | "teal";
  icon: React.ReactNode;
  step?: WorkflowStep[]
}

export interface WorkflowStep extends Omit<Workflow, "id"> {
  metric: string;
  id: TrackedAgentKey;
}

export type IngestionAgentStepResult = {
  name: string;
  status: string;
  summary: string;
}

export type IngestionAgentRunResult = {
  connectorId: string[];
  status: string;
  summary: string;
  steps: IngestionAgentStepResult[];
  batchedTables?: Array<{ tableName: string; status: string; node: string; summary: string }>;
  sessionId?: string;
  requiresApproval?: boolean;
  nextStep?: string;
  currentNode?: string;
  currentStage?: string;
  stageOutputs?: StageOutputs;
  stageStatuses?: GroupedStageStatuses;
  message?: string;
}
