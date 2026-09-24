import { eq, desc } from "drizzle-orm";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { IModelValidationRepository } from "./modelValidation.repository.interface";
import * as schema from "../db/modelValidation";
import { ModelValidationReport } from "../agents/ModelTrainingValidation/ModelValidation/types";
import { v4 as uuidv4 } from "uuid";

export class PostgresModelValidationRepository implements IModelValidationRepository {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  async saveValidationRun(
    runId: string,
    projectId: string,
    report: ModelValidationReport,
    validationDirectory: string,
    predictionsArtifactPath?: string
  ): Promise<void> {
    const existing = await this.db
      .select()
      .from(schema.modelValidationRuns)
      .where(eq(schema.modelValidationRuns.id, runId))
      .limit(1);

    const runValues = {
      id: runId,
      projectId,
      evaluationMode: report.mode,
      predictionObjectiveStartDate: report.prediction_objective_start_date,
      predictionObjectiveHorizon: report.prediction_objective_horizon,
      predictionObjectiveFrequency: report.prediction_objective_frequency,
      datasetReference: report.dataset_reference,
      datasetSchemaVersion: report.dataset_schema_version || null,
      actualDataCoverage: report.coverage_percentage !== null ? report.coverage_percentage : null,
      championModelId: report.champion_model_id || null,
      status: "Completed",
      summary: `Validation run ${runId} completed in ${report.mode} mode for ${Object.keys(report.models || {}).length} model(s).`,
      validationDirectory,
      reportArtifactPath: `${validationDirectory}/reports/model_validation_report.json`,
      predictionsArtifactPath: predictionsArtifactPath || `${validationDirectory}/artifacts/predictions/validation_predictions.parquet`,
      chartData: {
        championModel: report.models?.[report.champion_model_id]?.chartData || null,
        modelsSummary: Object.values(report.models || {}).map((m) => ({
          modelId: m.model_id,
          displayName: m.displayName,
          score: m.score,
          totals: m.totals,
          chartData: m.chartData,
        })),
      },
      warnings: report.warnings || [],
      metadata: {
        timeColumn: report.time_column,
        targetColumn: report.target_column,
        entityColumn: report.entity_column || null,
        problemType: report.problem_type,
        evaluationPeriod: report.evaluation_period,
      },
      updatedAt: new Date(),
    };

    if (existing.length > 0) {
      await this.db
        .update(schema.modelValidationRuns)
        .set(runValues)
        .where(eq(schema.modelValidationRuns.id, runId));

      // Remove previous candidate results for this runId to allow clean idempotent rewrite
      await this.db
        .delete(schema.modelValidationResults)
        .where(eq(schema.modelValidationResults.validationRunId, runId));
    } else {
      await this.db.insert(schema.modelValidationRuns).values({
        ...runValues,
        createdAt: new Date(),
      });
    }

    // Insert model-level validation result records
    const modelEntries = Object.values(report.models || {});
    for (const m of modelEntries) {
      const resultId = `mvr-${uuidv4()}`;
      await this.db.insert(schema.modelValidationResults).values({
        id: resultId,
        validationRunId: runId,
        modelId: m.model_id,
        displayName: m.displayName || m.model_id,
        framework: m.framework || "custom",
        executionStatus: m.status || "Completed",
        score: typeof m.score === "number" ? m.score : null,
        primaryMetricName: m.primaryMetricName || null,
        metrics: m.metrics || {},
        totals: m.totals || {},
        actualTotal: typeof m.totals?.actualTotal === "number" ? m.totals.actualTotal : null,
        forecastTotal: typeof m.totals?.forecastTotal === "number" ? m.totals.forecastTotal : null,
        difference: typeof m.totals?.difference === "number" ? m.totals.difference : null,
        differencePercentage: typeof m.totals?.differencePercentage === "number" ? m.totals.differencePercentage : null,
        evaluationRecordCount: m.evaluationRecordCount || 0,
        actualDataCoverage: typeof m.actualDataCoverage === "number" ? m.actualDataCoverage : null,
        chartSeries: m.chartData || {},
        modelArtifactPath: m.modelArtifactPath || null,
        errorMessage: m.error || null,
        createdAt: new Date(),
      });
    }
  }

  async getValidationRun(runId: string): Promise<any | null> {
    const rows = await this.db
      .select()
      .from(schema.modelValidationRuns)
      .where(eq(schema.modelValidationRuns.id, runId))
      .limit(1);

    if (rows.length === 0) return null;
    const run = rows[0];

    const results = await this.db
      .select()
      .from(schema.modelValidationResults)
      .where(eq(schema.modelValidationResults.validationRunId, runId));

    return { ...run, results };
  }

  async getLatestValidationRunByProject(projectId: string): Promise<any | null> {
    const rows = await this.db
      .select()
      .from(schema.modelValidationRuns)
      .where(eq(schema.modelValidationRuns.projectId, projectId))
      .orderBy(desc(schema.modelValidationRuns.createdAt))
      .limit(1);

    if (rows.length === 0) return null;
    const run = rows[0];

    const results = await this.db
      .select()
      .from(schema.modelValidationResults)
      .where(eq(schema.modelValidationResults.validationRunId, run.id));

    return { ...run, results };
  }

  async listValidationRunsByProject(projectId: string): Promise<any[]> {
    return this.db
      .select()
      .from(schema.modelValidationRuns)
      .where(eq(schema.modelValidationRuns.projectId, projectId))
      .orderBy(desc(schema.modelValidationRuns.createdAt));
  }
}
