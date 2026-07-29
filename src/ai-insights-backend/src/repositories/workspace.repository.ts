import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { eq, desc, asc } from "drizzle-orm";
import { IWorkspaceRepository } from "./workspace.repository.interface";
import { Workspace } from "../models/workspace.types";
import * as schema from "../db/connectors";

export class PostgresWorkspaceRepository implements IWorkspaceRepository {
  constructor(private db: NodePgDatabase<typeof schema>) {}

  private mapRowToWorkspace(row: any): Workspace {
    return {
      id: row.id,
      name: row.name,
      isDefault: row.isDefault ?? row.is_default ?? false,
      createdAt: row.createdAt instanceof Date
        ? row.createdAt.toISOString()
        : row.created_at instanceof Date
        ? row.created_at.toISOString()
        : String(row.createdAt || row.created_at),
    };
  }

  async getAll(): Promise<Workspace[]> {
    const res = await this.db
      .select()
      .from(schema.workspaces)
      .orderBy(desc(schema.workspaces.isDefault), asc(schema.workspaces.createdAt));
    return res.map((row) => this.mapRowToWorkspace(row));
  }

  async getById(id: string): Promise<Workspace | undefined> {
    const res = await this.db.select().from(schema.workspaces).where(eq(schema.workspaces.id, id));
    if (res.length === 0) return undefined;
    return this.mapRowToWorkspace(res[0]);
  }

  async getByName(name: string): Promise<Workspace | undefined> {
    const res = await this.db.select().from(schema.workspaces).where(eq(schema.workspaces.name, name));
    if (res.length === 0) return undefined;
    return this.mapRowToWorkspace(res[0]);
  }

  async create(workspace: Workspace): Promise<Workspace> {
    const now = new Date(workspace.createdAt);
    await this.db.insert(schema.workspaces).values({
      id: workspace.id,
      name: workspace.name,
      isDefault: workspace.isDefault,
      createdAt: now,
    });
    return workspace;
  }

  async delete(id: string): Promise<boolean> {
    const res = await this.db.delete(schema.workspaces).where(eq(schema.workspaces.id, id));
    return (res.rowCount ?? 0) > 0;
  }
}
