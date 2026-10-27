import * as path from "path";
import type { RunnableConfig } from "@langchain/core/runnables";
import {
  buildProjectContainer,
  executeProject,
} from "../runtime/pythonExecutor";
import type { LifecycleExecutionPlan, LifecycleExecutionResult } from "../contracts";
import { invokeLifecycleAgent, lifecycleTask, reportLifecycleProgress, requireLifecycleRunId } from "../agentRuntime";
import {
  MetricsQualitySchema,
  ProjectAuthorSchema,
  RepairSchema,
  ResearchSchema,
  RunReviewSchema,
  TrainingAuthorPrompt,
  TrainingQualityImprovementPrompt,
  TrainingQualityPrompt,
  TrainingRepairPrompt,
  TrainingResearchPrompt,
  TrainingReviewPrompt,
} from "../agentSchemas";
import { createLifecycleAgentTools } from "../agentTools";
import { checkProjectStructureAndDependencies } from "../projectStructureCheck";
import { updatePrivateAgentMemory } from "../memory/privateAgentMemory";
import { getModelExportPlans } from "../../ModelTrainingValidation/TrainingConfiguration/modelExportContract";
import type { TrainingGraphStateType } from "./types";

function buildTrainingExportInstructions(context: Record<string, unknown> | undefined): string {
  try {
    const tc: any = context?.trainingConfiguration;
    const configData = tc?.configuration || (tc?.model_selection ? tc : null);
    if (!configData?.model_selection?.models) {
      return [
        "CRITICAL MODEL ARTIFACT EXPORT MANDATE:",
        "- Every candidate model MUST be saved to 'artifacts/models/<candidate_model_id>/model.joblib' (or native format path specified in training_steps.export_step).",
        "- Fitted preprocessor (scalers, imputers, encoders) MUST be saved to 'artifacts/models/<candidate_model_id>/preprocessor.joblib'.",
        "- After export, reload each model to verify inference & prediction parity.",
        "- Write 'model_training_report.json' to the training root with complete 'models_evaluated' containing 'exports' array conforming to modelExportArtifactSchema.",
      ].join("\n");
    }
    const plans = getModelExportPlans(configData);
    const exportPolicy = configData.artifacts?.export_policy;
    return [
      "CRITICAL MODEL ARTIFACT EXPORT MANDATE (REQUIRED FOR MODEL EXPORT UI):",
      "1. Destination directory: Save each trained candidate model inside 'artifacts/models/<candidate_model_id>/'.",
      "2. Model file: Save primary model artifact to 'artifacts/models/<candidate_model_id>/model.joblib' (or configured extension/format).",
      "3. Preprocessor asset: Save fitted preprocessor/scaler to 'artifacts/models/<candidate_model_id>/preprocessor.joblib'.",
      "4. Reload & Parity: Reload exported artifact using its inference runtime, run test inference, and verify prediction parity.",
      "5. Training Report: Write 'model_training_report.json' to the project root with 'status: Completed', 'best_model', 'selected_model_path', and 'models_evaluated' containing an 'exports' array conforming to modelExportArtifactSchema for every evaluated candidate model.",
      `Configured Export Policy: ${JSON.stringify(exportPolicy || {})}`,
      `Per-Model Export Plans: ${JSON.stringify(plans)}`,
    ].join("\n");
  } catch {
    return [
      "CRITICAL MODEL ARTIFACT EXPORT MANDATE:",
      "- Every candidate model MUST be saved to 'artifacts/models/<candidate_model_id>/model.joblib' (or native format path).",
      "- Fitted preprocessor (scalers, imputers, encoders) MUST be saved to 'artifacts/models/<candidate_model_id>/preprocessor.joblib'.",
      "- After export, reload each model to verify inference & prediction parity.",
      "- Write 'model_training_report.json' to the training root with complete 'models_evaluated' containing 'exports' array conforming to modelExportArtifactSchema.",
    ].join("\n");
  }
}

function activeCandidate(state: TrainingGraphStateType): string {
  const candidate = state.currentCandidateId;
  if (!candidate) {
    throw new Error("Training graph has no active candidate.");
  }
  return candidate;
}

export async function loadTrainingContext(state: TrainingGraphStateType, config?: RunnableConfig) {
  const services = config?.configurable?.services || state.input?.services;
  await reportLifecycleProgress(
    config,
    "loadTrainingContext",
    `Preparing training lifecycle for candidate models: ${state.input.selectedModels.join(", ")}.`,
    services
  );
  requireLifecycleRunId(state.input);
  if (!path.isAbsolute(state.input.projectDirectory)) {
    throw new Error("Training project directory must be an absolute server-resolved path.");
  }
  if (state.input.selectedModels.length === 0) {
    throw new Error("Training requires at least one selected model.");
  }
  return {
    currentCandidateIndex: 0,
    currentCandidateId: state.input.selectedModels[0],
  };
}

export async function authorTrainingProjectAgent(
  state: TrainingGraphStateType,
  config?: RunnableConfig
) {
  const services = config?.configurable?.services || state.input?.services;
  await reportLifecycleProgress(
    config,
    "authorTrainingProjectAgent",
    `Authoring model training project files and researching framework dependencies for ${state.input.selectedModels.join(", ")}...`,
    services
  );
  const tools = await createLifecycleAgentTools(
    state.input.projectDirectory,
    state.input.abortSignal,
    state.input.additionalProjectDirectories
  );
  const exportInstructions = buildTrainingExportInstructions(state.input.context);
  const result = await invokeLifecycleAgent({
    role: "trainingAuthor",
    promptFile: TrainingAuthorPrompt,
    task: lifecycleTask(state.input.context, {
      selectedModels: state.input.selectedModels,
      projectDirectory: state.input.projectDirectory,
      requirement: `Author the complete project and return an execution plan for each selected candidate.\n\n${exportInstructions}`,
      exportInstructions,
    }),
    outputContract: `{"summary":"...","executionPlans":{"<selected-model-id>":{"service":"...","command":["..."],"reportPath":"..."}}}`,
    schema: ProjectAuthorSchema,
    tools,
    memory: state.privateMemory,
    signal: state.input.abortSignal,
    config,
  });
  await reportLifecycleProgress(
    config,
    "authorTrainingProjectAgent",
    `Authoring completed: ${result.output.summary}`,
    services
  );
  return {
    authoring: result.output,
    privateMemory: result.memory,
  };
}

export async function checkTrainingProjectStructure(state: TrainingGraphStateType, config?: RunnableConfig) {
  const services = config?.configurable?.services || state.input?.services;
  await reportLifecycleProgress(
    config,
    "checkTrainingProjectStructureAndDependencies",
    "Checking required project files (Dockerfile, docker-compose.yml, requirements.txt) and dependencies.",
    services
  );
  const structureCheck = await checkProjectStructureAndDependencies(state.input.projectDirectory);
  const structuralIssues = [
    ...structureCheck.missingFiles.map((name) => `Required project file is missing: ${name}`),
    ...(!structureCheck.dependencyFileReadable ? ["Dependency declaration is empty or unreadable."] : []),
  ];
  const summaryMsg = structureCheck.valid
    ? "Project structure and dependencies verified successfully."
    : `Project structure verification found issues: ${structuralIssues.join("; ")}`;
  await reportLifecycleProgress(
    config,
    "checkTrainingProjectStructureAndDependencies",
    summaryMsg,
    services
  );
  return { structureCheck, structuralIssues };
}

export function selectTrainingCandidate(state: TrainingGraphStateType, config?: RunnableConfig) {
  const candidate = state.input.selectedModels[state.currentCandidateIndex];
  if (config && candidate) {
    reportLifecycleProgress(
      config,
      "selectCandidate",
      `Selected candidate ${state.currentCandidateIndex + 1}/${state.input.selectedModels.length}: '${candidate}' for container training.`,
      config?.configurable?.services || state.input?.services
    ).catch(() => {});
  }
  return { currentCandidateId: candidate };
}

export async function executeTrainingCandidate(state: TrainingGraphStateType, config?: RunnableConfig): Promise<{
  execution: LifecycleExecutionResult;
  executionPlan?: LifecycleExecutionPlan;
}> {
  const candidateId = activeCandidate(state);
  const services = config?.configurable?.services || state.input?.services;
  await reportLifecycleProgress(
    config,
    "executeCandidateTraining",
    `Building container image for candidate '${candidateId}'...`,
    services
  );
  const executionPlan = state.authoring?.executionPlans[candidateId];
  if (!executionPlan) {
    throw new Error(`The training authoring agent did not return an execution plan for '${candidateId}'.`);
  }

  const build = await buildProjectContainer(state.input.projectDirectory, state.input.abortSignal);
  if (!build.success) {
    await reportLifecycleProgress(
      config,
      "executeCandidateTraining",
      `Container build failed for candidate '${candidateId}' (exit code: ${build.exitCode}).`,
      services
    );
    return {
      execution: {
        success: false,
        exitCode: build.exitCode,
        stdout: build.stdout,
        stderr: build.stderr,
        logFilePath: build.logFilePath,
      },
      executionPlan,
    };
  }

  await reportLifecycleProgress(
    config,
    "executeCandidateTraining",
    `Container build succeeded. Executing candidate '${candidateId}' with command: ${executionPlan.command.join(" ")}...`,
    services
  );

  const run = await executeProject({
    projectDirectory: state.input.projectDirectory,
    service: executionPlan.service,
    command: executionPlan.command,
    signal: state.input.abortSignal,
  });

  await reportLifecycleProgress(
    config,
    "executeCandidateTraining",
    `Container training run for '${candidateId}' ${run.success ? "completed successfully" : "exited with errors"} (exit code: ${run.exitCode}).`,
    services
  );

  return {
    execution: {
      success: run.success,
      exitCode: run.exitCode,
      stdout: run.stdout,
      stderr: run.stderr,
      logFilePath: run.logFilePath || build.logFilePath,
    },
    executionPlan,
  };
}

export async function reviewTrainingRunAgent(
  state: TrainingGraphStateType,
  config?: RunnableConfig
) {
  const candidateId = activeCandidate(state);
  const services = config?.configurable?.services || state.input?.services;
  await reportLifecycleProgress(
    config,
    "reviewTrainingRunAgent",
    `Reviewing raw training execution output for '${candidateId}'...`,
    services
  );
  if (!state.execution) {
    throw new Error("Training review cannot run without a process result.");
  }
  const tools = await createLifecycleAgentTools(
    state.input.projectDirectory,
    state.input.abortSignal,
    state.input.additionalProjectDirectories
  );
  const result = await invokeLifecycleAgent({
    role: "trainingFailureReview",
    promptFile: TrainingReviewPrompt,
    task: lifecycleTask(state.input.context, {
      candidateId,
      failedAttempts: state.candidateFailures[candidateId] || 0,
      cumulativeTrainingErrors: state.trainingErrorCount,
      processOutcome: state.execution,
      executionPlan: state.executionPlan || state.authoring?.executionPlans[candidateId],
      sourceAndGeneratedOutput: "Use the supplied scoped filesystem tools to review current project source and generated output.",
    }),
    outputContract: `{"action":"diagnose|assess|skip_candidate|terminal_failure","rationale":"...","evidence":["..."],"candidateId":"optional"}`,
    schema: RunReviewSchema,
    tools,
    memory: state.privateMemory,
    signal: state.input.abortSignal,
    config,
  });

  await reportLifecycleProgress(
    config,
    "reviewTrainingRunAgent",
    `Run review for '${candidateId}': action=${result.output.action}. ${result.output.rationale}`,
    services
  );

  const isError = result.output.action === "diagnose"
    || result.output.action === "terminal_failure"
    || result.output.action === "skip_candidate";
  const candidateFailures = isError
    ? {
        ...state.candidateFailures,
        [candidateId]: (state.candidateFailures[candidateId] || 0) + 1,
      }
    : state.candidateFailures;
  return {
    review: result.output,
    privateMemory: result.memory,
    candidateFailures,
    trainingErrorCount: state.trainingErrorCount + (isError ? 1 : 0),
  };
}

export async function assessTrainingMetricsAndModelQualityAgent(
  state: TrainingGraphStateType,
  config?: RunnableConfig
) {
  const candidateId = activeCandidate(state);
  const services = config?.configurable?.services || state.input?.services;
  await reportLifecycleProgress(
    config,
    "assessTrainingMetricsAndModelQualityAgent",
    `Assessing metrics and model quality for '${candidateId}'...`,
    services
  );
  const tools = await createLifecycleAgentTools(
    state.input.projectDirectory,
    state.input.abortSignal,
    state.input.additionalProjectDirectories
  );
  const result = await invokeLifecycleAgent({
    role: "trainingMetricsQuality",
    promptFile: TrainingQualityPrompt,
    task: lifecycleTask(state.input.context, {
      candidateId,
      processOutcome: state.execution,
      executionPlan: state.executionPlan || state.authoring?.executionPlans[candidateId],
      previousReview: state.review,
      candidates: state.candidates,
      assessmentInstructions: "Validate generated metrics and model quality from the authored code and evidence; return recommendations when quality can be improved.",
    }),
    outputContract: `{"action":"accept|improve_quality|skip_candidate|terminal_failure","rationale":"...","metricsValid":true,"modelQuality":"good|needs_improvement|undetermined","candidateRankings":["..."],"championCandidateId":"optional","recommendations":["..."],"candidateMetrics":{"candidate-id":{"metric":"value"}}}`,
    schema: MetricsQualitySchema,
    tools,
    memory: state.privateMemory,
    signal: state.input.abortSignal,
    config,
  });

  await reportLifecycleProgress(
    config,
    "assessTrainingMetricsAndModelQualityAgent",
    `Quality assessment for '${candidateId}': quality=${result.output.modelQuality}, action=${result.output.action}. ${result.output.rationale}`,
    services
  );

  const isClassifiedError =
    result.output.action === "skip_candidate" ||
    result.output.action === "terminal_failure";
  const candidateFailures = isClassifiedError
    ? {
        ...state.candidateFailures,
        [candidateId]: (state.candidateFailures[candidateId] || 0) + 1,
      }
    : state.candidateFailures;
  return {
    assessment: result.output,
    privateMemory: result.memory,
    candidateFailures,
    trainingErrorCount: state.trainingErrorCount + (isClassifiedError ? 1 : 0),
    championCandidateId: result.output.championCandidateId,
    candidateRankings: result.output.candidateRankings,
    qualityRecommendations: [
      ...state.qualityRecommendations,
      ...result.output.recommendations,
    ],
  };
}

export async function researchTrainingFailureAgent(
  state: TrainingGraphStateType,
  config?: RunnableConfig
) {
  const candidateId = state.currentCandidateId;
  const services = config?.configurable?.services || state.input?.services;
  await reportLifecycleProgress(
    config,
    "researchTrainingFailureAgent",
    `Researching training failure cause and documentation for '${candidateId}'...`,
    services
  );
  const tools = await createLifecycleAgentTools(
    state.input.projectDirectory,
    state.input.abortSignal,
    state.input.additionalProjectDirectories
  );
  const result = await invokeLifecycleAgent({
    role: "trainingResearch",
    promptFile: TrainingResearchPrompt,
    task: lifecycleTask(state.input.context, {
      candidateId: state.currentCandidateId,
      execution: state.execution,
      review: state.review,
      structuralIssues: state.structuralIssues,
    }),
    outputContract: `{"diagnosis":"...","evidence":["..."],"proposedChanges":["..."]}`,
    schema: ResearchSchema,
    tools,
    memory: state.privateMemory,
    signal: state.input.abortSignal,
    config,
  });

  await reportLifecycleProgress(
    config,
    "researchTrainingFailureAgent",
    `Research diagnosis for '${candidateId}': ${result.output.diagnosis}`,
    services
  );

  return { research: result.output, privateMemory: result.memory };
}

async function invokeTrainingRepair(
  role: "trainingRepair" | "trainingQualityImprovement",
  promptFile: string,
  task: string,
  state: TrainingGraphStateType,
  config?: RunnableConfig
) {
  const tools = await createLifecycleAgentTools(
    state.input.projectDirectory,
    state.input.abortSignal,
    state.input.additionalProjectDirectories
  );
  const result = await invokeLifecycleAgent({
    role,
    promptFile,
    task,
    outputContract: `{"summary":"...","changedFiles":["..."]}`,
    schema: RepairSchema,
    tools,
    memory: state.privateMemory,
    signal: state.input.abortSignal,
    config,
  });
  return {
    privateMemory: result.memory,
    structuralIssues: [],
  };
}

export async function repairTrainingProjectAgent(
  state: TrainingGraphStateType,
  config?: RunnableConfig
) {
  const services = config?.configurable?.services || state.input?.services;
  await reportLifecycleProgress(
    config,
    "repairTrainingProjectAgent",
    `Repairing training project for candidate '${state.currentCandidateId}'...`,
    services
  );
  const exportInstructions = buildTrainingExportInstructions(state.input.context);
  const res = await invokeTrainingRepair(
    "trainingRepair",
    TrainingRepairPrompt,
    lifecycleTask(state.input.context, {
      candidateId: state.currentCandidateId,
      structuralIssues: state.structuralIssues,
      review: state.review,
      research: state.research,
      execution: state.execution,
      exportInstructions,
    }),
    state,
    config
  );
  await reportLifecycleProgress(
    config,
    "repairTrainingProjectAgent",
    "Project repair applied. Re-checking structure and container build...",
    services
  );
  return res;
}

export async function improveTrainingQualityAgent(
  state: TrainingGraphStateType,
  config?: RunnableConfig
) {
  const services = config?.configurable?.services || state.input?.services;
  await reportLifecycleProgress(
    config,
    "improveTrainingQualityAgent",
    `Applying quality improvements for candidate '${state.currentCandidateId}'...`,
    services
  );
  const exportInstructions = buildTrainingExportInstructions(state.input.context);
  const res = await invokeTrainingRepair(
    "trainingQualityImprovement",
    TrainingQualityImprovementPrompt,
    lifecycleTask(state.input.context, {
      candidateId: state.currentCandidateId,
      assessment: state.assessment,
      recommendations: state.assessment?.recommendations || [],
      execution: state.execution,
      exportInstructions,
    }),
    state,
    config
  );
  await reportLifecycleProgress(
    config,
    "improveTrainingQualityAgent",
    "Model quality improvements applied.",
    services
  );
  return res;
}

export function advanceTrainingCandidate(state: TrainingGraphStateType, config?: RunnableConfig) {
  const candidateId = activeCandidate(state);
  const assessment = state.assessment;
  const review = state.review;
  const skipped = review?.action === "skip_candidate" || assessment?.action === "skip_candidate";
  const existing = state.candidates.filter((candidate) => candidate.modelId !== candidateId);
  const outcome = {
    modelId: candidateId,
    status: skipped ? "Skipped" as const : "Completed" as const,
    failureCount: state.candidateFailures[candidateId] || 0,
    summary: skipped
      ? review?.rationale || assessment?.rationale || "The lifecycle agent skipped this candidate after repeated failures."
      : assessment?.rationale || "The lifecycle agent accepted the candidate assessment.",
    metrics: assessment?.candidateMetrics?.[candidateId],
    qualityAssessment: assessment?.modelQuality,
    qualityRecommendations: assessment?.recommendations || [],
  };
  if (config) {
    reportLifecycleProgress(
      config,
      "advanceCandidate",
      `Candidate '${candidateId}' marked as ${outcome.status}. Advancing to next candidate.`,
      config?.configurable?.services || state.input?.services
    ).catch(() => {});
  }
  return {
    candidates: [...existing, outcome],
    currentCandidateIndex: state.currentCandidateIndex + 1,
    currentCandidateId: state.input.selectedModels[state.currentCandidateIndex + 1],
    review: undefined,
    assessment: undefined,
    execution: undefined,
    research: undefined,
    structuralIssues: [],
  };
}

export function persistTrainingResult(state: TrainingGraphStateType, config?: RunnableConfig) {
  const skippedCount = state.candidates.filter((candidate) => candidate.status === "Skipped").length;
  const failed = Boolean(state.stopReason);
  const status = failed
    ? "Failed" as const
    : skippedCount > 0
      ? "Partial" as const
      : "Completed" as const;
  const result = {
    status,
    summary: state.stopReason || `Training lifecycle finished with ${state.candidates.length} candidate outcome(s).`,
    projectDirectory: state.input.projectDirectory,
    candidates: state.candidates,
    qualityRecommendations: state.qualityRecommendations,
    championCandidateId: state.championCandidateId,
    candidateRankings: state.candidateRankings,
    execution: state.execution,
    assessment: state.assessment,
  };
  if (config) {
    reportLifecycleProgress(
      config,
      "persistTrainingResult",
      `Persisted training lifecycle result: ${status}. Candidate outcomes: ${state.candidates.map((c) => `${c.modelId} (${c.status})`).join(", ")}. Champion: ${state.championCandidateId || "none"}.`,
      config?.configurable?.services || state.input?.services
    ).catch(() => {});
  }
  return { result };
}

export function withTrainingFailure(
  state: TrainingGraphStateType,
  reason: string,
  config?: RunnableConfig
) {
  const candidateId = state.currentCandidateId;
  const candidates = candidateId && !state.candidates.some((candidate) => candidate.modelId === candidateId)
    ? [
        ...state.candidates,
        {
          modelId: candidateId,
          status: "Failed" as const,
          failureCount: state.candidateFailures[candidateId] || 0,
          summary: reason,
          metrics: state.assessment?.candidateMetrics?.[candidateId],
          qualityAssessment: state.assessment?.modelQuality,
          qualityRecommendations: state.assessment?.recommendations || [],
        },
      ]
    : state.candidates;
  if (config) {
    reportLifecycleProgress(
      config,
      "persistTrainingFailure",
      `Training lifecycle terminated: ${reason}`,
      config?.configurable?.services || state.input?.services
    ).catch(() => {});
  }
  return {
    stopReason: reason,
    result: {
      status: "Failed" as const,
      summary: reason,
      projectDirectory: state.input.projectDirectory,
      candidates,
      qualityRecommendations: state.qualityRecommendations,
      execution: state.execution,
    },
  };
}

export function mergeTrainingMemory(
  state: TrainingGraphStateType,
  role: Parameters<typeof updatePrivateAgentMemory>[1],
  messages: Parameters<typeof updatePrivateAgentMemory>[2]
) {
  return { privateMemory: updatePrivateAgentMemory(state.privateMemory, role, messages) };
}
