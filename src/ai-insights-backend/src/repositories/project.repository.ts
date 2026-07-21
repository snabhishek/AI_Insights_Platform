import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import * as schema from "../db/connectors";
import { IProjectRepository } from "./project.repository.interface";
import { Project } from "../models/project.types";

export class PostgresProjectRepository implements IProjectRepository {
  constructor(private db: NodePgDatabase<typeof schema>) {}

  private mapRowToProject(row: any): Project {
    return {
      id: row.id,
      name: row.name,
      role: row.role as "OWNER" | "MEMBER",
      dataSources: Array.isArray(row.data_sources) ? row.data_sources : [],
      initials: row.initials,
      workspaceId: row.workspace_id,
      useCase: row.use_case || undefined,
      agentState: row.agent_state ?? {},
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    };
  }

  async getById(id: string): Promise<Project | undefined> {
    const res = await this.db.select().from(schema.projects).where(eq(schema.projects.id, id));
    if (res.length === 0) return undefined;
    return this.mapRowToProject(res[0]);
  }

  async updateAgentState(id: string, agentState: Record<string, unknown>): Promise<Project | undefined> {
    const res = await this.db.update(schema.projects)
      .set({ agentState })
      .where(eq(schema.projects.id, id))
      .returning();

    if (res.length === 0) return undefined;
    return this.mapRowToProject(res[0]);
  }
}
