import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { eq, desc } from "drizzle-orm";
import { IConnectorRepository } from "./connector.repository.interface";
import { Connector, ConnectorType, ConnectorStatus, ConnectorHealth, ConnectionConfig } from "../models/connector.types";
import * as schema from "../db/connectors";

export class PostgresConnectorRepository implements IConnectorRepository {
  constructor(private db: NodePgDatabase<typeof schema>) {}

  private mapRowToConnector(row: any): Connector {
    return {
      id: row.id,
      name: row.name,
      subtext: row.subtext,
      type: row.type as ConnectorType,
      status: row.status as ConnectorStatus,
      health: row.health as ConnectorHealth,
      lastSyncTime: row.lastSyncTime,
      lastSyncDate: row.lastSyncDate,
      createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
      connectionConfig: row.connectionConfig,
      assets: row.assets,
    };
  }

  async getAll(): Promise<Connector[]> {
    const res = await this.db.select().from(schema.connectors).orderBy(desc(schema.connectors.createdAt));
    return res.map((row) => this.mapRowToConnector(row));
  }

  async getById(id: string): Promise<Connector | undefined> {
    const res = await this.db.select().from(schema.connectors).where(eq(schema.connectors.id, id));
    if (res.length === 0) return undefined;
    return this.mapRowToConnector(res[0]);
  }

  async create(connector: Connector): Promise<Connector> {
    const now = new Date(connector.createdAt);
    await this.db.insert(schema.connectors).values({
      id: connector.id,
      name: connector.name,
      subtext: connector.subtext,
      type: connector.type,
      status: connector.status,
      health: connector.health,
      lastSyncTime: connector.lastSyncTime,
      lastSyncDate: connector.lastSyncDate,
      createdAt: now,
      connectionConfig: connector.connectionConfig,
      assets: connector.assets,
    });
    return connector;
  }

  async delete(id: string): Promise<boolean> {
    const res = await this.db.delete(schema.connectors).where(eq(schema.connectors.id, id));
    return (res.rowCount ?? 0) > 0;
  }

  async updateStatus(
    id: string,
    status: ConnectorStatus,
    lastSyncTime?: string,
    lastSyncDate?: string
  ): Promise<Connector | undefined> {
    let res;
    if (status === "Connected" && lastSyncTime && lastSyncDate) {
      res = await this.db.update(schema.connectors)
        .set({ status, lastSyncTime, lastSyncDate })
        .where(eq(schema.connectors.id, id))
        .returning();
    } else {
      res = await this.db.update(schema.connectors)
        .set({ status })
        .where(eq(schema.connectors.id, id))
        .returning();
    }

    if (res.length === 0) return undefined;
    return this.mapRowToConnector(res[0]);
  }

  async updateHealth(id: string, health: ConnectorHealth): Promise<Connector | undefined> {
    const res = await this.db.update(schema.connectors)
      .set({ health })
      .where(eq(schema.connectors.id, id))
      .returning();
    if (res.length === 0) return undefined;
    return this.mapRowToConnector(res[0]);
  }

  async updateAllStatus(
    status: ConnectorStatus,
    lastSyncTime?: string,
    lastSyncDate?: string
  ): Promise<void> {
    if (status === "Connected" && lastSyncTime && lastSyncDate) {
      await this.db.update(schema.connectors)
        .set({ status, lastSyncTime, lastSyncDate });
    } else {
      await this.db.update(schema.connectors)
        .set({ status });
    }
  }

  async updateConnectorConfig(id: string, name: string, config: ConnectionConfig): Promise<Connector | undefined> {
    const res = await this.db.update(schema.connectors)
      .set({ name, connectionConfig: config })
      .where(eq(schema.connectors.id, id))
      .returning();
    if (res.length === 0) return undefined;
    return this.mapRowToConnector(res[0]);
  }
}
