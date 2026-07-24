import { IProjectRepository } from "../repositories/project.repository.interface";
import { Project, ProjectRun, ProjectWithWorkspace } from "../models/project.types";

export class ProjectService {
  constructor(private repository: IProjectRepository) {}

  async getById(id: string): Promise<Project | undefined> {
    return this.repository.getById(id);
  }

  async getProjectWithWorkspace(id: string): Promise<ProjectWithWorkspace | undefined> {
    return this.repository.getProjectWithWorkspace(id);
  }

  async updateAgentState(id: string, agentState: Record<string, unknown>, useCase?: string): Promise<Project | undefined> {
    return this.repository.updateAgentState(id, agentState, useCase);
  }

  async updateProject(id: string, updates: Partial<Project>): Promise<Project | undefined> {
    return this.repository.updateProject(id, updates);
  }

  async getProjectRuns(projectId: string): Promise<ProjectRun[]> {
    return this.repository.getProjectRuns(projectId);
  }
}

