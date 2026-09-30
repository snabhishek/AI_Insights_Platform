import { RunnableConfig } from "@langchain/core/runnables";
import { IngestionServices } from "../../state";
import { getModel, invokeAgentJson, getPromptFromFile, logMilestoneThinking } from "../../utils/agentUtils";
import { FeatureArchitectAnnotation } from "./state";
import { executePythonScript } from "../../tools/helpers/pythonExecutor";
import * as fs from "fs";
import * as path from "path";
import {
  ensureFeatureEngineeringEnvironment,
  getMcpFilesystemTools,
  getPythonScriptDirectory,
} from "../../tools";
import {
  DEFAULT_PIPELINE_SCRIPT_NAME,
  PROMPT_PROGRAM_RECTIFIER,
  REGION_BUILD_DATASET,
  REGION_DATA_VALIDATION,
  REGION_FEATURE_CREATION,
  REGION_FEATURE_EXTRACTION,
  REGION_FEATURE_SELECTION,
  REGION_FEATURE_TRANSFORMATION,
  REGION_FEATURE_VALIDATION,
  STATUS_FAILED,
  STATUS_SUCCESS,
  TRACE_RECTIFIER,
  WORKER_BUILD_DATASET,
  WORKER_DATA_VALIDATION,
  WORKER_FEATURE_CREATION,
  WORKER_FEATURE_EXTRACTION,
  WORKER_FEATURE_SELECTION,
  WORKER_FEATURE_TRANSFORMATION,
  WORKER_FEATURE_VALIDATOR,
} from "./constants";

const DEFAULT_STAGE_TITLE = "Feature Engineering";
const DEFAULT_NO_SCRIPT_MSG = "No script fragment found that requires execution.";
const DEFAULT_SYSTEM_PROMPT_FALLBACK = "You are an expert AI Python Debugger and Code Rectification Agent.";
const DEFAULT_FALLBACK_EXPLANATION = "Rectification failed/fallback triggered";
const DEFAULT_FALLBACK_STATUS = "Failed";
const DEFAULT_FALLBACK_PROJECT = "default";
const DEFAULT_FALLBACK_TIMESTAMP = "default";
const MAX_ATTEMPTS = 3;
const MAX_RECURSION_LIMIT = 100;
const UTF8_ENCODING = "utf-8";

interface RectifierOutput extends Record<string, unknown> {
  status: string;
  rectifiedCode: string;
  explanation: string;
  requiredPackages?: string[];
}

interface ExecutableStageCandidate {
  region: string;
  fragment: string;
  historyKey: string;
  stateField: string;
  stagePackages: string[];
}

function findStageToExecute(
  state: typeof FeatureArchitectAnnotation.State,
  historyWorkers: string[]
): ExecutableStageCandidate | null {
  const stageDefinitions = [
    {
      region: REGION_FEATURE_CREATION,
      code: state.featureCreation?.pythonCode,
      name: WORKER_FEATURE_CREATION,
      stateField: "featureCreation",
      packages: state.featureCreation?.requiredPackages,
    },
    {
      region: REGION_FEATURE_TRANSFORMATION,
      code: state.featureTransformation?.pythonCode,
      name: WORKER_FEATURE_TRANSFORMATION,
      stateField: "featureTransformation",
      packages: state.featureTransformation?.requiredPackages,
    },
    {
      region: REGION_BUILD_DATASET,
      code: state.buildDataset?.pythonCode,
      name: WORKER_BUILD_DATASET,
      stateField: "buildDataset",
      packages: state.buildDataset?.requiredPackages,
    },
    {
      region: REGION_DATA_VALIDATION,
      code: state.dataValidation?.pythonCode,
      name: WORKER_DATA_VALIDATION,
      stateField: "dataValidation",
      packages: state.dataValidation?.requiredPackages,
    },
    {
      region: REGION_FEATURE_EXTRACTION,
      code: state.featureExtraction?.pythonCode,
      name: WORKER_FEATURE_EXTRACTION,
      stateField: "featureExtraction",
      packages: state.featureExtraction?.requiredPackages,
    },
    {
      region: REGION_FEATURE_SELECTION,
      code: state.featureSelection?.pythonCode,
      name: WORKER_FEATURE_SELECTION,
      stateField: "featureSelection",
      packages: state.featureSelection?.requiredPackages,
    },
    {
      region: REGION_FEATURE_VALIDATION,
      code: state.featureValidator?.pythonCode,
      name: WORKER_FEATURE_VALIDATOR,
      stateField: "featureValidator",
      packages: state.featureValidator?.requiredPackages,
    },
  ];

  for (const def of stageDefinitions) {
    const executedKey = `${def.name}_executed`;
    const hasCode = typeof def.code === "string" && def.code.length > 0;
    const isAlreadyExecuted = historyWorkers.includes(executedKey);
    const shouldRun = hasCode && !isAlreadyExecuted;
    if (shouldRun) {
      return {
        region: def.region,
        fragment: def.code ?? "",
        historyKey: executedKey,
        stateField: def.stateField,
        stagePackages: def.packages ?? [],
      };
    }
  }

  return null;
}

function isDockerEnvironmentError(stderr: string): boolean {
  const dockerErrors = [
    "Docker daemon is not running",
    "Docker SDK execution error",
    "connect ECONNREFUSED",
  ];
  return dockerErrors.some((msg) => stderr.includes(msg));
}

function isScriptLockedByOther(currentLock: string | undefined, owner: string): boolean {
  const hasLock = typeof currentLock === "string" && currentLock.length > 0;
  const isOther = currentLock !== owner;
  return hasLock && isOther;
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

  const historyWorkers = state.history.map((h) => h.worker);
  const stageCandidate = findStageToExecute(state, historyWorkers);

  if (!stageCandidate) {
    if (services) {
      await logMilestoneThinking(services, DEFAULT_STAGE_TITLE, DEFAULT_NO_SCRIPT_MSG);
    }
    return {};
  }

  const { region, fragment, historyKey, stateField } = stageCandidate;
  let stagePackages = stageCandidate.stagePackages;
  const aggregatedName = state.aggregatedScriptPath ?? DEFAULT_PIPELINE_SCRIPT_NAME;

  if (services) {
    await logMilestoneThinking(
      services,
      DEFAULT_STAGE_TITLE,
      `Executing and validating aggregated script "${aggregatedName}" region ${region} via Docker Compose...`
    );
  }

  let attempt = 0;
  const baseDir = getPythonScriptDirectory(services, state.runTimestamp);
  const scriptPath = path.join(baseDir, aggregatedName);
  let aggregated = "";
  if (fs.existsSync(scriptPath)) {
    aggregated = fs.readFileSync(scriptPath, UTF8_ENCODING);
  } else {
    aggregated = state.aggregatedScript ?? "";
  }

  ensureFeatureEngineeringEnvironment(baseDir, stagePackages);

  const lockOwner = `programRectifier:${historyKey}`;
  const isLocked = isScriptLockedByOther(state.scriptLockOwner, lockOwner);

  if (isLocked) {
    if (services) {
      await logMilestoneThinking(
        services,
        DEFAULT_STAGE_TITLE,
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

  if (fs.existsSync(scriptPath)) {
    aggregated = fs.readFileSync(scriptPath, UTF8_ENCODING);
  }

  let currentCode = aggregated;
  let success = false;
  let lastStdout = "";
  let lastStderr = "";

  while (attempt < MAX_ATTEMPTS && !success) {
    attempt++;
    if (services) {
      await logMilestoneThinking(
        services,
        DEFAULT_STAGE_TITLE,
        `Running aggregated script "${aggregatedName}" in Docker Compose (Attempt ${attempt}/${MAX_ATTEMPTS})...`
      );
    }

    ensureFeatureEngineeringEnvironment(baseDir, stagePackages);

    const projectIdVal = services.projectId ?? DEFAULT_FALLBACK_PROJECT;
    const runTimestampVal = state.runTimestamp ?? DEFAULT_FALLBACK_TIMESTAMP;

    const res = await executePythonScript(
      aggregatedName,
      currentCode,
      projectIdVal,
      runTimestampVal,
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
          DEFAULT_STAGE_TITLE,
          `Aggregated script "${aggregatedName}" ran successfully for region ${region}.`
        );
      }
      break;
    }

    const isEnvError = isDockerEnvironmentError(lastStderr);
    if (isEnvError) {
      if (services) {
        await logMilestoneThinking(
          services,
          DEFAULT_STAGE_TITLE,
          `Docker environment unavailable for live execution. Pipeline code for region ${region} preserved to disk.`
        );
      }
      break;
    }

    if (model) {
      if (services) {
        await logMilestoneThinking(
          services,
          DEFAULT_STAGE_TITLE,
          `Aggregated script "${aggregatedName}" failed for region ${region}. Asking Program Rectifier to fix code/environment errors...`
        );
      }

      const systemPrompt = await getPromptFromFile(
        PROMPT_PROGRAM_RECTIFIER,
        DEFAULT_SYSTEM_PROMPT_FALLBACK
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
        status: DEFAULT_FALLBACK_STATUS,
        rectifiedCode: currentCode,
        explanation: DEFAULT_FALLBACK_EXPLANATION,
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
            traceLabel: TRACE_RECTIFIER,
            tools: [...fsTools],
            recursionLimit: MAX_RECURSION_LIMIT,
          }
        );

        const reqPkgs = Array.isArray(rectifierRes?.requiredPackages) ? rectifierRes.requiredPackages : [];
        if (reqPkgs.length > 0) {
          stagePackages = Array.from(new Set([...stagePackages, ...reqPkgs]));
          ensureFeatureEngineeringEnvironment(baseDir, stagePackages);
        }

        if (fs.existsSync(scriptPath)) {
          currentCode = fs.readFileSync(scriptPath, UTF8_ENCODING);
          aggregated = currentCode;
        }
      } catch (err) {
        console.warn("[programRectificationNode] Rectifier call failed", err);
      }
    }
  }

  const targetStateUpdate: Record<string, any> = {};
  const currentLogs = `--- Stdout ---\n${lastStdout}\n\n--- Stderr ---\n${lastStderr}`;

  if (success) {
    targetStateUpdate[stateField] = {
      ...(state as any)[stateField],
      status: STATUS_SUCCESS,
      pythonCode: fragment,
      requiredPackages: stagePackages,
    };

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
  }

  targetStateUpdate[stateField] = {
    ...(state as any)[stateField],
    status: STATUS_FAILED,
    pythonCode: fragment,
    requiredPackages: stagePackages,
  };

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
