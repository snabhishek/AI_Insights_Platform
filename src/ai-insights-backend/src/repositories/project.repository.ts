import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { eq, desc } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import * as schema from "../db/connectors";
import { agentThinking } from "../db/agentThinking";
import { IProjectRepository } from "./project.repository.interface";
import { Project, ProjectRun, ProjectWithWorkspace } from "../models/project.types";

export class PostgresProjectRepository implements IProjectRepository {
  constructor(private db: NodePgDatabase<typeof schema>) {}

  private normalizeAgentState(agentState: any): any {
    if (!agentState || typeof agentState !== "object") return agentState;
    const stageOutputs = agentState.stageOutputs || {};

    const hasForms = (obj: any) =>
      obj &&
      typeof obj === "object" &&
      ((Array.isArray(obj.filterGroups) && obj.filterGroups.length > 0) ||
        (Array.isArray(obj.forms) && obj.forms.length > 0));

    if (!hasForms(agentState.formBuilder)) {
      if (hasForms(stageOutputs.formBuilder)) {
        agentState.formBuilder = stageOutputs.formBuilder;
      } else if (hasForms(stageOutputs.hierarchyMapper?.formBuilder)) {
        agentState.formBuilder = stageOutputs.hierarchyMapper.formBuilder;
      } else if (hasForms(agentState.hierarchyMapper?.formBuilder)) {
        agentState.formBuilder = agentState.hierarchyMapper.formBuilder;
      }
    }

    if (!agentState.hierarchyMapper || Object.keys(agentState.hierarchyMapper).length === 0) {
      if (stageOutputs.hierarchyMapper && Object.keys(stageOutputs.hierarchyMapper).length > 0) {
        agentState.hierarchyMapper = stageOutputs.hierarchyMapper;
      }
    }

    if (!agentState.relationshipBuilder || Object.keys(agentState.relationshipBuilder).length === 0) {
      if (stageOutputs.relationshipBuilder && Object.keys(stageOutputs.relationshipBuilder).length > 0) {
        agentState.relationshipBuilder = stageOutputs.relationshipBuilder;
      } else if (stageOutputs.hierarchyMapper?.relationshipBuilder) {
        agentState.relationshipBuilder = stageOutputs.hierarchyMapper.relationshipBuilder;
      }
    }

    return agentState;
  }

  private mapRowToProject(row: any): Project {
    const rawAgentState = row.agent_state ?? row.agentState ?? {};
    return {
      id: row.id,
      name: row.name,
      role: row.role as "OWNER" | "MEMBER",
      dataSources: Array.isArray(row.data_sources) ? row.data_sources : row.dataSources || [],
      initials: row.initials,
      workspaceId: row.workspace_id || row.workspaceId,
      useCase: row.use_case ?? row.useCase ?? undefined,
      domain: row.domain ?? undefined,
      subDomain: row.sub_domain ?? row.subDomain ?? undefined,
      folderPath: row.folder_path ?? row.folderPath ?? undefined,
      status: row.status || (row.agent_state?.status) || "idle",
      agentState: this.normalizeAgentState(rawAgentState),
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : (row.created_at || row.createdAt),
    };
  }

  private mapRowToProjectRun(row: any): ProjectRun {
    const rawAgentState = row.agent_state ?? row.agentState ?? {};
    return {
      id: row.id,
      projectId: row.project_id || row.projectId,
      useCase: row.use_case ?? row.useCase ?? undefined,
      status: row.status || (row.agent_state?.status) || "idle",
      agentState: this.normalizeAgentState(rawAgentState),
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : (row.created_at || row.createdAt),
    };
  }

  async getById(id: string): Promise<Project | undefined> {
    const res = await this.db.select().from(schema.projects).where(eq(schema.projects.id, id));
    if (res.length === 0) return undefined;

    const latestRuns = await this.db.select()
      .from(schema.projectRuns)
      .where(eq(schema.projectRuns.projectId, id))
      .orderBy(desc(schema.projectRuns.createdAt))
      .limit(1);

    const project = this.mapRowToProject(res[0]);
    if (latestRuns.length > 0) {
      project.agentState = this.normalizeAgentState(latestRuns[0].agentState);
      project.status = latestRuns[0].status || (latestRuns[0].agentState as any)?.status || project.status || "idle";
      if (project.agentState && typeof project.agentState === "object") {
        (project.agentState as any).status = project.status;
      }
    }
    return project;
  }

  async getAll(): Promise<Project[]> {
    const res = await this.db.select().from(schema.projects).orderBy(desc(schema.projects.createdAt));
    const projects: Project[] = [];
    for (const row of res) {
      const proj = this.mapRowToProject(row);
      const latestRuns = await this.db
        .select()
        .from(schema.projectRuns)
        .where(eq(schema.projectRuns.projectId, proj.id))
        .orderBy(desc(schema.projectRuns.createdAt))
        .limit(1);
      if (latestRuns.length > 0) {
        proj.agentState = this.normalizeAgentState(latestRuns[0].agentState);
        proj.status = latestRuns[0].status || (latestRuns[0].agentState as any)?.status || proj.status || "idle";
        if (proj.agentState && typeof proj.agentState === "object") {
          (proj.agentState as any).status = proj.status;
        }
      }
      projects.push(proj);
    }
    return projects;
  }

  async getProjectWithWorkspace(id: string): Promise<ProjectWithWorkspace | undefined> {
    const res = await this.db.select({
      project: schema.projects,
      workspaceName: schema.workspaces.name,
    })
    .from(schema.projects)
    .innerJoin(schema.workspaces, eq(schema.projects.workspaceId, schema.workspaces.id))
    .where(eq(schema.projects.id, id));

    if (res.length === 0) return undefined;

    const proj = await this.getById(id);
    return {
      project: proj || this.mapRowToProject(res[0].project),
      workspaceName: res[0].workspaceName,
    };
  }

  async updateAgentState(id: string, agentState: Record<string, unknown>, useCase?: string): Promise<Project | undefined> {
    const currentProj = await this.getById(id);
    const effectiveUseCase = useCase ?? currentProj?.useCase;
    const effectiveStatus = (agentState?.status as string) || currentProj?.status || "idle";

    // Merge previous agentState with new agentState so that fields like stageOutputs, modelSelection, etc. are NOT lost
    const existingState = (currentProj?.agentState as Record<string, unknown>) || {};
    const existingOutputs = (existingState?.stageOutputs as Record<string, unknown>) || {};
    const incomingOutputs = (agentState?.stageOutputs as Record<string, unknown>) || {};

    const mergedStageOutputs: Record<string, unknown> = { ...existingOutputs };
    for (const [k, v] of Object.entries(incomingOutputs)) {
      const isIncomingEmpty = !v || (typeof v === "object" && Object.keys(v as object).length === 0);
      const isExistingPopulated = existingOutputs[k] && typeof existingOutputs[k] === "object" && Object.keys(existingOutputs[k] as object).length > 0;
      if (isIncomingEmpty && isExistingPopulated) {
        continue;
      }
      mergedStageOutputs[k] = v;
    }

    const preserveIfIncomingEmpty = (key: string) => {
      const incoming = agentState?.[key];
      const existing = existingState?.[key];
      const isIncEmpty = !incoming || (typeof incoming === "object" && Object.keys(incoming as object).length === 0);
      const isExtPopulated = existing && typeof existing === "object" && Object.keys(existing as object).length > 0;
      if (isIncEmpty && isExtPopulated) {
        return existing;
      }
      return incoming !== undefined ? incoming : existing;
    };

    const mergedAgentState: Record<string, unknown> = {
      ...existingState,
      ...agentState,
      stageOutputs: mergedStageOutputs,
      formBuilder: preserveIfIncomingEmpty("formBuilder"),
      hierarchyMapper: preserveIfIncomingEmpty("hierarchyMapper"),
      relationshipBuilder: preserveIfIncomingEmpty("relationshipBuilder"),
      modelSelection: preserveIfIncomingEmpty("modelSelection"),
      trainingConfiguration: preserveIfIncomingEmpty("trainingConfiguration"),
      preFlight: preserveIfIncomingEmpty("preFlight"),
      modelTraining: preserveIfIncomingEmpty("modelTraining"),
      modelValidation: preserveIfIncomingEmpty("modelValidation"),
      ...((agentState?.stageStatuses || existingState?.stageStatuses) ? {
        stageStatuses: {
          ...((existingState?.stageStatuses as Record<string, unknown>) || {}),
          ...((agentState?.stageStatuses as Record<string, unknown>) || {}),
        }
      } : {}),
    };

    // Update projects table with status and useCase
    const projectUpdates: Record<string, any> = {
      status: effectiveStatus,
    };
    if (effectiveUseCase !== undefined && effectiveUseCase !== currentProj?.useCase) {
      projectUpdates.useCase = effectiveUseCase;
    }

    await this.db.update(schema.projects)
      .set(projectUpdates)
      .where(eq(schema.projects.id, id));

    // Always insert a new state execution record into project_runs table
    try {
      const runId = `run-${uuidv4()}`;
      await this.db.insert(schema.projectRuns).values({
        id: runId,
        projectId: id,
        useCase: effectiveUseCase || null,
        status: effectiveStatus,
        agentState: mergedAgentState,
      });
    } catch (runErr: any) {
      console.warn(`[ProjectRepository] Failed to insert project run record:`, runErr?.message || runErr);
    }

    const updatedProj = await this.getById(id);
    if (updatedProj) {
      updatedProj.agentState = mergedAgentState;
      updatedProj.status = effectiveStatus;
    }
    return updatedProj;
  }

  async updateProject(id: string, updates: Partial<Project>): Promise<Project | undefined> {
    const updatePayload: Record<string, any> = {};
    if (updates.name !== undefined) updatePayload.name = updates.name;
    if (updates.useCase !== undefined) updatePayload.useCase = updates.useCase;
    if (updates.dataSources !== undefined) updatePayload.dataSources = updates.dataSources;
    if (updates.folderPath !== undefined) updatePayload.folderPath = updates.folderPath;
    if (updates.status !== undefined) updatePayload.status = updates.status;

    if (Object.keys(updatePayload).length > 0) {
      await this.db.update(schema.projects)
        .set(updatePayload)
        .where(eq(schema.projects.id, id));
    }

    return this.getById(id);
  }

  async getProjectRuns(projectId: string): Promise<ProjectRun[]> {
    const res = await this.db.select()
      .from(schema.projectRuns)
      .where(eq(schema.projectRuns.projectId, projectId))
      .orderBy(desc(schema.projectRuns.createdAt));

    return res.map((row) => this.mapRowToProjectRun(row));
  }

  async getByWorkspaceId(workspaceId: string): Promise<Project[]> {
    const res = await this.db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.workspaceId, workspaceId))
      .orderBy(desc(schema.projects.createdAt));

    const projects: Project[] = [];
    for (const row of res) {
      const proj = this.mapRowToProject(row);
      const latestRuns = await this.db
        .select()
        .from(schema.projectRuns)
        .where(eq(schema.projectRuns.projectId, proj.id))
        .orderBy(desc(schema.projectRuns.createdAt))
        .limit(1);
      if (latestRuns.length > 0) {
        proj.agentState = this.normalizeAgentState(latestRuns[0].agentState);
        proj.status = latestRuns[0].status || (latestRuns[0].agentState as any)?.status || proj.status || "idle";
        if (proj.agentState && typeof proj.agentState === "object") {
          (proj.agentState as any).status = proj.status;
        }
      }
      projects.push(proj);
    }
    return projects;
  }

  async createProject(project: Project): Promise<Project> {
    const now = new Date(project.createdAt);
    await this.db.insert(schema.projects).values({
      id: project.id,
      name: project.name,
      role: project.role,
      dataSources: project.dataSources,
      initials: project.initials,
      workspaceId: project.workspaceId,
      useCase: project.useCase || null,
      domain: project.domain || null,
      subDomain: project.subDomain || null,
      folderPath: project.folderPath || null,
      status: project.status || "idle",
      createdAt: now,
    });
    return project;
  }

  async deleteProject(id: string): Promise<boolean> {
    try {
      await this.db.delete(schema.projectRuns).where(eq(schema.projectRuns.projectId, id));
    } catch {}
    try {
      await this.db.delete(agentThinking).where(eq(agentThinking.projectId, id));
    } catch {}
    const res = await this.db.delete(schema.projects).where(eq(schema.projects.id, id));
    return (res.rowCount ?? 0) > 0;
  }
}

