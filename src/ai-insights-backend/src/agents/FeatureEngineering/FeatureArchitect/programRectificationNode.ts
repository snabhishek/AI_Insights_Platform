import { RunnableConfig } from "@langchain/core/runnables";
import { IngestionServices } from "../../state";
import { getModel, invokeAgentJson, getPromptFromFile, logMilestoneThinking } from "../../utils/agentUtils";
import { validateWithRetry } from "../../validator/validatorNode";
import { FeatureArchitectAnnotation } from "./state";
import { executePythonScript } from "../../tools/helpers/pythonExecutor";
import * as fs from "fs";
import * as path from "path";
import { getMcpFilesystemTools, getSandboxDirectory, makePipelineTemplate } from "../../tools";


interface RectifierOutput extends Record<string, unknown> {
  status: string;
  rectifiedCode: string;
  explanation: string;
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
  const aggregatedName = state.aggregatedScriptPath || "aggregated_feature_pipeline.py";

  const historyWorkers = state.history.map((h) => h.worker);

  if (state.featureCreation?.pythonCode && !historyWorkers.includes("featureCreation_executed")) {
    region = "FEATURE_CREATION";
    fragment = state.featureCreation.pythonCode || "";
    historyKey = "featureCreation_executed";
    stateField = "featureCreation";
  } else if (
    state.featureTransformation?.pythonCode &&
    !historyWorkers.includes("featureTransformation_executed")
  ) {
    region = "FEATURE_TRANSFORMATION";
    fragment = state.featureTransformation.pythonCode || "";
    historyKey = "featureTransformation_executed";
    stateField = "featureTransformation";
  } else if (state.buildDataset?.pythonCode && !historyWorkers.includes("buildDataset_executed")) {
    region = "BUILD_DATASET";
    fragment = state.buildDataset.pythonCode || "";
    historyKey = "buildDataset_executed";
    stateField = "buildDataset";
  } else if (state.dataValidation?.pythonCode && !historyWorkers.includes("dataValidation_executed")) {
    region = "DATA_VALIDATION";
    fragment = state.dataValidation.pythonCode || "";
    historyKey = "dataValidation_executed";
    stateField = "dataValidation";
  } else if (state.featureExtraction?.pythonCode && !historyWorkers.includes("featureExtraction_executed")) {
    region = "FEATURE_EXTRACTION";
    fragment = state.featureExtraction.pythonCode || "";
    historyKey = "featureExtraction_executed";
    stateField = "featureExtraction";
  } else if (state.featureSelection?.pythonCode && !historyWorkers.includes("featureSelection_executed")) {
    region = "FEATURE_SELECTION";
    fragment = state.featureSelection.pythonCode || "";
    historyKey = "featureSelection_executed";
    stateField = "featureSelection";
  } else if (state.featureValidator?.pythonCode && !historyWorkers.includes("featureValidator_executed")) {
    region = "FEATURE_VALIDATION";
    fragment = state.featureValidator.pythonCode || "";
    historyKey = "featureValidator_executed";
    stateField = "featureValidator";
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
      `Executing and validating aggregated script "${aggregatedName}" region ${region}...`
    );
  }

  let attempt = 0;
  const maxAttempts = 3;
  // Build or update aggregated script content
  const baseDir = path.join(
    process.cwd(),
    "uploads",
    "projects",
    services.projectId || "default",
    "runs",
    state.runTimestamp || "default"
  );
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
        `Running aggregated script "${aggregatedName}" (Attempt ${attempt}/${maxAttempts})...`
      );
    }

    const res = await executePythonScript(
      aggregatedName,
      currentCode,
      services.projectId || "default",
      state.runTimestamp || "default",
      services,
      state.connectorId
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

    // If failed due to code error and model is available, attempt rectification
    if (model) {
      if (services) {
        await logMilestoneThinking(
          services,
          "Feature Engineering",
          `Aggregated script "${aggregatedName}" failed for region ${region}. Asking Program Rectifier to fix code errors...`
        );
      }

      const systemPrompt = await getPromptFromFile(
        "programRectifier.md",
        "You are an expert AI Python Debugger and Code Rectification Agent."
      );

      const userMessage = [
        `The aggregated Python script "${aggregatedName}" (region ${region}) failed during execution.`,
        `--- Original Code ---`,
        currentCode,
        `--- Execution Stderr/Traceback ---`,
        lastStderr,
        `--- Execution Stdout ---`,
        lastStdout,
        `Target Pipeline File: ${scriptPath}`,
        `Region with Error: ${region}`,
        "Action Required:",
        `1. Use MCP tool 'read_text_file' on '${scriptPath}' to inspect the code around the failure.`,
        `2. Use MCP tool 'edit_file' (or 'write_file') to apply your fix directly to '${scriptPath}'.`,
        "3. Return the final JSON summary with explanation.",
      ].join("\n\n");

      const fallback: RectifierOutput = {
        status: "Failed",
        rectifiedCode: currentCode,
        explanation: "Rectification failed/fallback triggered",
      };

      try {
        const fsTools = await getMcpFilesystemTools({
          projectId: services.projectId,
          runTimestamp: state.runTimestamp,
        });

        await invokeAgentJson<RectifierOutput>(
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
