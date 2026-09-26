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
  /**
   * Pure function to determine validation mode based on start date vs current server date.
   */
  public static determineValidationMode(
    predictionStartDate: string,
    currentServerDate?: string
  ): ValidationMode {
    const today = currentServerDate || new Date().toISOString().slice(0, 10);
    const cleanStart = (predictionStartDate || "").trim().slice(0, 10);
    if (!cleanStart) return "backtesting";
    return cleanStart > today ? "future_prediction" : "backtesting";
  }

  /**
   * Resolves the calculative prediction start date:
   * 1. Checks explicit predictionObjectiveStartDate from state or config
   * 2. Otherwise advances from training cutoff date (splitEndDate or splitDate) to the next day/period
   */
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
      try {
        const d = new Date(cutoffDateStr.trim());
        if (!isNaN(d.getTime())) {
          d.setDate(d.getDate() + 1);
          return d.toISOString().slice(0, 10);
        }
      } catch { }
      return cutoffDateStr.trim().slice(0, 10);
    }

    return new Date().toISOString().slice(0, 10);
  }

  /**
   * Scaffolds the dedicated validation directory structure:
   * <projectName>_model_validation/
   * â”œâ”€â”€ artifacts/
   * â”‚   â”œâ”€â”€ predictions/
   * â”‚   â””â”€â”€ plots/
   * â”œâ”€â”€ configs/
   * â””â”€â”€ reports/
   */
  public static setupValidationDirectory(validationDir: string): void {
    fs.mkdirSync(validationDir, { recursive: true });
    fs.mkdirSync(path.join(validationDir, "artifacts", "predictions"), { recursive: true });
    fs.mkdirSync(path.join(validationDir, "artifacts", "plots"), { recursive: true });
    fs.mkdirSync(path.join(validationDir, "configs"), { recursive: true });
    fs.mkdirSync(path.join(validationDir, "reports"), { recursive: true });
  }

  /**
   * Validates whether a model validation report exists and contains at least
   * one successfully evaluated candidate model with non-empty metrics.
   */
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
      const rawCandidates =
        content?.ranked_models ||
        content?.models ||
        content?.candidate_models ||
        content?.model_results ||
        content?.candidates;

      const modelsList: any[] = Array.isArray(rawCandidates)
        ? rawCandidates
        : rawCandidates && typeof rawCandidates === "object"
        ? Object.entries(rawCandidates).map(([k, v]: [string, any]) =>
            v && typeof v === "object" ? { model_id: v.model_id || k, ...v } : { model_id: k, value: v }
          )
        : [];

      if (!modelsList || modelsList.length === 0) {
        return { success: false, reason: "No models found in model_validation_report.json." };
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

  /**
   * Resolves project directories and artifact locations.
   */
  private static getProjectContext(state: AgentStateType, services: IngestionServices) {
    const projectId = state.projectId || services?.projectId || "default-project";
    const workspaceName = (state as any).workspaceName || services?.workspaceName || "Default_Workspace";
    const projectName = (state as any).projectName || services?.projectName || "Forecasting";
    const runTimestamp = state.runTimestamp || services?.runTimestamp || "";

    const projectRootDir = path.join(
      getFileServerBasePath(),
      "workspaces",
      sanitizeFolderName(workspaceName),
      "projects",
      sanitizeFolderName(projectName)
    );

    const runDir = runTimestamp ? path.join(projectRootDir, runTimestamp) : projectRootDir;
    const modelTrainingDir = path.join(runDir, `${projectName}_model_training`);
    const modelValidationDir = path.join(runDir, `${projectName}_model_validation`);
    const modelsDir = path.join(modelTrainingDir, "artifacts", "models");

    // Discover finalized dataset (STRICT - NO FALLBACK PATHS)
    const candidateDatasetPaths = [
      path.join(runDir, "python_script", "dataset.parquet"),
      path.join(runDir, "dataset.parquet"),
      path.join(runDir, "python_script", "feature_validation.parquet"),
      path.join(runDir, "feature_validation.parquet"),
      path.join(runDir, "python_script", "feature_selection.parquet"),
      path.join(runDir, "python_script", "feature_extraction.parquet"),
    ];
    const datasetPath = candidateDatasetPaths.find((p) => fs.existsSync(p));
    if (!datasetPath) {
      throw new Error(`[ModelValidationAgent] Finalized dataset artifact was not found in ${runDir} or ${projectRootDir}. Validated dataset is required.`);
    }

    // Read training config (STRICT - NO FALLBACKS)
    let trainingConfig: any = {};
    const configPath = path.join(modelTrainingDir, "configs", "training_config.yaml");
    if (!fs.existsSync(configPath)) {
      throw new Error(`[ModelValidationAgent] Training configuration contract not found at ${configPath}. Training configuration is required.`);
    }
    try {
      trainingConfig = yaml.load(fs.readFileSync(configPath, "utf-8")) || {};
    } catch (e: any) {
      throw new Error(`[ModelValidationAgent] Failed to read training configuration contract at ${configPath}: ${e?.message || e}`);
    }

    // Read training report (STRICT - NO FALLBACKS)
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
    };
  }


  /**
   * Main agentic execution flow for Model Validation.
   * Prompts the Model Validation Coding Agent with active context, artifacts, and tools,
   * then executes and validates the generated pipeline inside the Docker environment.
   */
  public static async execute(
    state: AgentStateType,
    services: IngestionServices,
    options?: {
      predictionHorizon?: number;
      predictionFrequency?: string;
      predictionObjectiveStartDate?: string;
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
    } = ctx;

    // Scaffolds the dedicated validation directory
    this.setupValidationDirectory(modelValidationDir);

    // Resolve Parameters
    const horizon = options?.predictionHorizon || (state as any).predictionHorizon || 12;
    const frequency: ValidationFrequency =
      (options?.predictionFrequency as ValidationFrequency) ||
      ((state as any).predictionFrequency as ValidationFrequency) ||
      "Weekly";

    const predictionStartDate =
      (options?.predictionObjectiveStartDate && options.predictionObjectiveStartDate.trim().length > 0)
        ? options.predictionObjectiveStartDate.trim().slice(0, 10)
        : this.resolvePredictionStartDate(state, trainingConfig);

    const mode = this.determineValidationMode(predictionStartDate);

    // Read feature engineering metadata.yaml if available for physical dataset column bindings
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
      Array.isArray(state.selectedModels) && state.selectedModels.length > 0
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

    // 1. Prepare Tools for the Agent
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

    // 2. Prepare System Prompt & User Prompt
    const model = getModel();
    const systemPrompt = await getPromptFromFile(
      "ModelValidation/modelValidation.md",
      "You are an expert AI Machine Learning Validation Engineer and Coding Agent."
    );

    const relativeValidationRunner = path.join(modelValidationDir, "validation_runner.py");

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
      `4. In Backtesting Mode (${mode === "backtesting"}), slice evaluation records starting from ${predictionStartDate}, compare against ground-truth actuals, and compute deterministic metrics (F1/Accuracy or WAPE/MAE/RMSE).`,
      `5. Save outputs to '${runTimestamp}/${projectName}_model_validation/reports/model_validation_report.json' and 'artifacts/predictions/validation_predictions.parquet'.`,
      `Return a JSON summary of your implementation when the runner is created.`,
    ].join("\n\n");

    const codingFallback: ValidationCodingAgentResult = {
      status: "Completed",
      summary: "Python model validation program scaffolded.",
      projectDirectory: `${runTimestamp}/${projectName}_model_validation`,
      files: ["validation_runner.py", "configs/validation_config.yaml"],
    };

    // 3. Agentic Code Generation
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

    // Inherit packages from model training requirements.txt if present
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

    // If the agent failed to produce validation_runner.py, retry the coding agent
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

    // Ensure initial requirements.txt exists in modelValidationDir
    try {
      const valReqPath = path.join(modelValidationDir, "requirements.txt");
      fs.writeFileSync(valReqPath, accumulatedPackages.join("\n"), "utf-8");
    } catch (writeErr: any) {
      console.warn("[ModelValidationAgent] Failed to write initial requirements.txt:", writeErr?.message || writeErr);
    }

    // 4. Execution in Container Sandbox
    const relDatasetPath = path.relative(projectRootDir, datasetPath).replace(/\\/g, "/");
    const relModelsDir = path.relative(projectRootDir, modelsDir).replace(/\\/g, "/");
    const relOutputDir = path.relative(projectRootDir, modelValidationDir).replace(/\\/g, "/");

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

    // 5. Self-Healing Rectification Loop if Container Execution Fails or all candidate models failed
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
          // Rectifier did not provide a code fix — re-invoke the coding agent
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
              `PREVIOUS EXECUTION FAILED:\n${validationHealth.reason || ""}\n${failedModelDetails}\n${execResult.stderr || execResult.stdout || "Report was not generated."}\n\nFix the issues and regenerate the validation_runner.py.`,
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
        // Rectifier itself failed — re-invoke the coding agent with error context
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

    // 6. Parse Output Report and Normalize
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

    // Extract raw candidates from any supported schema format
    const rawCandidatesList: any[] =
      rawReport?.ranked_models ||
      (rawReport?.models
        ? Array.isArray(rawReport.models)
          ? rawReport.models
          : Object.values(rawReport.models)
        : []) ||
      (rawReport?.candidate_models
        ? Array.isArray(rawReport.candidate_models)
          ? rawReport.candidate_models
          : Object.values(rawReport.candidate_models)
        : []) ||
      (rawReport?.model_results
        ? Array.isArray(rawReport.model_results)
          ? rawReport.model_results
          : Object.values(rawReport.model_results)
        : []) ||
      (rawReport?.candidateModels && Array.isArray(rawReport.candidateModels) ? rawReport.candidateModels : []);

    if (!rawCandidatesList || rawCandidatesList.length === 0) {
      throw new Error(`[ModelValidationAgent] Validation report at ${reportPath} contains no evaluated models.`);
    }

    const effectiveProblemType = rawReport?.problem_type || problemType;
    const isClassification = effectiveProblemType.toLowerCase().includes("class");

    // Comprehensive framework lookup across all pipeline sources and artifacts
    const frameworkMap = new Map<string, string>();

    // 1. From training config (training_config.yaml -> candidate_models: { [id]: { model_id, framework } })
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

    // 2. From training config contract schema (model_selection.models / candidates)
    const contractModels = [
      ...(trainingConfig?.model_selection?.models || []),
      ...(trainingConfig?.model_selection?.candidates || []),
    ];
    for (const m of contractModels) {
      const id = m?.model_id || m?.id;
      const fw = m?.framework;
      if (id && fw) frameworkMap.set(String(id).toLowerCase().trim(), String(fw));
    }

    // 3. From training report (models_evaluated, candidate_models_evaluated, results, model_results, runs, candidate_models)
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

    // 4. From state (modelSelection, modelTraining, trainingConfiguration)
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

    // 5. From validation report's own models dictionary
    if (rawReport?.models && typeof rawReport.models === "object") {
      for (const [k, v] of Object.entries<any>(rawReport.models)) {
        const id = v?.model_id || k;
        const fw = v?.framework;
        if (id && fw && !frameworkMap.has(String(id).toLowerCase().trim())) {
          frameworkMap.set(String(id).toLowerCase().trim(), String(fw));
        }
      }
    }

    // Helper to safely extract a numeric metric value from either number or object format
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

      // Merge candidate with full details object from rawReport.models, candidate_models, or model_results
      let detailedModel: any = {};
      const detailSources = [rawReport?.models, rawReport?.candidate_models, rawReport?.model_results];
      for (const src of detailSources) {
        if (src && typeof src === "object") {
          if (!Array.isArray(src)) {
            const directMatch = src[modelId] || src[modelId.toLowerCase()];
            const matched = directMatch || Object.values(src).find((v: any) =>
              (v?.model_id && String(v.model_id).toLowerCase() === modelId.toLowerCase()) ||
              (v?.displayName && String(v.displayName).toLowerCase() === String(candSummary.displayName || modelId).toLowerCase())
            );
            if (matched && typeof matched === "object") {
              detailedModel = { ...matched, ...detailedModel };
            }
          } else {
            const matched = src.find((v: any) =>
              (v?.model_id && String(v.model_id).toLowerCase() === modelId.toLowerCase()) ||
              (v?.displayName && String(v.displayName).toLowerCase() === String(candSummary.displayName || modelId).toLowerCase())
            );
            if (matched && typeof matched === "object") {
              detailedModel = { ...matched, ...detailedModel };
            }
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

      // Normalize metrics dictionary
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

      // Determine score and primary metric name
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

    // Rank candidates by performance strictly according to direction
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
      (typeof rawReport?.best_model === "object" ? rawReport?.best_model?.model_id : rawReport?.best_model) ||
      rawReport?.best_model_id ||
      rawReport?.champion_model_id ||
      (typeof rawReport?.selected_model === "object" ? rawReport?.selected_model?.model_id : rawReport?.selected_model) ||
      rawReport?.champion_model;

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
      models: Object.fromEntries(rankedCandidates.map((c) => [c.model_id, c])),
      ranked_models: rankedCandidates,
      warnings: rawReport?.warnings || [],
      created_at: rawReport?.timestamp || rawReport?.created_at || new Date().toISOString(),
    };

    // Save enriched report back to disk so file consumers get the normalized format
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
