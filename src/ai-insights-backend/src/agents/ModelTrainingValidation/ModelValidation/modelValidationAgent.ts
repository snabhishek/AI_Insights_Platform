import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import { BaseMessage } from "@langchain/core/messages";
import { AgentStateType, IngestionServices } from "../../state";
import {
  getModel,
  getPromptFromFile,
  invokeAgentJson,
  logMilestoneThinking,
} from "../../utils/agentUtils";
import { executePythonScript } from "../../tools/helpers/pythonExecutor";
import {
  getMcpFilesystemTools,
  getProjectDirectory,
} from "../../tools/filesystem/mcpFilesystemClient";
import {
  createReadTrainingReportTool,
  createReadTrainedModelsMetadataTool,
  createReadValidationConfigTool,
  createValidateValidationOutputTool,
} from "../../tools/modelValidation/modelValidation.tools";
import { webSearchTool, extractUrlContentTool } from "../../tools/search";
import {
  getFileServerBasePath,
  getWorkspacesBasePath,
  sanitizeFolderName,
} from "../../../config/fileServer.config";
import {
  ModelValidationAgentOutput,
  ModelValidationReport,
  ValidationMode,
  ValidationFrequency,
  CandidateModelValidationRun,
} from "./types";

interface ValidationCodingAgentResult extends Record<string, unknown> {
  status: string;
  summary: string;
  projectDirectory?: string;
  files?: string[];
  candidateModels?: string[];
  championModel?: string;
  requiredPackages?: string[];
}

interface ValidationRectifierResult extends Record<string, unknown> {
  status: string;
  failingFile?: string;
  rootCause?: string;
  rectificationSteps?: string;
  recommendedCodeSnippet?: string;
  requiredPackages?: string[];
}

export class ModelValidationAgent {

  public static determineValidationMode(
    predictionStartDate: string,
    currentServerDate?: string,
    executionMode?: ValidationMode
  ): ValidationMode {
    if (executionMode) return executionMode;
    const today = currentServerDate || new Date().toISOString().slice(0, 10);
    const cleanStart = (predictionStartDate || "").trim().slice(0, 10);
    if (!cleanStart) return "backtesting";
    return cleanStart > today ? "future_prediction" : "backtesting";
  }

  public static resolvePredictionStartDate(
    state: AgentStateType,
    trainingConfig: any
  ): string {
    const directStart =
      (state as any).predictionObjectiveStartDate ||
      trainingConfig?.task?.prediction_start_date ||
      trainingConfig?.task?.prediction_objective_start_date;

    if (directStart && typeof directStart === "string" && directStart.trim().length > 0) {
      return directStart.trim().slice(0, 10);
    }

    const cutoffDateStr =
      state.splitEndDate ||
      state.splitDate ||
      trainingConfig?.split?.split_date ||
      trainingConfig?.split?.test_start_date;

    if (cutoffDateStr && typeof cutoffDateStr === "string" && cutoffDateStr.trim().length > 0) {
      const trimmed = cutoffDateStr.trim();
      try {
        const d = new Date(trimmed);
        if (!isNaN(d.getTime())) {
          d.setUTCDate(d.getUTCDate() + 1);
          return d.toISOString().slice(0, 10);
        }
      } catch { }
      return trimmed.slice(0, 10);
    }

    return new Date().toISOString().slice(0, 10);
  }

  public static setupValidationDirectory(validationDir: string): void {
    fs.mkdirSync(validationDir, { recursive: true });
    fs.mkdirSync(path.join(validationDir, "artifacts", "predictions"), { recursive: true });
    fs.mkdirSync(path.join(validationDir, "artifacts", "plots"), { recursive: true });
    fs.mkdirSync(path.join(validationDir, "configs"), { recursive: true });
    fs.mkdirSync(path.join(validationDir, "reports"), { recursive: true });
  }

  public static validateReport(reportPath: string): {
    success: boolean;
    reason?: string;
    failedModelErrors?: string[];
  } {
    if (!fs.existsSync(reportPath)) {
      return { success: false, reason: "model_validation_report.json does not exist." };
    }
    try {
      const content = JSON.parse(fs.readFileSync(reportPath, "utf-8"));
      const rawCandidates = content?.model_results;

      if (!rawCandidates || typeof rawCandidates !== "object") {
        return { success: false, reason: "Missing required 'model_results' in model_validation_report.json." };
      }

      const modelsList: any[] = Array.isArray(rawCandidates)
        ? rawCandidates
        : Object.entries(rawCandidates).map(([k, v]: [string, any]) =>
            v && typeof v === "object" ? { model_id: v.model_id || k, ...v } : { model_id: k, value: v }
          );

      if (modelsList.length === 0) {
        return { success: false, reason: "No candidate models found in model_validation_report.json." };
      }

      const failedModelErrors: string[] = [];
      const successful = modelsList.filter((m) => {
        const status = (m.status || "").toLowerCase();
        const hasMetrics = m.metrics && typeof m.metrics === "object" && Object.keys(m.metrics).length > 0;
        if (status !== "completed" || !hasMetrics) {
          const errMsg = m.error || m.status_message || (hasMetrics ? "Status not Completed" : "Metrics are empty or missing");
          failedModelErrors.push(`Model '${m.displayName || m.model_id || "unknown"}': ${errMsg}`);
          return false;
        }
        return true;
      });

      if (successful.length === 0) {
        return {
          success: false,
          reason: `All ${modelsList.length} candidate model(s) failed validation${
            failedModelErrors.length > 0 ? `: ${failedModelErrors.slice(0, 3).join("; ")}` : "."
          }`,
          failedModelErrors,
        };
      }

      return { success: true, failedModelErrors };
    } catch (err: any) {
      return {
        success: false,
        reason: `Failed to parse model_validation_report.json: ${err?.message || err}`,
      };
    }
  }

  public static extractValidatedFeatures(
    trainingConfig: any,
    state: AgentStateType,
    runDir?: string
  ): string[] {

    const configFeatures =
      trainingConfig?.upstream_artifacts?.validated_features ||
      trainingConfig?.upstream_artifacts?.validatedFeatures ||
      trainingConfig?.validated_features ||
      trainingConfig?.validatedFeatures ||
      trainingConfig?.features ||
      trainingConfig?.features_list ||
      trainingConfig?.feature_list ||
      trainingConfig?.model_selection?.features;

    if (Array.isArray(configFeatures) && configFeatures.length > 0) {
      return Array.from(new Set(configFeatures.map((f: any) => String(f).trim()).filter(Boolean)));
    }

    const stateConfig = (state.trainingConfiguration as any)?.configuration || state.trainingConfiguration || {};
    const stateFeatures =
      stateConfig?.upstream_artifacts?.validated_features ||
      stateConfig?.upstream_artifacts?.validatedFeatures ||
      stateConfig?.validated_features ||
      stateConfig?.validatedFeatures ||
      stateConfig?.features ||
      (state.featureValidator as any)?.validatedFeatureSet?.kept ||
      (state.stageOutputs as any)?.featureValidator?.validatedFeatureSet?.kept ||
      (state as any)?.features ||
      (state as any)?.validatedFeatures ||
      (state.featureArchitect as any)?.validatedFeatureSet?.kept ||
      (state.stageOutputs as any)?.modelTraining?.features;

    if (Array.isArray(stateFeatures) && stateFeatures.length > 0) {
      return Array.from(new Set(stateFeatures.map((f: any) => String(f).trim()).filter(Boolean)));
    }

    if (runDir) {
      const reportPath = path.join(runDir, "python_script", "feature_validation_report.json");
      if (fs.existsSync(reportPath)) {
        try {
          const raw = JSON.parse(fs.readFileSync(reportPath, "utf-8"));
          const reportFeatures =
            raw?.validatedFeatureSet?.kept ||
            raw?.kept ||
            raw?.validated_features ||
            raw?.validatedFeatures;
          if (Array.isArray(reportFeatures) && reportFeatures.length > 0) {
            return Array.from(new Set(reportFeatures.map((f: any) => String(f).trim()).filter(Boolean)));
          }
        } catch {}
      }
    }

    return [];
  }

  private static getProjectContext(state: AgentStateType, services: IngestionServices) {
    const projectId = state.projectId || services?.projectId || "default-project";
    let workspaceName = (state as any).workspaceName || services?.workspaceName || "";
    const projectName = (state as any).projectName || services?.projectName || "Forecasting";
    const runTimestamp = state.runTimestamp || services?.runTimestamp || "";

    const workspacesBase = getWorkspacesBasePath();

    let projectRootDir = path.join(
      workspacesBase,
      sanitizeFolderName(workspaceName || "Default_Workspace"),
      "projects",
      sanitizeFolderName(projectName)
    );

    let runDir = runTimestamp ? path.join(projectRootDir, runTimestamp) : projectRootDir;
    let datasetPath = path.join(runDir, "python_script", "dataset.parquet");

    if (!fs.existsSync(datasetPath) && fs.existsSync(workspacesBase)) {
      try {
        const wsEntries = fs.readdirSync(workspacesBase, { withFileTypes: true }).filter((d) => d.isDirectory());
        for (const ws of wsEntries) {
          const candProjectDir = path.join(workspacesBase, ws.name, "projects", sanitizeFolderName(projectName));
          const candRunDir = runTimestamp ? path.join(candProjectDir, runTimestamp) : candProjectDir;
          const candDataset = path.join(candRunDir, "python_script", "dataset.parquet");
          if (fs.existsSync(candDataset)) {
            workspaceName = ws.name;
            projectRootDir = candProjectDir;
            runDir = candRunDir;
            datasetPath = candDataset;
            break;
          }
        }
      } catch {}
    }

    const modelTrainingDir = path.join(runDir, `${projectName}_model_training`);
    const modelValidationDir = path.join(runDir, `${projectName}_model_validation`);
    const modelsDir = path.join(modelTrainingDir, "artifacts", "models");

    if (!fs.existsSync(datasetPath)) {
      throw new Error(`[ModelValidationAgent] Finalized dataset artifact was not found at ${datasetPath}. 'dataset.parquet' is required.`);
    }

    let trainingConfig: any = {};
    const configCandidates = [
      path.join(modelTrainingDir, "configs", "training_config.yaml"),
      path.join(modelTrainingDir, "training_config.yaml"),
      (state.trainingConfiguration as any)?.contractPath,
    ];

    const schemasDir = path.join(runDir, "schemas");
    if (fs.existsSync(schemasDir)) {
      try {
        const yamlFiles = fs.readdirSync(schemasDir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
        const contractYaml = yamlFiles.find((f) => f.toLowerCase().includes("training_job_contract") || f.toLowerCase().includes("contract")) || yamlFiles[0];
        if (contractYaml) {
          configCandidates.push(path.join(schemasDir, contractYaml));
        }
      } catch {}
    }

    const foundConfig = configCandidates.find((c) => c && fs.existsSync(c));
    if (!foundConfig && !(state.trainingConfiguration as any)?.configuration) {
      throw new Error(`[ModelValidationAgent] Training configuration contract not found at ${path.join(modelTrainingDir, "configs", "training_config.yaml")}. Training configuration is required.`);
    }

    if (foundConfig) {
      try {
        trainingConfig = yaml.load(fs.readFileSync(foundConfig, "utf-8")) || {};
      } catch (e: any) {
        throw new Error(`[ModelValidationAgent] Failed to read training configuration contract at ${foundConfig}: ${e?.message || e}`);
      }
    } else {
      trainingConfig = (state.trainingConfiguration as any)?.configuration || {};
    }

    if (!trainingConfig?.upstream_artifacts?.validated_features && !trainingConfig?.validated_features) {
      if (fs.existsSync(schemasDir)) {
        try {
          const yamlFiles = fs.readdirSync(schemasDir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
          const contractYaml = yamlFiles.find((f) => f.toLowerCase().includes("training_job_contract") || f.toLowerCase().includes("contract"));
          if (contractYaml) {
            const schemaContract = yaml.load(fs.readFileSync(path.join(schemasDir, contractYaml), "utf-8")) as any;
            if (schemaContract?.upstream_artifacts) {
              trainingConfig.upstream_artifacts = {
                ...(schemaContract.upstream_artifacts || {}),
                ...(trainingConfig.upstream_artifacts || {}),
              };
            }
          }
        } catch {}
      }
    }

    const validatedFeatures = this.extractValidatedFeatures(trainingConfig, state, runDir);
    if (!validatedFeatures || validatedFeatures.length === 0) {
      throw new Error(
        `[ModelValidationAgent] Validated features array not found in training configuration contract at ${foundConfig || path.join(modelTrainingDir, "configs", "training_config.yaml")} or in state. Validated features are required for model validation.`
      );
    }

    let trainingReport: any = {};
    const reportCandidates = [
      path.join(modelTrainingDir, "reports", "model_training_report.json"),
      path.join(modelTrainingDir, "model_training_report.json"),
      path.join(runDir, "model_training_report.json"),
    ];
    const reportPathFound = reportCandidates.find((rp) => fs.existsSync(rp));
    if (!reportPathFound) {
      throw new Error(`[ModelValidationAgent] Model training report not found. Model training must complete successfully before validation.`);
    }
    try {
      trainingReport = JSON.parse(fs.readFileSync(reportPathFound, "utf-8")) || {};
    } catch (e: any) {
      throw new Error(`[ModelValidationAgent] Failed to parse model training report at ${reportPathFound}: ${e?.message || e}`);
    }

    if (!fs.existsSync(modelsDir)) {
      throw new Error(`[ModelValidationAgent] Trained models directory not found at ${modelsDir}. Model training artifacts are required.`);
    }

    return {
      projectId,
      workspaceName,
      projectName,
      runTimestamp,
      projectRootDir,
      runDir,
      modelTrainingDir,
      modelValidationDir,
      modelsDir,
      datasetPath,
      trainingConfig,
      trainingReport,
      validatedFeatures,
    };
  }

  public static async execute(
    state: AgentStateType,
    services: IngestionServices,
    options?: {
      predictionHorizon?: number;
      predictionFrequency?: string;
      predictionObjectiveStartDate?: string;
      executionMode?: ValidationMode;
      selectedModels?: string[];
      filters?: Record<string, any>;
      maxRetries?: number;
    }
  ): Promise<ModelValidationAgentOutput> {
    const ctx = this.getProjectContext(state, services);
    const {
      projectId,
      workspaceName,
      projectName,
      runTimestamp,
      projectRootDir,
      runDir,
      modelTrainingDir,
      modelValidationDir,
      modelsDir,
      datasetPath,
      trainingConfig,
      trainingReport,
      validatedFeatures,
    } = ctx;

    this.setupValidationDirectory(modelValidationDir);

    const horizon = options?.predictionHorizon ?? (state as any).predictionHorizon;
    if (!horizon || typeof horizon !== "number" || horizon <= 0) {
      throw new Error("[ModelValidationAgent] Prediction horizon is required and must be an integer greater than 0.");
    }

    const frequency: ValidationFrequency = (
      options?.predictionFrequency as ValidationFrequency ||
      (state as any).predictionFrequency as ValidationFrequency
    );
    if (!frequency) {
      throw new Error("[ModelValidationAgent] Prediction frequency is required. Please specify Weekly, Monthly, or Yearly.");
    }

    const rawStartDate = options?.predictionObjectiveStartDate ?? (state as any).predictionObjectiveStartDate;
    const predictionStartDate = (rawStartDate && typeof rawStartDate === "string" && rawStartDate.trim().length > 0)
      ? rawStartDate.trim().slice(0, 10)
      : this.resolvePredictionStartDate(state, trainingConfig);

    if (!predictionStartDate) {
      throw new Error("[ModelValidationAgent] Prediction objective start date is required.");
    }

    const mode = this.determineValidationMode(predictionStartDate, undefined, options?.executionMode);

    let featureMetadata: any = {};
    const metadataYamlPath = path.join(runDir, "python_script", "metadata.yaml");
    if (fs.existsSync(metadataYamlPath)) {
      try {
        featureMetadata = yaml.load(fs.readFileSync(metadataYamlPath, "utf-8")) || {};
      } catch {}
    }

    const timeCol =
      trainingReport?.time_column ||
      featureMetadata?.time_column ||
      trainingConfig?.time_column ||
      trainingConfig?.split?.time_column ||
      trainingConfig?.data_splitting?.time_column ||
      (state as any).timeColumn ||
      (state.featureArchitect as any)?.timeColumn ||
      (state.featureArchitect as any)?.orchestrationDecision?.timeColumn ||
      (state.schemaResolution as any)?.timeColumn ||
      "";

    const targetCol =
      trainingReport?.target_column ||
      featureMetadata?.target_column ||
      (state.featureArchitect as any)?.orchestrationDecision?.targetColumn ||
      (state as any).targetColumn ||
      trainingConfig?.task?.target_column ||
      trainingConfig?.target_column ||
      trainingConfig?.model_selection?.target_entity?.name ||
      (state.modelSelection as any)?.target_entity?.name ||
      (state.stageOutputs?.modelSelection as any)?.target_entity?.name ||
      "";

    const groupCol =
      trainingReport?.group_by ||
      trainingReport?.group_col ||
      featureMetadata?.entity_key ||
      trainingConfig?.group_by ||
      trainingConfig?.group_col ||
      trainingConfig?.split?.group_by ||
      (state as any).entityColumn ||
      (state.featureArchitect as any)?.orchestrationDecision?.entityColumns?.[0] ||
      "";
    const problemType =
      trainingConfig?.task?.problem_type ||
      trainingConfig?.task?.task_type ||
      trainingConfig?.problem_type ||
      trainingReport?.task_type ||
      (state as any).problemType ||
      (state.modelSelection as any)?.problem_type ||
      (state.modelSelection as any)?.task_type ||
      (state.stageOutputs?.modelSelection as any)?.problem_type ||
      (state.featureArchitect as any)?.orchestrationDecision?.problemType;

    const direction =
      trainingReport?.primary_metric_direction ||
      trainingReport?.metric_direction ||
      trainingReport?.direction ||
      trainingConfig?.task?.metric_direction ||
      trainingConfig?.task?.direction ||
      trainingConfig?.objective?.direction ||
      trainingConfig?.["x-primary-metric-def"]?.direction ||
      (state as any).direction ||
      (state.modelSelection as any)?.direction ||
      (state.stageOutputs?.modelSelection as any)?.direction ||
      (state.modelTraining as any)?.direction ||
      (state.stageOutputs?.modelTraining as any)?.direction ||
      (state.trainingConfiguration as any)?.configuration?.objective?.direction ||
      (state.trainingConfiguration as any)?.configuration?.["x-primary-metric-def"]?.direction ||
      (state.trainingConfiguration as any)?.direction;

    if (!targetCol) {
      throw new Error("[ModelValidationAgent] Missing required 'target_column' from training configuration or state.");
    }
    if (!problemType) {
      throw new Error("[ModelValidationAgent] Missing required 'task_type' / 'problem_type' from training configuration or state.");
    }
    if (!direction || !["maximize", "minimize"].includes(String(direction).toLowerCase())) {
      throw new Error(`[ModelValidationAgent] Missing or invalid optimization direction ('${direction}'). Must be 'maximize' or 'minimize'.`);
    }

    const rawReportModels =
      trainingReport?.candidate_models_evaluated ||
      trainingReport?.models_evaluated;

    const evaluatedFromReport: string[] = Array.isArray(rawReportModels)
      ? rawReportModels.map((m: any) => (typeof m === "string" ? m : m.model_id || m.id)).filter(Boolean)
      : Object.keys(trainingReport?.model_results || trainingReport?.results || {});

    const effectiveSelectedModels: string[] = (
      Array.isArray(options?.selectedModels) && options!.selectedModels.length > 0
        ? options!.selectedModels
        : Array.isArray(state.selectedModels) && state.selectedModels.length > 0
        ? state.selectedModels
        : Array.isArray((state as any).selectedModelsToValidate) && (state as any).selectedModelsToValidate.length > 0
        ? (state as any).selectedModelsToValidate
        : evaluatedFromReport.length > 0
        ? evaluatedFromReport
        : []
    );

    if (effectiveSelectedModels.length === 0) {
      throw new Error("[ModelValidationAgent] No candidate models found to validate. Candidate models are required.");
    }

    await logMilestoneThinking(
      services,
      "Model Validation",
      `Model Validation Agent initializing in ${mode} mode for project '${projectName}' (${horizon} ${frequency} periods starting ${predictionStartDate})...`
    );

    try {
      const initialValConfig = {
        project_id: projectId,
        project_name: projectName,
        run_timestamp: runTimestamp,
        validation_mode: mode,
        prediction_objective_start_date: predictionStartDate,
        prediction_objective_horizon: horizon,
        prediction_objective_frequency: frequency,
        time_column: timeCol,
        target_column: targetCol,
        group_column: groupCol || null,
        problem_type: problemType,
        selected_models: effectiveSelectedModels,
        validated_features: validatedFeatures,
      };
      fs.writeFileSync(
        path.join(modelValidationDir, "configs", "validation_config.yaml"),
        yaml.dump(initialValConfig),
        "utf-8"
      );
    } catch (confWriteErr: any) {
      console.warn("[ModelValidationAgent] Failed to write initial validation_config.yaml:", confWriteErr?.message || confWriteErr);
    }

    const fsTools = await getMcpFilesystemTools({ projectId, workspaceName, projectName, runTimestamp });
    const trainingReportTool = createReadTrainingReportTool(projectId, runTimestamp, projectName, workspaceName);
    const trainedModelsTool = createReadTrainedModelsMetadataTool(modelsDir);
    const validationConfigTool = createReadValidationConfigTool(modelTrainingDir, runDir);
    const validationOutputTool = createValidateValidationOutputTool(modelValidationDir);

    const agentTools = [
      ...fsTools,
      trainingReportTool,
      trainedModelsTool,
      validationConfigTool,
      validationOutputTool,
      webSearchTool,
      extractUrlContentTool,
    ];

    const model = getModel();
    const systemPrompt = await getPromptFromFile(
      "ModelValidation/modelValidation.md",
      "You are an expert AI Machine Learning Validation Engineer and Coding Agent."
    );

    const relativeValidationRunner = path.join(modelValidationDir, "validation_runner.py");

    const relDatasetPath = path.relative(projectRootDir, datasetPath).replace(/\\/g, "/");
    const relModelsDir = path.relative(projectRootDir, modelsDir).replace(/\\/g, "/");
    const relOutputDir = path.relative(projectRootDir, modelValidationDir).replace(/\\/g, "/");

    const userPrompt = [
      `Generate the complete Python model validation and prediction runner for project '${projectName}' in '${runTimestamp}/${projectName}_model_validation'.`,
      `--- Active Run & Artifact Context ---`,
      `Project Name: ${projectName}`,
      `Run Timestamp: ${runTimestamp}`,
      `Validation Directory: ${runTimestamp}/${projectName}_model_validation`,
      `Training Directory: ${runTimestamp}/${projectName}_model_training`,
      `Trained Models Directory: ${runTimestamp}/${projectName}_model_training/artifacts/models`,
      `Finalized Dataset: ${datasetPath}`,
      `Dataset Time Column: ${timeCol}`,
      `Target Column: ${targetCol}`,
      `Entity / Grouping Column: ${groupCol || "None"}`,
      `Problem Type: ${problemType}`,
      `--- Feature Specifications (Model Training Contract Alignment) ---`,
      `Validated Features Count: ${validatedFeatures.length}`,
      `Validated Features Array: ${JSON.stringify(validatedFeatures)}`,
      `CRITICAL FEATURE EXTRACTION MANDATES:`,
      `1. The validation runner MUST load 'dataset.parquet' from '${datasetPath}' (container path: /workspace/${relDatasetPath}).`,
      `2. Extract strictly the ${validatedFeatures.length} validated features: ${validatedFeatures.join(", ")}.`,
      `3. Construct the model input matrix X using strictly these validated feature columns (along with target '${targetCol}' and time '${timeCol}' where applicable).`,
      `4. DO NOT include arbitrary, unvalidated, or target-leakage columns in X that were not present in the training partition.`,
      `5. Align features strictly with 'preprocessor.joblib' or candidate estimator expectations (estimator.n_features_in_) so that feature dimensions match identically to Model Training.`,
      `--- Prediction Objective ---`,
      `Objective Start Date: ${predictionStartDate}`,
      `Forecast Horizon: ${horizon} periods`,
      `Frequency: ${frequency}`,
      `Validation Mode: ${mode}`,
      ...(effectiveSelectedModels.length > 0
        ? [`Selected Candidate Models to Validate: ${effectiveSelectedModels.join(", ")}`]
        : [`Validate all candidate model artifacts in artifacts/models/`]),
      `--- Output Requirements ---`,
      `1. Write the executable validation script to '${runTimestamp}/${projectName}_model_validation/validation_runner.py'.`,
      `2. The script must execute inference across all candidate model joblib artifacts, apply preprocessor transformation, and compute metrics.`,
      `3. In Future Prediction Mode (${mode === "future_prediction"}), generate forward periods without fake past actuals, benchmark using training test scores, and set actualTotal/difference to null.`,
      `In future_prediction mode, forecast every period from ${predictionStartDate} for all ${horizon} periods, including gaps before today's date. Calendar-past periods without observations are still forecasts. Advance sequentially and recursively update lag/rolling features from prior predictions when required by the trained model; do not jump directly to a late requested period with stale lags. Never fabricate actuals or unavailable future covariates; report unsupported inference explicitly.`,
      `4. In Backtesting Mode (${mode === "backtesting"}), slice evaluation records starting from ${predictionStartDate}, compare against ground-truth actuals, and compute deterministic metrics (F1/Accuracy or WAPE/MAE/RMSE).`,
      `5. Save outputs to '${runTimestamp}/${projectName}_model_validation/reports/model_validation_report.json' and 'artifacts/predictions/validation_predictions.parquet'.`,
      `6. MANDATORY JSON REPORT SCHEMA: 'model_validation_report.json' MUST structure candidate model results under the exact key 'model_results' (i.e. { "model_results": { "<model_id>": { "model_id": ..., "displayName": ..., "framework": ..., "status": "Completed", "score": ..., "metrics": { ... }, "totals": { ... }, "chartData": { ... }, ... } } }), matching the exact convention used in 'model_training_report.json'. DO NOT use 'models', 'candidate_models', or any alternative key names. Do NOT modify the key-value names mentioned in the standard schema.`,
      `Return a JSON summary of your implementation when the runner is created.`,
    ].join("\n\n");

    const codingFallback: ValidationCodingAgentResult = {
      status: "Completed",
      summary: "Python model validation program scaffolded.",
      projectDirectory: `${runTimestamp}/${projectName}_model_validation`,
      files: ["validation_runner.py", "configs/validation_config.yaml"],
    };

    const agentMessages: BaseMessage[] = [];
    const rectifierMessages: BaseMessage[] = [];

    let codingResult: ValidationCodingAgentResult = codingFallback;
    try {
      codingResult = await invokeAgentJson<ValidationCodingAgentResult>(
        "modelValidationCode",
        model,
        userPrompt,
        codingFallback,
        services,
        {
          systemPrompt,
          traceLabel: "modelValidation:codeGeneration",
          tools: agentTools,
          useDeepAgent: true,
          enableTodoList: true,
          recursionLimit: 150,
          messages: agentMessages,
          middlewareOptions: {
            summarization: {
              triggerTokens: 200000,
              keepTokens: 25000,
            },
            todoList: true,
            toolRetry: { maxRetries: 2 },
          },
        }
      );
    } catch (codeErr: any) {
      console.warn("[ModelValidationAgent] Code generation invoke warning:", codeErr?.message || codeErr);
    }

    const baseValidationPackages = ["pandas", "numpy", "scikit-learn", "pyarrow", "pyyaml", "joblib", "lightgbm"];
    let accumulatedPackages: string[] = [...baseValidationPackages];

    const trainingReqPath = path.join(modelTrainingDir, "requirements.txt");
    if (fs.existsSync(trainingReqPath)) {
      try {
        const trainingReqLines = fs
          .readFileSync(trainingReqPath, "utf-8")
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line && !line.startsWith("#"));
        accumulatedPackages = Array.from(new Set([...accumulatedPackages, ...trainingReqLines]));
      } catch (err: any) {
        console.warn("[ModelValidationAgent] Failed to read training requirements.txt:", err?.message || err);
      }
    }

    if (Array.isArray(codingResult.requiredPackages)) {
      accumulatedPackages = Array.from(new Set([...accumulatedPackages, ...codingResult.requiredPackages]));
    }

    const maxCodeGenRetries = options?.maxRetries ?? 20;
    let codeGenAttempt = 0;
    while (!fs.existsSync(relativeValidationRunner) && codeGenAttempt < maxCodeGenRetries) {
      codeGenAttempt++;
      console.warn(`[ModelValidationAgent] validation_runner.py not found after code generation. Retrying agent (attempt ${codeGenAttempt}/${maxCodeGenRetries})...`);
      await logMilestoneThinking(
        services,
        "Model Validation",
        `Code generation did not produce validation_runner.py. Re-invoking coding agent (attempt ${codeGenAttempt})...`
      );
      try {
        codingResult = await invokeAgentJson<ValidationCodingAgentResult>(
          "modelValidationCode",
          model,
          `The previous attempt did not produce validation_runner.py. You MUST write the file to '${runTimestamp}/${projectName}_model_validation/validation_runner.py' using the write_text_file tool.`,
          codingFallback,
          services,
          {
            systemPrompt,
            traceLabel: `modelValidation:codeGeneration:retry${codeGenAttempt}`,
            tools: agentTools,
            useDeepAgent: true,
            enableTodoList: true,
            recursionLimit: 150,
            messages: agentMessages,
            middlewareOptions: {
              summarization: {
                triggerTokens: 200000,
                keepTokens: 25000,
              },
              todoList: true,
              toolRetry: { maxRetries: 2 },
            },
          }
        );
        if (Array.isArray(codingResult.requiredPackages)) {
          accumulatedPackages = Array.from(new Set([...accumulatedPackages, ...codingResult.requiredPackages]));
        }
      } catch (retryErr: any) {
        console.warn(`[ModelValidationAgent] Code generation retry ${codeGenAttempt} failed:`, retryErr?.message || retryErr);
      }
    }

    if (!fs.existsSync(relativeValidationRunner)) {
      console.error("[ModelValidationAgent] validation_runner.py was not generated after all retries.");
      return {
        status: "Failed",
        summary: `Model Validation failed: the coding agent did not produce validation_runner.py after ${maxCodeGenRetries + 1} attempts.`,
        phase: "Model Validation",
        projectDirectory: `${runTimestamp}/${projectName}_model_training`,
        validationDirectory: `${runTimestamp}/${projectName}_model_validation`,
        mode,
        predictionObjectiveStartDate: predictionStartDate,
        predictionObjectiveHorizon: horizon,
        predictionObjectiveFrequency: frequency,
        candidates: [],
        error: "validation_runner.py was not generated by the coding agent.",
      };
    }

    try {
      const valReqPath = path.join(modelValidationDir, "requirements.txt");
      fs.writeFileSync(valReqPath, accumulatedPackages.join("\n"), "utf-8");
    } catch (writeErr: any) {
      console.warn("[ModelValidationAgent] Failed to write initial requirements.txt:", writeErr?.message || writeErr);
    }

    const extraArgs = [
      `--dataset-path "/workspace/${relDatasetPath}"`,
      `--models-dir "/workspace/${relModelsDir}"`,
      `--output-dir "/workspace/${relOutputDir}"`,
      `--start-date "${predictionStartDate}"`,
      `--horizon ${horizon}`,
      `--frequency "${frequency}"`,
      `--mode "${mode}"`,
      `--time-col "${timeCol}"`,
      `--target-col "${targetCol}"`,
      `--group-col "${groupCol}"`,
      `--problem-type "${problemType}"`,
      `--features "${validatedFeatures.join(",")}"`,
    ];

    if (effectiveSelectedModels.length > 0) {
      extraArgs.push(`--selected-models "${effectiveSelectedModels.join(",")}"`);
    }

    await logMilestoneThinking(
      services,
      "Model Validation",
      `Executing model validation inference in container sandbox for ${horizon} ${frequency} periods...`
    );

    let execResult = await executePythonScript(
      relativeValidationRunner,
      "",
      projectId,
      runTimestamp,
      services,
      undefined,
      accumulatedPackages,
      extraArgs
    );

    const maxRetries = options?.maxRetries ?? 20;
    let attempts = 0;

    const reportPath = path.join(modelValidationDir, "reports", "model_validation_report.json");
    let validationHealth = ModelValidationAgent.validateReport(reportPath);

    while ((!execResult.success || !validationHealth.success) && attempts < maxRetries) {
      attempts++;
      console.warn(
        `[ModelValidationAgent] Validation execution attempt ${attempts} failed (exec success: ${execResult.success}, valid report: ${validationHealth.success}, reason: ${validationHealth.reason || "N/A"}). Invoking Self-Healing Rectifier...`
      );

      await logMilestoneThinking(
        services,
        "Model Validation",
        `Validation execution attempt ${attempts} encountered error (${validationHealth.reason || "Process error"}). Diagnosing and rectifying...`
      );

      const rectifierPrompt = await getPromptFromFile(
        "ModelValidation/modelValidationRectifier.md",
        "You are an expert AI Python Debugger and Diagnostic Advisor."
      );

      const failedModelDetails = validationHealth.failedModelErrors?.length
        ? `\n--- Candidate Model Failures ---\n${validationHealth.failedModelErrors.join("\n")}`
        : "";

      const rectifierContext = [
        `Validation runner execution failed for project '${projectName}'.`,
        validationHealth.reason ? `Validation Health Check: ${validationHealth.reason}` : "",
        failedModelDetails,
        `--- Error Traceback / Logs ---`,
        execResult.stderr || execResult.stdout || "Report was not generated or models failed.",
        `--- Execution Command Arguments ---`,
        extraArgs.join(" "),
        `--- Validated Features ---`,
        `Validated Features (${validatedFeatures.length}): ${validatedFeatures.join(", ")}`,
        `Diagnose the root cause (e.g. missing package dependencies, feature count/preprocessing mismatch such as preprocessor.joblib vs validation features, or model inference exceptions) and advise on exact code modifications to '${runTimestamp}/${projectName}_model_validation/validation_runner.py'. If packages are missing, list them in requiredPackages.`,
      ].filter(Boolean).join("\n\n");

      const rectifierFallback: ValidationRectifierResult = {
        status: "NeedsRectification",
        failingFile: "validation_runner.py",
        rootCause: validationHealth.reason || "Execution failed to generate a valid report.",
      };

      try {
        const diagnostic = await invokeAgentJson<ValidationRectifierResult>(
          "modelValidationRectifier",
          model,
          rectifierContext,
          rectifierFallback,
          services,
          {
            systemPrompt: rectifierPrompt,
            traceLabel: `modelValidation:rectifier:attempt${attempts}`,
            tools: agentTools,
            useDeepAgent: true,
            enableTodoList: true,
            recursionLimit: 150,
            messages: rectifierMessages,
            middlewareOptions: {
              summarization: {
                triggerTokens: 200000,
                keepTokens: 25000,
              },
              todoList: true,
              toolRetry: { maxRetries: 2 },
            },
          }
        );

        if (Array.isArray(diagnostic.requiredPackages) && diagnostic.requiredPackages.length > 0) {
          accumulatedPackages = Array.from(new Set([...accumulatedPackages, ...diagnostic.requiredPackages]));
          try {
            const valReqPath = path.join(modelValidationDir, "requirements.txt");
            fs.writeFileSync(valReqPath, accumulatedPackages.join("\n"), "utf-8");
          } catch (writeErr: any) {
            console.warn("[ModelValidationAgent] Failed to update validation requirements.txt:", writeErr?.message || writeErr);
          }
        }

        if (diagnostic.recommendedCodeSnippet && diagnostic.failingFile) {
          const targetFile = path.join(modelValidationDir, path.basename(diagnostic.failingFile));
          fs.writeFileSync(targetFile, diagnostic.recommendedCodeSnippet, "utf-8");
        } else {

          console.warn("[ModelValidationAgent] Rectifier did not provide code snippet. Re-invoking coding agent...");
          await logMilestoneThinking(
            services,
            "Model Validation",
            `Rectifier could not provide a fix. Re-generating validation runner (attempt ${attempts})...`
          );
          try {
            const regenResult = await invokeAgentJson<ValidationCodingAgentResult>(
              "modelValidationCode",
              model,
              `PREVIOUS EXECUTION FAILED:\n${validationHealth.reason || ""}\n${failedModelDetails}\n${execResult.stderr || execResult.stdout || "Report was not generated."}\n\nValidated Features (${validatedFeatures.length}): ${validatedFeatures.join(", ")}\n\nFix the issues, ensure feature dimensions align with preprocessor.joblib and estimators, and regenerate the validation_runner.py.`,
              codingFallback,
              services,
              {
                systemPrompt,
                traceLabel: `modelValidation:codeGeneration:rectifyRetry${attempts}`,
                tools: agentTools,
                useDeepAgent: true,
                enableTodoList: true,
                recursionLimit: 150,
                messages: agentMessages,
                middlewareOptions: {
                  summarization: {
                    triggerTokens: 200000,
                    keepTokens: 25000,
                  },
                  todoList: true,
                  toolRetry: { maxRetries: 2 },
                },
              }
            );
            if (Array.isArray(regenResult?.requiredPackages) && regenResult.requiredPackages.length > 0) {
              accumulatedPackages = Array.from(new Set([...accumulatedPackages, ...regenResult.requiredPackages]));
              try {
                const valReqPath = path.join(modelValidationDir, "requirements.txt");
                fs.writeFileSync(valReqPath, accumulatedPackages.join("\n"), "utf-8");
              } catch (writeErr: any) {
                console.warn("[ModelValidationAgent] Failed to update validation requirements.txt:", writeErr?.message || writeErr);
              }
            }
          } catch (regenErr: any) {
            console.warn("[ModelValidationAgent] Coding agent re-invocation failed:", regenErr?.message || regenErr);
          }
        }
      } catch (rectErr: any) {
        console.warn("[ModelValidationAgent] Rectifier invocation warning:", rectErr?.message || rectErr);

        await logMilestoneThinking(
          services,
          "Model Validation",
          `Rectifier failed. Re-generating validation runner with error context (attempt ${attempts})...`
        );
        try {
          const fallbackResult = await invokeAgentJson<ValidationCodingAgentResult>(
            "modelValidationCode",
            model,
            `PREVIOUS EXECUTION FAILED:\n${validationHealth.reason || ""}\n${failedModelDetails}\n${execResult.stderr || execResult.stdout || "Report was not generated."}\n\nFix the issues and regenerate the validation_runner.py.`,
            codingFallback,
            services,
            {
              systemPrompt,
              traceLabel: `modelValidation:codeGeneration:rectifyFallback${attempts}`,
              tools: agentTools,
              useDeepAgent: true,
              enableTodoList: true,
              recursionLimit: 150,
              messages: agentMessages,
              middlewareOptions: {
                summarization: {
                  triggerTokens: 200000,
                  keepTokens: 25000,
                },
                todoList: true,
                toolRetry: { maxRetries: 2 },
              },
            }
          );
          if (Array.isArray(fallbackResult?.requiredPackages) && fallbackResult.requiredPackages.length > 0) {
            accumulatedPackages = Array.from(new Set([...accumulatedPackages, ...fallbackResult.requiredPackages]));
            try {
              const valReqPath = path.join(modelValidationDir, "requirements.txt");
              fs.writeFileSync(valReqPath, accumulatedPackages.join("\n"), "utf-8");
            } catch (writeErr: any) {
              console.warn("[ModelValidationAgent] Failed to update validation requirements.txt:", writeErr?.message || writeErr);
            }
          }
        } catch (regenErr: any) {
          console.warn("[ModelValidationAgent] Coding agent fallback re-invocation failed:", regenErr?.message || regenErr);
        }
      }

      execResult = await executePythonScript(
        relativeValidationRunner,
        "",
        projectId,
        runTimestamp,
        services,
        undefined,
        accumulatedPackages,
        extraArgs
      );

      validationHealth = ModelValidationAgent.validateReport(reportPath);
    }

    if (!fs.existsSync(reportPath)) {
      throw new Error(
        `[ModelValidationAgent] Validation execution failed: 'model_validation_report.json' was not generated at ${reportPath}.`
      );
    }

    let rawReport: any = undefined;
    try {
      rawReport = JSON.parse(fs.readFileSync(reportPath, "utf-8"));
    } catch (err: any) {
      throw new Error(`[ModelValidationAgent] Failed to parse validation report at ${reportPath}: ${err?.message || err}`);
    }

    if (!rawReport || typeof rawReport !== "object") {
      throw new Error(`[ModelValidationAgent] Validation report at ${reportPath} is empty or not a valid JSON object.`);
    }

    const rawModelResults = rawReport?.model_results;
    if (!rawModelResults || typeof rawModelResults !== "object") {
      throw new Error(`[ModelValidationAgent] Validation report at ${reportPath} is missing required 'model_results'.`);
    }

    const rawCandidatesList: any[] = Array.isArray(rawModelResults)
      ? rawModelResults
      : Object.entries(rawModelResults).map(([k, v]: [string, any]) =>
          v && typeof v === "object" ? { model_id: v.model_id || k, ...v } : { model_id: k, value: v }
        );

    if (rawCandidatesList.length === 0) {
      throw new Error(`[ModelValidationAgent] Validation report at ${reportPath} contains empty 'model_results'.`);
    }

    const effectiveProblemType = rawReport?.problem_type || problemType;
    const isClassification = effectiveProblemType.toLowerCase().includes("class");

    const frameworkMap = new Map<string, string>();

    if (trainingConfig?.candidate_models && typeof trainingConfig.candidate_models === "object") {
      const cands = Array.isArray(trainingConfig.candidate_models)
        ? trainingConfig.candidate_models
        : Object.values(trainingConfig.candidate_models);
      for (const c of cands as any[]) {
        const id = c?.model_id || c?.id;
        const fw = c?.framework;
        if (id && fw) frameworkMap.set(String(id).toLowerCase().trim(), String(fw));
      }
    }

    const contractModels = [
      ...(trainingConfig?.model_selection?.models || []),
      ...(trainingConfig?.model_selection?.candidates || []),
    ];
    for (const m of contractModels) {
      const id = m?.model_id || m?.id;
      const fw = m?.framework;
      if (id && fw) frameworkMap.set(String(id).toLowerCase().trim(), String(fw));
    }

    const reportResults =
      trainingReport?.models_evaluated ||
      trainingReport?.candidate_models_evaluated ||
      trainingReport?.results ||
      trainingReport?.model_results ||
      trainingReport?.runs ||
      trainingReport?.candidate_models;
    if (reportResults) {
      const runsList = Array.isArray(reportResults) ? reportResults : Object.values(reportResults);
      for (const r of runsList as any[]) {
        const id = r?.model_id || r?.id;
        const fw = r?.framework;
        if (id && fw) frameworkMap.set(String(id).toLowerCase().trim(), String(fw));
      }
    }

    const stateCandidates = [
      ...((state.modelSelection as any)?.candidates || []),
      ...((state.modelSelection as any)?.models || []),
      ...((state.stageOutputs?.modelSelection as any)?.candidates || []),
      ...((state.stageOutputs?.modelSelection as any)?.models || []),
      ...((state.modelTraining as any)?.candidates || []),
      ...((state.stageOutputs?.modelTraining as any)?.candidates || []),
      ...((state.trainingConfiguration as any)?.configuration?.model_selection?.candidates || []),
      ...((state.trainingConfiguration as any)?.configuration?.model_selection?.models || []),
    ];
    for (const sc of stateCandidates) {
      const id = sc?.model_id || sc?.id;
      const fw = sc?.framework;
      if (id && fw) frameworkMap.set(String(id).toLowerCase().trim(), String(fw));
    }

    if (rawReport?.model_results && typeof rawReport.model_results === "object") {
      const resultsObj = Array.isArray(rawReport.model_results)
        ? Object.fromEntries(rawReport.model_results.map((m: any) => [m?.model_id, m]))
        : rawReport.model_results;
      for (const [k, v] of Object.entries<any>(resultsObj)) {
        const id = v?.model_id || k;
        const fw = v?.framework;
        if (id && fw && !frameworkMap.has(String(id).toLowerCase().trim())) {
          frameworkMap.set(String(id).toLowerCase().trim(), String(fw));
        }
      }
    }

    const extractMetricNum = (val: any): number | null => {
      if (val === null || val === undefined) return null;
      if (typeof val === "number") return isNaN(val) ? null : val;
      if (typeof val === "object" && val.value !== undefined && val.value !== null) {
        const n = Number(val.value);
        return isNaN(n) ? null : n;
      }
      const parsed = Number(val);
      return isNaN(parsed) ? null : parsed;
    };

    const normalizedCandidates: CandidateModelValidationRun[] = rawCandidatesList.map((candSummary: any) => {
      const modelId = candSummary.model_id || candSummary.modelId;
      if (!modelId) {
        throw new Error("[ModelValidationAgent] Candidate model entry in validation report is missing 'model_id'.");
      }

      let detailedModel: any = {};
      if (rawReport?.model_results && typeof rawReport.model_results === "object") {
        if (!Array.isArray(rawReport.model_results)) {
          const directMatch = rawReport.model_results[modelId] || rawReport.model_results[modelId.toLowerCase()];
          const matched = directMatch || Object.values(rawReport.model_results).find((v: any) =>
            (v?.model_id && String(v.model_id).toLowerCase() === modelId.toLowerCase()) ||
            (v?.displayName && String(v.displayName).toLowerCase() === String(candSummary.displayName || modelId).toLowerCase())
          );
          if (matched && typeof matched === "object") {
            detailedModel = { ...matched, ...detailedModel };
          }
        }
      }

      const m = { ...detailedModel, ...candSummary };
      const displayName = candSummary.displayName || detailedModel.displayName || m.name || modelId;
      const framework = frameworkMap.get(modelId.toLowerCase()) || m.framework || detailedModel.framework;
      if (!framework) {
        throw new Error(`[ModelValidationAgent] Candidate model '${modelId}' is missing required 'framework'.`);
      }
      const status = m.status || detailedModel.status || "Completed";

      const rawMetrics: Record<string, any> = m.metrics && typeof m.metrics === "object" ? m.metrics : {};
      const metrics: Record<string, any> = {};
      for (const [k, v] of Object.entries(rawMetrics)) {
        const numVal = extractMetricNum(v);
        metrics[k] = {
          value: numVal,
          status: numVal !== null ? "available" : "unavailable",
          unit: typeof v === "object" ? v.unit : undefined,
          reason: typeof v === "object" ? v.reason : undefined,
        };
      }

      let score: number | undefined = typeof m.score === "number" && !isNaN(m.score) ? m.score : undefined;
      let primaryMetricName = m.primaryMetricName;

      if (score === undefined) {
        if (primaryMetricName) {
          const directMatch = extractMetricNum(rawMetrics[primaryMetricName] ?? rawMetrics[primaryMetricName.toLowerCase()]);
          if (directMatch !== null) {
            score = directMatch;
          }
        }
        if (score === undefined) {
          for (const [k, v] of Object.entries(rawMetrics)) {
            const num = extractMetricNum(v);
            if (num !== null) {
              score = num;
              primaryMetricName = primaryMetricName || k;
              break;
            }
          }
        }
      }

      return {
        model_id: modelId,
        displayName,
        framework,
        status: (status.toLowerCase() === "completed" ? "Completed" : "Failed") as "Completed" | "Failed",
        score,
        primaryMetricName: primaryMetricName || "Score",
        metrics,
        totals: {
          actualTotal: typeof m.totals?.actualTotal === "number" ? m.totals.actualTotal : null,
          forecastTotal: typeof m.totals?.forecastTotal === "number" ? m.totals.forecastTotal : 0,
          difference: typeof m.totals?.difference === "number" ? m.totals.difference : null,
          differencePercentage: typeof m.totals?.differencePercentage === "number" ? m.totals.differencePercentage : null,
        },
        chartData: {
          dates: Array.isArray(m.chartData?.dates) ? m.chartData.dates : [],
          actualSeries: Array.isArray(m.chartData?.actualSeries) ? m.chartData.actualSeries : [],
          predictedSeries: Array.isArray(m.chartData?.predictedSeries) ? m.chartData.predictedSeries : [],
          residuals: Array.isArray(m.chartData?.residuals) ? m.chartData.residuals : null,
        },
        evaluationRecordCount: typeof m.evaluationRecordCount === "number" ? m.evaluationRecordCount : (rawReport?.total_records || 0),
        actualDataCoverage: typeof m.actualDataCoverage === "number" ? m.actualDataCoverage : null,
        modelArtifactPath: m.modelArtifactPath || `artifacts/models/${modelId}.joblib`,
        error: m.error || m.status_message,
      };
    });

    const isMinimize = direction.toLowerCase() === "minimize";
    const rankedCandidates = [...normalizedCandidates].sort((a, b) => {
      const scoreA = a.score ?? (isMinimize ? 999999 : -999999);
      const scoreB = b.score ?? (isMinimize ? 999999 : -999999);
      return isMinimize ? scoreA - scoreB : scoreB - scoreA;
    });

    const successfulRuns = rankedCandidates.filter(
      (r) => r.status === "Completed" && r.metrics && Object.keys(r.metrics).length > 0
    );

    const championIdFromReport =
      rawReport?.champion_model_id ||
      rawReport?.best_model_id ||
      (typeof rawReport?.best_model === "object" ? rawReport?.best_model?.model_id : rawReport?.best_model);

    const championModel =
      rankedCandidates.find((r) => r.model_id === championIdFromReport && r.status === "Completed") ||
      successfulRuns[0];

    if (!championModel) {
      throw new Error(`[ModelValidationAgent] No candidate model completed validation successfully.`);
    }

    const effectiveRunId = (rawReport?.validation_run_id || rawReport?.run_id || `val-${runTimestamp || Date.now()}`).slice(0, 50);

    const report: ModelValidationReport = {
      validation_run_id: effectiveRunId,
      project_id: rawReport?.project_id || projectId,
      mode: (rawReport?.mode || rawReport?.evaluation_mode || mode) as ValidationMode,
      prediction_objective_start_date: rawReport?.prediction_objective_start_date || predictionStartDate,
      prediction_objective_horizon: typeof rawReport?.prediction_objective_horizon === "number" ? rawReport.prediction_objective_horizon : horizon,
      prediction_objective_frequency: (rawReport?.prediction_objective_frequency || frequency) as ValidationFrequency,
      time_column: rawReport?.time_column || timeCol || "",
      target_column: rawReport?.target_column || targetCol || "",
      entity_column: rawReport?.entity_column || groupCol || null,
      problem_type: effectiveProblemType,
      dataset_reference: rawReport?.dataset_reference || datasetPath || "",
      dataset_schema_version: rawReport?.dataset_schema_version || undefined,
      evaluation_period: rawReport?.evaluation_period || {
        start_date: predictionStartDate,
        end_date: new Date().toISOString().slice(0, 10),
      },
      coverage_percentage: typeof rawReport?.coverage_percentage === "number" ? rawReport.coverage_percentage : 100.0,
      champion_model_id: championModel?.model_id || "",
      model_results: Object.fromEntries(rankedCandidates.map((c) => [c.model_id, c])),
      ranked_models: rankedCandidates,
      warnings: rawReport?.warnings || [],
      created_at: rawReport?.timestamp || rawReport?.created_at || new Date().toISOString(),
    };

    if (fs.existsSync(path.dirname(reportPath))) {
      try {
        fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf-8");
      } catch (writeErr: any) {
        console.warn("[ModelValidationAgent] Failed to write back enriched validation report:", writeErr?.message || writeErr);
      }
    }

    const executionSuccess = execResult.success && !!report && successfulRuns.length > 0;
    const finalStatus = executionSuccess ? "Completed" : "Failed";

    const summary = executionSuccess
      ? `Model Validation completed successfully in ${mode.replace("_", " ")} mode for ${successfulRuns.length} candidate model(s). Champion: ${championModel?.displayName || championModel?.model_id || "selected model"}.`
      : `Model Validation failed: ${rankedCandidates.length === 0 ? "No models validated" : "All candidate models failed during validation"}. ${execResult.stderr.slice(0, 250)}`;

    await logMilestoneThinking(
      services,
      "Model Validation",
      summary
    );

    return {
      status: finalStatus,
      summary,
      phase: "Model Validation",
      projectDirectory: `${runTimestamp}/${projectName}_model_training`,
      validationDirectory: `${runTimestamp}/${projectName}_model_validation`,
      mode,
      predictionObjectiveStartDate: predictionStartDate,
      predictionObjectiveHorizon: horizon,
      predictionObjectiveFrequency: frequency,
      report,
      candidates: rankedCandidates,
      championModel,
      predictionsArtifact: `${projectName}_model_validation/artifacts/predictions/validation_predictions.parquet`,
      reportArtifact: `${projectName}_model_validation/reports/model_validation_report.json`,
      warnings: report?.warnings || [],
      error: executionSuccess ? undefined : (execResult.stderr || summary),
    };
  }
}
