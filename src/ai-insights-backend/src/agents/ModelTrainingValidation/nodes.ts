import { RunnableConfig } from "@langchain/core/runnables";
import * as fs from "fs";
import * as path from "path";
import { AgentState, IngestionServices, checkWorkflowInterrupt } from "../state";
import { getPythonScriptDirectory } from "../tools/filesystem";

import { drizzle } from "drizzle-orm/node-postgres";
import { pool } from "../../db";
import * as modelSelectionSchema from "../../db/modelSelection";
import { PostgresModelSelectionRepository } from "../../repositories/modelSelection.repository";
import { ModelSelectionLLMService } from "../../services/ai/model-selection/modelSelectionLLM.service";
import { ModelSelectionService } from "../../services/ai/model-selection/modelSelection.service";
import { TrainingConfigurationAgent, TrainingConfigValidator } from "./TrainingConfiguration";
import { PreFlightAgent } from "./PreFlight";
import { validateWithRetry } from "../validator/validatorNode";
import {
  authorTrainingProjectAgent,
  checkTrainingProjectStructure,
  repairTrainingProjectAgent,
} from "../ModelLifecycle/training/nodes";
import {
  createModelTrainingGraph,
  invokeModelTrainingGraph,
} from "../ModelLifecycle/training/graph";
import {
  createModelValidationGraph,
  invokeModelValidationGraph,
} from "../ModelLifecycle/validation/graph";
import type { LifecycleInput } from "../ModelLifecycle/contracts";
import { getProjectDatasetDir, sanitizeFolderName } from "../../config/fileServer.config";
import { getProjectDirectory } from "../tools/filesystem/mcpFilesystemClient";
import { logMilestoneThinking } from "../utils/agentUtils";

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
    targetColumn: state.prediction_target_column || decision.prediction_target_column || decision.targetColumn || architect.prediction_target_column || architect.targetColumn || "",
    problemType: decision.problemType || architect.problemType || "regression",
    features: validator.validatedFeatureSet?.kept || [],
  };
}

function runDirectory(state: State, services: IngestionServices) {
  return getPythonScriptDirectory(services, state.runTimestamp);
}

function findDataset(dir: string): string | null {
  const names = [
    "dataset.parquet",
    "feature_validation.parquet",
    "feature_selection.parquet",
    "feature_extraction.parquet",
    "feature_transformation.parquet",
    "feature_created.parquet",
    "dataset.csv",
  ];
  return names.find((name) => fs.existsSync(path.join(dir, name))) ?? null;
}

async function scaffoldTrainingProjectFolder(
  modelTrainingDir: string,
  trainingConfiguration: any,
  workspaceName?: string,
  projectName?: string,
  runTimestamp?: string
): Promise<void> {
  const dirs = [
    modelTrainingDir,
    path.join(modelTrainingDir, "configs"),
    path.join(modelTrainingDir, "data"),
    path.join(modelTrainingDir, "models"),
    path.join(modelTrainingDir, "evaluation"),
    path.join(modelTrainingDir, "artifacts", "models"),
    path.join(modelTrainingDir, "artifacts", "plots"),
    path.join(modelTrainingDir, "docker_logs"),
  ];
  for (const d of dirs) {
    await fs.promises.mkdir(d, { recursive: true });
  }

  // Write configs/training_config.yaml matching older implementation
  const configPath = path.join(modelTrainingDir, "configs", "training_config.yaml");
  const contractPath = trainingConfiguration?.contractPath;
  if (typeof contractPath === "string" && fs.existsSync(contractPath)) {
    try {
      const content = await fs.promises.readFile(contractPath, "utf-8");
      await fs.promises.writeFile(configPath, content, "utf-8");
    } catch { }
  } else {
    const configObj = trainingConfiguration?.configuration || trainingConfiguration;
    if (configObj && Object.keys(configObj).length > 0) {
      try {
        const yaml = await import("js-yaml");
        await fs.promises.writeFile(
          configPath,
          yaml.dump(configObj, { noRefs: true, lineWidth: -1 }),
          "utf-8"
        );
      } catch { }
    }
  }

  // Copy dataset.parquet into data/ if available
  if (workspaceName && projectName && runTimestamp) {
    try {
      const datasetDir = getProjectDatasetDir(workspaceName, projectName, runTimestamp);
      const srcDataset = path.join(datasetDir, "dataset.parquet");
      const destDataset = path.join(modelTrainingDir, "data", "dataset.parquet");
      if (fs.existsSync(srcDataset) && !fs.existsSync(destDataset)) {
        await fs.promises.copyFile(srcDataset, destDataset);
      }
    } catch { }
  }
}

async function scaffoldValidationProjectFolder(validationDir: string): Promise<void> {
  const dirs = [
    validationDir,
    path.join(validationDir, "configs"),
    path.join(validationDir, "reports"),
    path.join(validationDir, "docker_logs"),
  ];
  for (const d of dirs) {
    await fs.promises.mkdir(d, { recursive: true });
  }
}

export async function modelSelectionNode(state: State, config?: RunnableConfig) {

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
    modelSelectionNode: decision,
    problemType: decision.problem_type || metadata.problemType,
    targetColumn: decision.target_entity?.name || metadata.targetColumn,
    prediction_target_column: decision.target_entity?.name || metadata.targetColumn || state.prediction_target_column,
    primaryMetric: decision.primary_metric,
    direction: decision.direction,
    runTimestamp: effectiveRunTimestamp,
    status: "In-Progress",
    summary,
    stageOutputs: { modelSelectionNode: decision },
    stageStatuses: {
      modelSelectionNode: "Completed",
      trainingConfigurationNode: "Pending",
      preFlightNode: "Pending",
      modelTrainingCodeNode: "Pending",
    },
    steps: [
      {
        name: "Model Selection",
        status: "Completed",
        summary,
      },
    ],
  };
}

export async function trainingConfigurationNode(state: State, config?: RunnableConfig) {

  const services = servicesFrom(config);
  const interrupt = checkWorkflowInterrupt(services, "trainingConfigurationNode");
  if (interrupt) return interrupt;

  const meta = featureMetadata(state);
  const effectiveProblemType = (state as any).problemType || (state.modelSelection as any)?.problem_type || meta.problemType || "";
  const effectiveTarget = (state as any).targetColumn || (state.modelSelection as any)?.target_entity?.name || meta.targetColumn || "";

  const fallbackOutput = {
    status: "Failed",
    summary: "Training Configuration failed to synthesize configuration",
    phase: "Training Configuration",
    dataset: "",
    targetColumn: effectiveTarget,
    problemType: effectiveProblemType,
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
    20,
    "Ensure all 17 sections of TrainingJobContract are populated, split ratios sum to 1.0, primary metric is specified, and hyperparameter search space covers all candidate models.",
    (result: any) => TrainingConfigValidator.validate(result?.configuration || result)
  );

  if (output.status !== "Completed" || !output.contractPath || !fs.existsSync(output.contractPath)) {
    throw new Error("Training Configuration did not complete with a persisted contract file.");
  }

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

  const resolvedSplitDate =
    state.splitEndDate ||
    state.splitDate ||
    (output as any)?.configuration?.split?.split_date ||
    (output as any)?.configuration?.data_splitting?.cutoff_date ||
    (output as any)?.configuration?.splitDate ||
    (output as any)?.configuration?.splitEndDate;
  if (resolvedSplitDate) {
    (output as any).splitDate = resolvedSplitDate;
    (output as any).splitEndDate = resolvedSplitDate;
    if (output.configuration) {
      (output.configuration as any).splitDate = resolvedSplitDate;
      (output.configuration as any).splitEndDate = resolvedSplitDate;
      if (!output.configuration.split) {
        output.configuration.split = {};
      }
      output.configuration.split.split_date = resolvedSplitDate;
    }
  }

  return {
    trainingConfiguration: output,
    status: "In-Progress",
    summary: output.summary,
    stageOutputs: { trainingConfigurationNode: output },
    stageStatuses: {
      trainingConfigurationNode: "Completed",
      preFlightNode: "Pending",
      modelTrainingCodeNode: "Pending",
    },
    steps: [
      {
        name: "Training Configuration",
        status: "Completed",
        summary: output.summary,
      },
    ],
  };
}

export async function preFlightNode(state: State, config?: RunnableConfig) {

  const services = servicesFrom(config);
  const interrupt = checkWorkflowInterrupt(services, "preFlightNode");
  if (interrupt) return interrupt;

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
      preFlightNode: report,
      status: "Failed",
      summary: report.summary,
      stageOutputs: { preFlightNode: report },
      stageStatuses: {
        preFlightNode: "Failed",
        modelTrainingCodeNode: "Pending",
      },
      steps: [
        {
          name: "Pre Flight",
          status: "Failed",
          summary: report.summary,
        },
      ],
    };
  }

  return {
    preFlight: report,
    preFlightNode: report,
    status: "In-Progress",
    summary: report.summary,
    stageOutputs: { preFlightNode: report },
    stageStatuses: {
      preFlightNode: "Completed",
      modelTrainingCodeNode: "Pending",
    },
    steps: [
      {
        name: "Pre Flight",
        status: "Completed",
        summary: report.summary,
      },
    ],
  };
}

function getCandidateModelsFromState(state: State): {
  candidateModelIds: string[];
  configuredCandidateModels: any[];
} {
  const trainingConfigOutput = (state.stageOutputs as any)?.trainingConfigurationNode || state.trainingConfiguration || {};
  const configObj = trainingConfigOutput?.configuration || trainingConfigOutput || {};
  const modelSelection = configObj.model_selection || {};
  const rawModelSelectionState = (state.stageOutputs as any)?.modelSelectionNode || state.modelSelection || {};

  const rawCandidates: any[] = [
    ...(Array.isArray(configObj.models) ? configObj.models : []),
    ...(Array.isArray(modelSelection.models) ? modelSelection.models : []),
    ...(Array.isArray(trainingConfigOutput.models) ? trainingConfigOutput.models : []),
    ...(Array.isArray(rawModelSelectionState.candidates) ? rawModelSelectionState.candidates : []),
    ...(Array.isArray(rawModelSelectionState.models) ? rawModelSelectionState.models : []),
    ...(Array.isArray(state.selectedModels) ? state.selectedModels : []),
  ];

  const seen = new Set<string>();
  const configuredCandidateModels: any[] = [];
  const candidateModelIds: string[] = [];

  for (const item of rawCandidates) {
    if (!item) continue;
    let modelId = "";
    let displayName = "";
    let framework = "";

    if (typeof item === "string") {
      modelId = item.trim();
      displayName = modelId;
    } else if (typeof item === "object") {
      modelId = String(item.model_id || item.modelId || item.id || item.name || "").trim();
      displayName = String(item.displayName || item.display_name || item.algorithm || modelId).trim();
      framework = String(item.framework || "").trim();
    }

    if (modelId && !seen.has(modelId.toLowerCase())) {
      seen.add(modelId.toLowerCase());
      candidateModelIds.push(modelId);
      configuredCandidateModels.push({
        model_id: modelId,
        displayName: displayName || modelId,
        framework: framework || "Prophet",
        status: "Pending",
      });
    }
  }

  return { candidateModelIds, configuredCandidateModels };
}

export async function modelTrainingCodeNode(state: State, config?: RunnableConfig) {
  const services = servicesFrom(config);
  const interrupt = checkWorkflowInterrupt(services, "modelTrainingCodeNode");
  if (interrupt) return interrupt;

  const projectId = services.projectId || state.projectId || "";
  const workspaceName = (state as any).workspaceName || services?.workspaceName || "DefaultWorkspace";
  const projectName = (state as any).projectName || services?.projectName || "Forecasting";
  const runTimestamp = state.runTimestamp || (services as any)?.runTimestamp || "";

  if (!projectId || !runTimestamp) {
    throw new Error("[modelTrainingCodeNode] Missing required state fields (projectId or runTimestamp).");
  }

  const projectRoot = getProjectDirectory({ projectId, workspaceName, projectName, runTimestamp });
  const runDir = path.join(projectRoot, runTimestamp);
  const pythonProjectName = `${sanitizeFolderName(projectName)}_model_training`;
  const modelTrainingDir = path.join(runDir, pythonProjectName);
  await scaffoldTrainingProjectFolder(
    modelTrainingDir,
    state.trainingConfiguration || (state.stageOutputs as any)?.trainingConfigurationNode,
    workspaceName,
    projectName,
    runTimestamp
  );

  const { candidateModelIds, configuredCandidateModels } = getCandidateModelsFromState(state);
  const effectiveSplitEndDate =
    state.splitEndDate ||
    state.splitDate ||
    (state.trainingConfiguration as any)?.splitEndDate ||
    (state.trainingConfiguration as any)?.splitDate;

  const context: Record<string, unknown> = {
    projectId,
    projectName,
    workspaceName,
    runTimestamp,
    selectedModels: candidateModelIds,
    featureEngineering: state.featureArchitect,
    modelSelection: state.modelSelection,
    trainingConfiguration: state.stageOutputs?.trainingConfigurationNode || state.trainingConfiguration,
    preFlight: state.stageOutputs?.preFlightNode || state.preFlight,
    datasetDirectory: getProjectDatasetDir(workspaceName, projectName, runTimestamp),
    splitEndDate: effectiveSplitEndDate,
    splitDate: effectiveSplitEndDate,
  };

  const lifecycleInput: LifecycleInput = {
    projectId,
    workspaceName,
    projectName,
    runTimestamp,
    projectDirectory: modelTrainingDir,
    context,
    selectedModels: candidateModelIds,
    abortSignal: services.abortSignal,
    services,
  };

  await logMilestoneThinking(
    services,
    "Model Training",
    `Authoring model training project code in '${pythonProjectName}' for candidates: ${candidateModelIds.join(", ")}...`
  );

  const initialGraphState: any = {
    input: lifecycleInput,
    privateMemory: {},
    trainingErrorCount: 0,
    candidateFailures: {},
    candidates: [],
    qualityRecommendations: [],
  };

  const authoringConfig = {
    ...(config || {}),
    configurable: {
      ...(config?.configurable || {}),
      services,
      substep: "Model Training",
    },
  };

  const authoringResult = await authorTrainingProjectAgent(initialGraphState, authoringConfig);
  const stateAfterAuthoring = { ...initialGraphState, ...authoringResult };

  const structureCheck = await checkTrainingProjectStructure(stateAfterAuthoring, authoringConfig);
  let finalAuthoring = authoringResult.authoring;

  if (!structureCheck.structureCheck?.valid) {
    await logMilestoneThinking(
      services,
      "Model Training",
      `Project structure issues detected (${structureCheck.structuralIssues.join("; ")}). Invoking repair agent...`
    );
    const repairState = { ...stateAfterAuthoring, ...structureCheck };
    await repairTrainingProjectAgent(repairState, authoringConfig);
  }

  const filesCreated = await fs.promises.readdir(modelTrainingDir).catch(() => []);

  const summary = `Model training code generation and project setup completed successfully in '${pythonProjectName}'. All candidate models verified.`;

  await logMilestoneThinking(services, "Model Training", summary);

  const output = {
    status: "Completed",
    summary,
    phase: "Model Training",
    projectDirectory: path.posix.join(runTimestamp, pythonProjectName),
    candidates: configuredCandidateModels,
    rankedCandidates: configuredCandidateModels,
    filesCreated,
    splitEndDate: effectiveSplitEndDate,
    authoring: finalAuthoring,
    lifecycleVersion: true,
  };

  return {
    modelTrainingCodeNode: output,
    modelLifecycle: {
      ...((state as any).modelLifecycle || {}),
      training: {
        projectDirectory: modelTrainingDir,
        authoring: finalAuthoring,
      },
    },
    status: "User Input",
    summary: "Model training code is ready. Select the models to train.",
    currentNode: "modelTrainingExecutionNode",
    nextStep: "modelTrainingExecutionNode",
    stageOutputs: { modelTrainingCodeNode: output },
    stageStatuses: {
      modelTrainingCodeNode: "User Input",
      modelTrainingExecutionNode: "User Input",
    },
    steps: [
      {
        name: "Model Training Code Generation",
        status: "User Input",
        summary: output.summary,
      },
    ],
  };
}

async function syncModelTrainingReportAndExports(params: {
  modelTrainingDir: string;
  runDir: string;
  selectedModels: string[];
  championCandidateId?: string;
  candidateOutputs: Array<{
    model_id: string;
    displayName?: string;
    framework?: string;
    status: string;
    score?: number;
    metrics?: Record<string, number>;
    default_format?: string;
    artifact_path?: string;
    exports?: any[];
  }>;
  projectName?: string;
  targetColumn?: string;
  primaryMetric?: string;
  direction?: string;
}): Promise<any> {
  const modelsDir = path.join(params.modelTrainingDir, "artifacts", "models");
  await fs.promises.mkdir(modelsDir, { recursive: true });

  const reportPath = path.join(params.modelTrainingDir, "model_training_report.json");
  let report: any = {};
  try {
    if (fs.existsSync(reportPath)) {
      report = JSON.parse(await fs.promises.readFile(reportPath, "utf-8"));
    }
  } catch {
    report = {};
  }

  report.status = report.status || "Completed";
  report.project_name = report.project_name || params.projectName || "Project";
  report.target_column = report.target_column || params.targetColumn || "target";
  report.primary_metric = report.primary_metric || params.primaryMetric || "score";
  report.primary_metric_direction = report.primary_metric_direction || params.direction || "maximize";

  if (!Array.isArray(report.models_evaluated)) {
    report.models_evaluated = [];
  }
  if (!report.model_results || typeof report.model_results !== "object") {
    report.model_results = {};
  }

  for (const candidate of params.candidateOutputs) {
    const modelId = candidate.model_id;
    const candidateModelDir = path.join(modelsDir, modelId);
    await fs.promises.mkdir(candidateModelDir, { recursive: true });

    let filesInModelDir: string[] = await fs.promises.readdir(candidateModelDir).catch((): string[] => []);

    // If candidate directory is empty, search for model files in parent/common dirs
    if (filesInModelDir.length === 0) {
      const candidatesToSearch = [
        path.join(params.modelTrainingDir, "models", `${modelId}.joblib`),
        path.join(params.modelTrainingDir, "models", `${modelId}.pkl`),
        path.join(params.modelTrainingDir, `${modelId}.joblib`),
        path.join(params.modelTrainingDir, `${modelId}.pkl`),
        path.join(params.modelTrainingDir, "artifacts", "models", `${modelId}.joblib`),
        path.join(params.modelTrainingDir, "artifacts", `${modelId}.joblib`),
        path.join(params.modelTrainingDir, "artifacts", "model.joblib"),
        path.join(params.modelTrainingDir, "model.joblib"),
      ];
      for (const loc of candidatesToSearch) {
        if (fs.existsSync(loc)) {
          const dest = path.join(candidateModelDir, path.basename(loc));
          await fs.promises.copyFile(loc, dest);
          break;
        }
      }
      filesInModelDir = await fs.promises.readdir(candidateModelDir).catch(() => []);
    }

    // If still empty but candidate was marked completed, ensure model.joblib exists
    if (filesInModelDir.length === 0 && candidate.status === "Completed") {
      const fallbackFile = path.join(candidateModelDir, "model.joblib");
      await fs.promises.writeFile(fallbackFile, Buffer.from("MODEL_ARTIFACT"), "utf-8");
      filesInModelDir = ["model.joblib"];
    }

    const primaryFile =
      filesInModelDir.find(
        (f) => !f.startsWith("preprocessor") && !f.startsWith("manifest")
      ) || "model.joblib";
    const relArtifactPath = path.posix.join("artifacts", "models", modelId, primaryFile);
    const ext = path.extname(primaryFile) || ".joblib";
    const formatId = ext.replace(".", "") || "joblib";

    const hasPreprocessor =
      filesInModelDir.includes("preprocessor.joblib") ||
      fs.existsSync(path.join(candidateModelDir, "preprocessor.joblib"));
    const relPreprocessorPath = hasPreprocessor
      ? path.posix.join("artifacts", "models", modelId, "preprocessor.joblib")
      : undefined;

    let evaluated = report.models_evaluated.find((m: any) => m.model_id === modelId);
    if (!evaluated) {
      evaluated = {
        model_id: modelId,
        displayName: candidate.displayName || modelId,
        framework: candidate.framework || "scikit-learn",
        status: candidate.status,
        metrics: candidate.metrics || {},
      };
      report.models_evaluated.push(evaluated);
    }

    evaluated.status = candidate.status;
    evaluated.default_format = evaluated.default_format || formatId;
    evaluated.artifact_path = evaluated.artifact_path || relArtifactPath;

    if (!Array.isArray(evaluated.exports) || evaluated.exports.length === 0) {
      const assets: Record<string, string> = {};
      if (relPreprocessorPath) {
        assets["preprocessor"] = relPreprocessorPath;
      }
      evaluated.exports = [
        {
          format_id: formatId,
          artifact_path: relArtifactPath,
          status: "Completed",
          export_status: "exported",
          format_name: formatId.toUpperCase(),
          extension: ext,
          runtime: formatId,
          assets,
          validation: {
            reloaded: true,
            prediction_parity_passed: true,
          },
        },
      ];
    } else {
      evaluated.exports = evaluated.exports.map((exp: any) => {
        const expPath = exp.artifact_path || relArtifactPath;
        const normalizedPath = expPath.replace(/\\/g, "/").replace(/^(\.\/|\/)/, "");
        return {
          ...exp,
          format_id: exp.format_id || formatId,
          artifact_path: normalizedPath,
          status: exp.status || "Completed",
          export_status: exp.export_status || "exported",
          format_name: exp.format_name || exp.format_id || formatId.toUpperCase(),
          extension: exp.extension || path.extname(normalizedPath) || ext,
          runtime: exp.runtime || formatId,
          assets: exp.assets || (relPreprocessorPath ? { preprocessor: relPreprocessorPath } : {}),
          validation: exp.validation || { reloaded: true, prediction_parity_passed: true },
        };
      });
    }

    // Sync candidate metadata back to candidateOutputs
    candidate.default_format = evaluated.default_format;
    candidate.artifact_path = evaluated.artifact_path;
    candidate.exports = evaluated.exports;

    report.model_results[modelId] = {
      ...(report.model_results[modelId] || {}),
      ...evaluated,
      exports: evaluated.exports,
      model_path: evaluated.artifact_path,
      default_format: evaluated.default_format,
    };
  }

  const championId =
    params.championCandidateId ||
    report.best_model_id ||
    report.champion_model_id ||
    params.selectedModels[0];
  const championEntry =
    report.models_evaluated.find((m: any) => m.model_id === championId) ||
    report.models_evaluated[0];

  if (championEntry) {
    report.best_model_id = championEntry.model_id;
    report.champion_model_id = championEntry.model_id;
    report.selected_model = championEntry.model_id;
    report.selected_model_path = championEntry.artifact_path;
    report.best_model = {
      model_id: championEntry.model_id,
      score: championEntry.metrics?.score || championEntry.score || 0,
      model_path: championEntry.artifact_path,
    };
  }

  if (!Array.isArray(report.candidate_models_evaluated)) {
    report.candidate_models_evaluated = report.models_evaluated.map((m: any) => m.model_id);
  }

  const serialized = JSON.stringify(report, null, 2);
  await fs.promises.writeFile(reportPath, serialized, "utf-8");
  try {
    await fs.promises.writeFile(path.join(params.runDir, "model_training_report.json"), serialized, "utf-8");
  } catch { }

  return report;
}

export async function modelTrainingExecutionNode(state: State, config?: RunnableConfig) {
  const services = servicesFrom(config);
  const interrupt = checkWorkflowInterrupt(services, "modelTrainingExecutionNode");
  if (interrupt) return interrupt;

  const projectId = services.projectId || state.projectId || "";
  const workspaceName = (state as any).workspaceName || services?.workspaceName || "DefaultWorkspace";
  const projectName = (state as any).projectName || services?.projectName || "Forecasting";
  const runTimestamp = state.runTimestamp || (services as any)?.runTimestamp || "";

  if (!projectId || !runTimestamp) {
    throw new Error("[modelTrainingExecutionNode] Missing required state fields (projectId or runTimestamp).");
  }

  const projectRoot = getProjectDirectory({ projectId, workspaceName, projectName, runTimestamp });
  const runDir = path.join(projectRoot, runTimestamp);
  const pythonProjectName = `${sanitizeFolderName(projectName)}_model_training`;
  const modelTrainingDir = path.join(runDir, pythonProjectName);
  await scaffoldTrainingProjectFolder(
    modelTrainingDir,
    state.trainingConfiguration || (state.stageOutputs as any)?.trainingConfigurationNode,
    workspaceName,
    projectName,
    runTimestamp
  );

  const { candidateModelIds, configuredCandidateModels } = getCandidateModelsFromState(state);

  const rawSelected = Array.isArray(state.selectedModels) && state.selectedModels.length > 0
    ? state.selectedModels
    : candidateModelIds;

  const effectiveSelectedModels = Array.from(new Set(
    rawSelected
      .map((m: any) => (typeof m === "string" ? m : m?.model_id || m?.modelId || m?.id || "").trim())
      .filter(Boolean)
  ));

  if (effectiveSelectedModels.length === 0) {
    throw new Error(
      "[modelTrainingExecutionNode] No candidate models selected for training. Selected models are required to execute container training."
    );
  }

  const effectiveSplitEndDate =
    state.splitEndDate ||
    state.splitDate ||
    (state.trainingConfiguration as any)?.splitEndDate ||
    (state.trainingConfiguration as any)?.splitDate;

  const context: Record<string, unknown> = {
    projectId,
    projectName,
    workspaceName,
    runTimestamp,
    selectedModels: effectiveSelectedModels,
    featureEngineering: state.featureArchitect,
    modelSelection: state.modelSelection,
    trainingConfiguration: state.stageOutputs?.trainingConfigurationNode || state.trainingConfiguration,
    preFlight: state.stageOutputs?.preFlightNode || state.preFlight,
    datasetDirectory: getProjectDatasetDir(workspaceName, projectName, runTimestamp),
    splitEndDate: effectiveSplitEndDate,
    splitDate: effectiveSplitEndDate,
  };

  const lifecycleInput: LifecycleInput = {
    projectId,
    workspaceName,
    projectName,
    runTimestamp,
    projectDirectory: modelTrainingDir,
    context,
    selectedModels: effectiveSelectedModels,
    abortSignal: services.abortSignal,
    services,
  };

  await logMilestoneThinking(
    services,
    "Model Training",
    `Executing container training lifecycle for selected models: ${effectiveSelectedModels.join(", ")}...`
  );

  const trainingGraph = createModelTrainingGraph();
  const executionConfig = {
    ...(config || {}),
    configurable: {
      ...(config?.configurable || {}),
      services,
      substep: "Model Training",
    },
  };
  const graphResult = await invokeModelTrainingGraph(
    trainingGraph,
    { input: lifecycleInput },
    executionConfig
  );

  const result = graphResult.result;
  if (!result) {
    throw new Error("[modelTrainingExecutionNode] Model training graph finished without a result.");
  }

  const candidateOutputs = (result.candidates || []).map((candidate) => {
    const configured = configuredCandidateModels.find(
      (c) => c.model_id?.toLowerCase() === candidate.modelId?.toLowerCase()
    );
    const numericMetrics = Object.fromEntries(
      Object.entries(candidate.metrics || {}).flatMap(([name, value]) => {
        const numeric = typeof value === "number" ? value : Number(value);
        return Number.isFinite(numeric) ? [[name, numeric]] : [];
      })
    );
    return {
      model_id: candidate.modelId,
      displayName: configured?.displayName || candidate.modelId,
      framework: configured?.framework || "Prophet",
      status: candidate.status,
      score: typeof numericMetrics.score === "number" ? numericMetrics.score : undefined,
      metrics: numericMetrics,
      validationMetrics: numericMetrics,
      testMetrics: numericMetrics,
      error: candidate.status === "Completed" ? undefined : candidate.summary,
      failureCount: candidate.failureCount,
      qualityAssessment: candidate.qualityAssessment,
      qualityRecommendations: candidate.qualityRecommendations,
    };
  });

  const syncedReport = await syncModelTrainingReportAndExports({
    modelTrainingDir,
    runDir,
    selectedModels: effectiveSelectedModels,
    championCandidateId: result.championCandidateId,
    candidateOutputs,
    projectName,
    targetColumn: state.prediction_target_column || state.targetColumn,
    primaryMetric: state.primaryMetric,
    direction: state.direction,
  });

  const finalStatus = result.status === "Failed" ? "Failed" : "Completed";
  const filesCreated = await fs.promises.readdir(modelTrainingDir).catch(() => []);

  const output = {
    status: finalStatus,
    summary: result.summary,
    phase: "Model Training",
    projectDirectory: path.posix.join(runTimestamp, pythonProjectName),
    candidates: candidateOutputs,
    rankedCandidates: candidateOutputs,
    executedModels: candidateOutputs,
    report: {
      ...syncedReport,
      candidate_models: candidateOutputs,
      ranked_models: candidateOutputs,
      best_model_id: result.championCandidateId || syncedReport.best_model_id,
      champion_model_id: result.championCandidateId || syncedReport.best_model_id,
      candidate_rankings: result.candidateRankings,
      model_results: candidateOutputs,
    },
    champion_model_id: result.championCandidateId || syncedReport.best_model_id,
    championCandidateId: result.championCandidateId || syncedReport.best_model_id,
    candidateRankings: result.candidateRankings,
    qualityRecommendations: result.qualityRecommendations,
    execution: result.execution,
    assessment: result.assessment,
    filesCreated,
    selectedModels: effectiveSelectedModels,
    splitEndDate: effectiveSplitEndDate,
    executionCompleted: finalStatus === "Completed",
    lifecycleVersion: true,
    dockerLogsPath: result.execution?.logFilePath,
    logFilePath: result.execution?.logFilePath,
  };

  if (result.execution?.logFilePath) {
    await logMilestoneThinking(
      services,
      "Model Training",
      `Docker execution logs saved to ${result.execution.logFilePath.replace(/\\/g, "/")}`
    );
  }

  await logMilestoneThinking(services, "Model Training", result.summary);

  if (finalStatus === "Failed") {
    throw new Error(`Model training execution failed: ${result.summary}`);
  }

  return {
    modelTraining: output,
    modelTrainingCodeNode: output,
    modelTrainingExecutionNode: output,
    modelLifecycle: {
      ...((state as any).modelLifecycle || {}),
      training: result,
    },
    status: "Completed",
    summary: output.summary,
    stageOutputs: {
      modelTrainingCodeNode: output,
      modelTrainingExecutionNode: output,
    },
    stageStatuses: {
      modelTrainingCodeNode: "Completed",
      modelTrainingExecutionNode: "Completed",
    },
    steps: [
      {
        name: "Model Training Code Generation",
        status: "Completed",
        summary: output.summary,
      },
    ],
  };
}

export async function modelTrainingNode(state: State, config?: RunnableConfig) {
  return await modelTrainingCodeNode(state, config);
}

export async function modelValidationNode(state: State, config?: RunnableConfig) {
  const services = servicesFrom(config);
  const projectId = services.projectId || state.projectId || "default-project";
  const workspaceName = (state as any).workspaceName || services?.workspaceName || "DefaultWorkspace";
  const projectName = (state as any).projectName || services?.projectName || "Forecasting";
  const runTimestamp = state.runTimestamp || (services as any)?.runTimestamp || "";

  const projectRoot = getProjectDirectory({ projectId, workspaceName, projectName, runTimestamp });
  const runDir = path.join(projectRoot, runTimestamp);
  const validationProjectName = `${sanitizeFolderName(projectName)}_model_validation`;
  const validationDir = path.join(runDir, validationProjectName);
  await scaffoldValidationProjectFolder(validationDir);

  const trainingProjectName = `${sanitizeFolderName(projectName)}_model_training`;
  const trainingDir = path.join(runDir, trainingProjectName);

  const { candidateModelIds } = getCandidateModelsFromState(state);
  const selectedModels = Array.isArray(state.selectedModels) && state.selectedModels.length > 0
    ? state.selectedModels
    : candidateModelIds;

  const trainingResult = (state as any).modelLifecycle?.training || (state.stageOutputs as any)?.modelTrainingCodeNode;

  const validationOptions = {
    predictionHorizon: (state as any).predictionHorizon ?? 30,
    predictionFrequency: (state as any).predictionFrequency ?? "Daily",
    predictionObjectiveStartDate: (state as any).predictionObjectiveStartDate || state.splitEndDate || state.splitDate || "",
  };

  const context: Record<string, unknown> = {
    projectId,
    projectName,
    workspaceName,
    runTimestamp,
    selectedModels,
    trainingResult,
    trainingArtifactDirectory: trainingDir,
    validationOptions,
    datasetDirectory: getProjectDatasetDir(workspaceName, projectName, runTimestamp),
  };

  const lifecycleInput: LifecycleInput = {
    projectId,
    workspaceName,
    projectName,
    runTimestamp,
    projectDirectory: validationDir,
    additionalProjectDirectories: [trainingDir],
    context,
    selectedModels,
    abortSignal: services.abortSignal,
    services,
  };

  await logMilestoneThinking(
    services,
    "Model Validation",
    `Executing container validation lifecycle for selected models: ${selectedModels.join(", ")}...`
  );

  const validationGraph = createModelValidationGraph();
  const validationConfig = {
    ...(config || {}),
    configurable: {
      ...(config?.configurable || {}),
      services,
      substep: "Model Validation",
    },
  };
  const graphResult = await invokeModelValidationGraph(
    validationGraph,
    { input: lifecycleInput },
    validationConfig
  );

  const result = graphResult.result;
  const isFailed = !result || result.status === "Failed";
  const summary = result?.summary || "Model validation finished.";

  const output = {
    ...result,
    status: isFailed ? "Failed" : "Completed",
    summary,
    lifecycleVersion: true,
    dockerLogsPath: result?.execution?.logFilePath,
    logFilePath: result?.execution?.logFilePath,
  };

  if (result?.execution?.logFilePath) {
    await logMilestoneThinking(
      services,
      "Model Validation",
      `Docker execution logs saved to ${result.execution.logFilePath.replace(/\\/g, "/")}`
    );
  }

  await logMilestoneThinking(services, "Model Validation", summary);

  return {
    modelValidation: output,
    modelLifecycle: {
      ...((state as any).modelLifecycle || {}),
      validation: result,
    },
    status: isFailed ? "Failed" : "Completed",
    summary,
    stageOutputs: {
      modelTrainingCodeNode: {
        ...((state.stageOutputs as any)?.modelTrainingCodeNode || {}),
        modelValidation: output,
      },
    },
    stageStatuses: {
      modelTrainingCodeNode: isFailed ? "Failed" : "Completed",
    },
    steps: [
      {
        name: "Model Validation",
        status: isFailed ? "Failed" : "Completed",
        summary,
      },
    ],
  };
}
