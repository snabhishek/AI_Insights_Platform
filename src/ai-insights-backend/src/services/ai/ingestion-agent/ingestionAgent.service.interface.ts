import { GroupedStageStatuses, PipelineStepStatus, StageOutputs } from "../../../agents/pipelineNames";

export interface IngestionAgentStepResult {
  name: string;
  status: PipelineStepStatus;
  summary: string;
}

export interface IngestionAgentRunResult {
  connectorId: string[];
  status: PipelineStepStatus;
  summary: string;
  steps: IngestionAgentStepResult[];
  batchedTables?: Array<{ tableName: string; status: string; node: string; summary: string }>;
  sessionId?: string;
  requiresApproval?: boolean;
  nextStep?: string;
  currentNode?: string;
  currentStage?: string;
  stageOutputs?: StageOutputs;
  replaceStageOutputs?: boolean;
  stageStatuses?: GroupedStageStatuses;
  message?: string;
  agentThinking?: Record<string, Array<{ time: string; text: string; done: boolean }>>;
  runTimestamp?: string;
}

export interface IIngestionAgentService {
  run(
    connectorId: string[],
    userPrompt?: string,
    options?: {
      sessionId?: string;
      action?: "approve" | "retry" | "resume";
      step?: string;
      projectId?: string;
      splitDate?: string;
      splitEndDate?: string;
      selectedModels?: string[];
      predictionHorizon?: number;
      predictionFrequency?: string;
      predictionObjectiveStartDate?: string;
    }
  ): AsyncGenerator<IngestionAgentRunResult, void, unknown>;
  stop(sessionId?: string, projectId?: string): Promise<IngestionAgentRunResult | { success: boolean; message: string }>;
  pause(sessionId?: string, projectId?: string): Promise<IngestionAgentRunResult | { success: boolean; message: string }>;
  isProjectActive?(projectId?: string): boolean;
  findSessionIdForProject?(projectId?: string): string | undefined;
  getActiveWorkflow(): { active: boolean; projectId: string | null; sessionId: string | null; status: PipelineStepStatus };
}
