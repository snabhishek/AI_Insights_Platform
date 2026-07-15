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
}

export interface IIngestionAgentService {
  run(connectorId: string[], userPrompt?: string): Promise<IngestionAgentRunResult>;
}
