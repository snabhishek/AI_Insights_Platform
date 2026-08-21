  import { RunnableConfig } from "@langchain/core/runnables";
import { IngestionServices } from "../../state";
import { getModel, invokeAgentJson, getPromptFromFile, logMilestoneThinking } from "../../utils/agentUtils";
import { FeatureArchitectAnnotation } from "./state";
import { executePythonScript } from "../../tools/helpers/pythonExecutor";

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
  let scriptName = "";
  let code = "";
  let historyKey = "";
  let stateField = "";

  const historyWorkers = state.history.map((h) => h.worker);

  if (state.featureCreation?.pythonCode && !historyWorkers.includes("featureCreation_executed")) {
    scriptName = "feature_creation.py";
    code = state.featureCreation.pythonCode;
    historyKey = "featureCreation_executed";
    stateField = "featureCreation";
  } else if (
    state.featureTransformation?.pythonCode &&
    !historyWorkers.includes("featureTransformation_executed")
  ) {
    scriptName = "feature_transformation.py";
    code = state.featureTransformation.pythonCode;
    historyKey = "featureTransformation_executed";
    stateField = "featureTransformation";
  } else if (state.buildDataset?.pythonCode && !historyWorkers.includes("buildDataset_executed")) {
    scriptName = "build_dataset.py";
    code = state.buildDataset.pythonCode;
    historyKey = "buildDataset_executed";
    stateField = "buildDataset";
  } else if (state.dataValidation?.pythonCode && !historyWorkers.includes("dataValidation_executed")) {
    scriptName = "validate_dataset.py";
    code = state.dataValidation.pythonCode;
    historyKey = "dataValidation_executed";
    stateField = "dataValidation";
  } else if (state.featureExtraction?.pythonCode && !historyWorkers.includes("featureExtraction_executed")) {
    scriptName = "feature_extraction.py";
    code = state.featureExtraction.pythonCode;
    historyKey = "featureExtraction_executed";
    stateField = "featureExtraction";
  } else if (state.featureSelection?.pythonCode && !historyWorkers.includes("featureSelection_executed")) {
    scriptName = "feature_selection.py";
    code = state.featureSelection.pythonCode;
    historyKey = "featureSelection_executed";
    stateField = "featureSelection";
  }

  if (!scriptName) {
    if (services) {
      await logMilestoneThinking(services, "Feature Engineering", "No script found that requires execution.");
    }
    return {};
  }

  if (services) {
    await logMilestoneThinking(
      services,
      "Feature Engineering",
      `Executing and validating script "${scriptName}"...`
    );
  }

  let attempt = 0;
  const maxAttempts = 3;
  let currentCode = code;
  let success = false;
  let lastStdout = "";
  let lastStderr = "";

  while (attempt < maxAttempts && !success) {
    attempt++;
    if (services) {
      await logMilestoneThinking(
        services,
        "Feature Engineering",
        `Running "${scriptName}" (Attempt ${attempt}/${maxAttempts})...`
      );
    }

    const res = await executePythonScript(
      scriptName,
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
          `Script "${scriptName}" ran successfully.`
        );
      }
      break;
    }

    // If failed and model is available, attempt rectification
    if (model) {
      if (services) {
        await logMilestoneThinking(
          services,
          "Feature Engineering",
          `Script "${scriptName}" failed. Asking Program Rectifier to fix code errors...`
        );
      }

      const systemPrompt = await getPromptFromFile(
        "programRectifier.md",
        "You are an expert AI Python Debugger and Code Rectification Agent."
      );

      const userMessage = [
        `The Python script "${scriptName}" failed during execution.`,
        `--- Original Code ---`,
        currentCode,
        `--- Execution Stderr/Traceback ---`,
        lastStderr,
        `--- Execution Stdout ---`,
        lastStdout,
        `Please rectify the errors, ensuring compatibility with CLI connection arguments, and output the corrected script.`,
      ].join("\n\n");

      const fallback: RectifierOutput = {
        status: "Failed",
        rectifiedCode: currentCode,
        explanation: "Rectification failed/fallback triggered",
      };

      try {
        const rectifierResult = await invokeAgentJson<RectifierOutput>(
          "featureArchitect",
          model,
          userMessage,
          fallback,
          services,
          {
            systemPrompt,
            traceLabel: "featureArchitect:rectifier",
          }
        );

        if (rectifierResult.rectifiedCode) {
          currentCode = rectifierResult.rectifiedCode;
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
      pythonCode: currentCode,
    };
    return {
      ...targetStateUpdate,
      currentExecutionLogs: currentLogs,
      history: [
        {
          worker: historyKey,
          summary: `Successfully executed and verified "${scriptName}" after ${attempt} attempt(s).`,
        },
      ],
    };
  } else {
    targetStateUpdate[stateField] = {
      ...(state as any)[stateField],
      status: "Failed",
      pythonCode: currentCode,
    };
    return {
      ...targetStateUpdate,
      currentExecutionLogs: currentLogs,
      history: [
        {
          worker: `${historyKey}_failed`,
          summary: `Failed executing "${scriptName}" after ${attempt} attempt(s). Stderr: ${lastStderr}`,
        },
      ],
    };
  }
}
