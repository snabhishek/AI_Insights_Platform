import { pgTable, varchar, timestamp, jsonb, text, integer, doublePrecision, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { projects } from "./connectors";

export const modelValidationRuns = pgTable(
  "model_validation_runs",
  {
    id: varchar("id", { length: 50 }).primaryKey(),
    projectId: varchar("project_id", { length: 50 })
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    evaluationMode: varchar("evaluation_mode", { length: 50 }).notNull(), // "backtesting" | "future_prediction"
    predictionObjectiveStartDate: varchar("prediction_objective_start_date", { length: 50 }),
    predictionObjectiveHorizon: integer("prediction_objective_horizon").notNull().default(12),
    predictionObjectiveFrequency: varchar("prediction_objective_frequency", { length: 50 }).notNull().default("Weekly"),
    datasetReference: text("dataset_reference"),
    datasetSchemaVersion: varchar("dataset_schema_version", { length: 50 }),
    actualDataCoverage: doublePrecision("actual_data_coverage"),
    championModelId: varchar("champion_model_id", { length: 100 }),
    status: varchar("status", { length: 50 }).notNull().default("Completed"),
    summary: text("summary"),
    validationDirectory: varchar("validation_directory", { length: 500 }),
    reportArtifactPath: text("report_artifact_path"),
    predictionsArtifactPath: text("predictions_artifact_path"),
    chartData: jsonb("chart_data").default(sql`'{}'::jsonb`),
    warnings: text("warnings").array().default(sql`'{}'::text[]`),
    metadata: jsonb("metadata").default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    projectIdIdx: index("model_validation_runs_project_id_idx").on(table.projectId),
    modeIdx: index("model_validation_runs_mode_idx").on(table.evaluationMode),
  })
);

export const modelValidationResults = pgTable(
  "model_validation_results",
  {
    id: varchar("id", { length: 50 }).primaryKey(),
    validationRunId: varchar("validation_run_id", { length: 50 })
      .notNull()
      .references(() => modelValidationRuns.id, { onDelete: "cascade" }),
    modelId: varchar("model_id", { length: 100 }).notNull(),
    displayName: varchar("display_name", { length: 255 }),
    framework: varchar("framework", { length: 50 }),
    executionStatus: varchar("execution_status", { length: 50 }).notNull().default("Completed"),
    score: doublePrecision("score"),
    primaryMetricName: varchar("primary_metric_name", { length: 100 }),
    metrics: jsonb("metrics").default(sql`'{}'::jsonb`),
    totals: jsonb("totals").default(sql`'{}'::jsonb`),
    actualTotal: doublePrecision("actual_total"),
    forecastTotal: doublePrecision("forecast_total"),
    difference: doublePrecision("difference"),
    differencePercentage: doublePrecision("difference_percentage"),
    evaluationRecordCount: integer("evaluation_record_count").default(0),
    actualDataCoverage: doublePrecision("actual_data_coverage"),
    chartSeries: jsonb("chart_series").default(sql`'{}'::jsonb`),
    modelArtifactPath: text("model_artifact_path"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    runIdIdx: index("model_validation_results_run_id_idx").on(table.validationRunId),
    modelIdIdx: index("model_validation_results_model_id_idx").on(table.modelId),
  })
);
