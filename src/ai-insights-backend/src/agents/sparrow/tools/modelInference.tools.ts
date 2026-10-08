import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { IModelValidationService } from "../../../services/ai/model-validation/modelValidation.service.interface";
import { ProjectService } from "../../../services/project/project.service";
import { VALID_FREQUENCY_VALUES } from "../../../constants/modelValidation.constants";

export interface ModelInferenceToolServices {
  projectService: ProjectService;
  modelValidationService: IModelValidationService;
}

export const createDiscoverAvailableModelsTool = (
  projectId: string,
  services: ModelInferenceToolServices
) =>
  tool(
    async () => {
      try {
        if (!projectId) {
          return { success: false, error: "No projectId provided for model discovery." };
        }

        const candidateInfo = await services.modelValidationService.getValidationCandidates(projectId);
        const candidates = candidateInfo?.candidates || [];
        const championModelId = candidateInfo?.championModelId || null;

        const project = await services.projectService.getById(projectId);
        const agentState = (project?.agentState || {}) as any;
        const validation = agentState.modelValidation || agentState.stageOutputs?.modelValidation;

        return {
          success: true,
          projectId,
          championModelId,
          models: candidates.map((c: any) => ({
            modelId: c.model_id || c.id || String(c),
            displayName: c.displayName || c.model_name || c.model_id || String(c),
            framework: c.framework || "custom",
            isChampion: (c.model_id || c.id) === championModelId,
            score: c.score || c.suitability_score || null,
          })),
          hasCompletedValidation: Boolean(validation?.report || validation?.status === "Completed"),
        };
      } catch (err: any) {
        return {
          success: false,
          error: err?.message || String(err),
          models: [],
        };
      }
    },
    {
      name: "discoverAvailableModels",
      description: "Discovers all trained and candidate ML models for the project, identifying the champion model and evaluation status.",
      schema: z.object({}),
    }
  );

export const createGetModelValidationResultsTool = (
  projectId: string,
  services: ModelInferenceToolServices
) =>
  tool(
    async () => {
      try {
        if (!projectId) {
          return { success: false, error: "No projectId provided." };
        }

        const run = await services.modelValidationService.getValidationResults(projectId);
        if (!run) {
          return {
            success: false,
            message: "No validation results or predictions found for this project yet.",
          };
        }

        const modelsList = run.results || run.ranked_models || run.report?.ranked_models || [];
        const championId = run.championModelId || run.champion_model_id;

        return {
          success: true,
          validationRunId: run.id || run.validation_run_id,
          status: run.status,
          evaluationMode: run.evaluationMode || run.mode,
          horizon: run.predictionObjectiveHorizon || run.prediction_objective_horizon,
          frequency: run.predictionObjectiveFrequency || run.prediction_objective_frequency,
          startDate: run.predictionObjectiveStartDate || run.prediction_objective_start_date,
          championModelId: championId,
          coveragePercentage: run.actualDataCoverage || run.coverage_percentage,
          chartData: run.chartData || null,
          modelsSummary: modelsList.map((m: any) => ({
            modelId: m.modelId || m.model_id,
            displayName: m.displayName || m.modelId || m.model_id,
            score: m.score,
            totals: m.totals,
            primaryMetricName: m.primaryMetricName,
            actualTotal: m.actualTotal,
            forecastTotal: m.forecastTotal,
            differencePercentage: m.differencePercentage,
          })),
        };
      } catch (err: any) {
        return {
          success: false,
          error: err?.message || String(err),
        };
      }
    },
    {
      name: "getModelValidationResults",
      description: "Retrieves latest validation results, forecast totals, metric comparisons, and backtest accuracy for trained models.",
      schema: z.object({}),
    }
  );

export const createRunModelInferenceTool = (
  projectId: string,
  services: ModelInferenceToolServices
) =>
  tool(
    async ({
      predictionObjectiveStartDate,
      predictionHorizon,
      predictionFrequency,
      selectedModels,
    }: {
      predictionObjectiveStartDate?: string;
      predictionHorizon: number;
      predictionFrequency: string;
      selectedModels: string[];
    }) => {
      try {
        if (!projectId) {
          return { success: false, error: "No projectId provided for inference execution." };
        }

        const modelsToRun = selectedModels;
        const candidateInfo = await services.modelValidationService.getValidationCandidates(projectId);
        const availableIds = (candidateInfo?.candidates ?? []).map((model: any) => model.model_id || model.id);
        if (!modelsToRun.length || modelsToRun.some((id) => !availableIds.includes(id))) {
          return { success: false, error: "Select supported model IDs from the discovered project models." };
        }

        const project = await services.projectService.getById(projectId);
        const agentState = (project?.agentState || {}) as any;
        const resolvedStartDate =
          predictionObjectiveStartDate ||
          agentState.predictionObjectiveStartDate ||
          agentState.splitDate;
        if (!resolvedStartDate) return { success: false, error: "Prediction start date is required; specify it or configure the project objective." };

        const result = await services.modelValidationService.validateModels({
          projectId,
          predictionObjectiveStartDate: resolvedStartDate,
          predictionHorizon,
          predictionFrequency,
          selectedModels: modelsToRun,
        });

        const report = result.report || {};
        const rankedModels = report.ranked_models || [];

        return {
          success: result.status === "Completed",
          status: result.status,
          summary: result.summary,
          predictionHorizon,
          predictionFrequency,
          startDate: resolvedStartDate,
          championModel: report.champion_model_id || modelsToRun[0],
          modelResults: rankedModels.map((m: any) => ({
            modelId: m.model_id || m.modelId,
            score: m.score,
            totals: m.totals,
            chartData: m.chartData,
          })),
        };
      } catch (err: any) {
        return {
          success: false,
          error: err?.message || String(err),
        };
      }
    },
    {
      name: "runModelInference",
      description: "Executes full-project predictions for the trained target, explicit horizon, supported frequency and discovered model IDs. Segment filters and changed-feature scenarios are not supported by the current inference engine.",
      schema: z.object({
        predictionObjectiveStartDate: z.string().optional().describe("Prediction start date in YYYY-MM-DD format."),
        predictionHorizon: z.number().int().positive().max(1000).describe("Number of periods to forecast ahead (e.g. 4 for 4 weeks or 4 months)."),
        predictionFrequency: z.enum(VALID_FREQUENCY_VALUES).describe("Explicit forecast frequency supported by the validation engine."),
        selectedModels: z.array(z.string()).min(1).describe("Exact model IDs chosen from discovery results; respect the user selection."),
      }).strict(),
    }
  );
