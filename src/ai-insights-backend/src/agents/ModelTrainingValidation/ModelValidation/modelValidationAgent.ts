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
      const modelsList: any[] =
        content?.ranked_models ||
        (content?.models
          ? Array.isArray(content.models)
            ? content.models
            : Object.values(content.models)
          : []);

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
          reason: `All ${modelsList.length} candidate model(s) failed validation.`,
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

    // Discover finalized dataset
    const candidateDatasetPaths = [
      path.join(runDir, "python_script", "validated_features.parquet"),
      path.join(runDir, "python_script", "selected_features.parquet"),
      path.join(runDir, "python_script", "dataset.parquet"),
      path.join(projectRootDir, "python_script", "validated_features.parquet"),
    ];
    const datasetPath = candidateDatasetPaths.find((p) => fs.existsSync(p)) || candidateDatasetPaths[0];

    // Read training config
    let trainingConfig: any = {};
    const configPath = path.join(modelTrainingDir, "configs", "training_config.yaml");
    if (fs.existsSync(configPath)) {
      try {
        trainingConfig = yaml.load(fs.readFileSync(configPath, "utf-8")) || {};
      } catch { }
    }

    // Read training report
    let trainingReport: any = {};
    const reportCandidates = [
      path.join(modelTrainingDir, "reports", "model_training_report.json"),
      path.join(modelTrainingDir, "model_training_report.json"),
      path.join(runDir, "model_training_report.json"),
    ];
    for (const rp of reportCandidates) {
      if (fs.existsSync(rp)) {
        try {
          trainingReport = JSON.parse(fs.readFileSync(rp, "utf-8")) || {};
          break;
        } catch { }
      }
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

    const timeCol = trainingConfig?.split?.time_column || "Order_Date";
    const targetCol = trainingConfig?.task?.target_column || "Order_Quantity";
    const groupCol = trainingConfig?.split?.group_by || "SKU";
    const problemType = trainingConfig?.task?.task_type || "forecasting";

    const effectiveSelectedModels: string[] = Array.isArray(state.selectedModels) && state.selectedModels.length > 0
      ? state.selectedModels
      : Array.isArray((state as any).selectedModelsToValidate)
        ? (state as any).selectedModelsToValidate
        : [];

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

    // 6. Parse Output Report
    let report: ModelValidationReport | undefined;
    if (fs.existsSync(reportPath)) {
      try {
        report = JSON.parse(fs.readFileSync(reportPath, "utf-8"));
      } catch (err: any) {
        console.warn(`[ModelValidationAgent] Failed to parse validation report:`, err?.message || err);
      }
    }

    const runs: CandidateModelValidationRun[] = report?.ranked_models || (report?.models ? Object.values(report.models) : []);
    const successfulRuns = runs.filter(
      (r) => (r.status || "").toLowerCase() === "completed" && r.metrics && Object.keys(r.metrics).length > 0
    );
    const championModel =
      runs.find((r) => r.model_id === report?.champion_model_id && (r.status || "").toLowerCase() === "completed") ||
      successfulRuns[0];

    const executionSuccess = execResult.success && !!report && successfulRuns.length > 0;
    const finalStatus = executionSuccess ? "Completed" : "Failed";

    const summary = executionSuccess
      ? `Model Validation completed successfully in ${mode.replace("_", " ")} mode for ${successfulRuns.length} candidate model(s). Champion: ${championModel?.displayName || championModel?.model_id || "selected model"}.`
      : `Model Validation failed: ${runs.length === 0 ? "No models validated" : "All candidate models failed during validation"}. ${execResult.stderr.slice(0, 250)}`;

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
      candidates: runs,
      championModel,
      predictionsArtifact: `${projectName}_model_validation/artifacts/predictions/validation_predictions.parquet`,
      reportArtifact: `${projectName}_model_validation/reports/model_validation_report.json`,
      warnings: report?.warnings || [],
      error: executionSuccess ? undefined : (execResult.stderr || summary),
    };
  }
}
