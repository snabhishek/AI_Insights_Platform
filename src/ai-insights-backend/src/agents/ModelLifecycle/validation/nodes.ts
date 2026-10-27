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
  ValidationAuthorPrompt,
  ValidationQualityImprovementPrompt,
  ValidationQualityPrompt,
  ValidationRepairPrompt,
  ValidationResearchPrompt,
  ValidationReviewPrompt,
} from "../agentSchemas";
import { createLifecycleAgentTools } from "../agentTools";
import { checkProjectStructureAndDependencies } from "../projectStructureCheck";
import type { ValidationGraphStateType } from "./types";

function activeCandidate(state: ValidationGraphStateType): string {
  const candidate = state.currentCandidateId;
  if (!candidate) {
    throw new Error("Validation graph has no active candidate.");
  }
  return candidate;
}

export async function loadValidationContext(state: ValidationGraphStateType, config?: RunnableConfig) {
  const services = config?.configurable?.services || state.input?.services;
  await reportLifecycleProgress(
    config,
    "loadValidationContext",
    `Preparing validation lifecycle for candidate models: ${state.input.selectedModels.join(", ")}.`,
    services
  );
  requireLifecycleRunId(state.input);
  if (!path.isAbsolute(state.input.projectDirectory)) {
    throw new Error("Validation project directory must be an absolute server-resolved path.");
  }
  if (state.input.selectedModels.length === 0) {
    throw new Error("Validation requires at least one selected model.");
  }
  return {
    currentCandidateIndex: 0,
    currentCandidateId: state.input.selectedModels[0],
  };
}

export async function authorValidationProjectAgent(
  state: ValidationGraphStateType,
  config?: RunnableConfig
) {
  const services = config?.configurable?.services || state.input?.services;
  await reportLifecycleProgress(
    config,
    "authorValidationProjectAgent",
    `Authoring model validation project files and inference logic for ${state.input.selectedModels.join(", ")}...`,
    services
  );
  const tools = await createLifecycleAgentTools(
    state.input.projectDirectory,
    state.input.abortSignal,
    state.input.additionalProjectDirectories
  );
  const result = await invokeLifecycleAgent({
    role: "validationAuthor",
    promptFile: ValidationAuthorPrompt,
    task: lifecycleTask(state.input.context, {
      selectedModels: state.input.selectedModels,
      projectDirectory: state.input.projectDirectory,
      requirement: "Author a complete validation project and an execution plan for each selected model.",
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
    "authorValidationProjectAgent",
    `Validation authoring completed: ${result.output.summary}`,
    services
  );
  return {
    authoring: result.output,
    privateMemory: result.memory,
  };
}

export async function checkValidationProjectStructure(state: ValidationGraphStateType, config?: RunnableConfig) {
  const services = config?.configurable?.services || state.input?.services;
  await reportLifecycleProgress(
    config,
    "checkValidationProjectStructureAndDependencies",
    "Checking validation project files (Dockerfile, docker-compose.yml, requirements.txt) and dependencies.",
    services
  );
  const structureCheck = await checkProjectStructureAndDependencies(state.input.projectDirectory);
  const structuralIssues = [
    ...structureCheck.missingFiles.map((name) => `Required project file is missing: ${name}`),
    ...(!structureCheck.dependencyFileReadable ? ["Dependency declaration is empty or unreadable."] : []),
  ];
  const summaryMsg = structureCheck.valid
    ? "Validation project structure and dependencies verified successfully."
    : `Validation structure verification found issues: ${structuralIssues.join("; ")}`;
  await reportLifecycleProgress(
    config,
    "checkValidationProjectStructureAndDependencies",
    summaryMsg,
    services
  );
  return { structureCheck, structuralIssues };
}

export function selectValidationCandidate(state: ValidationGraphStateType, config?: RunnableConfig) {
  const candidate = state.input.selectedModels[state.currentCandidateIndex];
  if (config && candidate) {
    reportLifecycleProgress(
      config,
      "selectCandidate",
      `Selected candidate ${state.currentCandidateIndex + 1}/${state.input.selectedModels.length}: '${candidate}' for validation.`,
      config?.configurable?.services || state.input?.services
    ).catch(() => {});
  }
  return {
    currentCandidateId: candidate,
  };
}

export async function executeValidationCandidate(
  state: ValidationGraphStateType,
  config?: RunnableConfig
): Promise<{ execution: LifecycleExecutionResult; executionPlan?: LifecycleExecutionPlan }> {
  const candidateId = activeCandidate(state);
  const services = config?.configurable?.services || state.input?.services;
  await reportLifecycleProgress(
    config,
    "executeValidation",
    `Building validation container for candidate '${candidateId}'...`,
    services
  );
  const plan = state.authoring?.executionPlans[candidateId];
  if (!plan) {
    throw new Error(`The validation authoring agent did not return an execution plan for '${candidateId}'.`);
  }
  const build = await buildProjectContainer(state.input.projectDirectory, state.input.abortSignal);
  if (!build.success) {
    await reportLifecycleProgress(
      config,
      "executeValidation",
      `Validation container build failed for candidate '${candidateId}' (exit code: ${build.exitCode}).`,
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
      executionPlan: plan,
    };
  }

  await reportLifecycleProgress(
    config,
    "executeValidation",
    `Validation container build succeeded. Executing candidate '${candidateId}' with command: ${plan.command.join(" ")}...`,
    services
  );

  const result = await executeProject({
    projectDirectory: state.input.projectDirectory,
    service: plan.service,
    command: plan.command,
    signal: state.input.abortSignal,
  });

  await reportLifecycleProgress(
    config,
    "executeValidation",
    `Validation run for '${candidateId}' ${result.success ? "completed successfully" : "exited with errors"} (exit code: ${result.exitCode}).`,
    services
  );

  return {
    execution: {
      success: result.success,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      logFilePath: result.logFilePath || build.logFilePath,
    },
    executionPlan: plan,
  };
}

export async function reviewValidationRunAgent(
  state: ValidationGraphStateType,
  config?: RunnableConfig
) {
  const candidateId = state.currentCandidateId || "";
  const services = config?.configurable?.services || state.input?.services;
  await reportLifecycleProgress(
    config,
    "reviewValidationRunAgent",
    `Reviewing raw validation container execution output for '${candidateId}'...`,
    services
  );
  if (!state.execution) {
    throw new Error("Validation review cannot run without a process result.");
  }
  const tools = await createLifecycleAgentTools(
    state.input.projectDirectory,
    state.input.abortSignal,
    state.input.additionalProjectDirectories
  );
  const result = await invokeLifecycleAgent({
    role: "validationFailureReview",
    promptFile: ValidationReviewPrompt,
    task: lifecycleTask(state.input.context, {
      candidateId: state.currentCandidateId,
      failedAttempts: state.candidateFailures[state.currentCandidateId || ""] || 0,
      processOutcome: state.execution,
      executionPlan: state.executionPlan || state.authoring?.executionPlans[candidateId],
      sourceAndGeneratedOutput: "Use the scoped MCP filesystem tools to inspect current project files and outputs.",
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
    "reviewValidationRunAgent",
    `Validation review for '${candidateId}': action=${result.output.action}. ${result.output.rationale}`,
    services
  );

  const isError = result.output.action === "diagnose"
    || result.output.action === "terminal_failure"
    || result.output.action === "skip_candidate";
  return {
    review: result.output,
    privateMemory: result.memory,
    candidateFailures: isError
      ? { ...state.candidateFailures, [candidateId]: (state.candidateFailures[candidateId] || 0) + 1 }
      : state.candidateFailures,
  };
}

export async function assessValidationMetricsAndQualityAgent(
  state: ValidationGraphStateType,
  config?: RunnableConfig
) {
  const candidateId = state.currentCandidateId || "";
  const services = config?.configurable?.services || state.input?.services;
  await reportLifecycleProgress(
    config,
    "assessValidationMetricsAndQualityAgent",
    `Evaluating validation metrics and model quality for '${candidateId}'...`,
    services
  );
  const tools = await createLifecycleAgentTools(
    state.input.projectDirectory,
    state.input.abortSignal,
    state.input.additionalProjectDirectories
  );
  const result = await invokeLifecycleAgent({
    role: "validationMetricsQuality",
    promptFile: ValidationQualityPrompt,
    task: lifecycleTask(state.input.context, {
      candidateId: state.currentCandidateId,
      execution: state.execution,
      executionPlan: state.executionPlan || state.authoring?.executionPlans[candidateId],
      runReview: state.review,
      assessmentInstructions: "Validate generated metrics and model quality, and recommend a code-based improvement when evidence supports it.",
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
    "assessValidationMetricsAndQualityAgent",
    `Validation assessment for '${candidateId}': quality=${result.output.modelQuality}, action=${result.output.action}. ${result.output.rationale}`,
    services
  );

  const isClassifiedError =
    result.output.action === "skip_candidate" ||
    result.output.action === "terminal_failure";
  return {
    assessment: result.output,
    privateMemory: result.memory,
    candidateFailures: isClassifiedError
      ? { ...state.candidateFailures, [candidateId]: (state.candidateFailures[candidateId] || 0) + 1 }
      : state.candidateFailures,
    championCandidateId: result.output.championCandidateId,
    candidateRankings: result.output.candidateRankings,
    qualityRecommendations: [
      ...state.qualityRecommendations,
      ...result.output.recommendations,
    ],
  };
}

export async function researchValidationFailureAgent(
  state: ValidationGraphStateType,
  config?: RunnableConfig
) {
  const candidateId = state.currentCandidateId || "";
  const services = config?.configurable?.services || state.input?.services;
  await reportLifecycleProgress(
    config,
    "researchValidationFailureAgent",
    `Researching validation failure cause and documentation for '${candidateId}'...`,
    services
  );
  const tools = await createLifecycleAgentTools(
    state.input.projectDirectory,
    state.input.abortSignal,
    state.input.additionalProjectDirectories
  );
  const result = await invokeLifecycleAgent({
    role: "validationResearch",
    promptFile: ValidationResearchPrompt,
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
    "researchValidationFailureAgent",
    `Validation failure diagnosis for '${candidateId}': ${result.output.diagnosis}`,
    services
  );

  return { research: result.output, privateMemory: result.memory };
}

async function invokeValidationRepair(
  role: "validationRepair" | "validationQualityImprovement",
  promptFile: string,
  task: string,
  state: ValidationGraphStateType,
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

export async function repairValidationProjectAgent(
  state: ValidationGraphStateType,
  config?: RunnableConfig
) {
  const services = config?.configurable?.services || state.input?.services;
  await reportLifecycleProgress(
    config,
    "repairValidationProjectAgent",
    `Repairing validation project for candidate '${state.currentCandidateId}'...`,
    services
  );
  const res = await invokeValidationRepair(
    "validationRepair",
    ValidationRepairPrompt,
    lifecycleTask(state.input.context, {
      candidateId: state.currentCandidateId,
      structuralIssues: state.structuralIssues,
      review: state.review,
      research: state.research,
      execution: state.execution,
    }),
    state,
    config
  );
  await reportLifecycleProgress(
    config,
    "repairValidationProjectAgent",
    "Validation project repair applied. Re-checking structure and container...",
    services
  );
  return res;
}

export async function improveValidationQualityAgent(
  state: ValidationGraphStateType,
  config?: RunnableConfig
) {
  const services = config?.configurable?.services || state.input?.services;
  await reportLifecycleProgress(
    config,
    "improveValidationQualityAgent",
    `Applying validation quality improvements for candidate '${state.currentCandidateId}'...`,
    services
  );
  const res = await invokeValidationRepair(
    "validationQualityImprovement",
    ValidationQualityImprovementPrompt,
    lifecycleTask(state.input.context, {
      candidateId: state.currentCandidateId,
      assessment: state.assessment,
      recommendations: state.assessment?.recommendations || [],
      execution: state.execution,
    }),
    state,
    config
  );
  await reportLifecycleProgress(
    config,
    "improveValidationQualityAgent",
    "Validation quality improvements applied.",
    services
  );
  return res;
}

export function advanceValidationCandidate(state: ValidationGraphStateType, config?: RunnableConfig) {
  const candidateId = activeCandidate(state);
  const assessment = state.assessment;
  const skipped = state.review?.action === "skip_candidate" || assessment?.action === "skip_candidate";
  const candidate = {
    modelId: candidateId,
    status: skipped ? "Skipped" as const : "Completed" as const,
    failureCount: state.candidateFailures[candidateId] || 0,
    summary: skipped
      ? state.review?.rationale || assessment?.rationale || "The lifecycle agent skipped this candidate after repeated failures."
      : assessment?.rationale || "The lifecycle agent accepted the validation assessment.",
    metrics: assessment?.candidateMetrics?.[candidateId],
    qualityAssessment: assessment?.modelQuality,
    qualityRecommendations: assessment?.recommendations || [],
  };
  if (config) {
    reportLifecycleProgress(
      config,
      "advanceCandidate",
      `Validation candidate '${candidateId}' marked as ${candidate.status}. Advancing to next candidate.`,
      config?.configurable?.services || state.input?.services
    ).catch(() => {});
  }
  return {
    candidates: [
      ...state.candidates.filter((item) => item.modelId !== candidateId),
      candidate,
    ],
    currentCandidateIndex: state.currentCandidateIndex + 1,
    currentCandidateId: state.input.selectedModels[state.currentCandidateIndex + 1],
    review: undefined,
    assessment: undefined,
    execution: undefined,
    research: undefined,
    structuralIssues: [],
  };
}

export function persistValidationResult(state: ValidationGraphStateType, config?: RunnableConfig) {
  const failed = Boolean(state.stopReason);
  const skipped = state.candidates.some((candidate) => candidate.status === "Skipped");
  const result = {
    status: failed ? "Failed" as const : skipped ? "Partial" as const : "Completed" as const,
    summary: state.stopReason || `Validation lifecycle finished with ${state.candidates.length} candidate outcome(s).`,
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
      "persistValidationResult",
      `Persisted validation results: ${result.status}. Candidate outcomes: ${state.candidates.map((c) => `${c.modelId} (${c.status})`).join(", ")}. Champion: ${state.championCandidateId || "none"}.`,
      config?.configurable?.services || state.input?.services
    ).catch(() => {});
  }
  return { result };
}

export function persistValidationFailure(state: ValidationGraphStateType, config?: RunnableConfig) {
  const reason = state.stopReason || state.review?.rationale || "The validation lifecycle agent could not complete this run.";
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
      "persistValidationFailure",
      `Validation lifecycle terminated: ${reason}`,
      config?.configurable?.services || state.input?.services
    ).catch(() => {});
  }
  return {
    result: {
      status: "Failed" as const,
      summary: reason,
      projectDirectory: state.input.projectDirectory,
      candidates,
      qualityRecommendations: state.qualityRecommendations,
      execution: state.execution,
      assessment: state.assessment,
    },
  };
}
