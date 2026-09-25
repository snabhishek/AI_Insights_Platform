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
import { ModelValidationAgent } from "./ModelValidation";
import * as modelValidationSchema from "../../db/modelValidation";
import { PostgresModelValidationRepository } from "../../repositories/modelValidation.repository";
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
  const summary = `Model selection completed for ${decision.target_entity?.name || metadata.targetColumn || "target"}. Recommended: ${decision.recommended_model?.model_id || "None"} (${((decision.recommended_model?.suitability_score || 0) * 100).toFixed(0)}%). Candidates (${candidateNames.length}): ${candidateNames.join(", ")}`;

  return {
    modelSelection: decision,
    runTimestamp: effectiveRunTimestamp,
    status: "running",
    summary,
    stageOutputs: { modelSelection: decision },
    stageStatuses: {
      modelSelection: "Completed",
      trainingConfiguration: "Pending",
      preFlight: "Pending",
      modelTrainingCode: "Pending",
      modelTraining: "Pending",
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

  // Calculate dataset temporal range and maximum last date of dataset directly in trainingConfigurationNode
  try {
    const { extractDatasetDateRange } = await import("../tools/helpers/datasetDateRangeHelper");
    const wsName = (state as any).workspaceName || services.workspaceName || "DefaultWorkspace";
    const pName = (state as any).projectName || services.projectName || "Forecasting";
    const ts = state.runTimestamp || (services as any)?.runTimestamp;
    const dateRange = await extractDatasetDateRange(wsName, pName, ts, state as any);
    if (dateRange && dateRange.hasTemporalData) {
      (output as any).dateRange = dateRange;
      if (dateRange.maxDate) {
        (output as any).maxDate = dateRange.maxDate;
      }
      if (dateRange.minDate) {
        (output as any).minDate = dateRange.minDate;
      }
      if (output.configuration) {
        (output.configuration as any).dateRange = dateRange;
        if (dateRange.maxDate) {
          (output.configuration as any).maxDate = dateRange.maxDate;
          if ((output.configuration as any).split) {
            (output.configuration as any).split.max_date = dateRange.maxDate;
          }
        }
      }
    }
  } catch (rangeErr: any) {
    console.warn("[trainingConfigurationNode] Failed to extract dataset date range:", rangeErr?.message || rangeErr);
  }

  // Preserve split date explicitly on output and configuration
  const resolvedSplitDate =
    state.splitEndDate ||
    state.splitDate ||
    (output as any)?.configuration?.split?.split_date ||
    (output as any)?.configuration?.data_splitting?.cutoff_date ||
    (output as any)?.configuration?.splitDate;
  if (resolvedSplitDate) {
    (output as any).splitDate = resolvedSplitDate;
    if (output.configuration) {
      (output.configuration as any).splitDate = resolvedSplitDate;
    }
  }

  return {
    trainingConfiguration: output,
    status: "running",
    summary: output.summary,
    stageOutputs: { trainingConfiguration: output },
    stageStatuses: {
      trainingConfiguration: "Completed",
      preFlight: "Pending",
      modelTrainingCode: "Pending",
      modelTraining: "Pending",
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
  // Phase 2.5: Pre Flight - Runs automatically to validate resources and readiness (no user approval required)
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

  if (isBlockedOrFailed) {
    console.warn(`[Workflow] preFlightNode BLOCKED model training: ${report.summary}`);
    return {
      preFlight: report,
      status: "failed",
      summary: report.summary,
      stageOutputs: { preFlight: report },
      stageStatuses: {
        preFlight: "Failed",
        modelTrainingCode: "Pending",
        modelTraining: "Pending",
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

  // Automatic transition: status "running" cascades immediately into modelTrainingCodeNode
  return {
    preFlight: report,
    status: "running",
    summary: report.summary,
    stageOutputs: { preFlight: report },
    stageStatuses: {
      preFlight: "Completed",
      modelTrainingCode: "Pending",
      modelTraining: "Pending",
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

/**
 * Step 4A: Scaffolds modular Python model training project with train split dates.
 * Does NOT run Docker container.
 */
export async function modelTrainingCodeNode(state: State, config?: RunnableConfig) {
  const services = servicesFrom(config);
  if (services.isCancelled?.() || services.abortSignal?.aborted || state.status === "failed" || state.status === "paused") {
    console.info("[Workflow] modelTrainingCodeNode skipping execution because workflow is stopped/paused.");
    return { status: state.status || "failed" };
  }

  const output = await ModelTrainingAgent.generateProjectCode(state, services);

  if (output.status === "Failed") {
    return {
      modelTrainingCode: output,
      modelTraining: output,
      status: "failed",
      summary: output.summary,
      stageOutputs: { modelTrainingCode: output, modelTraining: output },
      stageStatuses: {
        modelTrainingCode: "Failed",
        modelTraining: "Pending",
      },
      steps: [
        {
          name: "Model Training Code Generation",
          status: "failed",
          summary: output.summary,
        },
      ],
    };
  }

  return {
    modelTrainingCode: output,
    modelTraining: output,
    status: "running",
    summary: output.summary,
    stageOutputs: { modelTrainingCode: output, modelTraining: output },
    stageStatuses: {
      modelTrainingCode: "Completed",
      modelTraining: "In Progress",
    },
    steps: [
      {
        name: "Model Training Code Generation",
        status: "completed",
        summary: output.summary,
      },
    ],
  };
}

/**
 * Step 4B: Executes Python project in Docker sandbox for user-selected candidate models.
 */
export async function modelTrainingExecNode(state: State, config?: RunnableConfig) {
  const services = servicesFrom(config);
  if (services.isCancelled?.() || services.abortSignal?.aborted || state.status === "failed" || state.status === "paused") {
    console.info("[Workflow] modelTrainingExecNode skipping execution because workflow is stopped/paused.");
    return { status: state.status || "failed" };
  }

  const output = await ModelTrainingAgent.executeContainerTraining(state, services, {maxRetries: 20});

  if (output.status === "Failed") {
    return {
      modelTraining: output,
      status: "failed",
      summary: output.summary,
      stageOutputs: { modelTraining: output },
      stageStatuses: {
        modelTraining: "Failed",
      },
      steps: [
        {
          name: "Model Training Execution",
          status: "failed",
          summary: output.summary,
        },
      ],
    };
  }

  return {
    modelTraining: output,
    status: "completed",
    summary: output.summary,
    stageOutputs: { modelTraining: output },
    stageStatuses: {
      modelTraining: "Completed",
    },
    steps: [
      {
        name: "Model Training Execution",
        status: "completed",
        summary: output.summary,
      },
    ],
  };
}

/**
 * Legacy single-node modelTrainingNode maintained for backward compatibility.
 */
export async function modelTrainingNode(state: State, config?: RunnableConfig) {
  const services = servicesFrom(config);
  if (services.isCancelled?.() || services.abortSignal?.aborted || state.status === "failed" || state.status === "paused") {
    return { status: state.status || "failed" };
  }
  const output = await ModelTrainingAgent.execute(state, services);
  return {
    modelTraining: output,
    status: output.status === "Failed" ? "failed" : "completed",
    summary: output.summary,
    stageOutputs: { modelTraining: output },
    stageStatuses: { modelTraining: output.status === "Failed" ? "Failed" : "Completed" },
    steps: [{ name: "Model Training", status: output.status === "Failed" ? "failed" : "completed", summary: output.summary }],
  };
}

export async function modelValidationNode(state: State, config?: RunnableConfig) {
  // Phase 4: 3.4 Model Validation - Validate trained candidate models, calculate deterministic metrics, persist in dedicated validation directory
  const services = servicesFrom(config);
  const projectId = services.projectId || state.projectId || "default-project";

  const options = {
    predictionHorizon: (state as any).predictionHorizon,
    predictionFrequency: (state as any).predictionFrequency,
    predictionObjectiveStartDate: (state as any).predictionObjectiveStartDate,
    maxRetries: 20
  };

  const output = await ModelValidationAgent.execute(state, services, options);

  // Persist to Postgres database repository if available
  try {
    const db = drizzle(pool, { schema: modelValidationSchema });
    const repo = new PostgresModelValidationRepository(db);
    if (output.report) {
      const runId = output.report.validation_run_id || `val-${state.runTimestamp || Date.now()}`;
      await repo.saveValidationRun(
        runId,
        projectId,
        output.report,
        output.validationDirectory,
        output.predictionsArtifact
      );
    }
  } catch (persistErr: any) {
    console.warn("[modelValidationNode] Postgres persistence warning:", persistErr?.message || persistErr);
  }

  const isFailed = output.status === "Failed";

  return {
    modelValidation: output,
    status: isFailed ? "failed" : "completed",
    summary: output.summary,
    stageOutputs: {
      modelValidation: output,
    },
    stageStatuses: {
      modelSelection: "Completed",
      trainingConfiguration: "Completed",
      modelTraining: "Completed",
      modelValidation: isFailed ? "Failed" : "Completed",
    },
    steps: [
      {
        name: "Model Validation",
        status: isFailed ? "failed" : "completed",
        summary: output.summary,
      },
    ],
  };
}
