import { AgentThinking, ThinkingLog } from "../../../models/agentThinking.types";

export interface IAgentThinkingService {
  getThinking(projectId: string, pipeline: string, substep: string): Promise<AgentThinking | undefined>;
  saveThinking(projectId: string, pipeline: string, substep: string, thinking: ThinkingLog[]): Promise<AgentThinking>;
  deleteThinking(projectId: string, pipeline: string, substep: string): Promise<void>;
  clearProjectPipelineThinking(projectId: string, pipeline: string): Promise<void>;
}
