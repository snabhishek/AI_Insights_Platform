import { v4 as uuidv4 } from "uuid";
import { IWorkspaceRepository } from "../../repositories/workspace.repository.interface";
import { IProjectRepository } from "../../repositories/project.repository.interface";
import { IConnectorRepository } from "../../repositories/connector.repository.interface";
import { IDuckDBService, ProjectSourceInput } from "../duckdb/duckdb.service.interface";
import { Workspace, CreateProjectDto, UpdateProjectDto } from "../../models/workspace.types";
import { Project, ProjectRun } from "../../models/project.types";
import { createProjectSchemaFile, deleteProjectSchemaFolder } from "../../agents/tools/helpers";
import {
  computeProjectRelativePath,
  ensureDirectoryExists,
  getProjectDir,
  getWorkspaceDir,
  resolveStoragePath,
} from "../../config/fileServer.config";
import fs from "fs";
import path from "path";
import yaml from "js-yaml";

export type ServiceResult<T> =
  | { success: true; data: T }
  | { success: false; reason: "NOT_FOUND" | "FORBIDDEN" | "DUPLICATE" | "WORKSPACE_NOT_FOUND" | "BAD_REQUEST"; message: string };

export class WorkspaceService {
  constructor(
    private workspaceRepository: IWorkspaceRepository,
    private projectRepository: IProjectRepository,
    private connectorRepository?: IConnectorRepository,
    private duckDBService?: IDuckDBService
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

    try {
      const projects = await this.projectRepository.getByWorkspaceId(id);
      for (const p of projects) {
        await deleteProjectSchemaFolder(ws.name, p.name);
        if (this.duckDBService) {
          await this.duckDBService.deleteProjectFolder(p.name, ws.name, p.folderPath);
        }
      }
      const wsDir = getWorkspaceDir(ws.name);
      if (fs.existsSync(wsDir)) {
        fs.rmSync(wsDir, { recursive: true, force: true });
        console.log(`[workspaceService] Deleted workspace directory: ${wsDir}`);
      }
    } catch (e: any) {
      console.warn(`[workspaceService] Failed to clean up project/workspace folders during workspace deletion:`, e?.message || e);
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

    if (!Array.isArray(dataSources) || dataSources.length === 0) {
      return {
        success: false,
        reason: "BAD_REQUEST",
        message: "Data source connectivity is required. Please select at least one data source to create a project.",
      };
    }

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
    const projectDir = getProjectDir(ws.name, name);
    ensureDirectoryExists(projectDir);

    const newProject: Project = {
      id: projectId,
      name,
      role: projectData.role || "OWNER",
      dataSources,
      initials: projectData.initials || "US",
      workspaceId,
      useCase: projectData.useCase || "",
      domain: projectData.domain || "",
      subDomain: projectData.subDomain || "",
      agentState: projectData.splitDate ? { splitDate: projectData.splitDate } : {},
      createdAt: new Date().toISOString(),
    };

    const created = await this.projectRepository.createProject(newProject);
    if (created) {
      // Ingest connected data sources into DuckDB under designated project folder
      if (this.duckDBService && this.connectorRepository && dataSources.length > 0) {
        try {
          const projectSourceInputs: ProjectSourceInput[] = [];
          for (const dsId of dataSources) {
            const conn = await this.connectorRepository.getById(dsId);
            if (conn) {
              projectSourceInputs.push({
                type: conn.type,
                config: conn.connectionConfig,
                name: conn.name,
              });
            }
          }
          if (projectSourceInputs.length > 0) {
            await this.duckDBService.ingestProjectSources(newProject.name, projectSourceInputs, ws.name);
          }
        } catch (ingestErr: any) {
          console.warn(`[workspaceService] Warning during project DuckDB source ingestion:`, ingestErr?.message || ingestErr);
        }
      }
    }
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
      status: updateData.status,
    });

    let updatedProject: Project | undefined;

    if (updateData.agentState !== undefined) {
      const stateToSave = {
        ...updateData.agentState,
        ...(updateData.status ? { status: updateData.status } : {}),
      };
      updatedProject = await this.projectRepository.updateAgentState(
        pid,
        stateToSave,
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
    let projectWithWs: any;
    try {
      projectWithWs = await this.projectRepository.getProjectWithWorkspace(pid);
    } catch (e: any) {
      console.warn(`[workspaceService] Could not lookup project/workspace prior to deletion:`, e?.message || e);
    }

    const deleted = await this.projectRepository.deleteProject(pid);
    if (!deleted) {
      return { success: false, reason: "NOT_FOUND", message: "Project not found." };
    }

    if (projectWithWs && projectWithWs.project && projectWithWs.workspaceName) {
      try {
        await deleteProjectSchemaFolder(
          projectWithWs.workspaceName,
          projectWithWs.project.name
        );
      } catch (folderErr: any) {
        console.warn(`[workspaceService] Failed to delete project schema folder for ${pid}:`, folderErr?.message || folderErr);
      }

      if (this.duckDBService && projectWithWs.project.name) {
        try {
          await this.duckDBService.deleteProjectFolder(projectWithWs.project.name, projectWithWs.workspaceName);
        } catch (duckDbCleanErr: any) {
          console.warn(`[workspaceService] Failed to delete project DuckDB folder for ${pid}:`, duckDbCleanErr?.message || duckDbCleanErr);
        }
      }
    }

    return { success: true, data: true };
  }

  async getProjectById(pid: string): Promise<Project | undefined> {
    return this.projectRepository.getById(pid);
  }

  async getProjectFormSchema(
    workspaceId: string,
    projectId: string
  ): Promise<ServiceResult<{
    sourceId: string;
    projectId: string;
    projectName: string;
    filterGroups: any[];
    forms: any[];
    summary?: string;
    status?: string;
  }>> {
    const project = await this.projectRepository.getById(projectId);
    if (!project) {
      return { success: false, reason: "NOT_FOUND", message: "Project not found." };
    }

    const runs = await this.projectRepository.getProjectRuns(projectId);
    // 1. Check all runs for this project in descending order
    for (const run of runs) {
      const state = (run.agentState as any) || {};
      const candidates = [
        state.stageOutputs?.formBuilder,
        state.stageOutputs?.hierarchyMapper?.formBuilder,
        state.hierarchyMapper?.formBuilder,
        state.formBuilder,
        state.stageOutputs?.hierarchyMapper,
        state.hierarchyMapper,
      ];

      for (const c of candidates) {
        if (!c || typeof c !== "object") continue;
        const groups = c.filterGroups || c.forms || c.groups;
        if (Array.isArray(groups) && groups.length > 0) {
          const sourceId =
            (project.dataSources && project.dataSources.length > 0 ? project.dataSources[0] : null) ||
            c.sourceId ||
            "default_source";

          return {
            success: true,
            data: {
              sourceId,
              projectId: project.id,
              projectName: project.name,
              filterGroups: groups,
              forms: groups,
              summary: c.summary,
              status: c.status || "OK",
            },
          };
        }
      }
    }

    // 2. Check disk for YAML schema file if not in DB runs
    try {
      const projectWithWs = await this.projectRepository.getProjectWithWorkspace(projectId);
      const wsName = projectWithWs?.workspaceName;
      if (wsName) {
        const projectDir = getProjectDir(wsName, project.name);
        if (fs.existsSync(projectDir)) {
          const findFormYaml = (dir: string): string | null => {
            if (!fs.existsSync(dir)) return null;
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
              const fullPath = path.join(dir, entry.name);
              if (entry.isDirectory()) {
                const found = findFormYaml(fullPath);
                if (found) return found;
              } else if (
                entry.isFile() &&
                entry.name.endsWith(".yaml") &&
                (entry.name.includes("form_schema") || entry.name.includes("hierarchy_schema"))
              ) {
                return fullPath;
              }
            }
            return null;
          };

          const yamlPath = findFormYaml(projectDir);
          if (yamlPath) {
            const yamlContent = fs.readFileSync(yamlPath, "utf-8");
            const parsed: any = yaml.load(yamlContent);
            const groups = parsed?.filterGroups || parsed?.forms || parsed?.groups;
            if (Array.isArray(groups) && groups.length > 0) {
              const sourceId =
                (project.dataSources && project.dataSources.length > 0 ? project.dataSources[0] : null) ||
                parsed?.sourceId ||
                "default_source";

              return {
                success: true,
                data: {
                  sourceId,
                  projectId: project.id,
                  projectName: project.name,
                  filterGroups: groups,
                  forms: groups,
                  summary: parsed?.summary,
                  status: parsed?.status || "OK",
                },
              };
            }
          }
        }
      }
    } catch (diskErr: any) {
      console.warn(`[workspaceService] Warning reading form schema from disk:`, diskErr?.message || diskErr);
    }

    return {
      success: false,
      reason: "NOT_FOUND",
      message: "No form schema found for this project.",
    };
  }
}
