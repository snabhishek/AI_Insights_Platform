import { pgTable, varchar, timestamp, jsonb, boolean, text, integer, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { projects } from "./connectors";
import {
  ModelSelectionContext,
  ModelSelectionDecision,
  UserSelectionHandoff,
} from "../models/modelSelection.types";

export const modelSelectionDecisions = pgTable(
  "model_selection_decisions",
  {
    id: varchar("id", { length: 50 }).primaryKey(),
    projectId: varchar("project_id", { length: 50 })
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    useCase: text("use_case"),
    status: varchar("status", { length: 50 }).notNull().default("READY"),
    datasetVersion: varchar("dataset_version", { length: 100 }),
    featureSetVersion: varchar("feature_set_version", { length: 100 }),
    modelCatalogVersion: varchar("model_catalog_version", { length: 50 }).notNull().default("1.0.0"),
    promptVersion: varchar("prompt_version", { length: 50 }).notNull().default("1.0.0"),
    agentVersion: varchar("agent_version", { length: 50 }).notNull().default("1.0.0"),
    llmProvider: varchar("llm_provider", { length: 50 }),
    llmModel: varchar("llm_model", { length: 100 }),
    executionDurationMs: integer("execution_duration_ms"),
    candidateCount: integer("candidate_count"),
    primaryModelId: varchar("primary_model_id", { length: 100 }),
    inputContextSnapshot: jsonb("input_context_snapshot")
      .$type<ModelSelectionContext>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    decision: jsonb("decision")
      .$type<ModelSelectionDecision>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    userSelection: jsonb("user_selection").$type<UserSelectionHandoff>(),
    isStale: boolean("is_stale").notNull().default(false),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    projectIdIdx: index("model_selection_decisions_project_id_idx").on(table.projectId),
    statusIdx: index("model_selection_decisions_status_idx").on(table.status),
  })
);

export const modelSourceTypes = pgTable("model_source_types", {
  id: varchar("id", { length: 50 }).primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const modelSourceProviders = pgTable(
  "model_source_providers",
  {
    id: varchar("id", { length: 100 }).primaryKey(),
    name: varchar("name", { length: 255 }).notNull(),
    sourceTypeId: varchar("source_type_id", { length: 50 })
      .notNull()
      .references(() => modelSourceTypes.id),
    baseUrl: text("base_url"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    sourceTypeIdIdx: index("model_source_providers_source_type_id_idx").on(table.sourceTypeId),
  })
);

export const dynamicModelRegistry = pgTable(
  "dynamic_model_registry",
  {
    modelId: varchar("model_id", { length: 100 }).primaryKey(),
    displayName: varchar("display_name", { length: 255 }).notNull(),
    algorithm: varchar("algorithm", { length: 255 }).notNull(),
    framework: varchar("framework", { length: 50 }).notNull().default("custom"),
    supportedTasks: text("supported_tasks").array().notNull().default(sql`'{}'::text[]`),
    capabilities: text("capabilities").array().notNull().default(sql`'{}'::text[]`),
    strengths: text("strengths").array().notNull().default(sql`'{}'::text[]`),
    weaknesses: text("weaknesses").array().notNull().default(sql`'{}'::text[]`),
    isBaseline: boolean("is_baseline").notNull().default(false),
    sourceTypeId: varchar("source_type_id", { length: 50 })
      .notNull()
      .default("external")
      .references(() => modelSourceTypes.id),
    sourceProviderId: varchar("source_provider_id", { length: 100 })
      .references(() => modelSourceProviders.id),
    source: varchar("source", { length: 100 }).notNull().default("web_search"),
    repositoryUrl: text("repository_url"),
    repositoryId: varchar("repository_id", { length: 255 }),
    version: varchar("version", { length: 100 }),
    license: varchar("license", { length: 100 }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default(sql`'{}'::jsonb`),
    discoveredAt: timestamp("discovered_at").defaultNow().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    frameworkIdx: index("dynamic_model_registry_framework_idx").on(table.framework),
    sourceIdx: index("dynamic_model_registry_source_idx").on(table.source),
    sourceTypeIdx: index("dynamic_model_registry_source_type_idx").on(table.sourceTypeId),
    sourceProviderIdx: index("dynamic_model_registry_source_provider_idx").on(table.sourceProviderId),
  })
);
