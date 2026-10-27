import path from "path";
import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import type { BaseCheckpointSaver } from "@langchain/langgraph";
import { getProjectDatasetDir, sanitizeFolderName } from "../../../config/fileServer.config";
import { getProjectDirectory } from "../../../agents/tools/filesystem/mcpFilesystemClient";
import { buildGroupedStageStatuses, normalizeFlatStageStatuses } from "../../../agents/pipelineNames";
import { invokeModelTrainingGraph, createModelTrainingGraph } from "../../../agents/ModelLifecycle/training/graph";
import { invokeModelValidationGraph, createModelValidationGraph } from "../../../agents/ModelLifecycle/validation/graph";
import type { LifecycleInput, LifecycleRunResult } from "../../../agents/ModelLifecycle/contracts";
import type { Project } from "../../../models/project.types";
import { ProjectService } from "../../project/project.service";

type LifecycleStage = "training" | "validation";

interface RunLifecycleInput {
  projectId: string;
  selectedModels: string[];
  validationOptions?: {
    predictionObjectiveStartDate: string;
    predictionHorizon: number;
    predictionFrequency: string;
    filters?: Record<string, unknown>;
  };
}

type LifecycleAgentState = Record<string, unknown>;

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function getLifecycleStageStatus(state: LifecycleAgentState, stage: string): unknown {
  const statuses = asRecord(state.stageStatuses);
  const groupedStatuses = asRecord(statuses.modelTrainingValidation);
  const value = statuses[stage] ?? groupedStatuses[stage];
  return asRecord(value).status ?? value;
}

function isWaitingForApproval(status: unknown): boolean {
  return status === "User Input" || status === "Awaiting Approval";
}

export function resolvePendingLifecycleStage(state: LifecycleAgentState): LifecycleStage | undefined {
  const trainingResult = asRecord(asRecord(state.modelLifecycle).training);
  const validationResult = asRecord(asRecord(state.modelLifecycle).validation);
  const trainingStatus = getLifecycleStageStatus(state, "modelTrainingCodeNode");
  const validationStatus = getLifecycleStageStatus(state, "modelValidation");

  if (isWaitingForApproval(validationStatus)) return "validation";
  if (isWaitingForApproval(trainingStatus)) return "training";

  const preflightStatus = getLifecycleStageStatus(state, "preFlightNode");
  if (preflightStatus === "Completed" &&
      trainingResult.status !== "Completed" &&
      trainingResult.status !== "Partial") {
    return "training";
  }
  if ((trainingResult.status === "Completed" || trainingResult.status === "Partial") &&
      validationResult.status !== "Completed" &&
      validationResult.status !== "Partial") {
    return "validation";
  }
  return undefined;
}

function getSelectedModels(state: LifecycleAgentState): string[] {
  const stageOutputs = asRecord(state.stageOutputs);
  const trainingConfigurationOutput = asRecord(stageOutputs.trainingConfigurationNode);
  const trainingConfiguration = asRecord(trainingConfigurationOutput.configuration || state.trainingConfiguration);
  const modelSelection = asRecord(trainingConfiguration.model_selection);
  const modelSelectionOutput = asRecord(stageOutputs.modelSelectionNode);
  const savedModelSelection = asRecord(state.modelSelection);
  const selected = [
    ...(Array.isArray(state.selectedModels) ? state.selectedModels : []),
    ...(Array.isArray(modelSelectionOutput.selectedModels) ? modelSelectionOutput.selectedModels : []),
    ...(Array.isArray(savedModelSelection.userSelection) ? savedModelSelection.userSelection : []),
    ...(Array.isArray(trainingConfigurationOutput.models) ? trainingConfigurationOutput.models : []),
    ...(Array.isArray(trainingConfiguration.models) ? trainingConfiguration.models : []),
    ...(Array.isArray(modelSelection.models) ? modelSelection.models : []),
  ];
  return Array.from(new Set(selected.map((model) => {
    if (typeof model === "string") return model.trim();
    const candidate = asRecord(model);
    const modelId = candidate.model_id ?? candidate.modelId ?? candidate.id;
    return typeof modelId === "string" ? modelId.trim() : "";
  }).filter(Boolean)));
}

function getValidationOptions(state: LifecycleAgentState): RunLifecycleInput["validationOptions"] {
  const savedOptions = asRecord(state.validationOptions);
  const date = savedOptions.predictionObjectiveStartDate ||
    state.predictionObjectiveStartDate ||
    state.splitEndDate ||
    state.splitDate;
  const horizon = savedOptions.predictionHorizon ?? state.predictionHorizon;
  const frequency = savedOptions.predictionFrequency ?? state.predictionFrequency;
  if (typeof date !== "string" || !date.trim() ||
      typeof horizon !== "number" || !Number.isInteger(horizon) || horizon <= 0 ||
      typeof frequency !== "string" || !["Weekly", "Monthly", "Yearly"].includes(frequency)) {
    throw new Error("Saved validation date, horizon, and frequency are required before approving model validation.");
  }
  return {
    predictionObjectiveStartDate: date.trim(),
    predictionHorizon: horizon,
    predictionFrequency: frequency,
    filters: asRecord(savedOptions.filters),
  };
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`The project is missing required lifecycle context: ${field}.`);
  }
  return value.trim();
}

export async function prepareLifecycleDirectory(
  runDirectory: string,
  projectName: string,
  stage: LifecycleStage
): Promise<string> {
  const resolvedRunDirectory = path.resolve(runDirectory);
  const projectDirectory = path.resolve(
    resolvedRunDirectory,
    sanitizeFolderName(`${projectName}_model_${stage}`)
  );
  const relativeLifecycleDirectory = path.relative(resolvedRunDirectory, projectDirectory);
  if (!relativeLifecycleDirectory || relativeLifecycleDirectory === ".." ||
      relativeLifecycleDirectory.startsWith(`..${path.sep}`) || path.isAbsolute(relativeLifecycleDirectory)) {
    throw new Error("The lifecycle project directory must remain inside the active project run.");
  }
  await fs.mkdir(projectDirectory, { recursive: true });
  for (const entry of await fs.readdir(projectDirectory)) {
    await fs.rm(path.join(projectDirectory, entry), { recursive: true, force: false });
  }
  return projectDirectory;
}

export class ModelLifecycleService {
  private readonly activeRuns = new Set<string>();

  constructor(
    private readonly projectService: ProjectService,
    private readonly checkpointer: BaseCheckpointSaver
  ) {}

  async runTraining(input: RunLifecycleInput): Promise<LifecycleRunResult> {
    return this.run("training", input);
  }

  async runValidation(input: RunLifecycleInput): Promise<LifecycleRunResult> {
    if (!input.validationOptions) {
      throw new Error("Validation options are required to run model validation.");
    }
    return this.run("validation", input);
  }

  async approvePending(projectId: string, approved: boolean): Promise<LifecycleRunResult | undefined> {
    if (this.activeRuns.has(projectId)) {
      throw new Error(`A model lifecycle is already running for project ${projectId}.`);
    }
    const project = await this.projectService.getById(projectId);
    if (!project) throw new Error(`Project ${projectId} was not found.`);
    const state = asRecord(project.agentState);
    const stage = resolvePendingLifecycleStage(state);
    if (!stage) {
      throw new Error("No model lifecycle step is currently waiting for approval.");
    }

    if (!approved) {
      const updated = await this.projectService.updateAgentState(projectId, {
        ...state,
        status: "Paused",
        summary: `Approval for model ${stage} was declined.`,
        message: `Approval for model ${stage} was declined.`,
      });
      if (!updated) throw new Error(`Failed to persist the declined model ${stage} approval.`);
      return undefined;
    }

    const selectedModels = getSelectedModels(state);
    if (selectedModels.length === 0 && stage === "validation") {
      const training = asRecord(asRecord(state.modelLifecycle).training);
      const candidates = Array.isArray(training.candidates) ? training.candidates : [];
      selectedModels.push(...candidates
        .map((candidate) => asRecord(candidate))
        .filter((candidate) => candidate.status === "Completed" && typeof candidate.modelId === "string")
        .map((candidate) => candidate.modelId as string));
    }
    if (selectedModels.length === 0) {
      throw new Error("No selected models are saved in the project state.");
    }

    return stage === "training"
      ? this.runTraining({ projectId, selectedModels })
      : this.runValidation({ projectId, selectedModels, validationOptions: getValidationOptions(state) });
  }

  async getResult(projectId: string, stage: LifecycleStage): Promise<LifecycleRunResult | undefined> {
    const project = await this.projectService.getById(projectId);
    if (!project) throw new Error(`Project ${projectId} was not found.`);
    const state = asRecord(project.agentState);
    const lifecycle = asRecord(state.modelLifecycle);
    const result = lifecycle[stage];
    return result && typeof result === "object"
      ? result as LifecycleRunResult
      : undefined;
  }

  private async run(stage: LifecycleStage, input: RunLifecycleInput): Promise<LifecycleRunResult> {
    const runKey = input.projectId;
    if (this.activeRuns.has(runKey)) {
      throw new Error(`A model lifecycle is already running for project ${input.projectId}.`);
    }
    this.activeRuns.add(runKey);
    try {
      return await this.runExclusive(stage, input);
    } finally {
      this.activeRuns.delete(runKey);
    }
  }

  private async runExclusive(stage: LifecycleStage, input: RunLifecycleInput): Promise<LifecycleRunResult> {
    if (!Array.isArray(input.selectedModels) || input.selectedModels.length === 0 ||
        input.selectedModels.some((model) => typeof model !== "string" || model.trim().length === 0)) {
      throw new Error("At least one non-empty selected model ID is required.");
    }
    const selectedModels = Array.from(new Set(input.selectedModels.map((model) => model.trim())));
    const project = await this.projectService.getById(input.projectId);
    if (!project) throw new Error(`Project ${input.projectId} was not found.`);
    const projectWithWorkspace = await this.projectService.getProjectWithWorkspace(project.id);
    const workspaceName = requireNonEmptyString(projectWithWorkspace?.workspaceName, "workspaceName");
    const projectName = requireNonEmptyString(project.projectName || project.name, "projectName");
    const state = asRecord(project.agentState);
    const runTimestamp = requireNonEmptyString(state.runTimestamp, "runTimestamp");
    if (!/^[A-Za-z0-9_-]+$/.test(runTimestamp)) {
      throw new Error("The project run timestamp contains unsupported path characters.");
    }

    const projectRoot = getProjectDirectory({
      projectId: project.id,
      projectName,
      workspaceName,
      folderPath: project.folderPath,
    });
    const runDirectory = path.join(projectRoot, runTimestamp);
    const projectDirectory = await prepareLifecycleDirectory(runDirectory, projectName, stage);
    const stageOutputs = asRecord(state.stageOutputs);
    const trainingResult = asRecord(asRecord(state.modelLifecycle).training);
    const additionalProjectDirectories: string[] = [];
    if (stage === "validation") {
      const trainingDirectory = path.resolve(requireNonEmptyString(trainingResult.projectDirectory, "trainingResult.projectDirectory"));
      const relativeTrainingDirectory = path.relative(path.resolve(runDirectory), trainingDirectory);
      const expectedTrainingDirectory = path.resolve(
        runDirectory,
        sanitizeFolderName(`${projectName}_model_training`)
      );
      if (path.resolve(trainingDirectory) !== expectedTrainingDirectory ||
          !relativeTrainingDirectory ||
          path.isAbsolute(relativeTrainingDirectory) ||
          relativeTrainingDirectory.startsWith(`..${path.sep}`) ||
          relativeTrainingDirectory === "..") {
        throw new Error("The saved training artifacts are outside the active project run.");
      }
      const completedCandidateIds = Array.isArray(trainingResult.candidates)
        ? trainingResult.candidates
            .map((candidate) => asRecord(candidate))
            .filter((candidate) => candidate.status === "Completed")
            .map((candidate) => candidate.modelId)
            .filter((modelId): modelId is string => typeof modelId === "string")
        : [];
      if (completedCandidateIds.length === 0) {
        throw new Error("Model validation requires at least one successfully trained candidate.");
      }
      const unavailableCandidates = selectedModels.filter((model) => !completedCandidateIds.includes(model));
      if (unavailableCandidates.length > 0) {
        throw new Error(`Selected models do not have completed training artifacts: ${unavailableCandidates.join(", ")}.`);
      }
      additionalProjectDirectories.push(trainingDirectory);
    }
    const context: Record<string, unknown> = {
      projectId: project.id,
      projectName,
      workspaceName,
      runTimestamp,
      selectedModels,
      featureEngineering: state.featureEngineering,
      modelSelection: state.modelSelection,
      trainingConfiguration: stageOutputs.trainingConfigurationNode || state.trainingConfiguration,
      preFlight: stageOutputs.preFlightNode || state.preFlight,
      datasetDirectory: getProjectDatasetDir(workspaceName, projectName, runTimestamp),
      trainingResult: stage === "validation" ? trainingResult : undefined,
      trainingArtifactDirectory: stage === "validation" ? additionalProjectDirectories[0] : undefined,
      validationOptions: input.validationOptions,
    };
    const graphInput: LifecycleInput = {
      projectId: project.id,
      workspaceName,
      projectName,
      runTimestamp,
      projectDirectory,
      additionalProjectDirectories,
      selectedModels,
      context,
    };

    const lifecycleRunId = randomUUID();
    const threadId = `${project.id}:${runTimestamp}:model-lifecycle-${stage}:${lifecycleRunId}`;
    const config = { configurable: { thread_id: threadId } };
    await this.persistProgress(project.id, stage, projectDirectory, "starting", "Starting model lifecycle.");
    const runningTools = new Map<string, string>();
    const callback = BaseCallbackHandler.fromMethods({
      handleToolStart: async (serialized, _toolInput, runId) => {
        const toolName = serialized.name || serialized.id?.at(-1) || "agent tool";
        runningTools.set(runId, toolName);
        await this.persistProgress(project.id, stage, projectDirectory, toolName, `Running ${toolName}.`);
      },
      handleToolEnd: async (_output, runId) => {
        const toolName = runningTools.get(runId) || "Agent tool";
        runningTools.delete(runId);
        await this.persistProgress(project.id, stage, projectDirectory, "agent", `${toolName} completed; continuing agent reasoning.`);
      },
      handleToolError: async (error, _runId) => {
        await this.persistProgress(project.id, stage, projectDirectory, "agent", `Tool failed: ${error instanceof Error ? error.message : String(error)}`);
      },
      handleLLMStart: async () =>
        this.persistProgress(project.id, stage, projectDirectory, "agentReasoning", "Agent is reasoning about the latest result."),
    });
    const progressConfig = {
      ...config,
      callbacks: [callback],
      configurable: {
        ...config.configurable,
        onLifecycleProgress: async (progress: { step: string; detail: string }) =>
          this.persistProgress(project.id, stage, projectDirectory, progress.step, progress.detail),
      },
    };
    let output: { result?: LifecycleRunResult };
    try {
      output = stage === "training"
        ? await invokeModelTrainingGraph(createModelTrainingGraph(this.checkpointer), { input: graphInput }, progressConfig)
        : await invokeModelValidationGraph(createModelValidationGraph(this.checkpointer), { input: graphInput }, progressConfig);
    } catch (error) {
      try {
        await this.persistProgress(
          project.id,
          stage,
          projectDirectory,
          "failed",
          error instanceof Error ? error.message : String(error),
          "Failed"
        );
      } catch (persistError) {
        console.error(`[ModelLifecycle] Failed to persist ${stage} failure status:`, persistError);
      }
      throw error;
    }
    if (!output.result) {
      await this.persistProgress(
        project.id,
        stage,
        projectDirectory,
        "failed",
        `The model ${stage} workflow finished without a result.`,
        "Failed"
      );
      throw new Error(`The model ${stage} workflow finished without a result.`);
    }

    const latestProject = await this.projectService.getById(project.id);
    if (!latestProject) throw new Error(`Project ${project.id} was not found while saving lifecycle output.`);
    const latestState = asRecord(latestProject.agentState);
    const previousLifecycle = asRecord(latestState.modelLifecycle);
    const existingStageOutputs = asRecord(latestState.stageOutputs);
    const candidateOutputs = output.result.candidates.map((candidate) => ({
      model_id: candidate.modelId,
      displayName: candidate.modelId,
      status: candidate.status,
      metrics: candidate.metrics,
      validationMetrics: candidate.metrics,
      testMetrics: candidate.metrics,
      error: candidate.status === "Completed" ? undefined : candidate.summary,
      failureCount: candidate.failureCount,
      qualityAssessment: candidate.qualityAssessment,
      qualityRecommendations: candidate.qualityRecommendations,
    }));
    const currentTrainingOutput = asRecord(existingStageOutputs.modelTrainingCodeNode);
    const validationCandidates = candidateOutputs.map((candidate) => ({
      ...candidate,
      modelId: candidate.model_id,
      displayName: candidate.displayName,
      totals: { actualTotal: null, forecastTotal: 0, difference: null, differencePercentage: null },
      chartData: { dates: [], actualSeries: [], predictedSeries: [] },
      evaluationRecordCount: 0,
      actualDataCoverage: null,
    }));
    const lifecycleStageOutput = stage === "training"
      ? {
          ...output.result,
          executedModels: candidateOutputs,
          report: {
            candidate_models: candidateOutputs,
            ranked_models: candidateOutputs,
            best_model_id: output.result.championCandidateId,
            champion_model_id: output.result.championCandidateId,
            candidate_rankings: output.result.candidateRankings,
          },
          executionCompleted: true,
        }
      : {
          ...currentTrainingOutput,
          modelValidation: {
            ...output.result,
            lifecycleVersion: true,
            candidates: validationCandidates,
            ranked_models: validationCandidates,
            champion_model_id: output.result.championCandidateId,
          },
        };
    const updated = await this.projectService.updateAgentState(project.id, {
      ...latestState,
      status: output.result.status === "Failed" ? "Failed" : "Completed",
      summary: output.result.summary,
      message: output.result.summary,
      currentNode: stage === "training" ? "modelTrainingCodeNode" : "modelValidation",
      currentStage: "modelTrainingValidation",
      currentLifecycleStep: output.result.summary,
      lifecycleProgress: {
        stage,
        step: "completed",
        detail: output.result.summary,
        updatedAt: new Date().toISOString(),
      },
      stageStatuses: stage === "training"
        ? buildGroupedStageStatuses({
            ...normalizeFlatStageStatuses(latestState.stageStatuses),
            modelTrainingCodeNode: output.result.status === "Failed" ? "Failed" : "Completed",
          })
        : latestState.stageStatuses,
      stageOutputs: {
        ...existingStageOutputs,
        modelTrainingCodeNode: lifecycleStageOutput,
      },
      modelLifecycle: {
        ...previousLifecycle,
        [stage]: output.result,
      },
    });
    if (!updated) throw new Error(`Failed to persist model ${stage} lifecycle output for project ${project.id}.`);
    return output.result;
  }

  private async persistProgress(
    projectId: string,
    stage: LifecycleStage,
    projectDirectory: string,
    step: string,
    detail: string,
    status: "In-Progress" | "Failed" = "In-Progress"
  ): Promise<void> {
    const project = await this.projectService.getById(projectId);
    if (!project) throw new Error(`Project ${projectId} was not found while persisting lifecycle progress.`);
    const state = asRecord(project.agentState);
    const lifecycle = asRecord(state.modelLifecycle);
    const stageResult = asRecord(lifecycle[stage]);
    const existingStageOutputs = asRecord(state.stageOutputs);
    const trainingOutput = asRecord(existingStageOutputs.modelTrainingCodeNode);
    const progressOutput = {
      ...stageResult,
      status,
      summary: detail,
      projectDirectory,
      currentStep: step,
      candidates: step === "starting" ? [] : Array.isArray(stageResult.candidates) ? stageResult.candidates : [],
      qualityRecommendations: step === "starting"
        ? []
        : Array.isArray(stageResult.qualityRecommendations) ? stageResult.qualityRecommendations : [],
      ...(step === "starting" ? { championCandidateId: undefined, candidateRankings: [] } : {}),
    };
    const stageStatuses = stage === "training"
      ? buildGroupedStageStatuses({
          ...normalizeFlatStageStatuses(state.stageStatuses),
          modelTrainingCodeNode: status,
        })
      : state.stageStatuses;
    const updated = await this.projectService.updateAgentState(projectId, {
      ...state,
      status,
      summary: detail,
      message: detail,
      currentNode: stage === "training" ? "modelTrainingCodeNode" : "modelValidation",
      currentStage: "modelTrainingValidation",
      currentLifecycleStep: detail,
      lifecycleProgress: {
        stage,
        step,
        detail,
        updatedAt: new Date().toISOString(),
      },
      ...(stageStatuses ? { stageStatuses } : {}),
      stageOutputs: {
        ...existingStageOutputs,
        modelTrainingCodeNode: stage === "training"
          ? {
              ...trainingOutput,
              ...progressOutput,
              ...(step === "starting" ? { report: { candidate_models: [], ranked_models: [] }, executedModels: [] } : {}),
              lifecycleVersion: true,
              executionCompleted: false,
            }
          : {
              ...trainingOutput,
              modelValidation: { ...progressOutput, lifecycleVersion: true },
            },
      },
      modelLifecycle: {
        ...lifecycle,
        [stage]: progressOutput,
      },
    });
    if (!updated) throw new Error(`Failed to persist ${stage} lifecycle progress for project ${projectId}.`);
  }
}

export type { LifecycleStage, RunLifecycleInput };
