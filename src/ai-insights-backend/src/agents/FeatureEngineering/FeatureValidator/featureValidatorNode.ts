import { RunnableConfig } from "@langchain/core/runnables";
import { IngestionServices } from "../../state";
import { getModel, invokeAgentJson, getPromptFromFile, logMilestoneThinking } from "../../utils/agentUtils";
import { validateWithRetry } from "../../validator/validatorNode";
import { FeatureArchitectAnnotation, FeatureValidatorOutput } from "../FeatureArchitect/state";
import * as path from "path";
import * as fs from "fs";
import {
  createGetTableColumnsAndProfileTool,
  createGetSplitBoundariesTool,
  getMcpFilesystemTools,
  getPythonScriptDirectory
} from "../../tools";
import {
  ARTIFACT_FEATURE_SELECTION,
  ARTIFACT_FEATURE_VALIDATION,
  ARTIFACT_FEATURE_VALIDATION_REPORT,
  DEFAULT_PIPELINE_SCRIPT_NAME,
  PROMPT_FEATURE_VALIDATOR,
  REGION_FEATURE_VALIDATION,
  STATUS_FAILED,
  STATUS_OK,
  STATUS_SUCCESS,
  TRACE_FEATURE_VALIDATOR,
  WORKER_FEATURE_VALIDATOR,
} from "../FeatureArchitect/constants";

const DEFAULT_USER_PROMPT = "None provided";
const DEFAULT_STAGE_TITLE = "Feature Validator";
const DEFAULT_STAGE_THINKING = "Auditing feature matrix for leakage, multicollinearity, and drift, and computing importance rankings...";
const DEFAULT_VALIDATION_SUCCESS = "Feature Validation completed successfully";
const DEFAULT_VALIDATION_FAILED = "Feature Validator execution failed/fallback triggered";
const DEFAULT_NO_MODEL_MSG = "No model available for Feature Validator";
const DEFAULT_FALLBACK_SUMMARY = "Feature Validator fallback triggered";
const DEFAULT_SYSTEM_PROMPT_FALLBACK = "You are an expert AI Feature Engineering & Quality Validation Agent specialized in auditing feature matrices for data leakage, multicollinearity, drift, and computing feature importances.";
const MAX_VALIDATE_RETRY_COUNT = 3;
const MAX_RECURSION_LIMIT = 100;
const UTF8_ENCODING = "utf-8";

function parseJsonSafe(content: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(content);
    const isValid = typeof parsed === "object" && parsed !== null;
    return isValid ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function loadFeatureValidationReport(
  reportFilePath: string,
  baseResult: FeatureValidatorOutput
): FeatureValidatorOutput {
  const fileExists = fs.existsSync(reportFilePath);
  if (!fileExists) {
    return baseResult;
  }

  try {
    const rawContent = fs.readFileSync(reportFilePath, UTF8_ENCODING);
    const parsed = parseJsonSafe(rawContent);
    if (!parsed) {
      return baseResult;
    }

    const mergedStatus = typeof parsed.status === "string" ? parsed.status : baseResult.status;
    const mergedSummary = typeof parsed.summary === "string" ? parsed.summary : baseResult.summary;
    const mergedLeakage = typeof parsed.leakageReport === "object" && parsed.leakageReport !== null
      ? (parsed.leakageReport as FeatureValidatorOutput["leakageReport"])
      : baseResult.leakageReport;
    const mergedMulticollinearity = typeof parsed.multicollinearityReport === "object" && parsed.multicollinearityReport !== null
      ? (parsed.multicollinearityReport as FeatureValidatorOutput["multicollinearityReport"])
      : baseResult.multicollinearityReport;
    const mergedDrift = typeof parsed.driftReport === "object" && parsed.driftReport !== null
      ? (parsed.driftReport as FeatureValidatorOutput["driftReport"])
      : baseResult.driftReport;
    const mergedImportance = Array.isArray(parsed.importanceRanking)
      ? (parsed.importanceRanking as FeatureValidatorOutput["importanceRanking"])
      : baseResult.importanceRanking;
    const mergedValidatedFeatureSet = typeof parsed.validatedFeatureSet === "object" && parsed.validatedFeatureSet !== null
      ? (parsed.validatedFeatureSet as FeatureValidatorOutput["validatedFeatureSet"])
      : baseResult.validatedFeatureSet;
    const mergedPythonCode = typeof parsed.pythonCode === "string" ? parsed.pythonCode : baseResult.pythonCode;
    const mergedYamlLineage = typeof parsed.yamlLineage === "string" ? parsed.yamlLineage : baseResult.yamlLineage;

    const mergedOutput: FeatureValidatorOutput = {
      status: mergedStatus,
      summary: mergedSummary,
      leakageReport: mergedLeakage,
      multicollinearityReport: mergedMulticollinearity,
      driftReport: mergedDrift,
      importanceRanking: mergedImportance,
      validatedFeatureSet: mergedValidatedFeatureSet,
      pythonCode: mergedPythonCode,
      yamlLineage: mergedYamlLineage,
    };

    return mergedOutput;
  } catch (error) {
    console.warn("[loadFeatureValidationReport] Failed to read report file", error);
    return baseResult;
  }
}

export async function featureValidatorNode(
  state: typeof FeatureArchitectAnnotation.State,
  config?: RunnableConfig
) {
  const services = config?.configurable?.services as IngestionServices;
  const model = getModel();

  const fallback: FeatureValidatorOutput = {
    status: STATUS_FAILED,
    summary: DEFAULT_FALLBACK_SUMMARY,
    leakageReport: {
      leakyFeatures: [],
      leakageFound: false,
    },
    multicollinearityReport: {
      highVifFeatures: [],
      highCorrelationPairs: [],
    },
    driftReport: {
      driftedFeatures: [],
    },
    importanceRanking: [],
    validatedFeatureSet: {
      kept: [],
      dropped: [],
      totalKept: 0,
      totalDropped: 0,
    },
    pythonCode: "",
    yamlLineage: "",
  };

  if (!model) {
    return {
      featureValidator: fallback,
      history: [
        {
          worker: WORKER_FEATURE_VALIDATOR,
          summary: DEFAULT_NO_MODEL_MSG,
        },
      ],
    };
  }

  const systemPrompt = await getPromptFromFile(
    PROMPT_FEATURE_VALIDATOR,
    DEFAULT_SYSTEM_PROMPT_FALLBACK
  );

  if (services) {
    await logMilestoneThinking(
      services,
      DEFAULT_STAGE_TITLE,
      DEFAULT_STAGE_THINKING
    );
  }

  const pythonScriptDir = getPythonScriptDirectory(services, state.runTimestamp);
  const scriptName = state.aggregatedScriptPath ?? DEFAULT_PIPELINE_SCRIPT_NAME;
  const scriptPath = path.join(pythonScriptDir, scriptName);
  const reportPath = path.join(pythonScriptDir, ARTIFACT_FEATURE_VALIDATION_REPORT);
  const userPromptText = state.userPrompt ?? DEFAULT_USER_PROMPT;

  const userMessage = [
    "Design and generate the feature validation Python code to audit the feature matrix.",
    `User Requirements: ${userPromptText}`,
    `Tables List: ${JSON.stringify(state.batchedTables.map((t) => t.tableName))}`,
    `Orchestrator Decisions: ${JSON.stringify(state.orchestrationDecision)}`,
    `Feature Selection Recommendations: ${JSON.stringify(state.featureSelection?.recommendations)}`,
    `Input Feature File: ${ARTIFACT_FEATURE_SELECTION}`,
    `Target Pipeline File: ${scriptPath}`,
    `Region to Edit: ${REGION_FEATURE_VALIDATION}`,
    "Validation & Remediation Protocol:",
    "1. Compute baseline model feature importance ranking strictly on the training split as tie-breaker.",
    "2. Detect hard target leakage (single-feature target correlation > 0.90 AUC/R²) and auto-drop leaky features.",
    "3. Check multicollinearity via VIF > 10 and correlation matrix |r| > 0.95, keeping the higher-importance feature and dropping redundant pairs.",
    "4. Assess feature drift via PSI or KS-test between splits.",
    `5. Assemble validatedFeatureSet and export validated features to '--output-path' (${ARTIFACT_FEATURE_VALIDATION}) and validation report to '--report-path' (${ARTIFACT_FEATURE_VALIDATION_REPORT}).`,
    "Action Required:",
    `1. Use MCP tool 'read_text_file' on '${scriptPath}' to inspect the exact region markers and line structure.`,
    `2. Use MCP tool 'edit_file' (or 'write_file') to write/insert your validation function 'main_feature_validation' into the ${REGION_FEATURE_VALIDATION} region in '${scriptPath}'.`,
    "3. Return the final JSON summary adhering to the FeatureValidatorOutput schema.",
  ].join("\n\n");

  try {
    const getTableColumnsAndProfileTool = createGetTableColumnsAndProfileTool(state.inspector, state.dataProfile);
    const getSplitBoundariesTool = createGetSplitBoundariesTool(state.orchestrationDecision, state.dataProfile);
    const fsTools = await getMcpFilesystemTools(services);

    const agentResult = await validateWithRetry<FeatureValidatorOutput>(
      WORKER_FEATURE_VALIDATOR,
      async () =>
        await invokeAgentJson<FeatureValidatorOutput>(
          WORKER_FEATURE_VALIDATOR,
          model,
          userMessage,
          fallback,
          services,
          {
            systemPrompt,
            traceLabel: TRACE_FEATURE_VALIDATOR,
            tools: [getTableColumnsAndProfileTool, getSplitBoundariesTool, ...fsTools],
            recursionLimit: MAX_RECURSION_LIMIT,
          }
        ),
      fallback,
      services,
      MAX_VALIDATE_RETRY_COUNT
    );

    const finalResult = loadFeatureValidationReport(reportPath, agentResult);
    const summaryText = finalResult.summary.length > 0 ? finalResult.summary : DEFAULT_VALIDATION_SUCCESS;

    return {
      featureValidator: finalResult,
      history: [
        {
          worker: WORKER_FEATURE_VALIDATOR,
          summary: summaryText,
        },
      ],
    };
  } catch (error) {
    console.warn("[featureValidatorNode] Execution failed, using fallback", error);
    return {
      featureValidator: fallback,
      history: [
        {
          worker: WORKER_FEATURE_VALIDATOR,
          summary: DEFAULT_VALIDATION_FAILED,
        },
      ],
    };
  }
}
