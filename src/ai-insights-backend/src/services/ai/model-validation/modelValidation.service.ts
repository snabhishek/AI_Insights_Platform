import { IModelValidationService, ValidateModelsInput } from "./modelValidation.service.interface";
import { ProjectService } from "../../project/project.service";
import { WorkspaceService } from "../../project/workspace.service";
import { IModelValidationRepository } from "../../../repositories/modelValidation.repository.interface";
import { IAgentThinkingService } from "../agent-thinking/agentThinking.service.interface";
import { ModelValidationAgent } from "../../../agents/ModelTrainingValidation/ModelValidation/modelValidationAgent";
import { IngestionServices } from "../../../agents/state";
import { AgentTraceHelper } from "../../../agents/utils/agentUtils";
import {
  VALIDATION_ERROR_MESSAGES,
  VALIDATION_PIPELINE_CONSTANTS,
  VALID_FREQUENCY_VALUES,
} from "../../../constants/modelValidation.constants";

export class ModelValidationService implements IModelValidationService {
  constructor(
    private readonly projectService: ProjectService,
    private readonly workspaceService: WorkspaceService,
    private readonly modelValidationRepository: IModelValidationRepository,
    private readonly agentThinkingService: IAgentThinkingService
  ) {}

  public async validateModels(input: ValidateModelsInput): Promise<any> {

    if (!input.projectId || typeof input.projectId !== "string" || input.projectId.trim().length === 0) {
      throw new Error(VALIDATION_ERROR_MESSAGES.MISSING_PROJECT_ID);
    }

    if (
      !input.predictionObjectiveStartDate ||
      typeof input.predictionObjectiveStartDate !== "string" ||
      input.predictionObjectiveStartDate.trim().length === 0
    ) {
      throw new Error(VALIDATION_ERROR_MESSAGES.MISSING_START_DATE);
    }

    if (
      input.predictionHorizon === undefined ||
      input.predictionHorizon === null ||
      typeof input.predictionHorizon !== "number" ||
      input.predictionHorizon <= 0 ||
      !Number.isInteger(input.predictionHorizon)
    ) {
      throw new Error(VALIDATION_ERROR_MESSAGES.INVALID_HORIZON);
    }

    if (
      !input.predictionFrequency ||
      typeof input.predictionFrequency !== "string" ||
      !VALID_FREQUENCY_VALUES.includes(input.predictionFrequency as any)
    ) {
      throw new Error(VALIDATION_ERROR_MESSAGES.INVALID_FREQUENCY);
    }

    if (
      !input.selectedModels ||
      !Array.isArray(input.selectedModels) ||
      input.selectedModels.length === 0
    ) {
      throw new Error(VALIDATION_ERROR_MESSAGES.MISSING_SELECTED_MODELS);
    }

    const project = await this.projectService.getById(input.projectId.trim());
    if (!project) {
      throw new Error(VALIDATION_ERROR_MESSAGES.PROJECT_NOT_FOUND);
    }

    const workspace = project.workspaceId ? await this.workspaceService.getWorkspaceById(project.workspaceId) : null;
    const resolvedWorkspaceName =
      workspace?.name ||
      (project.agentState as any)?.workspaceName ||
      (project as any).workspaceName ||
      "Forecasting";

    const state = {
      ...((project.agentState as any) || {}),
      projectId: project.id,
      projectName: project.name,
      workspaceName: resolvedWorkspaceName,
      selectedModels: input.selectedModels,
      predictionHorizon: input.predictionHorizon,
      predictionFrequency: input.predictionFrequency,
      predictionObjectiveStartDate: input.predictionObjectiveStartDate.trim(),
    };

    const services = {
      projectService: this.projectService,
      agentThinkingService: this.agentThinkingService,
      projectId: project.id,
      projectName: project.name,
      workspaceName: resolvedWorkspaceName,
      runTimestamp: state.runTimestamp || (project.agentState as any)?.runTimestamp || "",
      pipeline: VALIDATION_PIPELINE_CONSTANTS.PIPELINE_NAME,
      traceHelper: new AgentTraceHelper(),
      onThinkingUpdate: async () => {},
    } as unknown as IngestionServices;

    const output = await ModelValidationAgent.execute(state as any, services, {
      predictionHorizon: input.predictionHorizon,
      predictionFrequency: input.predictionFrequency,
      predictionObjectiveStartDate: input.predictionObjectiveStartDate.trim(),
      selectedModels: input.selectedModels,
      filters: input.filters,
      executionMode: input.executionMode,
      maxRetries: VALIDATION_PIPELINE_CONSTANTS.DEFAULT_MAX_RETRIES,
    });

    if (output.report) {
      try {
        const runId = output.report.validation_run_id || `val-${state.runTimestamp || Date.now()}`;
        await this.modelValidationRepository.saveValidationRun(
          runId,
          project.id,
          output.report,
          output.validationDirectory || "",
          output.predictionsArtifact
        );
      } catch (persistErr: any) {
        console.warn(`[ModelValidationService] Database persistence warning:`, persistErr?.message || persistErr);
      }
    }

    try {
      const updatedAgentState = {
        ...((project.agentState as any) || {}),
        modelValidation: output,
        stageOutputs: {
          ...((project.agentState as any)?.stageOutputs || {}),
          modelValidation: output,
        },
      };
      await this.projectService.updateProject(project.id, { agentState: updatedAgentState });
    } catch (updateErr: any) {
      console.warn(`[ModelValidationService] Project state update warning:`, updateErr?.message || updateErr);
    }

    return output;
  }

  public async getValidationResults(projectId: string): Promise<any> {
    if (!projectId || typeof projectId !== "string") {
      throw new Error(VALIDATION_ERROR_MESSAGES.MISSING_PROJECT_ID);
    }

    const latestRun = await this.modelValidationRepository.getLatestValidationRunByProject(projectId.trim());
    if (latestRun) {
      return latestRun;
    }

    const project = await this.projectService.getById(projectId.trim());
    if (project?.agentState) {
      const state = project.agentState as any;
      if (state.modelValidation || state.stageOutputs?.modelValidation) {
        return state.modelValidation || state.stageOutputs?.modelValidation;
      }
    }

    return null;
  }

  public async getValidationCandidates(projectId: string): Promise<any> {
    if (!projectId || typeof projectId !== "string") {
      throw new Error(VALIDATION_ERROR_MESSAGES.MISSING_PROJECT_ID);
    }

    const project = await this.projectService.getById(projectId.trim());
    if (!project) {
      throw new Error(VALIDATION_ERROR_MESSAGES.PROJECT_NOT_FOUND);
    }

    const state = (project.agentState as any) || {};
    const trainingReport = state.modelTraining?.report || state.stageOutputs?.modelTraining?.report;
    const rawCandidates =
      trainingReport?.ranked_models ||
      trainingReport?.model_results ||
      trainingReport?.candidate_model_results ||
      state.modelSelection?.candidates ||
      state.stageOutputs?.modelSelection?.candidates ||
      [];

    const candidates = Array.isArray(rawCandidates)
      ? rawCandidates
      : typeof rawCandidates === "object" && rawCandidates !== null
        ? Object.entries(rawCandidates).map(([key, val]: [string, any]) => ({
            model_id: val?.model_id || val?.id || key,
            displayName: val?.displayName || val?.display_name || val?.model_name || key,
            framework: val?.framework || val?.training_metadata?.framework || "custom",
            score: val?.best_metric_score || val?.score || val?.suitability_score || null,
            ...val,
          }))
        : [];

    const championModelId =
      trainingReport?.champion_model_id ||
      trainingReport?.best_model_id ||
      state.modelTraining?.best_model_id ||
      state.modelSelection?.selectedModelId ||
      null;

    return {
      projectId: project.id,
      candidates,
      trainingReportSummary: trainingReport?.summary || null,
      championModelId,
    };
  }
}
