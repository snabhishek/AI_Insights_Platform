import { ModelCapabilityRegistry, DEFAULT_BASE_MODELS } from "../agents/ModelTrainingValidation/ModelSelection/modelCapabilityRegistry";
import { ModelSelectionContextNormalizer } from "../agents/ModelTrainingValidation/ModelSelection/contextNormalizer";
import { ModelSelectionValidator } from "../agents/ModelTrainingValidation/ModelSelection/modelSelectionValidator";
import { dynamicallyRegisterExploredModel } from "../agents/ModelTrainingValidation/ModelSelection/modelWebSearch.tool";
import { ModelDiscoveryService } from "../services/ai/model-selection/modelDiscovery.service";
import {
  ModelSelectionContext,
  ModelSelectionDecision,
  ModelDefinition,
} from "../models/modelSelection.types";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { RunnableBinding } from "@langchain/core/runnables";
import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { createAgent } from "langchain";
import { invokeAgentJson } from "../agents/utils/agentUtils";
import { ModelSelectionLLMService } from "../services/ai/model-selection/modelSelectionLLM.service";

async function runModelSelectionTests() {
  console.log("=================================================");
  console.log(" Model Selection Agent — Automated Test Suite");
  console.log("=================================================\n");

  let totalTests = 0;
  let passedTests = 0;

  function assert(condition: boolean, testName: string, failureDetails?: string) {
    totalTests++;
    if (condition) {
      console.log(`✅ [PASS] Test ${totalTests}: ${testName}`);
      passedTests++;
    } else {
      console.error(`❌ [FAIL] Test ${totalTests}: ${testName}`);
      if (failureDetails) {
        console.error(`   Details: ${failureDetails}`);
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 1. Context Normalization & Problem Inference Tests
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n--- Category 1: Context Normalization & Problem Inference ---");

  const classInput = {
    useCase: "Predict customer churn probability before quarter end",
    domain: "Retail",
    targetColumn: "churn_flag",
    columns: [
      { name: "customer_id", type: "varchar" },
      { name: "churn_flag", type: "integer" },
      { name: "total_spend", type: "numeric" },
    ],
    featureArchitect: {
      targetColumn: "churn_flag",
      features: ["total_spend", "avg_order_value"],
      categoricalColumns: ["region"],
      numericColumns: ["total_spend"],
      entityKeys: ["customer_id"],
    },
  };

  const normClassContext = ModelSelectionContextNormalizer.normalize(classInput);
  assert(
    normClassContext.businessContext.useCase === classInput.useCase,
    "Normalized businessContext contains correct use case"
  );
  assert(
    normClassContext.dataContext.targetColumn === "churn_flag",
    "Normalized dataContext contains correct target column"
  );
  assert(
    (normClassContext as any).leakageContext === undefined,
    "Leakage context is strictly excluded from normalized context"
  );

  const classInferred = ModelSelectionContextNormalizer.inferProblemSpecs(normClassContext);
  assert(
    classInferred.task === "tabular_classification" && classInferred.subtype === "binary_classification",
    "Inferred task is tabular_classification / binary_classification for churn flag",
    `Got task: ${classInferred.task}, subtype: ${classInferred.subtype}`
  );
  assert(
    classInferred.predictionGrain.entity === "customer_id",
    "Inferred predictionGrain entity is customer_id"
  );

  const forecastInput = {
    useCase: "Forecast weekly SKU demand for distribution centers",
    domain: "Supply Chain",
    temporalColumn: "order_date",
    dateGrain: "weekly",
    featureArchitect: {
      targetColumn: "units_sold",
      timeIndex: "order_date",
      entityKeys: ["sku_id", "dc_id"],
    },
  };

  const normForecastContext = ModelSelectionContextNormalizer.normalize(forecastInput);
  const forecastInferred = ModelSelectionContextNormalizer.inferProblemSpecs(normForecastContext);
  assert(
    forecastInferred.task === "time_series_forecasting" && forecastInferred.subtype === "panel_forecasting",
    "Inferred task is time_series_forecasting / panel_forecasting for demand use case",
    `Got task: ${forecastInferred.task}, subtype: ${forecastInferred.subtype}`
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // 2. Model Capability Registry & Dynamic Registration Tests
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n--- Category 2: Model Capability Registry & Dynamic Extension ---");

  // Test 2.1: Registry starts with empty catalog per requirement (no hardcoded legacy models)
  const registry = new ModelCapabilityRegistry();
  assert(
    registry.getAllModels().length === 0,
    "Registry initializes with empty catalog (starts from scratch, no hardcoded models)",
    `Actual count: ${registry.getAllModels().length}`
  );

  // Test 2.2: Register external model with dynamic source metadata
  dynamicallyRegisterExploredModel(registry, {
    modelId: "catboost_sota",
    displayName: "CatBoost Gradient Boosting",
    algorithm: "Oblivious Decision Trees with Symmetric Target Encoding",
    framework: "catboost",
    supportedTasks: ["tabular_classification", "tabular_regression"],
    capabilities: ["numerical_features", "categorical_features"],
    strengths: ["SOTA categorical handling", "Resistant to overfitting"],
    weaknesses: ["Slower training than LightGBM"],
    isBaseline: false,
    sourceTypeId: "external",
    sourceProviderId: "github",
    source: "github.com",
    repositoryUrl: "https://github.com/catboost/catboost",
    repositoryId: "catboost/catboost",
    version: "v1.2.7",
    license: "Apache-2.0",
  });

  assert(
    registry.isModelSupported("catboost_sota"),
    "Dynamically registered model 'catboost_sota' is supported in registry"
  );
  const catboost = registry.getModel("catboost_sota");
  assert(
    catboost?.source === "github.com" &&
    catboost?.sourceType === "external" &&
    catboost?.repositoryUrl === "https://github.com/catboost/catboost" &&
    catboost?.version === "v1.2.7",
    "Dynamic model metadata correctly records source, source_type, repositoryUrl, and version"
  );

  // Test 2.3: Register model from Hugging Face
  dynamicallyRegisterExploredModel(registry, {
    modelId: "timegpt_forecaster",
    displayName: "TimeGPT Foundation Forecaster",
    algorithm: "Transformer Zero-shot Time Series Foundation Model",
    framework: "nixtla",
    supportedTasks: ["time_series_forecasting"],
    capabilities: ["zero_shot", "temporal_data"],
    strengths: ["Zero-shot forecasting across multiple horizons"],
    weaknesses: ["Requires API key"],
    isBaseline: false,
    sourceTypeId: "external",
    sourceProviderId: "huggingface",
    source: "huggingface.co",
    repositoryUrl: "https://huggingface.co/Nixtla/timegpt-1",
    repositoryId: "Nixtla/timegpt-1",
    version: "1.0",
    license: "Commercial / Hosted",
  });

  assert(
    registry.isModelSupported("timegpt_forecaster"),
    "Hugging Face explored model 'timegpt_forecaster' is registered"
  );

  // Test 2.4: Register a Builtin Baseline Model
  registry.registerModel({
    modelId: "logistic_regression",
    displayName: "Logistic Regression",
    algorithm: "Generalized Linear Model with Logit Link",
    framework: "sklearn",
    supportedTasks: ["tabular_classification"],
    supportedSubTasks: ["binary_classification"],
    supportedPredictionTypes: ["label", "probability"],
    capabilities: ["numerical_features"],
    strengths: ["Fast interpretable linear baseline"],
    weaknesses: ["Linear decision boundary"],
    isBaseline: true,
    sourceTypeId: "builtin",
    sourceType: "builtin",
    source: "builtin",
  });

  assert(
    registry.isModelSupported("logistic_regression"),
    "Built-in baseline model is registered"
  );

  // Test 2.5: Distinguish Builtin vs External Models
  const externalModels = registry.getExternalModels();
  const builtinModels = registry.getBuiltinModels();
  assert(
    externalModels.length === 2 && externalModels.every((m) => m.sourceType === "external"),
    "Registry distinguishes external models correctly",
    `External count: ${externalModels.length}`
  );
  assert(
    builtinModels.length === 1 && builtinModels[0].modelId === "logistic_regression",
    "Registry distinguishes built-in models correctly",
    `Builtin count: ${builtinModels.length}`
  );

  // Test 2.6: Filter Candidates by Source
  const hfModels = registry.getModelsBySource("huggingface.co");
  assert(
    hfModels.length === 1 && hfModels[0].modelId === "timegpt_forecaster",
    "filterCandidates / getModelsBySource retrieves models from specific platform (huggingface.co)"
  );

  // Test 2.7: Deduplication and Metadata Update
  const initialTimeGptUpdated = registry.getModel("timegpt_forecaster")?.updatedAt;
  registry.registerModel({
    modelId: "timegpt_forecaster",
    displayName: "TimeGPT Foundation Forecaster (v2)",
    algorithm: "Transformer Zero-shot Time Series Foundation Model",
    framework: "nixtla",
    supportedTasks: ["time_series_forecasting"],
    supportedSubTasks: [],
    supportedPredictionTypes: ["point", "value"],
    capabilities: ["zero_shot", "temporal_data", "exogenous_features"],
    strengths: ["Zero-shot forecasting across multiple horizons", "Low latency inference"],
    weaknesses: ["Requires API key"],
    isBaseline: false,
    sourceTypeId: "external",
    source: "huggingface.co",
    version: "2.0",
  });

  const updatedTimeGpt = registry.getModel("timegpt_forecaster");
  assert(
    registry.getAllModels().length === 3,
    "Registering existing modelId does NOT create duplicate registry entry"
  );
  assert(
    updatedTimeGpt?.version === "2.0" &&
    updatedTimeGpt?.capabilities.includes("exogenous_features") &&
    updatedTimeGpt?.displayName === "TimeGPT Foundation Forecaster (v2)",
    "Existing model metadata is updated and enriched upon subsequent exploration"
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // 3. Model Selection Decision Validation Tests
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n--- Category 3: Output Schema & Structural Validation ---");

  // Register additional candidate for tabular classification
  registry.registerModel({
    modelId: "lightgbm_classifier",
    displayName: "LightGBM Classifier",
    algorithm: "Leaf-wise Gradient Boosted Decision Trees",
    framework: "lightgbm",
    supportedTasks: ["tabular_classification"],
    supportedSubTasks: ["binary_classification"],
    supportedPredictionTypes: ["label", "probability"],
    capabilities: ["numerical_features", "categorical_features"],
    strengths: ["Fast training", "Native categorical handling"],
    weaknesses: ["Hyperparameter sensitive"],
    isBaseline: false,
    sourceTypeId: "external",
    source: "github.com",
    repositoryUrl: "https://github.com/microsoft/LightGBM",
  });

  const validDecision: ModelSelectionDecision = {
    status: "READY",
    target_entity: {
      name: "churn_flag",
      datatype: "boolean",
      description: "Customer churn flag in Q3",
      source: "orders_table",
    },
    derivation: "Flagged if no orders in 90 days",
    positive_class: "churned",
    negative_class: "active",
    prediction_grain: {
      entity: "customer_id",
      keys: ["customer_id"],
      frequency: null,
    },
    recommended_model: {
      model_id: "lightgbm_classifier",
      rank: 1,
      suitability_score: 0.94,
      recommendation: "primary",
      source: "github.com",
      source_type: "external",
      repository_url: "https://github.com/microsoft/LightGBM",
    },
    candidates: [
      {
        model_id: "lightgbm_classifier",
        rank: 1,
        suitability_score: 0.94,
        recommendation: "primary",
        source: "github.com",
        source_type: "external",
        repository_url: "https://github.com/microsoft/LightGBM",
        reasoning: {
          strengths: ["Fast leaf-wise gradient boosting", "Native categorical handling"],
          weaknesses: ["Requires leaf tuning"],
          suitability: ["Top performer for high-dimensional customer activity"],
        },
      },
      {
        model_id: "catboost_sota",
        rank: 2,
        suitability_score: 0.89,
        recommendation: "alternative",
        source: "github.com",
        source_type: "external",
        repository_url: "https://github.com/catboost/catboost",
        reasoning: {
          strengths: ["Symmetric trees", "Target encoding"],
          weaknesses: ["Higher memory footprint"],
          suitability: ["Strong secondary candidate"],
        },
      },
    ],
    training: {
      mode: "automl_search",
      baseline_model: "logistic_regression",
      ensemble: {
        enabled: false,
        strategy: null,
      },
      random_seed: 42,
      early_stopping: {
        enabled: true,
        patience: 10,
        metric: "log_loss",
      },
    },
    max_training_time: "30m",
    model_selection_strategy: "gradient_boosted_tabular_search",
    models: [
      {
        model_id: "lightgbm_classifier",
        framework: "lightgbm",
        algorithm: "LightGBM",
        enabled: true,
        parameters: {},
        source: "github.com",
        source_type: "external",
      },
    ],
    featureRequirements: [
      {
        feature: "recency_days",
        requirement: "numeric_standard_scaling",
        reason: "Beneficial for linear baseline comparison",
      },
    ],
    hyperparameterOptimization: {
      recommended: true,
      approach: "bayesian_optimization",
      rationale: "Tune max_depth and learning_rate",
    },
    confidence: {
      score: 0.92,
      rationale: "Clean target distribution and clear tabular feature signals",
    },
  };

  const validRes = ModelSelectionValidator.validate(validDecision, registry);
  assert(validRes.isValid, "Valid decision with source metadata passes all validation checks", validRes.errors.join("; "));

  // Test Invalid Suitability Score (> 1.0)
  const invalidScoreDecision: ModelSelectionDecision = JSON.parse(JSON.stringify(validDecision));
  invalidScoreDecision.candidates[0].suitability_score = 1.45;
  const invalidScoreRes = ModelSelectionValidator.validate(invalidScoreDecision, registry);
  assert(
    !invalidScoreRes.isValid && invalidScoreRes.errors.some((e) => e.includes("suitability_score must be between 0 and 1")),
    "Validator rejects suitability score greater than 1.0"
  );

  // Test Unknown Model ID not in Registry
  const unknownModelDecision: ModelSelectionDecision = JSON.parse(JSON.stringify(validDecision));
  unknownModelDecision.candidates[1].model_id = "unregistered_magic_model_9000";
  const unknownModelRes = ModelSelectionValidator.validate(unknownModelDecision, registry);
  assert(
    !unknownModelRes.isValid && unknownModelRes.errors.some((e) => e.includes("does not exist in Model Capability Registry")),
    "Validator rejects candidate model not present in ModelCapabilityRegistry"
  );

  // Test Invalid source_type
  const invalidSourceDecision: ModelSelectionDecision = JSON.parse(JSON.stringify(validDecision));
  invalidSourceDecision.candidates[0].source_type = "invalid_source_type" as any;
  const invalidSourceRes = ModelSelectionValidator.validate(invalidSourceDecision, registry);
  assert(
    !invalidSourceRes.isValid && invalidSourceRes.errors.some((e) => e.includes("source_type must be \"external\" or \"builtin\"")),
    "Validator validates source_type values"
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // 4. Dynamic URL Parsing & Provider Resolution (No Hardcoding)
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n--- Category 4: Dynamic URL Parsing & Provider Resolution ---");

  const mockRepo = {
    ensureSourceProvider: async () => {},
    saveDynamicModel: async () => {},
    getDynamicModels: async () => [],
    clearDynamicModels: async () => {},
    getSourceTypes: async () => [],
    getSourceProviders: async () => [],
    saveDecision: async (d: any) => d,
    getById: async () => undefined,
    getLatestByProjectId: async () => undefined,
    getAllByProjectId: async () => [],
    updateUserSelection: async () => undefined,
    markStale: async () => true,
  };
  const discoveryService = new ModelDiscoveryService(mockRepo as any);

  const hfInfo = discoveryService.parseUrlSource("https://huggingface.co/microsoft/deberta-v3-base");
  assert(
    hfInfo.providerId === "huggingface_co" && hfInfo.repositoryId === "microsoft/deberta-v3-base",
    "parseUrlSource dynamically extracts Hugging Face repository details",
    JSON.stringify(hfInfo)
  );

  const ghInfo = discoveryService.parseUrlSource("https://github.com/google-research/tuning_playbook");
  assert(
    ghInfo.providerId === "github_com" && ghInfo.repositoryId === "google-research/tuning_playbook",
    "parseUrlSource dynamically extracts GitHub repository details",
    JSON.stringify(ghInfo)
  );

  const customInfo = discoveryService.parseUrlSource("https://ai.meta.com/resources/models-and-libraries/fairseq/");
  assert(
    customInfo.providerId === "ai_meta_com" && customInfo.providerName === "ai.meta.com",
    "parseUrlSource dynamically extracts arbitrary web domain without hardcoding",
    JSON.stringify(customInfo)
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // 5. Automatic Tool Execution in Agent Loop
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n--- Category 5: Automatic Tool Execution in Agent Loop ---");

  let toolExecuted: boolean = false;
  let toolReceivedQuery = "";

  const mockWebSearchTool = tool(
    async (input: { query: string }) => {
      toolExecuted = true;
      toolReceivedQuery = input.query;
      return JSON.stringify([
        { title: "Top ML models for churn", snippet: "LightGBM and CatBoost outperform on tabular customer churn benchmarks.", url: "https://github.com/catboost/catboost" }
      ]);
    },
    {
      name: "web_search",
      description: "Search web for state-of-the-art models",
      schema: z.object({ query: z.string() })
    }
  );

  class MockToolCallingChatModel extends BaseChatModel {
    public callCount = 0;
    constructor() { super({}); }
    _llmType() { return "mock"; }
    bindTools(tools: any[], kwargs?: Record<string, any>) {
      return new RunnableBinding({ bound: this, kwargs: { tools, ...kwargs } as any, config: {} });
    }
    async _generate(_messages: any[]) {
      this.callCount++;
      if (this.callCount === 1) {
        return {
          generations: [{
            message: new AIMessage({
              content: "",
              tool_calls: [{
                name: "web_search",
                args: { query: "state-of-the-art tabular classification models" },
                id: "call_web_search_01"
              }]
            }),
            text: ""
          }]
        };
      } else {
        return {
          generations: [{
            message: new AIMessage({
              content: JSON.stringify({
                status: "READY",
                recommended_model: {
                  model_id: "lightgbm_classifier",
                  suitability_score: 0.96,
                  source: "github.com",
                  source_type: "external",
                  repository_url: "https://github.com/microsoft/LightGBM"
                },
                candidates: [
                  {
                    model_id: "lightgbm_classifier",
                    rank: 1,
                    suitability_score: 0.96,
                    recommendation: "primary",
                    source: "github.com",
                    source_type: "external",
                    repository_url: "https://github.com/microsoft/LightGBM"
                  }
                ],
                exploredViaTool: true
              }),
              tool_calls: []
            }),
            text: ""
          }]
        };
      }
    }
  }

  const mockModel = new MockToolCallingChatModel();
  const testAgent = createAgent({
    model: mockModel as any,
    tools: [mockWebSearchTool],
    systemPrompt: "You are a model selection agent."
  });

  await testAgent.invoke({
    messages: [new HumanMessage("Select the best model for churn classification")]
  });

  assert(
    Boolean(toolExecuted) === true,
    "createAgent agent loop automatically executes tool call when model requests it"
  );
  assert(
    mockModel.callCount === 2,
    "Model was reinvoked with tool execution results (call count = 2)",
    `Actual calls: ${mockModel.callCount}`
  );
  assert(
    toolReceivedQuery === "state-of-the-art tabular classification models",
    "Tool received correct arguments from agent loop"
  );

  // Test 5.2: ModelSelectionLLMService createFallbackDecision creates valid decision
  const llmService = new ModelSelectionLLMService();
  const fallbackDecision = llmService.createFallbackDecision(normClassContext, registry.getAllModels());
  const fallbackValidation = ModelSelectionValidator.validate(fallbackDecision, registry);
  assert(
    fallbackValidation.isValid,
    "createFallbackDecision produces a structurally valid ModelSelectionDecision with source metadata",
    fallbackValidation.errors.join("; ")
  );

  console.log("\n=================================================");
  console.log(` Test Summary: ${passedTests} / ${totalTests} Passed`);
  console.log("=================================================\n");

  if (passedTests !== totalTests) {
    process.exit(1);
  }
}

runModelSelectionTests().catch((err) => {
  console.error("Test execution encountered critical failure:", err);
  process.exit(1);
});
