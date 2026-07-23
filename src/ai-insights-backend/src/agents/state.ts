import { Connector } from "../models/connector.types";

export interface AgentState {
  connectorIds: string[];
  connectors?: Connector[]; // Passed in from the controller to avoid DB lookups inside the graph
  sourceStructureFiles: string[]; 
  llmInferredRelationshipsFiles: string[];
  profilingDataFiles: string[];
  resolvedSchemaFiles: string[];
  systemPromptFiles: string[];
  errors: string[];
}
