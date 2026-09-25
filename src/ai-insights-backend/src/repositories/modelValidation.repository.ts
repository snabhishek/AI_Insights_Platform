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
    const effectiveRunId = (runId && runId !== "undefined" && runId.trim())
      ? runId.slice(0, 50)
      : (report.validation_run_id && report.validation_run_id !== "undefined")
        ? report.validation_run_id.slice(0, 50)
        : `val-${Date.now()}`;

    const existing = await this.db
      .select()
      .from(schema.modelValidationRuns)
      .where(eq(schema.modelValidationRuns.id, effectiveRunId))
      .limit(1);

    const mode = (report.mode || (report as any).evaluation_mode || "backtesting").slice(0, 50);

    const modelsList: any[] =
      report.ranked_models ||
      (report.models
        ? Array.isArray(report.models)
          ? report.models
          : Object.values(report.models)
        : []);

    const championId = report.champion_model_id || modelsList[0]?.model_id || modelsList[0]?.modelId || null;
    const championModel = modelsList.find((m) => (m.model_id || m.modelId) === championId) || modelsList[0] || null;

    const runValues = {
      id: effectiveRunId,
      projectId,
      evaluationMode: mode,
      predictionObjectiveStartDate: report.prediction_objective_start_date ? String(report.prediction_objective_start_date).slice(0, 50) : null,
      predictionObjectiveHorizon: typeof report.prediction_objective_horizon === "number" ? report.prediction_objective_horizon : 12,
      predictionObjectiveFrequency: (report.prediction_objective_frequency || "Weekly").slice(0, 50),
      datasetReference: report.dataset_reference || null,
      datasetSchemaVersion: report.dataset_schema_version || null,
      actualDataCoverage: typeof report.coverage_percentage === "number" ? report.coverage_percentage : null,
      championModelId: championId ? String(championId).slice(0, 100) : null,
      status: "Completed",
      summary: `Validation run ${effectiveRunId} completed in ${mode} mode for ${modelsList.length} model(s).`,
      validationDirectory: validationDirectory ? validationDirectory.slice(0, 500) : null,
      reportArtifactPath: `${validationDirectory}/reports/model_validation_report.json`,
      predictionsArtifactPath: predictionsArtifactPath || `${validationDirectory}/artifacts/predictions/validation_predictions.parquet`,
      chartData: {
        championModel: championModel?.chartData || null,
        modelsSummary: modelsList.map((m) => ({
          modelId: m.model_id || m.modelId,
          displayName: m.displayName || m.model_id || m.modelId,
          score: typeof m.score === "number" ? m.score : null,
          totals: m.totals || null,
          chartData: m.chartData || null,
        })),
      },
      warnings: report.warnings || [],
      metadata: {
        timeColumn: report.time_column || null,
        targetColumn: report.target_column || null,
        entityColumn: report.entity_column || null,
        problemType: report.problem_type || null,
        evaluationPeriod: report.evaluation_period || null,
      },
      updatedAt: new Date(),
    };

    if (existing.length > 0) {
      await this.db
        .update(schema.modelValidationRuns)
        .set(runValues)
        .where(eq(schema.modelValidationRuns.id, effectiveRunId));

      // Remove previous candidate results for this runId to allow clean idempotent rewrite
      await this.db
        .delete(schema.modelValidationResults)
        .where(eq(schema.modelValidationResults.validationRunId, effectiveRunId));
    } else {
      await this.db.insert(schema.modelValidationRuns).values({
        ...runValues,
        createdAt: new Date(),
      });
    }

    // Insert model-level validation result records
    for (const m of modelsList) {
      const modelId = String(m.model_id || m.modelId || "model").slice(0, 100);
      const resultId = `mvr-${uuidv4()}`.slice(0, 50);
      try {
        await this.db.insert(schema.modelValidationResults).values({
          id: resultId,
          validationRunId: effectiveRunId,
          modelId,
          displayName: String(m.displayName || modelId).slice(0, 255),
          framework: String(m.framework || "custom").slice(0, 50),
          executionStatus: String(m.status || "Completed").slice(0, 50),
          score: typeof m.score === "number" && !isNaN(m.score) ? m.score : null,
          primaryMetricName: m.primaryMetricName ? String(m.primaryMetricName).slice(0, 100) : null,
          metrics: m.metrics && typeof m.metrics === "object" ? m.metrics : {},
          totals: m.totals && typeof m.totals === "object" ? m.totals : {},
          actualTotal: typeof m.totals?.actualTotal === "number" ? m.totals.actualTotal : null,
          forecastTotal: typeof m.totals?.forecastTotal === "number" ? m.totals.forecastTotal : null,
          difference: typeof m.totals?.difference === "number" ? m.totals.difference : null,
          differencePercentage: typeof m.totals?.differencePercentage === "number" ? m.totals.differencePercentage : null,
          evaluationRecordCount: typeof m.evaluationRecordCount === "number" ? m.evaluationRecordCount : 0,
          actualDataCoverage: typeof m.actualDataCoverage === "number" ? m.actualDataCoverage : null,
          chartSeries: m.chartData && typeof m.chartData === "object" ? m.chartData : {},
          modelArtifactPath: m.modelArtifactPath ? String(m.modelArtifactPath) : null,
          errorMessage: m.error ? String(m.error) : null,
          createdAt: new Date(),
        });
      } catch (insertModelErr: any) {
        console.warn(`[modelValidationRepository] Failed to insert result for model ${modelId}:`, insertModelErr?.message || insertModelErr);
      }
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
