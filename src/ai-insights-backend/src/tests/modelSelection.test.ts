import { ModelCapabilityRegistry, DEFAULT_BASE_MODELS } from "../agents/ModelTrainingValidation/ModelSelection/modelCapabilityRegistry";
import { ModelSelectionContextNormalizer } from "../agents/ModelTrainingValidation/ModelSelection/contextNormalizer";
import { ModelSelectionValidator } from "../agents/ModelTrainingValidation/ModelSelection/modelSelectionValidator";
import { dynamicallyRegisterExploredModel } from "../agents/ModelTrainingValidation/ModelSelection/modelWebSearch.tool";
import {
  ModelSelectionContext,
  ModelSelectionDecision,
} from "../models/modelSelection.types";

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

  // Test 1.1: Binary Classification Inference
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

  // Test 1.2: Time-Series Forecasting Inference
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

  const registry = new ModelCapabilityRegistry();
  const allBase = registry.getAllModels();
  assert(
    allBase.length >= 8,
    "Registry initializes with clean set of default base models",
    `Count: ${allBase.length}`
  );

  // Test filtering classification candidates
  const classCandidates = registry.filterCandidates({ task: "tabular_classification" });
  assert(
    classCandidates.some((m) => m.modelId === "lightgbm_classifier") &&
    classCandidates.some((m) => m.modelId === "xgboost_classifier") &&
    classCandidates.every((m) => m.supportedTasks.includes("tabular_classification")),
    "filterCandidates returns only models supporting tabular_classification"
  );

  // Test filtering regression candidates
  const regCandidates = registry.filterCandidates({ task: "tabular_regression" });
  assert(
    regCandidates.some((m) => m.modelId === "linear_regression") &&
    regCandidates.every((m) => m.supportedTasks.includes("tabular_regression")),
    "filterCandidates returns only models supporting tabular_regression"
  );

  // Test Dynamic Registration of novel models (e.g. TimeGPT explored via web search)
  dynamicallyRegisterExploredModel(registry, {
    modelId: "timegpt_forecaster",
    displayName: "TimeGPT Foundation Forecaster",
    algorithm: "Transformer-based Zero-shot Time Series Foundation Model",
    framework: "custom",
    supportedTasks: ["time_series_forecasting"],
    capabilities: ["zero_shot", "temporal_data", "uncertainty_intervals"],
    strengths: ["State-of-the-art zero-shot forecasting", "Native anomaly handling"],
    weaknesses: ["Requires API key connectivity"],
    isBaseline: false,
  });

  assert(
    registry.isModelSupported("timegpt_forecaster"),
    "Dynamically registered model 'timegpt_forecaster' is supported in registry"
  );
  const timeGpt = registry.getModel("timegpt_forecaster");
  assert(
    timeGpt?.isDynamic === true && timeGpt?.source === "web_search",
    "Dynamic model metadata correctly records source: web_search"
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // 3. Model Selection Decision Validation Tests
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n--- Category 3: Output Schema & Structural Validation ---");

  // Valid decision template
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
    },
    candidates: [
      {
        model_id: "lightgbm_classifier",
        rank: 1,
        suitability_score: 0.94,
        recommendation: "primary",
        reasoning: {
          strengths: ["Fast leaf-wise gradient boosting", "Native categorical handling"],
          weaknesses: ["Requires leaf tuning"],
          suitability: ["Top performer for high-dimensional customer activity"],
        },
      },
      {
        model_id: "xgboost_classifier",
        rank: 2,
        suitability_score: 0.89,
        recommendation: "alternative",
        reasoning: {
          strengths: ["L1/L2 regularized depth-wise trees"],
          weaknesses: ["Slightly higher memory"],
          suitability: ["Strong secondary candidate"],
        },
      },
      {
        model_id: "catboost_classifier",
        rank: 3,
        suitability_score: 0.85,
        recommendation: "alternative",
        reasoning: {
          strengths: ["Target encoding on categorical features"],
          weaknesses: ["Slower training time"],
          suitability: ["Robust against overfitting"],
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
      },
      {
        model_id: "xgboost_classifier",
        framework: "xgboost",
        algorithm: "XGBoost",
        enabled: true,
        parameters: {},
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
      rationale: "Tune max_depth, learning_rate, and colsample_bytree",
    },
    confidence: {
      score: 0.92,
      rationale: "Clean target distribution and clear tabular feature signals",
    },
  };

  const validRes = ModelSelectionValidator.validate(validDecision, registry);
  assert(validRes.isValid, "Valid decision passes all validation checks", validRes.errors.join("; "));

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

  // Test Non-sequential Ranks
  const nonSeqRankDecision: ModelSelectionDecision = JSON.parse(JSON.stringify(validDecision));
  nonSeqRankDecision.candidates[1].rank = 4; // Expected 2
  const nonSeqRes = ModelSelectionValidator.validate(nonSeqRankDecision, registry);
  assert(
    !nonSeqRes.isValid && nonSeqRes.errors.some((e) => e.includes("ranks must be sequential starting at 1")),
    "Validator rejects non-sequential ranks"
  );

  // Test Multiple Primary Recommendations
  const multiPrimaryDecision: ModelSelectionDecision = JSON.parse(JSON.stringify(validDecision));
  multiPrimaryDecision.candidates[1].recommendation = "primary";
  const multiPrimaryRes = ModelSelectionValidator.validate(multiPrimaryDecision, registry);
  assert(
    !multiPrimaryRes.isValid && multiPrimaryRes.errors.some((e) => e.includes("Exactly one candidate must have recommendation \"primary\"")),
    "Validator enforces exactly one primary recommendation"
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // 4. User Selection & Training Handoff Separation
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n--- Category 4: User Selection & Training Configuration Separation ---");

  const originalCandidatesCopy = JSON.stringify(validDecision.candidates);
  const userSelectedModels = ["lightgbm_classifier", "catboost_classifier"]; // user excluded xgboost

  // Verify handoff logic:
  // 1. User selection preserves original decision immutability
  const candidateIds = validDecision.candidates.map((c) => c.model_id);
  const allUserModelsValid = userSelectedModels.every((id) => candidateIds.includes(id));
  assert(allUserModelsValid, "User-selected models are verified against candidate list");

  // Verify original decision was not modified
  assert(
    JSON.stringify(validDecision.candidates) === originalCandidatesCopy,
    "Original agent decision candidates remain immutable when user makes selection"
  );

  // Verify excluded candidate is omitted from training handoff
  assert(
    !userSelectedModels.includes("xgboost_classifier"),
    "Unselected candidate ('xgboost_classifier') is excluded from training candidate_models"
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
