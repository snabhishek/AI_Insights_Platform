import { RunnableConfig } from "@langchain/core/runnables";
import { IngestionServices } from "../../state";
import { getModel, invokeAgentJson, getPromptFromFile, logMilestoneThinking } from "../../utils/agentUtils";
import { validateWithRetry } from "../../validator/validatorNode";
import { FeatureArchitectAnnotation } from "./state";
import { executePythonScript } from "../../tools/helpers/pythonExecutor";
import * as fs from "fs";
import * as path from "path";
import {
  ensureFeatureEngineeringEnvironment,
  getMcpFilesystemTools,
  getPythonScriptDirectory,
  makePipelineTemplate,
} from "../../tools";

interface RectifierOutput extends Record<string, unknown> {
  status: string;
  rectifiedCode: string;
  explanation: string;
  requiredPackages?: string[];
}

export async function programRectificationNode(
  state: typeof FeatureArchitectAnnotation.State,
  config?: RunnableConfig
) {
  const services = config?.configurable?.services as IngestionServices;
  const model = getModel();

  if (!services) {
    throw new Error("Services are required in config for program rectification");
  }

  // 1. Detect which script to run and correct
  let region = "";
  let fragment = "";
  let historyKey = "";
  let stateField = "";
  let stagePackages: string[] = [];
  const aggregatedName = state.aggregatedScriptPath || "aggregated_feature_pipeline.py";

  const historyWorkers = state.history.map((h) => h.worker);

  if (state.featureCreation?.pythonCode && !historyWorkers.includes("featureCreation_executed")) {
    region = "FEATURE_CREATION";
    fragment = state.featureCreation.pythonCode || "";
    historyKey = "featureCreation_executed";
    stateField = "featureCreation";
    stagePackages = state.featureCreation.requiredPackages || [];
  } else if (
    state.featureTransformation?.pythonCode &&
    !historyWorkers.includes("featureTransformation_executed")
  ) {
    region = "FEATURE_TRANSFORMATION";
    fragment = state.featureTransformation.pythonCode || "";
    historyKey = "featureTransformation_executed";
    stateField = "featureTransformation";
    stagePackages = state.featureTransformation.requiredPackages || [];
  } else if (state.buildDataset?.pythonCode && !historyWorkers.includes("buildDataset_executed")) {
    region = "BUILD_DATASET";
    fragment = state.buildDataset.pythonCode || "";
    historyKey = "buildDataset_executed";
    stateField = "buildDataset";
    stagePackages = state.buildDataset.requiredPackages || [];
  } else if (state.dataValidation?.pythonCode && !historyWorkers.includes("dataValidation_executed")) {
    region = "DATA_VALIDATION";
    fragment = state.dataValidation.pythonCode || "";
    historyKey = "dataValidation_executed";
    stateField = "dataValidation";
    stagePackages = state.dataValidation.requiredPackages || [];
  } else if (state.featureExtraction?.pythonCode && !historyWorkers.includes("featureExtraction_executed")) {
    region = "FEATURE_EXTRACTION";
    fragment = state.featureExtraction.pythonCode || "";
    historyKey = "featureExtraction_executed";
    stateField = "featureExtraction";
    stagePackages = state.featureExtraction.requiredPackages || [];
  } else if (state.featureSelection?.pythonCode && !historyWorkers.includes("featureSelection_executed")) {
    region = "FEATURE_SELECTION";
    fragment = state.featureSelection.pythonCode || "";
    historyKey = "featureSelection_executed";
    stateField = "featureSelection";
    stagePackages = state.featureSelection.requiredPackages || [];
  } else if (state.featureValidator?.pythonCode && !historyWorkers.includes("featureValidator_executed")) {
    region = "FEATURE_VALIDATION";
    fragment = state.featureValidator.pythonCode || "";
    historyKey = "featureValidator_executed";
    stateField = "featureValidator";
    stagePackages = state.featureValidator.requiredPackages || [];
  }

  if (!region) {
    if (services) {
      await logMilestoneThinking(services, "Feature Engineering", "No script fragment found that requires execution.");
    }
    return {};
  }

  if (services) {
    await logMilestoneThinking(
      services,
      "Feature Engineering",
      `Executing and validating aggregated script "${aggregatedName}" region ${region} via Docker Compose...`
    );
  }

  let attempt = 0;
  const maxAttempts = 3;
  // Build or update aggregated script content
  const baseDir = getPythonScriptDirectory(services, state.runTimestamp);
  const scriptPath = path.join(baseDir, aggregatedName);
  let aggregated = "";
  if (fs.existsSync(scriptPath)) {
    aggregated = fs.readFileSync(scriptPath, "utf-8");
  } else {
    aggregated = state.aggregatedScript || "";
  }
  if (!aggregated || aggregated.trim() === "") {
    aggregated = makePipelineTemplate(aggregatedName);
    fs.mkdirSync(baseDir, { recursive: true });
    fs.writeFileSync(scriptPath, aggregated, "utf-8");
  }

  // Ensure Docker environment (Dockerfile, docker-compose.yml, requirements.txt) exists
  ensureFeatureEngineeringEnvironment(baseDir, stagePackages);

  // Acquire a simple lock (record ownership in state) to indicate we are modifying the script
  const lockOwner = `programRectifier:${historyKey}`;
  const lockTimestamp = new Date().toISOString();

  // If another process holds the lock, skip execution for now
  if (state.scriptLockOwner && state.scriptLockOwner !== "" && state.scriptLockOwner !== lockOwner) {
    if (services) {
      await logMilestoneThinking(
        services,
        "Feature Engineering",
        `Aggregated script is locked by ${state.scriptLockOwner}; skipping execution of region ${region}.`
      );
    }

    return {
      history: [
        {
          worker: `${historyKey}_skipped_locked`,
          summary: `Skipped executing region ${region} because aggregated script locked by ${state.scriptLockOwner}`,
        },
      ],
    };
  }

  // Re-read the script from disk to get the up-to-date version
  if (fs.existsSync(scriptPath)) {
    aggregated = fs.readFileSync(scriptPath, "utf-8");
  }

  let currentCode = aggregated;
  let success = false;
  let lastStdout = "";
  let lastStderr = "";

  while (attempt < maxAttempts && !success) {
    attempt++;
    if (services) {
      await logMilestoneThinking(
        services,
        "Feature Engineering",
        `Running aggregated script "${aggregatedName}" in Docker Compose (Attempt ${attempt}/${maxAttempts})...`
      );
    }

    // Sync environment packages before execution
    ensureFeatureEngineeringEnvironment(baseDir, stagePackages);

    const res = await executePythonScript(
      aggregatedName,
      currentCode,
      services.projectId || "default",
      state.runTimestamp || "default",
      services,
      state.connectorId,
      stagePackages
    );

    lastStdout = res.stdout;
    lastStderr = res.stderr;
    success = res.success;

    if (success) {
      if (services) {
        await logMilestoneThinking(
          services,
          "Feature Engineering",
          `Aggregated script "${aggregatedName}" ran successfully for region ${region}.`
        );
      }
      break;
    }

    // Check if error is an environment issue rather than code syntax/runtime
    const isEnvError =
      lastStderr.includes("Docker daemon is not running") ||
      lastStderr.includes("Docker SDK execution error") ||
      lastStderr.includes("connect ECONNREFUSED");

    if (isEnvError) {
      if (services) {
        await logMilestoneThinking(
          services,
          "Feature Engineering",
          `Docker environment unavailable for live execution. Pipeline code for region ${region} preserved to disk.`
        );
      }
      break;
    }

    // If failed due to code or container build error and model is available, attempt rectification
    if (model) {
      if (services) {
        await logMilestoneThinking(
          services,
          "Feature Engineering",
          `Aggregated script "${aggregatedName}" failed for region ${region}. Asking Program Rectifier to fix code/environment errors...`
        );
      }

      const systemPrompt = await getPromptFromFile(
        "FeatureArchitect/programRectifier.md",
        "You are an expert AI Python Debugger and Code Rectification Agent."
      );

      const userMessage = [
        `The aggregated Python script "${aggregatedName}" (region ${region}) or container build failed during Docker execution.`,
        `--- Original Code ---`,
        currentCode,
        `--- Execution Stderr/Traceback ---`,
        lastStderr,
        `--- Execution Stdout ---`,
        lastStdout,
        `Target Pipeline File: ${scriptPath}`,
        `Environment Directory: ${baseDir}`,
        `Environment Configs: ${path.join(baseDir, "requirements.txt")}, ${path.join(baseDir, "Dockerfile")}, ${path.join(baseDir, "docker-compose.yml")}`,
        `Region with Error: ${region}`,
        "Action Required:",
        `1. Use MCP tool 'read_text_file' on '${scriptPath}' or environment configs to inspect the failure.`,
        `2. Use MCP tool 'edit_file' (or 'write_file') to apply your fix directly to '${scriptPath}' or the configuration files.`,
        "3. Return the final JSON summary with explanation and any requiredPackages.",
      ].join("\n\n");

      const fallback: RectifierOutput = {
        status: "Failed",
        rectifiedCode: currentCode,
        explanation: "Rectification failed/fallback triggered",
      };

      try {
        const fsTools = await getMcpFilesystemTools(services);

        const rectifierRes = await invokeAgentJson<RectifierOutput>(
          "featureArchitect",
          model,
          userMessage,
          fallback,
          services,
          {
            systemPrompt,
            traceLabel: "featureArchitect:rectifier",
            tools: [...fsTools],
            recursionLimit: 100,
          }
        );

        if (Array.isArray(rectifierRes?.requiredPackages) && rectifierRes.requiredPackages.length > 0) {
          stagePackages = Array.from(new Set([...stagePackages, ...rectifierRes.requiredPackages]));
          ensureFeatureEngineeringEnvironment(baseDir, stagePackages);
        }

        // Re-read the updated script from disk after rectifier tool execution
        if (fs.existsSync(scriptPath)) {
          currentCode = fs.readFileSync(scriptPath, "utf-8");
          aggregated = currentCode;
        }
      } catch (err) {
        console.warn("[programRectificationNode] Rectifier call failed", err);
      }
    }
  }

  // Update target node state properties
  const targetStateUpdate: Record<string, any> = {};
  const currentLogs = `--- Stdout ---\n${lastStdout}\n\n--- Stderr ---\n${lastStderr}`;

  if (success) {
    targetStateUpdate[stateField] = {
      ...(state as any)[stateField],
      status: "Success",
      pythonCode: fragment,
      requiredPackages: stagePackages,
    };

    // persist aggregated script and release lock
    targetStateUpdate.aggregatedScript = currentCode;
    targetStateUpdate.scriptLockOwner = "";
    targetStateUpdate.scriptLockTimestamp = "";

    return {
      ...targetStateUpdate,
      currentExecutionLogs: currentLogs,
      history: [
        {
          worker: historyKey,
          summary: `Successfully executed and verified aggregated script "${aggregatedName}" after ${attempt} attempt(s).`,
        },
      ],
    };
  } else {
    targetStateUpdate[stateField] = {
      ...(state as any)[stateField],
      status: "Failed",
      pythonCode: fragment,
      requiredPackages: stagePackages,
    };

    // persist aggregated script and release lock
    targetStateUpdate.aggregatedScript = currentCode;
    targetStateUpdate.scriptLockOwner = "";
    targetStateUpdate.scriptLockTimestamp = "";

    return {
      ...targetStateUpdate,
      currentExecutionLogs: currentLogs,
      history: [
        {
          worker: `${historyKey}_failed`,
          summary: `Failed executing aggregated script "${aggregatedName}" after ${attempt} attempt(s). Stderr: ${lastStderr}`,
        },
      ],
    };
  }
}
