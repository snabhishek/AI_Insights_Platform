export interface IngestionAgentStepResult {
  name: string;
  status: string;
  summary: string;
}

export interface IngestionAgentRunResult {
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
  agentThinking?: Record<string, Array<{ time: string; text: string; done: boolean }>>;
}

export interface IIngestionAgentService {
  run(
    connectorId: string[],
    userPrompt?: string,
    options?: { sessionId?: string; action?: "approve" | "retry" | "resume"; step?: string; projectId?: string }
  ): AsyncGenerator<IngestionAgentRunResult, void, unknown>;
  stop(sessionId?: string, projectId?: string): Promise<IngestionAgentRunResult | { success: boolean; message: string }>;
  pause(sessionId?: string, projectId?: string): Promise<IngestionAgentRunResult | { success: boolean; message: string }>;
}

