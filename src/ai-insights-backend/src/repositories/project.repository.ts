import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { eq, desc, ne, and } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import * as schema from "../db/connectors";
import { agentThinking } from "../db/agentThinking";
import { IProjectRepository } from "./project.repository.interface";
import { Project, ProjectRun, ProjectWithWorkspace } from "../models/project.types";
import { AgentStateType } from "../agents/state";
import {
  buildGroupedStageStatuses,
  FlatStageStatuses,
  NODE_CONFIG,
  normalizeFlatStageStatuses,
  normalizeGroupedStageStatuses,
  normalizePipelineStepStatus,
  normalizeStageOutputs,
  PipelineStepStatus,
  StageKey,
  TRACKED_AGENT_KEYS,
  TrackedAgentKey,
} from "../agents/pipelineNames";

function normalizePersistedAgentState(value: unknown): AgentStateType | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const state = value as Record<string, unknown>;
  return {
    ...state,
    stageStatuses: normalizeGroupedStageStatuses(state.stageStatuses),
    stageOutputs: normalizeStageOutputs(state.stageOutputs),
  } as AgentStateType;
}

export class PostgresProjectRepository implements IProjectRepository {
  constructor(private db: NodePgDatabase<typeof schema>) { }

  private mapRowToProject(row: any): Project {
    const rawAgentState = row.agent_state ?? row.agentState ?? {};
    return {
      id: row.id,
      projectName: row.project_name ?? row.projectName ?? undefined,
      name: row.name,
      role: row.role as "OWNER" | "MEMBER",
      dataSources: Array.isArray(row.data_sources) ? row.data_sources : row.dataSources || [],
      initials: row.initials,
      workspaceId: row.workspace_id || row.workspaceId,
      useCase: row.use_case ?? row.useCase ?? undefined,
      domain: row.domain ?? undefined,
      subDomain: row.sub_domain ?? row.subDomain ?? undefined,
      folderPath: row.folder_path ?? row.folderPath ?? undefined,
      status: normalizePipelineStepStatus(row.status || (row.agent_state?.status)) || "None",

      agentState: normalizePersistedAgentState(rawAgentState),
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : (row.created_at || row.createdAt),
    };
  }

  private mapRowToProjectRun(row: any): ProjectRun {
    const rawAgentState = row.agent_state ?? row.agentState ?? {};
    return {
      id: row.id,
      projectId: row.project_id || row.projectId,
      useCase: row.use_case ?? row.useCase ?? undefined,
      status: normalizePipelineStepStatus(row.status || (row.agent_state?.status)) || "None",
      agentState: normalizePersistedAgentState(rawAgentState),
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
      project.agentState = normalizePersistedAgentState(latestRuns[0].agentState);
      project.status = normalizePipelineStepStatus(latestRuns[0].status || (latestRuns[0].agentState as any)?.status || project.status) || "None";
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
        proj.agentState = normalizePersistedAgentState(latestRuns[0].agentState);
        proj.status = normalizePipelineStepStatus(latestRuns[0].status || (latestRuns[0].agentState as any)?.status || proj.status) || "None";
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

  async updateAgentState(id: string, agentState: Record<string, unknown>, useCase?: string, replaceState = false): Promise<Project | undefined> {
    const currentProj = await this.getById(id);

    const effectiveUseCase = useCase ?? currentProj?.useCase;
    const rawStatus = (agentState?.status as string) || currentProj?.status;
    const effectiveStatus: PipelineStepStatus = normalizePipelineStepStatus(rawStatus) || "None";

    const existingState = replaceState ? {} : ((currentProj?.agentState as Record<string, unknown>) || {});
    const existingOutputs: Record<string, unknown> = { ...normalizeStageOutputs(existingState.stageOutputs) };
    const incomingOutputs: Record<string, unknown> = { ...normalizeStageOutputs(agentState.stageOutputs) };

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

    const existingStatuses = normalizeGroupedStageStatuses(existingState.stageStatuses);
    const incomingStatuses = agentState.stageStatuses;
    const incomingGroupedStatuses = incomingStatuses === undefined
      ? undefined
      : normalizeGroupedStageStatuses(incomingStatuses);
    const incomingStatusObject = incomingStatuses && typeof incomingStatuses === "object"
      ? incomingStatuses as Record<string, unknown>
      : {};
    const incomingStageOverrides: Partial<Record<StageKey, PipelineStepStatus>> = {};
    for (const key of Object.keys(existingStatuses) as StageKey[]) {
      const group = incomingStatusObject[key];
      if (group && typeof group === "object" && !Array.isArray(group)) {
        const status = normalizePipelineStepStatus((group as Record<string, unknown>).status);
        if (status) incomingStageOverrides[key] = status;
      }
    }
    const existingFlat = normalizeFlatStageStatuses(existingState.stageStatuses);
    const incomingFlat = normalizeFlatStageStatuses(incomingStatuses);
    const mergedFlat: FlatStageStatuses = {
      ...existingFlat,
      ...incomingFlat,
    };
    if (!replaceState) {
      for (const key of TRACKED_AGENT_KEYS) {
        if (existingFlat[key] === "Completed" && (incomingFlat[key] === "Pending" || incomingFlat[key] === "In-Progress")) {
          const stage = NODE_CONFIG[key]?.stage;
          if (stage && (existingStatuses[stage]?.status === "Completed" || incomingFlat[key] === "Pending")) {
            mergedFlat[key] = "Completed";
          }
        }
      }
    }
    const mergedStageStatuses = incomingGroupedStatuses
      ? buildGroupedStageStatuses(mergedFlat, incomingStageOverrides)
      : existingStatuses;

    const getAgentState = () => {
      const merged: Record<string, unknown> = {
        ...existingState,
        ...agentState,
        status: effectiveStatus,
        stageStatuses: mergedStageStatuses,
        stageOutputs: mergedStageOutputs,
        formBuilder: preserveIfIncomingEmpty("formBuilder"),
        hierarchyMapper: preserveIfIncomingEmpty("hierarchyMapper"),
        hierarchyMapperNode: preserveIfIncomingEmpty("hierarchyMapperNode"),
        relationshipBuilder: preserveIfIncomingEmpty("relationshipBuilder"),
        featureArchitect: preserveIfIncomingEmpty("featureArchitect"),
        featureArchitectNode: preserveIfIncomingEmpty("featureArchitectNode"),
        featureValidator: preserveIfIncomingEmpty("featureValidator"),
        featureValidatorNode: preserveIfIncomingEmpty("featureValidatorNode"),
        exogenousScout: preserveIfIncomingEmpty("exogenousScout"),
        exogenous: preserveIfIncomingEmpty("exogenous"),
        modelSelection: preserveIfIncomingEmpty("modelSelection"),
        modelSelectionNode: preserveIfIncomingEmpty("modelSelectionNode"),
        trainingConfiguration: preserveIfIncomingEmpty("trainingConfiguration"),
        trainingConfigurationNode: preserveIfIncomingEmpty("trainingConfigurationNode"),
        preFlight: preserveIfIncomingEmpty("preFlight"),
        preFlightNode: preserveIfIncomingEmpty("preFlightNode"),
        modelTrainingCode: preserveIfIncomingEmpty("modelTrainingCode"),
        modelTrainingCodeNode: preserveIfIncomingEmpty("modelTrainingCodeNode"),
        modelTraining: preserveIfIncomingEmpty("modelTraining"),
        modelTrainingExec: preserveIfIncomingEmpty("modelTrainingExec"),
        modelTrainingExecNode: preserveIfIncomingEmpty("modelTrainingExecNode"),
        modelValidation: preserveIfIncomingEmpty("modelValidation"),
      };
      return merged as AgentStateType;
    };

    const projectUpdates: Record<string, any> = {
      status: effectiveStatus,
    };
    if (effectiveUseCase !== undefined && effectiveUseCase !== currentProj?.useCase) {
      projectUpdates.useCase = effectiveUseCase;
    }

    await this.db.transaction(async (tx) => {
      await tx.update(schema.projects)
        .set(projectUpdates)
        .where(eq(schema.projects.id, id));

      try {
        const runId = `run-${uuidv4()}`;
        await tx.insert(schema.projectRuns).values({
          id: runId,
          projectId: id,
          useCase: effectiveUseCase || null,
          status: effectiveStatus,
          agentState: getAgentState(),
        });
      }
      catch (err) {
        console.error("Error inserting project run:", err);
      }
    })

    const updatedProj = await this.getById(id);
    if (updatedProj) {
      updatedProj.agentState = getAgentState();
      updatedProj.status = effectiveStatus;
    }
    return updatedProj;
  }

  async updateProject(id: string, updates: Partial<Project>): Promise<Project | undefined> {
    const updatePayload: Record<string, any> = {};
    if (updates.projectName !== undefined) updatePayload.projectName = updates.projectName;
    if (updates.name !== undefined) updatePayload.name = updates.name;
    if (updates.domain !== undefined) updatePayload.domain = updates.domain;
    if (updates.subDomain !== undefined) updatePayload.subDomain = updates.subDomain;
    if (updates.useCase !== undefined) updatePayload.useCase = updates.useCase;
    if (updates.dataSources !== undefined) updatePayload.dataSources = updates.dataSources;
    if (updates.folderPath !== undefined) updatePayload.folderPath = updates.folderPath;
    if (updates.status !== undefined) {
      const normalized = normalizePipelineStepStatus(updates.status);
      if (normalized) updatePayload.status = normalized;
    }

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
        proj.agentState = normalizePersistedAgentState(latestRuns[0].agentState);
        proj.status = normalizePipelineStepStatus(latestRuns[0].status || (latestRuns[0].agentState as any)?.status || proj.status) || "None";
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
    const initialStatus = normalizePipelineStepStatus(project.status) || "None";
    await this.db.insert(schema.projects).values({
      id: project.id,
      projectName: project.projectName || null,
      name: project.name,
      role: project.role,
      dataSources: project.dataSources,
      initials: project.initials,
      workspaceId: project.workspaceId,
      useCase: project.useCase || null,
      domain: project.domain || null,
      subDomain: project.subDomain || null,
      folderPath: project.folderPath || null,
      status: initialStatus,
      createdAt: now,
    });
    return project;
  }

  async deleteProject(id: string): Promise<boolean> {
    try {
      await this.db.delete(schema.projectRuns).where(eq(schema.projectRuns.projectId, id));
    } catch { }
    try {
      await this.db.delete(agentThinking).where(eq(agentThinking.projectId, id));
    } catch { }
    const res = await this.db.delete(schema.projects).where(eq(schema.projects.id, id));
    return (res.rowCount ?? 0) > 0;
  }
}
