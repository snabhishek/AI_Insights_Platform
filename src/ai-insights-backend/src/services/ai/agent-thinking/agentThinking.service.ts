import { IAgentThinkingRepository } from "../../../repositories/agentThinking.repository.interface";
import { IAgentThinkingService } from "./agentThinking.service.interface";
import { AgentThinking, ThinkingLog } from "../../../models/agentThinking.types";

export class AgentThinkingService implements IAgentThinkingService {
  constructor(private agentThinkingRepository: IAgentThinkingRepository) {}

  async getThinking(projectId: string, pipeline: string, substep: string): Promise<AgentThinking | undefined> {
    return this.agentThinkingRepository.getThinking(projectId, pipeline, substep);
  }

  async getAllThinking(projectId: string, pipeline?: string): Promise<Record<string, ThinkingLog[]>> {
    return this.agentThinkingRepository.getAllThinking(projectId, pipeline);
  }

  async saveThinking(projectId: string, pipeline: string, substep: string, thinking: ThinkingLog[]): Promise<AgentThinking> {
    return this.agentThinkingRepository.saveThinking(projectId, pipeline, substep, thinking);
  }

  async deleteThinking(projectId: string, pipeline: string, substep: string): Promise<void> {
    return this.agentThinkingRepository.deleteThinking(projectId, pipeline, substep);
  }

  async clearProjectPipelineThinking(projectId: string, pipeline: string): Promise<void> {
    return this.agentThinkingRepository.clearProjectPipelineThinking(projectId, pipeline);
  }
}
