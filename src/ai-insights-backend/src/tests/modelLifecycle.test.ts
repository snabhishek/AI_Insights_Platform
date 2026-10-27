import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { HumanMessage } from "@langchain/core/messages";
import {
  LIFECYCLE_GRAPH_RECURSION_LIMIT,
  shouldSkipCandidate,
  shouldStopTraining,
} from "../agents/ModelLifecycle/policies";
import { LIFECYCLE_AGENT_SUMMARIZATION_OPTIONS, parseAgentJsonResponse } from "../agents/ModelLifecycle/agentRuntime";
import { MetricsQualitySchema, ProjectAuthorSchema } from "../agents/ModelLifecycle/agentSchemas";
import { parseJson } from "../agents/utils/agentUtils";
import { advanceTrainingCandidate, withTrainingFailure } from "../agents/ModelLifecycle/training/nodes";
import type { TrainingGraphStateType } from "../agents/ModelLifecycle/training/types";
import { advanceValidationCandidate } from "../agents/ModelLifecycle/validation/nodes";
import type { ValidationGraphStateType } from "../agents/ModelLifecycle/validation/types";
import { updatePrivateAgentMemory } from "../agents/ModelLifecycle/memory/privateAgentMemory";
import { ModelLifecycleCandidateService } from "../services/ai/model-lifecycle/modelLifecycleCandidates.service";
import {
  ModelLifecycleService,
  prepareLifecycleDirectory,
  resolvePendingLifecycleStage,
} from "../services/ai/model-lifecycle/modelLifecycle.service";
import { modelExportArtifactSchema } from "../agents/ModelTrainingValidation/TrainingConfiguration/modelExportContract";

function lifecycleInput() {
  return {
    projectId: "project-1",
    workspaceName: "workspace",
    projectName: "project",
    runTimestamp: "20260627-120000",
    projectDirectory: "C:\\storage\\project",
    context: {},
    selectedModels: ["candidate-1", "candidate-2"],
  };
}

test("candidate skipping requires more than five failures", () => {
  assert.equal(shouldSkipCandidate(5), false);
  assert.equal(shouldSkipCandidate(6), true);
});

test("training stops only after the twentieth cumulative classified error", () => {
  assert.equal(shouldStopTraining(20), false);
  assert.equal(shouldStopTraining(21), true);
});

test("both lifecycle graph invocation policies use 500 graph steps", () => {
  assert.equal(LIFECYCLE_GRAPH_RECURSION_LIMIT, 500);
});

test("lifecycle agents summarize at 500000 tokens and retain the latest 25000 tokens", () => {
  assert.deepEqual(LIFECYCLE_AGENT_SUMMARIZATION_OPTIONS, {
    triggerTokens: 500_000,
    keepTokens: 25_000,
  });
});

test("training candidate advancement preserves skipped status and rationale", () => {
  const state = {
    input: lifecycleInput(),
    currentCandidateIndex: 0,
    currentCandidateId: "candidate-1",
    candidateFailures: { "candidate-1": 6 },
    trainingErrorCount: 6,
    candidates: [],
    qualityRecommendations: [],
    championCandidateId: undefined,
    candidateRankings: [],
    privateMemory: {},
    authoring: undefined,
    structureCheck: undefined,
    executionPlan: undefined,
    execution: undefined,
    review: { action: "skip_candidate", rationale: "Repeated process failures." },
    assessment: undefined,
    research: undefined,
    structuralIssues: [],
    stopReason: undefined,
    result: undefined,
  } as unknown as TrainingGraphStateType;

  const output = advanceTrainingCandidate(state);
  assert.equal(output.candidates[0].status, "Skipped");
  assert.equal(output.candidates[0].failureCount, 6);
  assert.equal(output.candidates[0].summary, "Repeated process failures.");
  assert.equal(output.currentCandidateId, "candidate-2");
});

test("training terminal failure includes the active candidate in persisted results", () => {
  const state = {
    input: lifecycleInput(),
    currentCandidateIndex: 0,
    currentCandidateId: "candidate-1",
    candidateFailures: { "candidate-1": 21 },
    trainingErrorCount: 21,
    candidates: [],
    qualityRecommendations: [],
    championCandidateId: undefined,
    candidateRankings: [],
    privateMemory: {},
    authoring: undefined,
    structureCheck: undefined,
    executionPlan: undefined,
    execution: { success: false, exitCode: 1, stdout: "", stderr: "raw stderr" },
    review: { action: "terminal_failure", rationale: "Error threshold reached." },
    assessment: undefined,
    research: undefined,
    structuralIssues: [],
    stopReason: undefined,
    result: undefined,
  } as unknown as TrainingGraphStateType;

  const output = withTrainingFailure(state, "Error threshold reached.");
  assert.equal(output.result.candidates[0].status, "Failed");
  assert.equal(output.result.candidates[0].failureCount, 21);
  assert.equal(output.result.execution?.stderr, "raw stderr");
});

test("validation candidate advancement reports skipped candidates", () => {
  const state = {
    input: lifecycleInput(),
    currentCandidateIndex: 0,
    currentCandidateId: "candidate-1",
    candidateFailures: { "candidate-1": 6 },
    candidates: [],
    qualityRecommendations: [],
    championCandidateId: undefined,
    candidateRankings: [],
    privateMemory: {},
    authoring: undefined,
    structureCheck: undefined,
    executionPlan: undefined,
    execution: undefined,
    review: { action: "skip_candidate", rationale: "Validation failed repeatedly." },
    assessment: undefined,
    research: undefined,
    structuralIssues: [],
    stopReason: undefined,
    result: undefined,
  } as unknown as ValidationGraphStateType;

  const output = advanceValidationCandidate(state);
  assert.equal(output.candidates[0].status, "Skipped");
  assert.equal(output.candidates[0].summary, "Validation failed repeatedly.");
});

test("primary-agent private memories remain isolated by role", () => {
  const authorMessage = new HumanMessage("training author context");
  const reviewMessage = new HumanMessage("training review context");
  const memory = updatePrivateAgentMemory({}, "trainingAuthor", [authorMessage]);
  const updated = updatePrivateAgentMemory(memory, "trainingFailureReview", [reviewMessage]);

  assert.deepEqual(updated.trainingAuthor, [authorMessage]);
  assert.deepEqual(updated.trainingFailureReview, [reviewMessage]);
});

test("Sparrow only receives successfully trained candidates and a trained champion", async () => {
  const service = new ModelLifecycleCandidateService({
    getById: async () => ({
      id: "project-1",
      agentState: {
        modelLifecycle: {
          training: {
            championCandidateId: "candidate-skipped",
            summary: "Training completed with a skipped candidate.",
            candidates: [
              { modelId: "candidate-1", status: "Completed", metrics: { score: 0.2 } },
              { modelId: "candidate-skipped", status: "Skipped", metrics: { score: 0.1 } },
            ],
          },
        },
      },
    }),
  } as any);

  const result = await service.getValidationCandidates("project-1");
  assert.deepEqual(result.candidates.map((candidate) => candidate.model_id), ["candidate-1"]);
  assert.equal(result.championModelId, null);
  assert.equal(result.trainingReportSummary, "Training completed with a skipped candidate.");
});

test("lifecycle reuses and clears its stage directory without touching sibling data", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "lifecycle-directory-"));
  const runDirectory = path.join(root, "active-run");
  const existingDirectory = path.join(runDirectory, "Project_model_training");
  const existingNestedDirectory = path.join(existingDirectory, "artifacts");
  const siblingFile = path.join(runDirectory, "keep.txt");
  await mkdir(existingNestedDirectory, { recursive: true });
  await writeFile(path.join(existingNestedDirectory, "old-model.bin"), "old");
  await writeFile(siblingFile, "keep");

  try {
    const resolved = await prepareLifecycleDirectory(runDirectory, "Project", "training");
    assert.equal(resolved, existingDirectory);
    assert.deepEqual(await readdir(resolved), []);
    assert.equal(await readFile(siblingFile, "utf8"), "keep");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("pending lifecycle stage is resolved from persisted agent state", () => {
  assert.equal(resolvePendingLifecycleStage({
    stageStatuses: {
      modelTrainingValidation: {
        preFlightNode: "Completed",
        modelTrainingCodeNode: "User Input",
      },
    },
    selectedModels: ["candidate-1"],
  }), "training");

  assert.equal(resolvePendingLifecycleStage({
    stageStatuses: {
      modelTrainingValidation: {
        modelTrainingCodeNode: "Completed",
        modelValidation: "Awaiting Approval",
      },
    },
    modelLifecycle: {
      training: { status: "Completed" },
    },
  }), "validation");
});

test("lifecycle approval dispatches the persisted pending stage without request routing data", async () => {
  let updatedAgentState: Record<string, unknown> | undefined;
  const projectService = {
    getById: async () => ({
      id: "project-1",
      agentState: {
        status: "Awaiting Approval",
        selectedModels: ["candidate-1"],
        stageStatuses: {
          modelTrainingValidation: {
            preFlightNode: "Completed",
            modelTrainingCodeNode: "User Input",
          },
        },
      },
    }),
    updateAgentState: async (_projectId: string, state: Record<string, unknown>) => {
      updatedAgentState = state;
      return true;
    },
  };
  const service = new ModelLifecycleService(projectService as any, {} as any);
  let dispatchedModels: string[] = [];
  service.runTraining = async ({ selectedModels }) => {
    dispatchedModels = selectedModels;
    return {
      status: "Completed",
      summary: "Training completed.",
      projectDirectory: "C:\\project",
      candidates: [],
      qualityRecommendations: [],
    };
  };

  const result = await service.approvePending("project-1", true);
  assert.deepEqual(dispatchedModels, ["candidate-1"]);
  assert.equal(result?.summary, "Training completed.");
  assert.equal(updatedAgentState, undefined);
});

test("lifecycle approval resolves validation and inputs from persisted agent state", async () => {
  let dispatchedInput: Record<string, unknown> | undefined;
  const service = new ModelLifecycleService({
    getById: async () => ({
      id: "project-1",
      agentState: {
        selectedModels: ["candidate-1"],
        predictionObjectiveStartDate: "2026-07-01",
        predictionHorizon: 4,
        predictionFrequency: "Monthly",
        stageStatuses: {
          modelTrainingValidation: {
            modelTrainingCodeNode: "Completed",
            modelValidation: "Awaiting Approval",
          },
        },
        modelLifecycle: {
          training: { status: "Completed" },
        },
      },
    }),
  } as any, {} as any);
  service.runValidation = async (input) => {
    dispatchedInput = input as unknown as Record<string, unknown>;
    return {
      status: "Completed",
      summary: "Validation completed.",
      projectDirectory: "C:\\project",
      candidates: [],
      qualityRecommendations: [],
    };
  };

  const result = await service.approvePending("project-1", true);
  assert.equal(result?.summary, "Validation completed.");
  assert.deepEqual(dispatchedInput, {
    projectId: "project-1",
    selectedModels: ["candidate-1"],
    validationOptions: {
      predictionObjectiveStartDate: "2026-07-01",
      predictionHorizon: 4,
      predictionFrequency: "Monthly",
      filters: {},
    },
  });
});

test("declined lifecycle approval pauses without starting the pending stage", async () => {
  let updatedAgentState: Record<string, unknown> | undefined;
  let replaceState: boolean | undefined;
  const service = new ModelLifecycleService({
    getById: async () => ({
      id: "project-1",
      agentState: {
        selectedModels: ["candidate-1"],
        stageStatuses: { modelTrainingValidation: { preFlightNode: "Completed" } },
      },
    }),
    updateAgentState: async (
      _projectId: string,
      state: Record<string, unknown>,
      _useCase?: string,
      replace?: boolean
    ) => {
      updatedAgentState = state;
      replaceState = replace;
      return true;
    },
  } as any, {} as any);
  let runStarted = false;
  service.runTraining = async () => {
    runStarted = true;
    throw new Error("Training should not start when approval is declined.");
  };

  const result = await service.approvePending("project-1", false);
  assert.equal(result, undefined);
  assert.equal(runStarted, false);
  assert.equal(updatedAgentState?.status, "Paused");
  assert.equal(replaceState, undefined);
});

test("parseAgentJsonResponse handles markdown-wrapped JSON code blocks", () => {
  const markdownResponse = [
    "Here is the authored project implementation:",
    "```json",
    "{",
    '  "summary": "Authored complete training pipeline",',
    '  "executionPlans": {',
    '    "lightgbm": {',
    '      "service": "model-training",',
    '      "command": ["python", "main.py"],',
    '      "reportPath": "model_training_report.json"',
    "    }",
    "  }",
    "}",
    "```",
    "All files written successfully."
  ].join("\n");

  const parsed = parseAgentJsonResponse<any>(markdownResponse);
  assert.equal(parsed.summary, "Authored complete training pipeline");
  assert.deepEqual(parsed.executionPlans.lightgbm.command, ["python", "main.py"]);

  const validated = ProjectAuthorSchema.parse(parsed);
  assert.equal(validated.summary, "Authored complete training pipeline");
  assert.equal(validated.executionPlans.lightgbm.service, "model-training");
});

test("parseAgentJsonResponse handles plain JSON and trims whitespace", () => {
  const plainResponse = '{"summary":"Direct JSON test","executionPlans":{}}';
  const parsed = parseAgentJsonResponse<any>(plainResponse);
  assert.equal(parsed.summary, "Direct JSON test");
});

test("MetricsQualitySchema and parseJson handle null championCandidateId and markdown fences", () => {
  const rawResponse = [
    "```json",
    "{",
    '  "action": "improve_quality",',
    '  "rationale": "Execution evidence reveals severe target leakage.",',
    '  "metricsValid": false,',
    '  "modelQuality": "needs_improvement",',
    '  "candidateRankings": ["lightgbm_sota"],',
    '  "championCandidateId": null,',
    '  "recommendations": ["Update data/data_loader.py"]',
    "}",
    "```"
  ].join("\n");

  const parsed = parseJson<any>(rawResponse, null as any);
  assert.equal(parsed.action, "improve_quality");
  assert.equal(parsed.championCandidateId, null);

  const validated = MetricsQualitySchema.parse(parsed);
  assert.equal(validated.action, "improve_quality");
  assert.equal(validated.championCandidateId, undefined);
  assert.equal(validated.metricsValid, false);
});

test("modelExportArtifactSchema accepts candidate exports saved under artifacts/models", () => {
  const candidateExports = [
    {
      format_id: "joblib",
      artifact_path: "artifacts/models/lightgbm/model.joblib",
      status: "Completed",
      export_status: "exported",
      format_name: "Joblib",
      extension: ".joblib",
      runtime: "joblib",
      assets: {
        preprocessor: "artifacts/models/lightgbm/preprocessor.joblib",
      },
      validation: {
        reloaded: true,
        prediction_parity_passed: true,
      },
    },
  ];

  const parsed = modelExportArtifactSchema.array().parse(candidateExports);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].format_id, "joblib");
  assert.equal(parsed[0].artifact_path, "artifacts/models/lightgbm/model.joblib");
  assert.equal(parsed[0].validation?.prediction_parity_passed, true);
  assert.equal(parsed[0].assets?.preprocessor, "artifacts/models/lightgbm/preprocessor.joblib");
});

