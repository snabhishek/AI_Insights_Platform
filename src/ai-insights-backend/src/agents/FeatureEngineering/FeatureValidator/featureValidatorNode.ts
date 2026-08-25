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
  getSandboxDirectory, 
  makePipelineTemplate 
} from "../../tools";

export async function featureValidatorNode(
  state: typeof FeatureArchitectAnnotation.State,
  config?: RunnableConfig
) {
  const services = config?.configurable?.services as IngestionServices;
  const model = getModel();

  const fallback: FeatureValidatorOutput = {
    status: "Failed",
    summary: "Feature Validator fallback triggered",
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
          worker: "featureValidator",
          summary: "No model available for Feature Validator",
        },
      ],
    };
  }

  const systemPrompt = await getPromptFromFile(
    "FeatureValidator/featureValidator.md",
    "You are an expert AI Feature Engineering & Quality Validation Agent specialized in auditing feature matrices for data leakage, multicollinearity, drift, and computing feature importances."
  );

  if (services) {
    await logMilestoneThinking(
      services,
      "Feature Validator",
      "Auditing feature matrix for leakage, multicollinearity, and drift, and computing importance rankings..."
    );
  }

  const sandboxDir = getSandboxDirectory(services?.projectId, state.runTimestamp);
  const scriptName = state.aggregatedScriptPath || "aggregated_feature_pipeline.py";
  const scriptPath = path.join(sandboxDir, scriptName);
  if (!fs.existsSync(scriptPath)) {
    fs.writeFileSync(scriptPath, makePipelineTemplate(scriptName), "utf-8");
  }

  const userMessage = [
    "Design and generate the feature validation Python code to audit the feature matrix.",
    `User Requirements: ${state.userPrompt || "None provided"}`,
    `Tables List: ${JSON.stringify(state.batchedTables.map((t) => t.tableName))}`,
    `Orchestrator Decisions: ${JSON.stringify(state.orchestrationDecision)}`,
    `Feature Selection Recommendations: ${JSON.stringify(state.featureSelection?.recommendations)}`,
    `Target Pipeline File: ${scriptPath}`,
    `Region to Edit: FEATURE_VALIDATION`,
    "Validation & Remediation Protocol:",
    "1. Compute baseline model feature importance ranking (e.g. LightGBM / Tree importance or Permutation Importance) first to use as tie-breaker.",
    "2. Detect hard target leakage (temporal violations, single-feature target correlation/probe > 0.9 AUC/R²) and auto-drop leaky features.",
    "3. Check multicollinearity via Variance Inflation Factor (VIF > 10) and correlation matrix (|r| > 0.95), auto-dropping the lower-importance feature in collinear pairs.",
    "4. Assess feature drift via Population Stability Index (PSI) or KS-test between splits (flag only in driftReport, do NOT auto-drop).",
    "5. Assemble validatedFeatureSet ({ kept: string[], dropped: { featureName, reason }[] }) and export validated features to '--output-path' (validated_features.parquet) and the full report to '--report-path' (feature_validation_report.json).",
    "Action Required:",
    `1. Use MCP tool 'read_text_file' on '${scriptPath}' to inspect the exact region markers and line structure.`,
    `2. Use MCP tool 'edit_file' (or 'write_file') to write/insert your validation function 'main_feature_validation' into the FEATURE_VALIDATION region in '${scriptPath}'.`,
    "3. Return the final JSON summary adhering to the FeatureValidatorOutput schema.",
  ].join("\n\n");

  try {
    const getTableColumnsAndProfileTool = createGetTableColumnsAndProfileTool(state.inspector, state.dataProfile);
    const getSplitBoundariesTool = createGetSplitBoundariesTool(state.orchestrationDecision, state.dataProfile);
    const fsTools = await getMcpFilesystemTools({
      projectId: services?.projectId,
      runTimestamp: state.runTimestamp,
    });

    const result = await validateWithRetry<FeatureValidatorOutput>(
      "featureValidator",
      async () =>
        await invokeAgentJson<FeatureValidatorOutput>(
          "featureValidator",
          model,
          userMessage,
          fallback,
          services,
          {
            systemPrompt,
            traceLabel: "featureArchitect:featureValidator",
            tools: [getTableColumnsAndProfileTool, getSplitBoundariesTool, ...fsTools],
            recursionLimit: 100,
          }
        ),
      fallback,
      services
    );

    return {
      featureValidator: result,
      history: [
        {
          worker: "featureValidator",
          summary: result.summary || "Feature Validation completed successfully",
        },
      ],
    };
  } catch (error) {
    console.warn("[featureValidatorNode] Execution failed, using fallback", error);
    return {
      featureValidator: fallback,
      history: [
        {
          worker: "featureValidator",
          summary: "Feature Validator execution failed/fallback triggered",
        },
      ],
    };
  }
}
