import { IProjectRepository } from "../../repositories/project.repository.interface";
import { Project, ProjectRun, ProjectWithWorkspace } from "../../models/project.types";
import { deleteProjectSchemaFolder } from "../../agents/tools/helpers";
import { IDuckDBService } from "../duckdb/duckdb.service.interface";

export class ProjectService {
  constructor(
    private repository: IProjectRepository,
    private duckDBService?: IDuckDBService
  ) {}

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

  async getByWorkspaceId(workspaceId: string): Promise<Project[]> {
    return this.repository.getByWorkspaceId(workspaceId);
  }

  async createProject(project: Project): Promise<Project> {
    return this.repository.createProject(project);
  }

  async deleteProject(id: string): Promise<boolean> {
    try {
      const pWs = await this.repository.getProjectWithWorkspace(id);
      if (pWs && pWs.project && pWs.workspaceName) {
        await deleteProjectSchemaFolder(pWs.workspaceName, pWs.project.name);
        if (this.duckDBService) {
          await this.duckDBService.deleteProjectFolder(pWs.project.name);
        }
      }
    } catch (e: any) {
      console.warn(`[projectService] Failed to delete project schema folder for ${id}:`, e?.message || e);
    }
    return this.repository.deleteProject(id);
  }
}

