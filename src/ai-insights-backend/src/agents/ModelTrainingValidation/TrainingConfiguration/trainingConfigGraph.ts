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
  userSelectedIds: Annotation<string[]>({
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
  const { services, projectId, runTimestamp, modelSelection, allCandidates, userSelectedIds, feedbackPrompt, parentState } = state;

  const probType = modelSelection?.problem_type || parentState?.problemType || "";
  const taskType = modelSelection?.task_type;
  const taskSubtype = modelSelection?.task_subtype;
  const predictionType = modelSelection?.prediction_type;
  const primaryMetric = modelSelection?.primary_metric || (parentState as any)?.primaryMetric;
  const direction = modelSelection?.direction || (parentState as any)?.direction;
  const secondaryMetrics = modelSelection?.secondary_metrics;
  const targetCol = modelSelection?.target_entity?.name || parentState?.targetColumn || "";

  if (!primaryMetric || !direction || !probType) {
    throw new Error(
      `[TrainingConfigGraph] Missing required Model Selection attributes: primary_metric="${primaryMetric}", direction="${direction}", problem_type="${probType}". Model Selection agent must strictly output these values during execution without fallbacks.`
    );
  }

  // Tools for Training Configuration Agent: profile introspection, web search, URL reader, MCP filesystem
  const getTableColumnsTool = createGetTableColumnsAndProfileTool(
    parentState?.inspection || parentState?.inspector || {},
    parentState?.dataProfile || {}
  );
  const webSearchTool = createWebSearchTool();
  const extractUrlContentToolInstance = createExtractUrlContentTool();
  let fsTools: any[] = [];
  try {
    fsTools = await getMcpFilesystemTools(services);
  } catch {}

  const tools = [
    getTableColumnsTool,
    webSearchTool,
    extractUrlContentToolInstance,
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
    ...(userSelectedIds && userSelectedIds.length > 0 ? [
      `USER-SELECTED CANDIDATE MODELS FOR TRAINING (${userSelectedIds.length} models): ${JSON.stringify(userSelectedIds)}`,
      `CRITICAL REQUIREMENT: The user has confirmed ${userSelectedIds.length} models for training: ${userSelectedIds.join(", ")}. You MUST include every single one of these user-selected models inside model_selection.models with enabled: true. Do not omit any of these models.`,
    ] : []),
    `Primary Metric: ${primaryMetric}`,
    `Direction: ${direction}`,
    ...(secondaryMetrics && secondaryMetrics.length > 0 ? [`Secondary Metrics: ${JSON.stringify(secondaryMetrics)}`] : []),
    ...(probType ? [`Problem Type Context: ${probType}`] : []),
    ...(taskType ? [`Task Type: ${taskType}`] : []),
    ...(taskSubtype ? [`Task Subtype: ${taskSubtype}`] : []),
    ...(predictionType ? [`Prediction Type: ${predictionType}`] : []),
    ...(targetCol ? [`Target Column: ${targetCol}`] : []),
    "",
    ...(state.parentState?.splitDate ? [
      `=== User-Specified Split Date ===`,
      `User Split Date: ${state.parentState.splitDate}`,
      `DATA SPLIT REQUIREMENT: If a timestamp/date column exists in the dataset, use temporal split with date <= "${state.parentState.splitDate}" for training, and date > "${state.parentState.splitDate}" for testing. If NO timestamp or date column exists in the dataset, you MUST configure a standard 70/15/15 ratio split (70% train, 15% validation, 15% test, summing strictly to 1.0).`,
      "",
    ] : [
      `DATA SPLIT REQUIREMENT: No split date specified. You MUST configure a standard 70/15/15 ratio split (70% train, 15% validation, 15% test, summing strictly to 1.0).`,
      "",
    ]),
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

  const emptyFallback = state.datasetAnalysisExplanation
    ? {}
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
        emptyFallback,
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
      rawConfig = emptyFallback;
    }
  } else {
    rawConfig = emptyFallback;
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

  if (!rawConfig || typeof rawConfig !== "object" || Object.keys(rawConfig).length === 0) {
    throw new Error(
      "[TrainingConfigGraph] Training Configuration Agent failed to synthesize a valid contract JSON. Agent must synthesize configuration without fallback."
    );
  }

  const finalConfig = rawConfig;

  if (state.parentState?.splitDate) {
    if (!finalConfig.split) finalConfig.split = {};
    finalConfig.split.split_date = state.parentState.splitDate;
  }

  // Strictly bind Model Selection decision specifications (NO FALLBACKS)
  finalConfig["x-primary-metric-name"] = primaryMetric;
  if (!finalConfig["x-primary-metric-def"]) {
    finalConfig["x-primary-metric-def"] = {
      value: primaryMetric,
      source: "model_selection",
      confidence: 1.0,
      confirmation_threshold: 0.85,
      requires_confirmation: false,
      rationale: `Primary optimization metric ${primaryMetric} established by Model Selection agent.`,
      evidence: [`Model selection established ${primaryMetric} (${direction}) for ${probType}`],
    };
  }

  if (!finalConfig.objective) finalConfig.objective = {};
  finalConfig.objective.optimization_metric = primaryMetric;
  finalConfig.objective.direction = direction;

  if (!finalConfig.evaluation) finalConfig.evaluation = {};
  finalConfig.evaluation.primary_metric = primaryMetric;
  if (secondaryMetrics && Array.isArray(secondaryMetrics) && secondaryMetrics.length > 0) {
    finalConfig.evaluation.secondary_metrics = secondaryMetrics;
  }

  if (!finalConfig.task) finalConfig.task = {};
  finalConfig.task.task_type = taskType || probType;
  if (taskSubtype) finalConfig.task.task_subtype = taskSubtype;
  if (predictionType) finalConfig.task.prediction_type = predictionType;

  // Preserve researched candidate training steps without hardcoded derivations
  if (!finalConfig.model_selection) {
    finalConfig.model_selection = {
      target_entity: modelSelection?.target_entity || { name: targetCol || "target" },
      recommended_model: modelSelection?.recommended_model || allCandidates[0],
      candidates: allCandidates,
      models: allCandidates,
    };
  } else {
    const rawCandidates = Array.isArray(finalConfig.model_selection.candidates) && finalConfig.model_selection.candidates.length > 0
      ? finalConfig.model_selection.candidates
      : allCandidates;

    finalConfig.model_selection.candidates = rawCandidates.map((c: any) => ({
      ...c,
      training_steps: c.training_steps || c.access_and_training_steps || {},
    }));

    const rawModels = Array.isArray(finalConfig.model_selection.models) && finalConfig.model_selection.models.length > 0
      ? finalConfig.model_selection.models
      : allCandidates;

    finalConfig.model_selection.models = rawModels.map((m: any) => ({
      ...m,
      model_id: typeof m === "string" ? m : (m.model_id || m.id),
      framework: typeof m === "string" ? "sklearn" : (m.framework || "sklearn"),
      algorithm: typeof m === "string" ? m : (m.algorithm || m.model_id),
      enabled: m.enabled !== undefined ? m.enabled : true,
      training_steps: m.training_steps || m.access_and_training_steps || {},
    }));
  }

  // Strictly enforce user-selected models: Every user-selected model MUST be present in finalConfig.model_selection.models
  const effectiveUserSelectedIds = (Array.isArray(userSelectedIds) && userSelectedIds.length > 0)
    ? userSelectedIds
    : (Array.isArray(modelSelection?.userSelection?.selectedModelIds) && modelSelection.userSelection.selectedModelIds.length > 0)
    ? modelSelection.userSelection.selectedModelIds
    : (Array.isArray(modelSelection?.selectedModelIds) && modelSelection.selectedModelIds.length > 0)
    ? modelSelection.selectedModelIds
    : [];

  if (effectiveUserSelectedIds.length > 0) {
    const existingModelMap = new Map<string, any>();
    for (const m of (finalConfig.model_selection.models || [])) {
      const id = typeof m === "string" ? m : (m.model_id || m.id);
      if (id) existingModelMap.set(id.toLowerCase().trim(), typeof m === "string" ? { model_id: m } : m);
    }

    const candidateMap = new Map<string, any>();
    for (const c of (allCandidates || [])) {
      const id = typeof c === "string" ? c : (c.model_id || c.id);
      if (id) candidateMap.set(id.toLowerCase().trim(), c);
    }

    const enforcedModels: any[] = [];
    for (const selId of effectiveUserSelectedIds) {
      const cleanId = selId.toLowerCase().trim();
      const existing = existingModelMap.get(cleanId);
      const candidate = candidateMap.get(cleanId);
      if (existing) {
        enforcedModels.push({
          ...existing,
          model_id: typeof existing === "string" ? existing : (existing.model_id || selId),
          framework: existing.framework || candidate?.framework || "sklearn",
          algorithm: existing.algorithm || candidate?.algorithm || selId,
          enabled: true,
          training_steps: existing.training_steps || candidate?.training_steps || candidate?.access_and_training_steps || {},
        });
      } else if (candidate) {
        enforcedModels.push({
          model_id: candidate.model_id || selId,
          framework: candidate.framework || "sklearn",
          algorithm: candidate.algorithm || candidate.displayName || selId,
          enabled: true,
          parameters: candidate.parameters || {},
          training_steps: candidate.training_steps || candidate.access_and_training_steps || {},
        });
      } else {
        enforcedModels.push({
          model_id: selId,
          framework: "sklearn",
          algorithm: selId,
          enabled: true,
          parameters: {},
          training_steps: {},
        });
      }
    }

    finalConfig.model_selection.models = enforcedModels;
    finalConfig.model_selection.selectedModelIds = effectiveUserSelectedIds;
    finalConfig.model_selection.userSelection = {
      selectedModelIds: effectiveUserSelectedIds,
      confirmedAt: new Date().toISOString(),
    };
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
