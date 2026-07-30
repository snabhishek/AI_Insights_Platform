// Shared types for the Projects feature

export type PipelineStatus = "Completed" | "In Progress" | "Pending" | "Not Started";
export type RunStatus = "Success" | "Running" | "Paused" | "Idle";

export type PipelineStatuses = Record<string, PipelineStatus>;

export interface Workflow {
  id: string;
  title: string;
  description: string;
  color: "green" | "blue" | "purple" | "yellow" | "red" | "pink" | "teal";
  icon: React.ReactNode;
  step?: WorkflowStep[]
}

export interface WorkflowStep extends Workflow {
  metric: string;
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
  inspection: Record<string, unknown>;
  schemaResolution: Record<string, unknown>;
  dataProfile: Record<string, unknown>;
  preprocessing: Record<string, unknown>;
  batchedTables?: Array<{ tableName: string; status: string; node: string; summary: string }>;
  sessionId?: string;
  requiresApproval?: boolean;
  nextStep?: string;
  currentNode?: string;
  currentStage?: string;
  stageOutputs?: Record<string, unknown>;
  stageStatuses?: Record<string, string>;
  message?: string;
}
