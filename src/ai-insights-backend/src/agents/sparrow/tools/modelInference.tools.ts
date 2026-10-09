import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { IModelValidationService } from "../../../services/ai/model-validation/modelValidation.service.interface";
import { ProjectService } from "../../../services/project/project.service";
import { VALID_FREQUENCY_VALUES } from "../../../constants/modelValidation.constants";
import { forecastWindow, selectForecastPeriods } from "../forecastWindow";

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
        const rawCandidates = candidateInfo?.candidates || [];
        const candidates = Array.isArray(rawCandidates)
          ? rawCandidates
          : typeof rawCandidates === "object" && rawCandidates !== null
            ? Object.entries(rawCandidates).map(([key, val]: [string, any]) => ({
                model_id: val?.model_id || val?.id || key,
                displayName: val?.displayName || val?.display_name || val?.model_name || key,
                framework: val?.framework || "custom",
                score: val?.best_metric_score || val?.score || null,
                ...val,
              }))
            : [];
        const championModelId = candidateInfo?.championModelId || null;

        return {
          success: true,
          projectId,
          championModelId,
          models: candidates.map((c: any) => ({
            modelId: c.model_id || c.id || String(c),
            displayName: c.displayName || c.model_name || c.model_id || String(c),
            framework: c.framework || "custom",
            isChampion: (c.model_id || c.id) === championModelId,
          })),
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
      description: "Discovers model IDs and names available for inference and identifies the training champion. Does not load validation reports.",
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
      requestedStartDate,
      predictionHorizon,
      predictionFrequency,
      selectedModels,
    }: {
      predictionObjectiveStartDate: string;
      requestedStartDate: string;
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
        const rawCandidates = candidateInfo?.candidates ?? [];
        const candidates = Array.isArray(rawCandidates)
          ? rawCandidates
          : typeof rawCandidates === "object" && rawCandidates !== null
            ? Object.entries(rawCandidates).map(([key, val]: [string, any]) => ({
                model_id: val?.model_id || val?.id || key,
                ...val,
              }))
            : [];
        const availableIds = candidates.map((model: any) => model.model_id || model.id || String(model));
        if (!modelsToRun.length || modelsToRun.some((id) => !availableIds.includes(id))) {
          return { success: false, error: "Select supported model IDs from the discovered project models." };
        }

        const window = forecastWindow(predictionObjectiveStartDate, requestedStartDate, predictionHorizon, predictionFrequency);

        const result = await services.modelValidationService.validateModels({
          projectId,
          predictionObjectiveStartDate: window.executionStart.toISOString().slice(0, 10),
          predictionHorizon: window.executionHorizon,
          predictionFrequency,
          selectedModels: modelsToRun,
          executionMode: "future_prediction",
        });

        const report = result.report || {};
        if (result.status !== "Completed") return { success: false, error: result.error || "Model inference did not complete." };
        const rankedModels = report.ranked_models || Object.values(report.model_results || {});
        if (!rankedModels.length) return { success: false, error: "Inference returned no model predictions." };
        if (modelsToRun.some(id => !rankedModels.some((model: any) => (model.model_id || model.modelId) === id && model.status !== "Failed"))) {
          return { success: false, error: "Inference did not return predictions for every selected model." };
        }

        return {
          success: result.status === "Completed",
          targetColumn: report.target_column,
          predictionHorizon,
          predictionFrequency,
          startDate: window.displayStart.toISOString().slice(0, 10),
          endDate: new Date(window.displayEnd.getTime() - 86400000).toISOString().slice(0, 10),
          executionWindow: { startDate: window.executionStart.toISOString().slice(0, 10), horizon: window.executionHorizon, bridgePeriods: window.bridgePeriods },
          championModel: report.champion_model_id || modelsToRun[0],
          modelResults: rankedModels.filter((m: any) => modelsToRun.includes(m.model_id || m.modelId)).map((m: any) => {
            const periods = selectForecastPeriods(m.chartData, window.displayStart, window.displayEnd, predictionHorizon, predictionFrequency);
            return { modelId: m.model_id || m.modelId, periods,
              forecastTotal: periods.reduce((sum: number, row: any) => sum + row.predicted, 0) };
          }),
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
      description: "Forecasts the trained target across any data gap, then returns only the requested periods and their totals. Inspect date coverage first. Segment filters and changed-feature scenarios are unsupported.",
      schema: z.object({
        predictionObjectiveStartDate: z.string().describe("Execution origin: first period after observed history, verified with a MAX(date) query; YYYY-MM-DD. Never use a stale project objective."),
        requestedStartDate: z.string().describe("First period the user wants displayed, from the resolved request; YYYY-MM-DD."),
        historyEvidenceIndex: z.number().int().nonnegative().describe("Index in toolResults of the successful queryProjectData MAX(date) coverage query."),
        historyEndColumn: z.string().min(1).describe("Exact column alias for the latest observed date in that query result."),
        predictionHorizon: z.number().int().positive().max(1000).describe("Number of periods to DISPLAY. The tool extends execution to cover the gap before requestedStartDate."),
        predictionFrequency: z.enum(VALID_FREQUENCY_VALUES).describe("Explicit forecast frequency supported by the validation engine."),
        selectedModels: z.array(z.string()).min(1).describe("Exact model IDs chosen from discovery results; respect the user selection."),
      }).strict(),
    }
  );
