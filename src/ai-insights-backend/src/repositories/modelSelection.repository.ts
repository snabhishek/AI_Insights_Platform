import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { eq, desc } from "drizzle-orm";
import * as schema from "../db/modelSelection";
import { IModelSelectionRepository } from "./modelSelection.repository.interface";
import {
  ModelDefinition,
  ModelSelectionDecisionRecord,
  UserSelectionHandoff,
} from "../models/modelSelection.types";

export class PostgresModelSelectionRepository implements IModelSelectionRepository {
  constructor(private db: NodePgDatabase<typeof schema>) {}

  private mapRowToRecord(row: any): ModelSelectionDecisionRecord {
    return {
      id: row.id,
      projectId: row.projectId || row.project_id,
      useCase: row.useCase || row.use_case || undefined,
      status: row.status,
      datasetVersion: row.datasetVersion || row.dataset_version || undefined,
      featureSetVersion: row.featureSetVersion || row.feature_set_version || undefined,
      modelCatalogVersion: row.modelCatalogVersion || row.model_catalog_version || "1.0.0",
      promptVersion: row.promptVersion || row.prompt_version || "1.0.0",
      agentVersion: row.agentVersion || row.agent_version || "1.0.0",
      llmProvider: row.llmProvider || row.llm_provider || undefined,
      llmModel: row.llmModel || row.llm_model || undefined,
      executionDurationMs: row.executionDurationMs || row.execution_duration_ms || undefined,
      candidateCount: row.candidateCount ?? row.candidate_count ?? 0,
      primaryModelId: row.primaryModelId || row.primary_model_id || "",
      inputContextSnapshot: row.inputContextSnapshot || row.input_context_snapshot || {},
      decision: row.decision || {},
      userSelection: row.userSelection || row.user_selection || undefined,
      isStale: Boolean(row.isStale ?? row.is_stale),
      createdAt:
        row.createdAt instanceof Date
          ? row.createdAt.toISOString()
          : row.createdAt || row.created_at || new Date().toISOString(),
      updatedAt:
        row.updatedAt instanceof Date
          ? row.updatedAt.toISOString()
          : row.updatedAt || row.updated_at || new Date().toISOString(),
    };
  }

  async saveDecision(record: ModelSelectionDecisionRecord): Promise<ModelSelectionDecisionRecord> {
    await this.db
      .insert(schema.modelSelectionDecisions)
      .values({
        id: record.id,
        projectId: record.projectId,
        useCase: record.useCase || null,
        status: record.status,
        datasetVersion: record.datasetVersion || null,
        featureSetVersion: record.featureSetVersion || null,
        modelCatalogVersion: record.modelCatalogVersion,
        promptVersion: record.promptVersion,
        agentVersion: record.agentVersion,
        llmProvider: record.llmProvider || null,
        llmModel: record.llmModel || null,
        executionDurationMs: record.executionDurationMs || null,
        candidateCount: record.candidateCount,
        primaryModelId: record.primaryModelId,
        inputContextSnapshot: record.inputContextSnapshot,
        decision: record.decision,
        userSelection: record.userSelection || null,
        isStale: record.isStale,
      })
      .onConflictDoUpdate({
        target: schema.modelSelectionDecisions.id,
        set: {
          status: record.status,
          decision: record.decision,
          userSelection: record.userSelection || null,
          isStale: record.isStale,
          updatedAt: new Date(),
        },
      });

    const saved = await this.getById(record.id);
    return saved || record;
  }

  async getById(id: string): Promise<ModelSelectionDecisionRecord | undefined> {
    const rows = await this.db
      .select()
      .from(schema.modelSelectionDecisions)
      .where(eq(schema.modelSelectionDecisions.id, id))
      .limit(1);

    if (rows.length === 0) return undefined;
    return this.mapRowToRecord(rows[0]);
  }

  async getLatestByProjectId(projectId: string): Promise<ModelSelectionDecisionRecord | undefined> {
    const rows = await this.db
      .select()
      .from(schema.modelSelectionDecisions)
      .where(eq(schema.modelSelectionDecisions.projectId, projectId))
      .orderBy(desc(schema.modelSelectionDecisions.createdAt))
      .limit(1);

    if (rows.length === 0) return undefined;
    return this.mapRowToRecord(rows[0]);
  }

  async getAllByProjectId(projectId: string): Promise<ModelSelectionDecisionRecord[]> {
    const rows = await this.db
      .select()
      .from(schema.modelSelectionDecisions)
      .where(eq(schema.modelSelectionDecisions.projectId, projectId))
      .orderBy(desc(schema.modelSelectionDecisions.createdAt));

    return rows.map((r) => this.mapRowToRecord(r));
  }

  async updateUserSelection(
    id: string,
    userSelection: UserSelectionHandoff
  ): Promise<ModelSelectionDecisionRecord | undefined> {
    await this.db
      .update(schema.modelSelectionDecisions)
      .set({
        userSelection,
        updatedAt: new Date(),
      })
      .where(eq(schema.modelSelectionDecisions.id, id));

    return this.getById(id);
  }

  async markStale(id: string): Promise<boolean> {
    const result = await this.db
      .update(schema.modelSelectionDecisions)
      .set({
        isStale: true,
        updatedAt: new Date(),
      })
      .where(eq(schema.modelSelectionDecisions.id, id));

    return true;
  }

  async saveDynamicModel(model: ModelDefinition): Promise<void> {
    await this.db
      .insert(schema.dynamicModelRegistry)
      .values({
        modelId: model.modelId.toLowerCase().trim(),
        displayName: model.displayName,
        algorithm: model.algorithm,
        framework: model.framework,
        supportedTasks: model.supportedTasks as string[],
        capabilities: model.capabilities || [],
        strengths: model.strengths || [],
        weaknesses: model.weaknesses || [],
        isBaseline: Boolean(model.isBaseline),
        source: model.source || "web_search",
        metadata: model.metadata || {},
      })
      .onConflictDoUpdate({
        target: schema.dynamicModelRegistry.modelId,
        set: {
          displayName: model.displayName,
          algorithm: model.algorithm,
          capabilities: model.capabilities || [],
          strengths: model.strengths || [],
          weaknesses: model.weaknesses || [],
        },
      });
  }

  async getDynamicModels(): Promise<ModelDefinition[]> {
    const rows = await this.db.select().from(schema.dynamicModelRegistry);
    return rows.map((r: any) => ({
      modelId: r.modelId || r.model_id,
      displayName: r.displayName || r.display_name,
      algorithm: r.algorithm,
      framework: (r.framework as any) || "custom",
      supportedTasks: (r.supportedTasks || r.supported_tasks || []) as any,
      supportedSubTasks: [],
      supportedPredictionTypes: ["value", "point"],
      capabilities: r.capabilities || [],
      strengths: r.strengths || [],
      weaknesses: r.weaknesses || [],
      isBaseline: Boolean(r.isBaseline || r.is_baseline),
      isDynamic: true,
      source: (r.source as any) || "web_search",
      metadata: r.metadata || {},
    }));
  }
}
