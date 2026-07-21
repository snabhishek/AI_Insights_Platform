import { IProjectRepository } from "../repositories/project.repository.interface";
import { Project } from "../models/project.types";

export class ProjectService {
  constructor(private repository: IProjectRepository) {}

  async getById(id: string): Promise<Project | undefined> {
    return this.repository.getById(id);
  }

  async updateAgentState(id: string, agentState: Record<string, unknown>): Promise<Project | undefined> {
    return this.repository.updateAgentState(id, agentState);
  }
}
