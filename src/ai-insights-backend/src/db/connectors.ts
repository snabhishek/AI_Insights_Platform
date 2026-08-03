import { pgTable, varchar, timestamp, jsonb, boolean, text, index } from "drizzle-orm/pg-core";
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
  useCase: text("use_case"),
  domain: varchar("domain", { length: 255 }),
  subDomain: varchar("sub_domain", { length: 255 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => {
  return {
    workspaceIdIdx: index("projects_workspace_id_idx").on(table.workspaceId),
  };
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
}, (table) => {
  return {
    workspaceIdIdx: index("connectors_workspace_id_idx").on(table.workspaceId),
  };
});

export const projectRuns = pgTable("project_runs", {
  id: varchar("id", { length: 50 }).primaryKey(),
  projectId: varchar("project_id", { length: 50 })
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  useCase: text("use_case"),
  agentState: jsonb("agent_state").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => {
  return {
    projectIdIdx: index("project_runs_project_id_idx").on(table.projectId),
  };
});


