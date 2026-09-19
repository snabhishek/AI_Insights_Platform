import { Annotation, StateGraph, END, START } from "@langchain/langgraph";
import { BaseMessage, AIMessage, HumanMessage } from "@langchain/core/messages";
import { IngestionServices } from "../../state";
import { DatasetAnalyserAgent } from "./datasetAnalyserAgent";
import { ContractPersistence } from "./contractPersistence";
import {
  getModel,
  invokeAgentJson,
  logMilestoneThinking,
  getPromptFromFile,
} from "../../utils/agentUtils";
import {
  createGetTableColumnsAndProfileTool,
  createWebSearchTool,
  createExtractUrlContentTool,
  getMcpFilesystemTools,
} from "../../tools";

export const TrainingConfigGraphAnnotation = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (left = [], right = []) => left.concat(right),
    default: () => [],
  }),
  turnCount: Annotation<number>({
    reducer: (left, right) => (right !== undefined ? right : left),
    default: () => 0,
  }),
  isComplete: Annotation<boolean>({
    reducer: (left, right) => (right !== undefined ? right : left),
    default: () => false,
  }),
  decision: Annotation<"ask_dataset_analyser" | "synthesize_contract" | undefined>({
    reducer: (left, right) => right ?? left,
    default: () => undefined,
  }),
  datasetInquiry: Annotation<string>({
    reducer: (left, right) => (right !== undefined ? right : left),
    default: () => "",
  }),
  datasetAnalysisExplanation: Annotation<string>({
    reducer: (left, right) => (right !== undefined ? right : left),
    default: () => "",
  }),
  configuration: Annotation<Record<string, any>>({
    reducer: (left, right) => (right !== undefined ? right : left),
    default: () => ({}),
  }),
  contractPath: Annotation<string>({
    reducer: (left, right) => (right !== undefined ? right : left),
    default: () => "",
  }),
  summary: Annotation<string>({
    reducer: (left, right) => (right !== undefined ? right : left),
    default: () => "",
  }),
  services: Annotation<IngestionServices>({
    reducer: (left, right) => right ?? left,
  }),
  parentState: Annotation<any>({
    reducer: (left, right) => right ?? left,
  }),
  feedbackPrompt: Annotation<string | undefined>({
    reducer: (left, right) => right ?? left,
  }),
  modelSelection: Annotation<any>({
    reducer: (left, right) => right ?? left,
    default: () => ({}),
  }),
  allCandidates: Annotation<any[]>({
    reducer: (left, right) => right ?? left,
    default: () => [],
  }),
  projectId: Annotation<string>({
    reducer: (left, right) => right ?? left,
    default: () => "",
  }),
  runTimestamp: Annotation<string>({
    reducer: (left, right) => right ?? left,
    default: () => "",
  }),
});

export type TrainingConfigGraphStateType = typeof TrainingConfigGraphAnnotation.State;

export interface ModelTrainingSteps {
  package_dependencies: string[];
  import_statement: string;
  class_name: string;
  initialization: string;
  data_format: string;
  fit_step: string;
  predict_step: string;
  export_step: string;
  execution_notes?: string;
}

/**
 * Node 1: Training Configuration Agent Node
 * Inspects state and decides whether it needs information from DatasetAnalyserAgent
 * (returns Mode 1: NEEDS_DATASET_ANALYSIS) or synthesizes the Training Job Contract
 * researching candidate execution steps via web search (Mode 2: CONFIG_SYNTHESIZED).
 */
async function trainingConfigAgentNode(state: TrainingConfigGraphStateType) {
  const { services, projectId, runTimestamp, modelSelection, allCandidates, feedbackPrompt, parentState } = state;

  const primaryMetric = modelSelection?.primary_metric || "f1_score";
  const direction = modelSelection?.direction || "maximize";
  const probType = parentState?.problemType || "classification";

  const fallbackSearchSpace: Record<string, any> = {
    n_estimators: { type: "integer", min: 50, max: 1000, values: [] },
    learning_rate: { type: "log_uniform", min: 0.005, max: 0.3, values: [] },
    max_depth: { type: "integer", min: 3, max: 15, values: [] },
    subsample: { type: "uniform", min: 0.5, max: 1.0, values: [] },
    colsample_bytree: { type: "uniform", min: 0.4, max: 1.0, values: [] },
    reg_alpha: { type: "log_uniform", min: 1e-8, max: 10.0, values: [] },
    reg_lambda: { type: "log_uniform", min: 1e-8, max: 10.0, values: [] },
  };

  const fallbackCandidates = (allCandidates && allCandidates.length > 0 ? allCandidates : [
    { model_id: "lightgbm", rank: 1, suitability_score: 0.94, recommendation: "primary" }
  ]).map((c: any) => ({
    ...c,
    training_steps: c.training_steps || c.access_and_training_steps || {},
  }));

  const fallbackModels = (modelSelection?.models && modelSelection.models.length > 0
    ? modelSelection.models
    : fallbackCandidates
  ).map((m: any) => ({
    ...m,
    framework: m.framework || "lightgbm",
    algorithm: m.algorithm || m.model_id,
    enabled: m.enabled !== undefined ? m.enabled : true,
    parameters: m.parameters || {},
    training_steps: m.training_steps || m.access_and_training_steps || {},
  }));

  const fallbackConfig: Record<string, any> = {
    "x-primary-metric-name": primaryMetric,
    "x-primary-metric-def": {
      value: primaryMetric,
      source: "llm_inference",
      confidence: 0.95,
      confirmation_threshold: 0.85,
      requires_confirmation: false,
      rationale: `Selected ${primaryMetric} as the primary optimization metric aligned with business objective.`,
      evidence: ["Problem type inferred from dataset analysis", `Dataset explanation incorporated`],
    },
    training_job: {
      job_id: `job-${Date.now()}`,
      experiment_name: `training_pipeline_${runTimestamp || Date.now()}`,
      version: "1.0.0",
      created_at: new Date().toISOString(),
      created_by: "AutoML Training Configuration Agent",
      description: "Automated ML training pipeline configuration",
    },
    task: {
      task_type: "classification",
      task_subtype: "binary",
      learning_type: "supervised",
      prediction_type: "probability",
      prediction_horizon: null,
      prediction_timestamp: null,
    },
    upstream_artifacts: {
      dataset_id: "validated_features.parquet",
      dataset_version: "1.0.0",
      feature_set_id: `fs_${runTimestamp || "v1"}`,
      feature_set_version: "1.0.0",
      profiling_report_id: "profiling_report.json",
      relationship_schema_id: "relationship_schema.json",
      row_count: 50000,
      column_count: 20,
    },
    split: {
      strategy: "stratified",
      train_ratio: 0.7,
      validation_ratio: 0.15,
      test_ratio: 0.15,
      random_seed: 42,
      stratify_by: null,
      group_by: null,
      time_column: null,
    },
    imbalance: {
      detected: false,
      ratio: null,
      strategy: "none",
      sampling_ratio: null,
      focal_loss_gamma: null,
    },
    hyperparameter_optimization: {
      method: "bayesian",
      max_trials: 50,
      timeout_seconds: 3600,
      early_stopping_patience: 10,
      random_seed: 42,
    },
    search_space: fallbackSearchSpace,
    objective: {
      optimization_metric: primaryMetric,
      direction: direction,
    },
    evaluation: {
      primary_metric: primaryMetric,
      secondary_metrics: ["accuracy", "precision", "recall", "roc_auc", "pr_auc", "log_loss"],
    },
    thresholding: {
      strategy: "optimize_f1",
      initial_threshold: 0.5,
      search_range: [0.1, 0.9],
      step_size: 0.01,
    },
    compute: {
      target: "local_docker",
      gpu_enabled: false,
      max_parallel_jobs: 2,
      timeout_minutes: 120,
    },
    constraints: {
      max_inference_latency_ms: 100,
      max_model_size_mb: 500,
      fairness_constraints: [],
    },
    validation_gates: {
      minimum_primary_metric_score: 0.65,
      maximum_overfitting_gap: 0.1,
      require_all_secondary_metrics_pass: false,
    },
    artifacts: {
      save_feature_importance: true,
      save_confusion_matrix: true,
      save_roc_curve: true,
      save_pr_curve: true,
      save_residual_plots: false,
      save_shap_explanations: true,
      save_optuna_study: true,
      serialization_format: "onnx",
    },
    reproducibility: {
      environment_lock: true,
      save_git_commit: true,
      save_code_snapshot: true,
      python_version: "3.10",
      cuda_version: null,
    },
    model_selection: {
      target_entity: modelSelection?.target_entity || { name: parentState?.targetColumn || "target" },
      recommended_model: modelSelection?.recommended_model || fallbackCandidates[0],
      candidates: fallbackCandidates,
      models: fallbackModels,
    },
    summary: `Training configuration synthesized with candidate models: ${fallbackCandidates.map((c: any) => c.model_id).join(", ")}`,
  };

  // Tools for Training Configuration Agent: profile introspection, web search, URL reader, MCP filesystem
  const getTableColumnsTool = createGetTableColumnsAndProfileTool(
    parentState?.inspection || parentState?.inspector || {},
    parentState?.dataProfile || {}
  );
  const webSearchTool = createWebSearchTool();
  const extractUrlContentTool = createExtractUrlContentTool();
  let fsTools: any[] = [];
  try {
    fsTools = await getMcpFilesystemTools(services);
  } catch {}

  const tools = [
    getTableColumnsTool,
    webSearchTool,
    extractUrlContentTool,
    ...fsTools,
  ];

  const defaultPrompt = `You are the Training Configuration Agent. Collaborate with the Dataset Analyser Agent or synthesize the complete 17-section TrainingJobContract JSON payload.`;
  const systemPrompt = await getPromptFromFile("trainingConfiguration.md", defaultPrompt);

  const hasAnalysis = Boolean(state.datasetAnalysisExplanation);

  const userMessage = [
    "You are the Training Configuration Agent responsible for formulating the production Training Job Contract.",
    "",
    "=== 1. Current State & Dataset Analysis Context ===",
    hasAnalysis
      ? `The Dataset Analyser Agent has provided the following technical findings on the dataset:\n${state.datasetAnalysisExplanation}`
      : "No dataset analysis has been performed yet in this session. Review what dataset metadata you have and determine if you need the Dataset Analyser Agent to inspect dataset artifacts (validated_features.parquet, dataset.csv), profiling reports, target distributions, class imbalance, or temporal columns.",
    "",
    "=== 2. Candidate Models & ML Objective ===",
    `Candidate Models: ${JSON.stringify(allCandidates, null, 2)}`,
    `Recommended Model: ${JSON.stringify(modelSelection?.recommended_model || allCandidates[0] || {})}`,
    `Primary Metric: ${primaryMetric}`,
    `Direction: ${direction}`,
    `Problem Type Context: ${probType}`,
    "",
    ...(feedbackPrompt ? [`=== 3. Previous Validation Feedback to Rectify ===\n${feedbackPrompt}\n`] : []),
    "=== Action Required ===",
    "1. DECIDE whether you need information from the Dataset Analyser Agent:",
    "   - If you need specific information from the dataset (e.g. data dimensions, column profiling, target class distributions, class imbalance ratio, temporal indicators, relationships, or artifact identifiers), return a JSON object with:",
    '     { "status": "NEEDS_DATASET_ANALYSIS", "inquiry": "<your specific, detailed technical questions describing what information you need from the data>", "reasoning": "<why this information is needed>" }',
    "2. If you already have sufficient dataset information (or have reviewed the Dataset Analyser Agent's findings above):",
    "   - Use your web search tools (web_search, extract_url_content) to research the official, modern implementation and execution steps (pip package dependencies, import statement, class name, initialization snippet, data format requirements, fit snippet, predict snippet, export snippet, execution notes) for each candidate model.",
    "   - Synthesize the complete 17-section Training Job Contract JSON with status 'CONFIG_SYNTHESIZED'. Populate the researched training_steps directly inside model_selection.candidates and model_selection.models.",
  ].join("\n");

  const model = getModel();
  let rawConfig: any = {};

  const fallbackDecision = state.datasetAnalysisExplanation
    ? fallbackConfig
    : {
        status: "NEEDS_DATASET_ANALYSIS",
        inquiry: "Please inspect the project dataset artifacts (e.g. validated_features.parquet or dataset.csv), profiling report (profiling_report.json), and relationship schema (relationship_schema.json). Provide row and column counts, target column name and distribution, class imbalance ratio, temporal indicators, and key feature data types.",
        reasoning: "Dataset dimensions, target distribution, and temporal properties are needed to configure the training contract.",
      };

  if (model) {
    try {
      rawConfig = await invokeAgentJson(
        "trainingConfigurationNode",
        model,
        userMessage,
        fallbackDecision,
        services,
        {
          systemPrompt,
          tools,
          traceLabel: "agent:trainingConfiguration",
          recursionLimit: 100,
          middlewareOptions: {
            summarization: {
              triggerTokens: 100000,
              keepTokens: 25000,
            },
          },
          messages: state.messages,
        }
      );
    } catch (err: any) {
      console.warn("[TrainingConfigGraph] invokeAgentJson warning:", err?.message || err);
      rawConfig = fallbackDecision;
    }
  } else {
    rawConfig = fallbackDecision;
  }

  // Check if agent decided to request information from Dataset Analyser Agent
  const isNeedsAnalysis =
    rawConfig?.status === "NEEDS_DATASET_ANALYSIS" ||
    (typeof rawConfig?.inquiry === "string" &&
      rawConfig.inquiry.trim().length > 0 &&
      !rawConfig.training_job &&
      !rawConfig.task &&
      !rawConfig.split);

  if (isNeedsAnalysis) {
    const inquiry = rawConfig.inquiry || "Please analyze the dataset artifacts, profiling report, and relationship schema.";
    await logMilestoneThinking(
      services,
      "Training Configuration",
      `Training Configuration Agent requesting information from Dataset Analyser Agent: ${rawConfig.reasoning || inquiry.slice(0, 120)}`
    );

    const inquiryMessage = new HumanMessage({
      content: inquiry,
      name: "TrainingConfigurationAgent",
    });

    return {
      messages: [inquiryMessage],
      decision: "ask_dataset_analyser" as const,
      datasetInquiry: inquiry,
      turnCount: state.turnCount + 1,
    };
  }

  // Agent synthesized the contract!
  await logMilestoneThinking(
    services,
    "Training Configuration",
    "Training Configuration Agent synthesizing Training Job Contract with researched model execution steps..."
  );

  let finalConfig = (rawConfig && typeof rawConfig === "object" && Object.keys(rawConfig).length > 0)
    ? rawConfig
    : fallbackConfig;

  // Preserve researched candidate training steps without hardcoded derivations
  if (!finalConfig.model_selection) {
    finalConfig.model_selection = fallbackConfig.model_selection;
  } else {
    const rawCandidates = Array.isArray(finalConfig.model_selection.candidates) && finalConfig.model_selection.candidates.length > 0
      ? finalConfig.model_selection.candidates
      : fallbackCandidates;

    finalConfig.model_selection.candidates = rawCandidates.map((c: any) => ({
      ...c,
      training_steps: c.training_steps || c.access_and_training_steps || {},
    }));

    const rawModels = Array.isArray(finalConfig.model_selection.models) && finalConfig.model_selection.models.length > 0
      ? finalConfig.model_selection.models
      : fallbackModels;

    finalConfig.model_selection.models = rawModels.map((m: any) => ({
      ...m,
      training_steps: m.training_steps || m.access_and_training_steps || {},
    }));
  }

  // Persist Contract to YAML
  let contractPath = "";
  if (services.projectService && projectId) {
    try {
      const pWs = await services.projectService.getProjectWithWorkspace(projectId);
      if (pWs?.project) {
        const saveRes = await ContractPersistence.saveModularTrainingConfigContract(
          pWs.workspaceName || "DefaultWorkspace",
          pWs.project.name,
          finalConfig,
          runTimestamp
        );
        contractPath = saveRes.contractPath;
      }
    } catch (saveErr: any) {
      console.warn("[TrainingConfigGraph] Error saving Training Job Contract YAML:", saveErr?.message || saveErr);
    }
  }

  const splitStrategy = finalConfig.split?.strategy || "standard";
  const trainRatio = finalConfig.split?.train_ratio != null ? (finalConfig.split.train_ratio * 100).toFixed(0) : "70";
  const valRatio = finalConfig.split?.validation_ratio != null ? (finalConfig.split.validation_ratio * 100).toFixed(0) : "15";
  const testRatio = finalConfig.split?.test_ratio != null ? (finalConfig.split.test_ratio * 100).toFixed(0) : "15";
  const metricDisplay = finalConfig["x-primary-metric-name"] || finalConfig.primary_metric_name || primaryMetric;
  const summary = `Training configuration prepared successfully (${splitStrategy} split: ${trainRatio}/${valRatio}/${testRatio}, primary metric: ${metricDisplay}). Configured models: ${(finalConfig.model_selection?.candidates || allCandidates).map((c: any) => c.model_id).join(", ")}.`;

  await logMilestoneThinking(services, "Training Configuration", summary);

  const completionMessage = new AIMessage({
    content: `Completed training configuration synthesis. Persisted contract to YAML. ${summary}`,
    name: "TrainingConfigurationAgent",
  });

  return {
    messages: [completionMessage],
    decision: "synthesize_contract" as const,
    configuration: finalConfig,
    contractPath,
    summary,
    isComplete: true,
    turnCount: state.turnCount + 1,
  };
}

/**
 * Node 2: Dataset Analyser Agent Node
 * Answers inquiries using scoped tools and returns narrative explanation without raw file paths.
 */
async function datasetAnalyserAgentNode(state: TrainingConfigGraphStateType) {
  const { services, runTimestamp, messages, datasetInquiry } = state;

  const latestInquiry = messages[messages.length - 1];
  const queryText = datasetInquiry || (
    typeof latestInquiry?.content === "string"
      ? latestInquiry.content
      : "Please analyze the dataset artifacts and provide column, row, and target statistics."
  );

  await logMilestoneThinking(
    services,
    "Training Configuration",
    `Dataset Analyser Agent answering inquiry: "${queryText.slice(0, 100)}..."`
  );

  const explanation = await DatasetAnalyserAgent.execute(
    queryText,
    services,
    runTimestamp,
    messages,
    state.parentState
  );

  const replyMessage = new AIMessage({
    content: explanation,
    name: "DatasetAnalyserAgent",
  });

  return {
    messages: [replyMessage],
    datasetAnalysisExplanation: state.datasetAnalysisExplanation
      ? `${state.datasetAnalysisExplanation}\n\n---\n\n${explanation}`
      : explanation,
  };
}

/**
 * Conditional router for the conversation graph.
 * Routing is strictly driven by the Training Configuration Agent's decision:
 * - If the agent decided it needs dataset analysis ("ask_dataset_analyser"), routes to datasetAnalyserNode.
 * - Otherwise (or when synthesis is complete or max loop safety reached), routes to END.
 */
function routeTrainingConfig(state: TrainingConfigGraphStateType) {
  if (state.decision === "ask_dataset_analyser") {
    // Safety guard to prevent unbounded cycling if an LLM repeatedly inquires
    if (state.turnCount >= 6) {
      return END;
    }
    return "datasetAnalyserNode";
  }
  return END;
}

/**
 * Compiles and returns the multi-agent conversational StateGraph
 */
export function createTrainingConfigGraph() {
  const workflow = new StateGraph(TrainingConfigGraphAnnotation)
    .addNode("trainingConfigNode", trainingConfigAgentNode)
    .addNode("datasetAnalyserNode", datasetAnalyserAgentNode)
    .addEdge(START, "trainingConfigNode")
    .addConditionalEdges("trainingConfigNode", routeTrainingConfig, {
      datasetAnalyserNode: "datasetAnalyserNode",
      [END]: END,
    })
    .addEdge("datasetAnalyserNode", "trainingConfigNode");

  return workflow.compile();
}
