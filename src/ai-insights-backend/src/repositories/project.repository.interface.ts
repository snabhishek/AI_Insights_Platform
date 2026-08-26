import { Project, ProjectRun, ProjectWithWorkspace } from "../models/project.types";

export interface IProjectRepository {
  getById(id: string): Promise<Project | undefined>;
  getAll(): Promise<Project[]>;
  getProjectWithWorkspace(id: string): Promise<ProjectWithWorkspace | undefined>;
  updateAgentState(id: string, agentState: Record<string, unknown>, useCase?: string): Promise<Project | undefined>;
  updateProject(id: string, updates: Partial<Project>): Promise<Project | undefined>;
  getProjectRuns(projectId: string): Promise<ProjectRun[]>;
  getByWorkspaceId(workspaceId: string): Promise<Project[]>;
  createProject(project: Project): Promise<Project>;
  deleteProject(id: string): Promise<boolean>;
}

