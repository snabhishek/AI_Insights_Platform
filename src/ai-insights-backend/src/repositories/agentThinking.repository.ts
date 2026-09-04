import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { eq, and } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { agentThinking } from "../db/agentThinking";
import { IAgentThinkingRepository } from "./agentThinking.repository.interface";
import { AgentThinking, ThinkingLog } from "../models/agentThinking.types";

export class PostgresAgentThinkingRepository implements IAgentThinkingRepository {
  constructor(private db: NodePgDatabase<any>) {}

  private mapRowToAgentThinking(row: any): AgentThinking {
    return {
      id: row.id,
      projectId: row.project_id || row.projectId,
      pipeline: row.pipeline,
      substep: row.substep,
      thinking: row.thinking || [],
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : (row.created_at || row.createdAt),
      updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : (row.updated_at || row.updatedAt),
    };
  }

  async getThinking(projectId: string, pipeline: string, substep: string): Promise<AgentThinking | undefined> {
    try {
      const res = await this.db.select()
        .from(agentThinking)
        .where(
          and(
            eq(agentThinking.projectId, projectId),
            eq(agentThinking.pipeline, pipeline),
            eq(agentThinking.substep, substep)
          )
        );
      if (res.length === 0) return undefined;
      return this.mapRowToAgentThinking(res[0]);
    } catch (err: any) {
      console.warn(`[AgentThinkingRepository] Error fetching thinking for project ${projectId}:`, err.message || err);
      return undefined;
    }
  }

  async getAllThinking(projectId: string, pipeline?: string): Promise<Record<string, ThinkingLog[]>> {
    try {
      const conditions = [eq(agentThinking.projectId, projectId)];
      if (pipeline) {
        conditions.push(eq(agentThinking.pipeline, pipeline));
      }
      const res = await this.db.select()
        .from(agentThinking)
        .where(and(...conditions));

      const map: Record<string, ThinkingLog[]> = {};
      for (const row of res) {
        if (row.substep) {
          map[row.substep] = (row.thinking as ThinkingLog[]) || [];
        }
      }
      return map;
    } catch (err: any) {
      console.warn(`[AgentThinkingRepository] Error fetching all thinking for project ${projectId}:`, err.message || err);
      return {};
    }
  }

  async saveThinking(projectId: string, pipeline: string, substep: string, thinking: ThinkingLog[]): Promise<AgentThinking> {
    try {
      const existing = await this.getThinking(projectId, pipeline, substep);
      
      if (existing) {
        const res = await this.db.update(agentThinking)
          .set({
            thinking,
            updatedAt: new Date(),
          })
          .where(eq(agentThinking.id, existing.id))
          .returning();
        return this.mapRowToAgentThinking(res[0]);
      } else {
        const id = `thinking-${uuidv4()}`;
        const res = await this.db.insert(agentThinking)
          .values({
            id,
            projectId,
            pipeline,
            substep,
            thinking,
          })
          .returning();
        return this.mapRowToAgentThinking(res[0]);
      }
    } catch (err: any) {
      console.error(`[AgentThinkingRepository] Error saving thinking for project ${projectId}:`, err.message || err);
      return {
        id: `thinking-${uuidv4()}`,
        projectId,
        pipeline,
        substep,
        thinking,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }
  }

  async deleteThinking(projectId: string, pipeline: string, substep: string): Promise<void> {
    try {
      await this.db.delete(agentThinking)
        .where(
          and(
            eq(agentThinking.projectId, projectId),
            eq(agentThinking.pipeline, pipeline),
            eq(agentThinking.substep, substep)
          )
        );
    } catch (err: any) {
      console.warn(`[AgentThinkingRepository] Warning: deleteThinking failed for project ${projectId}:`, err.message || err);
    }
  }

  async clearProjectPipelineThinking(projectId: string, pipeline: string): Promise<void> {
    try {
      await this.db.delete(agentThinking)
        .where(
          and(
            eq(agentThinking.projectId, projectId),
            eq(agentThinking.pipeline, pipeline)
          )
        );
    } catch (err: any) {
      console.warn(`[AgentThinkingRepository] Warning: clearProjectPipelineThinking failed for project ${projectId}:`, err.message || err);
    }
  }
}
