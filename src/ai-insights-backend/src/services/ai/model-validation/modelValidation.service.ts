import { IModelValidationService, ValidateModelsInput } from "./modelValidation.service.interface";
import { ProjectService } from "../../project/project.service";
import { WorkspaceService } from "../../project/workspace.service";
import { IModelValidationRepository } from "../../../repositories/modelValidation.repository.interface";
import { IAgentThinkingService } from "../agent-thinking/agentThinking.service.interface";
import { ModelValidationAgent } from "../../../agents/ModelTrainingValidation/ModelValidation/modelValidationAgent";
import { IngestionServices } from "../../../agents/state";
import { AgentTraceHelper } from "../../../agents/utils/agentUtils";
import * as fs from "fs";
import * as path from "path";
import { getProjectDirectory } from "../../../agents/tools/filesystem/mcpFilesystemClient";
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
      projectName: project.projectName,
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
      projectName: project.projectName,
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
      const existingStageOutputs = ((project.agentState as any)?.stageOutputs || {});
      const updatedAgentState = {
        ...((project.agentState as any) || {}),
        modelValidation: output,
        stageOutputs: {
          ...existingStageOutputs,
          modelTrainingCodeNode: {
            ...(existingStageOutputs?.modelTrainingCodeNode || {}),
            modelValidation: output,
          },
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
      const modelValidation = state.stageOutputs?.modelTrainingCodeNode?.modelValidation;
      if (state.modelValidation || modelValidation) {
        return state.modelValidation || modelValidation;
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
    let mtOutput =
      state.stageOutputs?.modelTrainingCodeNode ||
      state.modelTrainingCodeNode ||
      state.stageOutputs?.modelTraining ||
      state.modelTraining ||
      state.stageOutputs?.modelTrainingExecutionNode ||
      state.modelTrainingExecutionNode ||
      state.stageOutputs?.modelTrainingNode ||
      state.modelTrainingNode;

    let trainingReport: any =
      mtOutput?.report ||
      state.modelTrainingReport ||
      state.stageOutputs?.modelTrainingReport ||
      state.report;

    // 1. If not found in current agentState, check project runs in DB
    if (!trainingReport && !mtOutput?.candidates?.length && !mtOutput?.executedModels?.length) {
      try {
        const runs = await this.projectService.getProjectRuns(project.id);
        for (const run of runs) {
          const runState = (run.agentState as any) || {};
          const runMt =
            runState.stageOutputs?.modelTrainingCodeNode ||
            runState.modelTrainingCodeNode ||
            runState.stageOutputs?.modelTraining ||
            runState.modelTraining;
          if (runMt?.report || runMt?.candidates?.length || runMt?.executedModels?.length) {
            mtOutput = runMt;
            trainingReport = runMt.report || runState.report;
            break;
          }
        }
      } catch (runErr) {
        console.warn(`[ModelValidationService] Run check warning:`, runErr);
      }
    }

    // 2. If not found in DB, check disk folder for model_training_report.json
    if (!trainingReport && !mtOutput?.candidates?.length && !mtOutput?.executedModels?.length) {
      try {
        const workspace = project.workspaceId
          ? await this.workspaceService.getWorkspaceById(project.workspaceId)
          : null;
        const workspaceName = workspace?.name || "Default_Workspace";
        const projectDir = getProjectDirectory({
          projectId: project.id,
          projectName: project.projectName,
          workspaceName,
        });

        const findReportRecursive = (dir: string, depth = 0): any | null => {
          if (depth > 4 || !fs.existsSync(dir)) return null;
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const ent of entries) {
            const fullPath = path.join(dir, ent.name);
            if (ent.isFile() && ent.name === "model_training_report.json") {
              try {
                return JSON.parse(fs.readFileSync(fullPath, "utf-8"));
              } catch {}
            } else if (ent.isDirectory() && !ent.name.startsWith(".")) {
              const res = findReportRecursive(fullPath, depth + 1);
              if (res) return res;
            }
          }
          return null;
        };

        const diskReport = findReportRecursive(projectDir);
        if (diskReport) {
          trainingReport = diskReport;
        }
      } catch (fsErr) {
        console.warn(`[ModelValidationService] Disk report check warning:`, fsErr);
      }
    }

    // Extract raw candidates
    const rawCandidates =
      (Array.isArray(mtOutput?.executedModels) && mtOutput.executedModels.length > 0 ? mtOutput.executedModels : null) ||
      (Array.isArray(mtOutput?.rankedCandidates) && mtOutput.rankedCandidates.length > 0 ? mtOutput.rankedCandidates : null) ||
      (Array.isArray(mtOutput?.candidates) && mtOutput.candidates.length > 0 ? mtOutput.candidates : null) ||
      (Array.isArray(trainingReport?.models_evaluated) && trainingReport.models_evaluated.length > 0 ? trainingReport.models_evaluated : null) ||
      (Array.isArray(trainingReport?.ranked_models) && trainingReport.ranked_models.length > 0 ? trainingReport.ranked_models : null) ||
      (Array.isArray(trainingReport?.model_results) && trainingReport.model_results.length > 0 ? trainingReport.model_results : null) ||
      (Array.isArray(trainingReport?.candidate_model_results) && trainingReport.candidate_model_results.length > 0 ? trainingReport.candidate_model_results : null) ||
      (Array.isArray(trainingReport?.runs) && trainingReport.runs.length > 0 ? trainingReport.runs : null) ||
      (Array.isArray(trainingReport?.leaderboard) && trainingReport.leaderboard.length > 0 ? trainingReport.leaderboard : null) ||
      (Array.isArray(trainingReport?.candidates) && trainingReport.candidates.length > 0 ? trainingReport.candidates : null) ||
      (Array.isArray(trainingReport?.trained_models) && trainingReport.trained_models.length > 0 ? trainingReport.trained_models : null) ||
      (trainingReport?.model_results && typeof trainingReport.model_results === "object" ? trainingReport.model_results : null) ||
      (trainingReport?.candidate_model_results && typeof trainingReport.candidate_model_results === "object" ? trainingReport.candidate_model_results : null) ||
      (Array.isArray(trainingReport?.candidate_models_evaluated) && trainingReport.candidate_models_evaluated.length > 0 ? trainingReport.candidate_models_evaluated : null) ||
      (Array.isArray(state.stageOutputs?.modelSelectionNode?.candidates) && state.stageOutputs.modelSelectionNode.candidates.length > 0 ? state.stageOutputs.modelSelectionNode.candidates : null) ||
      (Array.isArray(state.modelSelectionNode?.candidates) && state.modelSelectionNode.candidates.length > 0 ? state.modelSelectionNode.candidates : null) ||
      (Array.isArray(state.stageOutputs?.modelSelection?.candidates) && state.stageOutputs.modelSelection.candidates.length > 0 ? state.stageOutputs.modelSelection.candidates : null) ||
      (Array.isArray(state.modelSelection?.candidates) && state.modelSelection.candidates.length > 0 ? state.modelSelection?.candidates : null) ||
      [];

    const normalizeCandidate = (c: any, defaultKey?: string) => {
      if (typeof c === "string") {
        return {
          model_id: c,
          displayName: c,
          framework: "—",
          score: undefined,
        };
      }
      const model_id = c?.model_id || c?.id || c?.name || c?.model_name || defaultKey || "";
      const displayName = c?.displayName || c?.display_name || c?.algorithm || c?.name || model_id;
      const framework = c?.framework || "—";
      const score = typeof c?.score === "number" ? c.score : c?.metrics?.score ?? c?.metrics?.test?.score ?? c?.metrics?.validation?.score;
      return { model_id, displayName, framework, score };
    };

    let normalizedCandidates: any[] = [];
    if (Array.isArray(rawCandidates)) {
      normalizedCandidates = rawCandidates.map((c: any) => normalizeCandidate(c)).filter((c) => Boolean(c.model_id));
    } else if (rawCandidates && typeof rawCandidates === "object") {
      normalizedCandidates = Object.entries(rawCandidates).map(([k, v]: [string, any]) =>
        normalizeCandidate(v && typeof v === "object" ? v : { model_id: k }, k)
      ).filter((c) => Boolean(c.model_id));
    }

    const championModelId =
      mtOutput?.selectedModel ||
      trainingReport?.best_model_id ||
      trainingReport?.champion_model_id ||
      trainingReport?.selected_model ||
      (typeof trainingReport?.best_model === "string" ? trainingReport.best_model : trainingReport?.best_model?.model_id) ||
      (typeof trainingReport?.champion_model === "string" ? trainingReport.champion_model : trainingReport?.champion_model?.model_id) ||
      (typeof trainingReport?.selected_model === "string" ? trainingReport.selected_model : trainingReport?.selected_model?.model_id) ||
      (normalizedCandidates[0]?.model_id ?? null);

    return {
      projectId: project.id,
      candidates: normalizedCandidates,
      trainingReportSummary: trainingReport?.summary || null,
      championModelId,
    };
  }
}
