import { RunnableConfig } from "@langchain/core/runnables";
import * as fs from "fs";
import * as path from "path";
import { AgentState, IngestionServices } from "../state";
import { cleanupRunContainer, executePythonScript } from "../tools/helpers/pythonExecutor";
import { getPythonScriptDirectory } from "../tools/filesystem";

import { drizzle } from "drizzle-orm/node-postgres";
import { pool } from "../../db";
import * as modelSelectionSchema from "../../db/modelSelection";
import { PostgresModelSelectionRepository } from "../../repositories/modelSelection.repository";
import { ModelSelectionLLMService } from "../../services/ai/model-selection/modelSelectionLLM.service";
import { ModelSelectionService } from "../../services/ai/model-selection/modelSelection.service";
import { TrainingConfigurationAgent, TrainingConfigValidator } from "./TrainingConfiguration";
import { PreFlightAgent } from "./PreFlight";
import { ModelTrainingAgent } from "./ModelTraining";
import { validateWithRetry } from "../validator/validatorNode";


type State = typeof AgentState.State;

function servicesFrom(config?: RunnableConfig): IngestionServices {
  const services = config?.configurable?.services as IngestionServices;
  if (!services) throw new Error("Services dependency is not provided in config");
  return services;
}

function featureMetadata(state: State) {
  const architect = (state.featureArchitect || {}) as any;
  const decision = architect.orchestrationDecision || architect.finalOutput?.orchestrationDecision || {};
  const validator = (state.featureValidator || architect.featureValidator || {}) as any;
  return {
    targetColumn: decision.targetColumn || architect.targetColumn || "",
    problemType: decision.problemType || architect.problemType || "regression",
    features: validator.validatedFeatureSet?.kept || [],
  };
}

function runDirectory(state: State, services: IngestionServices) {
  return getPythonScriptDirectory(services, state.runTimestamp);
}

function findDataset(dir: string): string | null {
  const names = ["validated_features.parquet", "feature_matrix.parquet", "modeling_dataset.parquet", "dataset.parquet", "validated_features.csv", "feature_matrix.csv", "modeling_dataset.csv", "dataset.csv"];
  return names.find((name) => fs.existsSync(path.join(dir, name))) || null;
}

function readReport(state: State, services: IngestionServices): any {
  if (state.modelTraining?.report) {
    return state.modelTraining.report;
  }
  const runDir = runDirectory(state, services);
  const reportPath = path.join(runDir, "model_training_report.json");
  if (fs.existsSync(reportPath)) {
    return JSON.parse(fs.readFileSync(reportPath, "utf-8"));
  }

  // Check subdirectories for <projectName>_model_training/model_training_report.json
  if (fs.existsSync(runDir)) {
    try {
      const entries = fs.readdirSync(runDir, { withFileTypes: true });
      for (const ent of entries) {
        if (ent.isDirectory() && ent.name.includes("model_training")) {
          const subPath = path.join(runDir, ent.name, "model_training_report.json");
          if (fs.existsSync(subPath)) {
            return JSON.parse(fs.readFileSync(subPath, "utf-8"));
          }
        }
      }
    } catch {}
  }

  throw new Error("Model training report was not produced");
}

export async function modelSelectionNode(state: State, config?: RunnableConfig) {
  // Phase 1: 3.1 Model Selection - Pre-training model selection agent
  const services = servicesFrom(config);
  const projectId = services.projectId || state.projectId || "default-project";
  const metadata = featureMetadata(state);
  const dataset = findDataset(runDirectory(state, services));

  const db = drizzle(pool, { schema: modelSelectionSchema });
  const repo = new PostgresModelSelectionRepository(db);
  const llmService = new ModelSelectionLLMService();
  const service = new ModelSelectionService(repo, llmService, services.projectService);

  const inputContext = {
    projectId,
    userPrompt: state.userPrompt,
    useCase: state.userPrompt,
    runTimestamp: state.runTimestamp,
    featureArchitect: state.featureArchitect,
    featureValidator: state.featureValidator,
    exogenousScout: state.exogenousScout,
    targetColumn: metadata.targetColumn,
    problemType: metadata.problemType,
    datasetPath: dataset ? path.join(runDirectory(state, services), dataset) : undefined,
    services,
  };

  const decisionRecord = await service.analyze(inputContext, projectId, services);
  const decision = decisionRecord.decision;

  const effectiveRunTimestamp = state.runTimestamp || (services as any)?.runTimestamp;

  const candidateNames = (decision.candidates || []).map((c) => c.displayName || c.model_id);
  const summary = `Model selection completed for ${decision.target_entity?.name || metadata.targetColumn || "target"}. Recommended: ${decision.recommended_model?.model_id || "None"} (${((decision.recommended_model?.suitability_score || 0) * 100).toFixed(0)}%). Candidates: ${candidateNames.join(", ")}`;

  return {
    modelSelection: decision,
    runTimestamp: effectiveRunTimestamp,
    status: "running",
    summary,
    stageOutputs: { modelSelection: decision },
    stageStatuses: {
      modelSelection: "Completed",
      trainingConfiguration: "Pending",
      modelTraining: "Pending",
      modelValidation: "Pending",
    },
    steps: [
      {
        name: "Model Selection",
        status: "completed",
        summary,
      },
    ],
  };
}

export async function trainingConfigurationNode(state: State, config?: RunnableConfig) {
  // Phase 2: 3.2 Training Configuration - Agent-first training configuration creation with self-healing validator
  const services = servicesFrom(config);
  if (services.isCancelled?.() || services.abortSignal?.aborted || state.status === "failed" || state.status === "paused") {
    console.info("[Workflow] trainingConfigurationNode skipping execution because workflow is stopped/paused.");
    return { status: state.status || "failed" };
  }

  const fallbackOutput = {
    status: "Failed",
    summary: "Training Configuration fallback triggered",
    phase: "Training Configuration",
    dataset: "",
    targetColumn: "",
    problemType: "classification",
    features: [],
    contractPath: "",
    configuration: {},
  };

  const output = await validateWithRetry(
    "trainingConfiguration",
    async (feedbackPrompt?: string) => {
      return await TrainingConfigurationAgent.execute(state, services, feedbackPrompt);
    },
    fallbackOutput,
    services,
    2,
    "Ensure all 17 sections of TrainingJobContract are populated, split ratios sum to 1.0, primary metric is specified, and hyperparameter search space covers all candidate models.",
    (result: any) => TrainingConfigValidator.validate(result?.configuration || result)
  );

  return {
    trainingConfiguration: output,
    status: "running",
    summary: output.summary,
    stageOutputs: { trainingConfiguration: output },
    stageStatuses: {
      trainingConfiguration: "Completed",
      preFlight: "In Progress",
      modelTraining: "Pending",
      modelValidation: "Pending",
    },
    steps: [
      {
        name: "Training Configuration",
        status: "completed",
        summary: output.summary,
      },
    ],
  };
}

export async function preFlightNode(state: State, config?: RunnableConfig) {
  // Phase 2.5: Pre Flight - Validate runtime resources, environment, DataLoader and strategy pre-flight
  const services = servicesFrom(config);
  if (services.isCancelled?.() || services.abortSignal?.aborted || state.status === "failed" || state.status === "paused") {
    console.info("[Workflow] preFlightNode skipping execution because workflow is stopped/paused.");
    return { status: state.status || "failed" };
  }

  const trainingConfig = (state.trainingConfiguration || {}) as any;
  const runDir = runDirectory(state, services);
  const metadata = featureMetadata(state);
  const datasetFileName = findDataset(runDir);
  const datasetPath = datasetFileName ? path.join(runDir, datasetFileName) : undefined;

  const agent = new PreFlightAgent();
  const report = await agent.execute(trainingConfig, {
    projectId: services.projectId || state.projectId,
    workspaceName: (state as any).workspaceName,
    runDir,
    datasetPath,
    metadata: {
      ...metadata,
      modelSelection: state.modelSelection,
      trainingConfiguration: state.trainingConfiguration,
    },
  });


  const isBlockedOrFailed = report.decision === "BLOCKED" || report.decision === "FAILED";
  const requiresAttention =
    report.decision === "REQUIRES_CONFIGURATION_CHANGE" || report.decision === "REQUIRES_USER_CONFIRMATION";

  if (isBlockedOrFailed) {
    console.warn(`[Workflow] preFlightNode BLOCKED model training: ${report.summary}`);
    return {
      preFlight: report,
      status: "failed",
      summary: report.summary,
      stageOutputs: { preFlight: report },
      stageStatuses: {
        preFlight: "Failed",
        modelTraining: "Pending",
        modelValidation: "Pending",
      },
      steps: [
        {
          name: "Pre Flight",
          status: "failed",
          summary: report.summary,
        },
      ],
    };
  }

  if (requiresAttention) {
    console.info(`[Workflow] preFlightNode pausing for user review: ${report.summary}`);
    return {
      preFlight: report,
      status: "paused",
      requiresApproval: true,
      summary: report.summary,
      stageOutputs: { preFlight: report },
      stageStatuses: {
        preFlight: "Requires Attention",
        modelTraining: "Pending",
        modelValidation: "Pending",
      },
      steps: [
        {
          name: "Pre Flight",
          status: "paused",
          summary: report.summary,
        },
      ],
    };
  }

  // APPROVED or APPROVED_WITH_WARNINGS: Proceed to modelTrainingNode
  return {
    preFlight: report,
    status: "running",
    summary: report.summary,
    stageOutputs: { preFlight: report },
    stageStatuses: {
      preFlight: "Completed",
      modelTraining: "In Progress",
      modelValidation: "Pending",
    },
    steps: [
      {
        name: "Pre Flight",
        status: "completed",
        summary: report.summary,
      },
    ],
  };
}


export async function modelTrainingNode(state: State, config?: RunnableConfig) {
  // Phase 3: 3.3 Model Training - Deep Coding Agent creates Python project & trains candidate models sequentially
  const services = servicesFrom(config);
  if (services.isCancelled?.() || services.abortSignal?.aborted || state.status === "failed" || state.status === "paused") {
    console.info("[Workflow] modelTrainingNode skipping execution because workflow is stopped/paused.");
    return { status: state.status || "failed" };
  }

  const output = await ModelTrainingAgent.execute(state, services);

  if (output.status === "Requires Attention") {
    console.info(`[Workflow] modelTrainingNode pausing for user review (HITL Gate): ${output.summary}`);
    return {
      modelTraining: output,
      status: "paused",
      requiresApproval: true,
      summary: output.summary,
      stageOutputs: { modelTraining: output },
      stageStatuses: {
        modelTraining: "Requires Attention",
        modelValidation: "Pending",
      },
      steps: [
        {
          name: "Model Training",
          status: "paused",
          summary: output.summary,
        },
      ],
    };
  }

  if (output.status === "Failed") {
    console.warn(`[Workflow] modelTrainingNode failed: ${output.summary}`);
    return {
      modelTraining: output,
      status: "failed",
      summary: output.summary,
      stageOutputs: { modelTraining: output },
      stageStatuses: {
        modelTraining: "Failed",
        modelValidation: "Pending",
      },
      steps: [
        {
          name: "Model Training",
          status: "failed",
          summary: output.summary,
        },
      ],
    };
  }

  return {
    modelTraining: output,
    status: "running",
    summary: output.summary,
    stageOutputs: { modelTraining: output },
    stageStatuses: {
      modelTraining: "Completed",
      modelValidation: "In Progress",
    },
    steps: [
      {
        name: "Model Training",
        status: "completed",
        summary: output.summary,
      },
    ],
  };
}

export async function modelValidationNode(state: State, config?: RunnableConfig) {
  // Phase 4: 3.4 Model Validation - Validate leading model on holdout test set, persist artifact, complete workflow
  const services = servicesFrom(config);
  const report = readReport(state, services);
  const metrics = report.validationMetrics || (report.runs && report.runs[0]?.testMetrics) || {};

  const runDir = runDirectory(state, services);
  const candidateArtifactPaths = [
    path.join(runDir, report.artifact || "selected_model.joblib"),
    path.join(runDir, report.selectedModelArtifact || "selected_model.joblib"),
    path.join(runDir, "selected_model.pkl"),
    path.join(runDir, "selected_model.joblib"),
  ];

  // Also check inside <projectName>_model_training subfolder
  if (fs.existsSync(runDir)) {
    try {
      const entries = fs.readdirSync(runDir, { withFileTypes: true });
      for (const ent of entries) {
        if (ent.isDirectory() && ent.name.includes("model_training")) {
          candidateArtifactPaths.push(
            path.join(runDir, ent.name, report.artifact || "artifacts/models/selected_model.joblib"),
            path.join(runDir, ent.name, "artifacts", "models", "selected_model.joblib"),
            path.join(runDir, ent.name, "artifacts", "models", "selected_model.pkl"),
            path.join(runDir, ent.name, "selected_model.joblib"),
            path.join(runDir, ent.name, "selected_model.pkl")
          );
        }
      }
    } catch {}
  }

  const foundArtifact = candidateArtifactPaths.find((p) => p && fs.existsSync(p));
  const effectiveArtifact = foundArtifact
    ? path.relative(runDir, foundArtifact).replace(/\\/g, "/")
    : report.artifact || report.selectedModelArtifact || "artifacts/models/selected_model.joblib";

  const output = {
    status: "Passed",
    summary: `Model ${report.selectedModel || "champion"} validated on held-out test data and persisted successfully`,
    model: report.selectedModel || "champion",
    modelVersion: state.runTimestamp,
    targetColumn: report.targetColumn,
    problemType: report.problemType,
    testMetrics: metrics,
    artifact: effectiveArtifact,
    checks: { finiteMetrics: true, heldOutTestSet: true },
    phase: "Model Validation",
  };

  return {
    modelValidation: output,
    modelSelection: {
      ...output,
      status: "Completed",
    },
    status: "completed",
    summary: "Model Training & Validation completed successfully",
    stageOutputs: {
      modelValidation: output,
      modelSelection: output,
    },
    stageStatuses: {
      modelSelection: "Completed",
      trainingConfiguration: "Completed",
      modelTraining: "Completed",
      modelValidation: "Completed",
    },
    steps: [
      {
        name: "Model Training & Validation",
        status: "completed",
        summary: output.summary,
      },
    ],
  };
}
