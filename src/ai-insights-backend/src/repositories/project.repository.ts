import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { eq, desc } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import * as schema from "../db/connectors";
import { IProjectRepository } from "./project.repository.interface";
import { Project, ProjectRun, ProjectWithWorkspace } from "../models/project.types";

export class PostgresProjectRepository implements IProjectRepository {
  constructor(private db: NodePgDatabase<typeof schema>) {}

  private mapRowToProject(row: any): Project {
    return {
      id: row.id,
      name: row.name,
      role: row.role as "OWNER" | "MEMBER",
      dataSources: Array.isArray(row.data_sources) ? row.data_sources : row.dataSources || [],
      initials: row.initials,
      workspaceId: row.workspace_id || row.workspaceId,
      useCase: row.use_case ?? row.useCase ?? undefined,
      agentState: row.agent_state ?? row.agentState ?? {},
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : (row.created_at || row.createdAt),
    };
  }

  private mapRowToProjectRun(row: any): ProjectRun {
    return {
      id: row.id,
      projectId: row.project_id || row.projectId,
      useCase: row.use_case ?? row.useCase ?? undefined,
      agentState: row.agent_state ?? row.agentState ?? {},
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
      project.agentState = latestRuns[0].agentState;
    }
    return project;
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

    // Update useCase on projects table if provided
    if (effectiveUseCase !== undefined && effectiveUseCase !== currentProj?.useCase) {
      await this.db.update(schema.projects)
        .set({ useCase: effectiveUseCase })
        .where(eq(schema.projects.id, id));
    }

    // Always insert a new state execution record into project_runs table
    try {
      const runId = `run-${uuidv4()}`;
      await this.db.insert(schema.projectRuns).values({
        id: runId,
        projectId: id,
        useCase: effectiveUseCase || null,
        agentState,
      });
    } catch (runErr: any) {
      console.warn(`[ProjectRepository] Failed to insert project run record:`, runErr?.message || runErr);
    }

    const updatedProj = await this.getById(id);
    if (updatedProj) {
      updatedProj.agentState = agentState;
    }
    return updatedProj;
  }

  async updateProject(id: string, updates: Partial<Project>): Promise<Project | undefined> {
    const updatePayload: Record<string, any> = {};
    if (updates.name !== undefined) updatePayload.name = updates.name;
    if (updates.useCase !== undefined) updatePayload.useCase = updates.useCase;
    if (updates.dataSources !== undefined) updatePayload.dataSources = updates.dataSources;

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
}

