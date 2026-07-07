import { pgTable, varchar, timestamp, jsonb } from "drizzle-orm/pg-core";
import { ConnectionConfig } from "../models/connector.types";

export const connectors = pgTable("connectors", {
  id: varchar("id", { length: 50 }).primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  subtext: varchar("subtext", { length: 255 }).notNull(),
  type: varchar("type", { length: 50 }).notNull(),
  status: varchar("status", { length: 50 }).notNull(),
  health: varchar("health", { length: 50 }).notNull(),
  lastSyncTime: varchar("last_sync_time", { length: 100 }).notNull(),
  lastSyncDate: varchar("last_sync_date", { length: 100 }).notNull(),
  createdAt: timestamp("created_at").notNull(),
  connectionConfig: jsonb("connection_config").$type<ConnectionConfig>().notNull(),
  assets: jsonb("assets").$type<{
    tables: number;
    views: number | null;
    pipelines: number;
  }>().notNull(),
});
