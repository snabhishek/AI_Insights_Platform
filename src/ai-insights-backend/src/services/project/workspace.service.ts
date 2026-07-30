import { v4 as uuidv4 } from "uuid";
import { IWorkspaceRepository } from "../../repositories/workspace.repository.interface";
import { IProjectRepository } from "../../repositories/project.repository.interface";
import { Workspace, CreateProjectDto, UpdateProjectDto } from "../../models/workspace.types";
import { Project, ProjectRun } from "../../models/project.types";

export type ServiceResult<T> =
  | { success: true; data: T }
  | { success: false; reason: "NOT_FOUND" | "FORBIDDEN" | "DUPLICATE" | "WORKSPACE_NOT_FOUND"; message: string };

export class WorkspaceService {
  constructor(
    private workspaceRepository: IWorkspaceRepository,
    private projectRepository: IProjectRepository
  ) {}

  async getAllWorkspaces(): Promise<Workspace[]> {
    return this.workspaceRepository.getAll();
  }

  async getWorkspaceById(id: string): Promise<Workspace | undefined> {
    return this.workspaceRepository.getById(id);
  }

  async createWorkspace(name: string): Promise<ServiceResult<Workspace>> {
    const trimmedName = name.trim();
    const existing = await this.workspaceRepository.getByName(trimmedName);
    if (existing) {
      return {
        success: false,
        reason: "DUPLICATE",
        message: `Workspace named "${trimmedName}" already exists.`,
      };
    }

    const id = `ws-${uuidv4()}`;
    const newWorkspace: Workspace = {
      id,
      name: trimmedName,
      isDefault: false,
      createdAt: new Date().toISOString(),
    };

    const created = await this.workspaceRepository.create(newWorkspace);
    return { success: true, data: created };
  }

  async deleteWorkspace(id: string): Promise<ServiceResult<boolean>> {
    const ws = await this.workspaceRepository.getById(id);
    if (!ws) {
      return { success: false, reason: "NOT_FOUND", message: "Workspace not found." };
    }
    if (ws.isDefault) {
      return { success: false, reason: "FORBIDDEN", message: "The Default Workspace cannot be deleted." };
    }

    await this.workspaceRepository.delete(id);
    return { success: true, data: true };
  }

  async getProjectsByWorkspace(workspaceId: string): Promise<Project[]> {
    return this.projectRepository.getByWorkspaceId(workspaceId);
  }

  async createProject(
    workspaceId: string,
    projectData: CreateProjectDto
  ): Promise<ServiceResult<Project>> {
    const ws = await this.workspaceRepository.getById(workspaceId);
    if (!ws) {
      return { success: false, reason: "WORKSPACE_NOT_FOUND", message: "Workspace not found." };
    }

    const name = projectData.name.trim();
    const dataSources = projectData.dataSources || [];

    const existingProjects = await this.projectRepository.getByWorkspaceId(workspaceId);
    const areSourceArraysEqual = (arr1: string[], arr2: string[]) => {
      if (arr1.length !== arr2.length) return false;
      const sorted1 = [...arr1].sort();
      const sorted2 = [...arr2].sort();
      return sorted1.every((val, index) => val === sorted2[index]);
    };

    const isDuplicate = existingProjects.some(
      (p) =>
        p.name.toLowerCase() === name.toLowerCase() &&
        areSourceArraysEqual(p.dataSources || [], dataSources)
    );

    if (isDuplicate) {
      return {
        success: false,
        reason: "DUPLICATE",
        message: `A project with name "${name}" and the same selected data sources already exists in this workspace.`,
      };
    }

    const projectId = `proj-${uuidv4()}`;
    const newProject: Project = {
      id: projectId,
      name,
      role: projectData.role || "OWNER",
      dataSources,
      initials: projectData.initials || "US",
      workspaceId,
      useCase: projectData.useCase || "",
      agentState: {},
      createdAt: new Date().toISOString(),
    };

    const created = await this.projectRepository.createProject(newProject);
    return { success: true, data: created };
  }

  async updateProject(
    pid: string,
    updateData: UpdateProjectDto
  ): Promise<ServiceResult<Project>> {
    const existing = await this.projectRepository.getById(pid);
    if (!existing) {
      return { success: false, reason: "NOT_FOUND", message: "Project not found." };
    }

    const updatedName =
      typeof updateData.name === "string" && updateData.name.trim()
        ? updateData.name.trim()
        : existing.name;
    const updatedUseCase =
      updateData.useCase !== undefined ? updateData.useCase : existing.useCase;
    const updatedSources = Array.isArray(updateData.dataSources)
      ? updateData.dataSources
      : existing.dataSources;

    await this.projectRepository.updateProject(pid, {
      name: updatedName,
      useCase: updatedUseCase,
      dataSources: updatedSources,
    });

    let updatedProject: Project | undefined;

    if (updateData.agentState !== undefined) {
      updatedProject = await this.projectRepository.updateAgentState(
        pid,
        updateData.agentState,
        updatedUseCase
      );
    } else {
      updatedProject = await this.projectRepository.getById(pid);
    }

    if (!updatedProject) {
      return { success: false, reason: "NOT_FOUND", message: "Project not found." };
    }

    return { success: true, data: updatedProject };
  }

  async getProjectRuns(projectId: string): Promise<ProjectRun[]> {
    return this.projectRepository.getProjectRuns(projectId);
  }

  async deleteProject(pid: string): Promise<ServiceResult<boolean>> {
    const deleted = await this.projectRepository.deleteProject(pid);
    if (!deleted) {
      return { success: false, reason: "NOT_FOUND", message: "Project not found." };
    }
    return { success: true, data: true };
  }
}
