import { pgTable, varchar, timestamp, jsonb, boolean, text } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { ConnectionConfig } from "../models/connector.types";

export const workspaces = pgTable("workspaces", {
  id: varchar("id", { length: 50 }).primaryKey(),
  name: varchar("name", { length: 255 }).notNull().unique(),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const projects = pgTable("projects", {
  id: varchar("id", { length: 50 }).primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  role: varchar("role", { length: 50 }).notNull().default("OWNER"),
  dataSources: text("data_sources").array().notNull().default(sql`'{}'::text[]`),
  initials: varchar("initials", { length: 10 }).notNull().default("US"),
  workspaceId: varchar("workspace_id", { length: 50 })
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

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
  workspaceId: varchar("workspace_id", { length: 50 })
    .references(() => workspaces.id, { onDelete: "cascade" }),
});

