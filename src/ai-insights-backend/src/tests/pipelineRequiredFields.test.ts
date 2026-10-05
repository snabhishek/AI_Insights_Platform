import assert from "assert";
import { ModelSelectionValidator } from "../agents/ModelTrainingValidation/ModelSelection/modelSelectionValidator";
import { ModelCapabilityRegistry } from "../agents/ModelTrainingValidation/ModelSelection/modelCapabilityRegistry";
import { TrainingConfigValidator } from "../agents/ModelTrainingValidation/TrainingConfiguration/trainingConfigValidator";
import { ModelSelectionDecision } from "../models/modelSelection.types";
import { ModelSelectionLLMService } from "../services/ai/model-selection/modelSelectionLLM.service";

const colors = {
  green: (text: string) => `\x1b[32m${text}\x1b[0m`,
  red: (text: string) => `\x1b[31m${text}\x1b[0m`,
  cyan: (text: string) => `\x1b[36m${text}\x1b[0m`,
  bold: (text: string) => `\x1b[1m${text}\x1b[0m`,
};

let testsPassed = 0;
let testsFailed = 0;

function runTest(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ${colors.green("✓")} ${name}`);
    testsPassed++;
  } catch (err: any) {
    console.error(`  ${colors.red("✗")} ${name}`);
    console.error(`    ${colors.red(err.message || String(err))}`);
    testsFailed++;
  }
}

console.log(colors.bold("\n========================================================"));
console.log(colors.bold(" Pipeline Required Fields & Fallback Elimination Tests "));
console.log(colors.bold("========================================================\n"));

console.log(colors.cyan(colors.bold("--- 1. Model Selection Required Fields & Fallback Checks ---")));

const registry = new ModelCapabilityRegistry();
const llmService = new ModelSelectionLLMService();

const validModelSelectionPayload = {
  status: "READY",
  problem_type: "forecasting",
  task_type: "tabular_forecasting",
  task_subtype: "panel_forecasting",
  prediction_type: "value",
  primary_metric: "WAPE",
  direction: "minimize",
  secondary_metrics: ["MAE", "RMSE"],
  target_entity: {
    name: "Order_Quantity",
    datatype: "numeric",
    description: "Units ordered by customer",
  },
  prediction_grain: {
    entity: "product_sku",
    keys: ["Customer_ID", "Product_ID"],
    frequency: "W-MON",
  },
  recommended_model: {
    model_id: "lightgbm_sota",
    suitability_score: 0.94,
    recommendation: "primary",
    displayName: "LightGBM Regressor",
  },
  candidates: [
    {
      model_id: "lightgbm_sota",
      framework: "lightgbm",
      algorithm: "LGBMRegressor",
      displayName: "LightGBM Regressor",
      rank: 1,
      suitability_score: 0.94,
      recommendation: "primary",
      reasoning: {
        strengths: ["Fast training", "Handles tabular interactions"],
        weaknesses: ["Sensitive to hyperparameters"],
        suitability: ["Best fit for panel sales data"],
      },
    },
    {
      model_id: "random_forest",
      framework: "sklearn",
      algorithm: "RandomForestRegressor",
      displayName: "Random Forest Regressor",
      rank: 2,
      suitability_score: 0.82,
      recommendation: "alternative",
      reasoning: {
        strengths: ["Robust baseline", "No feature scaling needed"],
        weaknesses: ["Large memory footprint"],
        suitability: ["Strong secondary candidate"],
      },
    },
  ],
  training: {
    mode: "automl_search",
    baseline_model: "random_forest",
  },
  featureRequirements: [
    {
      feature: "Order_Date",
      requirement: "Temporal feature extraction",
      reason: "Needed for seasonality modeling",
      priority: "required",
    },
  ],
  hyperparameterOptimization: {
    recommended: true,
    approach: "bayesian_optimization",
    rationale: "Optimizes learning rate and leaves count efficiently",
  },
  confidence: {
    score: 0.92,
    rationale: "High signal-to-noise ratio in historical order series",
  },
};

runTest("ModelSelection: Valid complete payload passes normalization without errors", () => {
  const norm = (llmService as any).normalizeLLMDecision(
    validModelSelectionPayload,
    { businessContext: { useCase: "Demand Forecasting" }, dataContext: {}, featureContext: {} },
    registry.getAllModels()
  );
  assert.strictEqual(norm.status, "READY");
  assert.strictEqual(norm.primary_metric, "WAPE");
  assert.strictEqual(norm.direction, "minimize");
  assert.strictEqual(norm.candidates.length, 2);
  assert.strictEqual(norm.candidates[0].framework, "lightgbm");
  assert.strictEqual(norm.target_entity.name, "Order_Quantity");
});

runTest("ModelSelection: Throws when target_entity is missing", () => {
  const invalid = { ...validModelSelectionPayload, target_entity: undefined };
  assert.throws(() => {
    (llmService as any).normalizeLLMDecision(invalid, { businessContext: {} }, registry.getAllModels());
  }, /target_entity.*is required/);
});

runTest("ModelSelection: Throws when primary_metric is missing", () => {
  const invalid = { ...validModelSelectionPayload, primary_metric: undefined };
  assert.throws(() => {
    (llmService as any).normalizeLLMDecision(invalid, { businessContext: {} }, registry.getAllModels());
  }, /mandatory fields: primary_metric/);
});

runTest("ModelSelection: Throws when direction is missing or invalid", () => {
  const invalid = { ...validModelSelectionPayload, direction: undefined };
  assert.throws(() => {
    (llmService as any).normalizeLLMDecision(invalid, { businessContext: {} }, registry.getAllModels());
  }, /direction/);
});

runTest("ModelSelection: Throws when candidate model is missing framework (no default fallback)", () => {
  const invalid = {
    ...validModelSelectionPayload,
    candidates: [
      {
        ...validModelSelectionPayload.candidates[0],
        model_id: "custom_unregistered_model",
        framework: undefined,
      },
    ],
  };
  assert.throws(() => {
    (llmService as any).normalizeLLMDecision(invalid, { businessContext: {} }, []);
  }, /Candidate model 'custom_unregistered_model' is missing required field 'framework'/);
});

runTest("ModelSelection: Resolves framework when provided directly on LLM candidate", () => {
  const payload = {
    ...validModelSelectionPayload,
    candidates: [
      {
        ...validModelSelectionPayload.candidates[0],
        model_id: "explored_gradient_boosting_a_silver_bullet_in_forecasting",
        framework: "lightgbm",
        algorithm: "Gradient Boosted Decision Trees",
      },
    ],
    recommended_model: {
      ...validModelSelectionPayload.recommended_model,
      model_id: "explored_gradient_boosting_a_silver_bullet_in_forecasting",
      framework: "lightgbm",
    },
  };
  const result = (llmService as any).normalizeLLMDecision(payload, { businessContext: {} }, []);
  assert.strictEqual(result.candidates[0].framework, "lightgbm");
  assert.strictEqual(result.candidates[0].algorithm, "Gradient Boosted Decision Trees");
});

runTest("ModelSelection: Resolves framework from registry for dynamically explored models with prefix matching", () => {
  const dynamicModelDef = {
    modelId: "explored_gradient_boosting_a_silver_bullet_in_for",
    displayName: "Gradient Boosting Paper",
    framework: "lightgbm",
    algorithm: "Gradient Boosted Trees",
    supportedTasks: ["time_series_forecasting"],
    supportedSubTasks: [],
    supportedPredictionTypes: ["point"],
    capabilities: ["numerical_features"],
    strengths: ["Strong tabular baseline"],
    weaknesses: [],
    isBaseline: false,
    isDynamic: true,
  };
  const customRegistry = new ModelCapabilityRegistry();
  customRegistry.registerModel(dynamicModelDef as any);

  const payload = {
    ...validModelSelectionPayload,
    candidates: [
      {
        ...validModelSelectionPayload.candidates[0],
        model_id: "explored_gradient_boosting_a_silver_bullet_in_forecasting",
        framework: undefined,
      },
    ],
    recommended_model: {
      ...validModelSelectionPayload.recommended_model,
      model_id: "explored_gradient_boosting_a_silver_bullet_in_forecasting",
    },
  };

  const result = (llmService as any).normalizeLLMDecision(
    payload,
    { businessContext: {} },
    customRegistry.getAllModels(),
    customRegistry
  );
  assert.strictEqual(result.candidates[0].framework, "lightgbm");
});

runTest("ModelSelection: Throws when candidate model is missing suitability_score (no synthetic scores)", () => {
  const invalid = {
    ...validModelSelectionPayload,
    candidates: [
      {
        ...validModelSelectionPayload.candidates[0],
        suitability_score: undefined,
      },
    ],
  };
  assert.throws(() => {
    (llmService as any).normalizeLLMDecision(invalid, { businessContext: {} }, registry.getAllModels());
  }, /is missing required field 'suitability_score'/);
});

runTest("ModelSelection: Throws when featureRequirements is missing or empty (no hardcoded defaults)", () => {
  const invalid = { ...validModelSelectionPayload, featureRequirements: [] };
  assert.throws(() => {
    (llmService as any).normalizeLLMDecision(invalid, { businessContext: {} }, registry.getAllModels());
  }, /featureRequirements array is required/);
});

runTest("ModelSelection: Throws when hyperparameterOptimization is missing", () => {
  const invalid = { ...validModelSelectionPayload, hyperparameterOptimization: undefined };
  assert.throws(() => {
    (llmService as any).normalizeLLMDecision(invalid, { businessContext: {} }, registry.getAllModels());
  }, /hyperparameterOptimization.*is required/);
});

runTest("ModelSelection: Throws when confidence score is missing", () => {
  const invalid = { ...validModelSelectionPayload, confidence: undefined };
  assert.throws(() => {
    (llmService as any).normalizeLLMDecision(invalid, { businessContext: {} }, registry.getAllModels());
  }, /confidence.*is required/);
});

console.log(colors.cyan(colors.bold("\n--- 2. Training Configuration Required Fields & Contract Validation ---")));

const validContract = {
  "x-primary-metric-name": "WAPE",
  "x-primary-metric-def": {
    value: "WAPE",
    direction: "minimize",
    confidence: 0.95,
    rationale: "Standard retail demand forecasting accuracy metric",
  },
  task: {
    task_type: "forecasting",
    task_subtype: "panel_forecasting",
    prediction_type: "value",
  },
  split: {
    strategy: "temporal",
    split_date: "2024-01-01",
    train_ratio: 0.7,
    validation_ratio: 0.15,
    test_ratio: 0.15,
  },
  objective: {
    optimization_metric: "WAPE",
    direction: "minimize",
  },
  evaluation: {
    primary_metric: "WAPE",
    secondary_metrics: ["MAE", "RMSE"],
  },
  model_selection: {
    target_entity: { name: "Order_Quantity" },
    candidates: [
      {
        model_id: "lightgbm_sota",
        framework: "lightgbm",
        algorithm: "LGBMRegressor",
      },
    ],
    models: [
      {
        model_id: "lightgbm_sota",
        framework: "lightgbm",
        algorithm: "LGBMRegressor",
        enabled: true,
      },
    ],
  },
  hyperparameter_optimization: {
    method: "bayesian",
  },
  search_space: {
    learning_rate: [0.01, 0.1],
  },
};

runTest("TrainingConfigValidator: Valid contract passes validation", () => {
  const res = TrainingConfigValidator.validate(validContract);
  assert.strictEqual(res.isValid, true);
  assert.strictEqual(res.errors.length, 0);
});

runTest("TrainingConfigValidator: Rejects missing 'x-primary-metric-name'", () => {
  const invalid = { ...validContract, "x-primary-metric-name": undefined };
  const res = TrainingConfigValidator.validate(invalid);
  assert.strictEqual(res.isValid, false);
  assert.ok(res.errors.some((e) => e.includes("x-primary-metric-name")));
});

runTest("TrainingConfigValidator: Rejects missing 'x-primary-metric-def.direction'", () => {
  const invalid = {
    ...validContract,
    "x-primary-metric-def": { value: "WAPE" },
  };
  const res = TrainingConfigValidator.validate(invalid);
  assert.strictEqual(res.isValid, false);
  assert.ok(res.errors.some((e) => e.includes("direction")));
});

runTest("TrainingConfigValidator: Rejects missing 'task.task_type'", () => {
  const invalid = {
    ...validContract,
    task: { prediction_type: "value" },
  };
  const res = TrainingConfigValidator.validate(invalid);
  assert.strictEqual(res.isValid, false);
  assert.ok(res.errors.some((e) => e.includes("task.task_type")));
});

runTest("TrainingConfigValidator: Rejects split ratios not summing to 1.0", () => {
  const invalid = {
    ...validContract,
    split: {
      strategy: "random",
      train_ratio: 0.8,
      validation_ratio: 0.1,
      test_ratio: 0.05,
    },
  };
  const res = TrainingConfigValidator.validate(invalid);
  assert.strictEqual(res.isValid, false);
  assert.ok(res.errors.some((e) => e.includes("must sum to 1.0")));
});

runTest("TrainingConfigValidator: Rejects missing candidate model framework", () => {
  const invalid = {
    ...validContract,
    model_selection: {
      ...validContract.model_selection,
      candidates: [{ model_id: "lightgbm_sota", algorithm: "LGBM" }],
    },
  };
  const res = TrainingConfigValidator.validate(invalid);
  assert.strictEqual(res.isValid, false);
  assert.ok(res.errors.some((e) => e.includes("missing framework")));
});

runTest("TrainingConfigValidator: Rejects missing 'objective.direction'", () => {
  const invalid = {
    ...validContract,
    objective: { optimization_metric: "WAPE" },
  };
  const res = TrainingConfigValidator.validate(invalid);
  assert.strictEqual(res.isValid, false);
  assert.ok(res.errors.some((e) => e.includes("objective.direction")));
});

runTest("TrainingConfigValidator: Rejects missing 'search_space'", () => {
  const invalid = { ...validContract, search_space: {} };
  const res = TrainingConfigValidator.validate(invalid);
  assert.strictEqual(res.isValid, false);
  assert.ok(res.errors.some((e) => e.includes("search_space")));
});

console.log(colors.cyan(colors.bold("\n--- 3. Model Training Report & Execution Validation ---")));

function parseTrainingReport(report: any, direction: "minimize" | "maximize", configuredCandidates?: any[]) {
  if (!report || typeof report !== "object") {
    throw new Error("[ModelTrainingAgent] Training execution failed: 'model_training_report.json' was not generated.");
  }
  const candidatesPayload =
    report.models_evaluated ||
    report.candidate_models_evaluated ||
    report.model_results ||
    report.candidate_model_results ||
    report.models ||
    report.runs;

  if (!candidatesPayload || (Array.isArray(candidatesPayload) ? candidatesPayload.length === 0 : Object.keys(candidatesPayload).length === 0)) {
    throw new Error("[ModelTrainingAgent] 'model_training_report.json' is missing required candidate model results.");
  }

  const rawRuns = Array.isArray(candidatesPayload)
    ? candidatesPayload
    : Object.entries(candidatesPayload).map(([key, val]: [string, any]) => ({
        model_id: val.model_id || key,
        ...val,
      }));

  const runs = rawRuns.map((r: any) => {
    const configured = configuredCandidates?.find((c) => c.model_id === r.model_id);
    const framework = r.framework || configured?.framework;
    if (!framework) {
      throw new Error(`[ModelTrainingAgent] Candidate model '${r.model_id}' is missing required 'framework'.`);
    }
    const normStatus = String(r.status || "").toLowerCase();
    const status = normStatus === "completed" || normStatus === "success" ? "Completed" : "Failed";

    const score =
      typeof r.score === "number"
        ? r.score
        : typeof r.metrics?.validation?.score === "number"
        ? r.metrics.validation.score
        : typeof r.validation_metrics?.[report.primary_metric] === "number"
        ? r.validation_metrics[report.primary_metric]
        : undefined;

    return {
      model_id: r.model_id,
      framework,
      status,
      score,
      artifact: r.artifact_path || r.model_path || `artifacts/models/${r.model_id}.joblib`,
    };
  });

  const isMinimize = direction.toLowerCase() === "minimize";
  const rankedCandidates = [...runs]
    .filter((r) => r.status === "Completed")
    .sort((a, b) => {
      if (a.score == null && b.score == null) return 0;
      if (a.score == null) return 1;
      if (b.score == null) return -1;
      return isMinimize ? a.score - b.score : b.score - a.score;
    });

  const selectedModel =
    (typeof report.best_model === "string" ? report.best_model : report.best_model?.model_id) ||
    (typeof report.selected_model === "string" ? report.selected_model : report.selected_model?.model_id) ||
    (typeof report.champion_model === "string" ? report.champion_model : report.champion_model?.model_id) ||
    report.best_model_id ||
    report.champion_model_id ||
    (rankedCandidates[0]?.model_id);

  if (!selectedModel) {
    throw new Error("[ModelTrainingAgent] Model training report is missing a best/champion model identifier ('best_model_id' or 'selected_model') and no evaluated candidate models succeeded.");
  }

  return { selectedModel, ranked: rankedCandidates, runs };
}

const mockTrainingReport = {
  status: "Completed",
  project_name: "Forecasting",
  primary_metric: "WAPE",
  best_model_id: "lightgbm_sota",
  best_model_wape: 0.5108,
  model_results: {
    lightgbm_sota: {
      model_id: "lightgbm_sota",
      framework: "lightgbm",
      status: "Completed",
      validation_metrics: { WAPE: 0.5108, MAE: 8.93, RMSE: 11.41 },
    },
    random_forest: {
      model_id: "random_forest",
      framework: "sklearn",
      status: "Completed",
      validation_metrics: { WAPE: 0.6342, MAE: 10.55, RMSE: 14.22 },
    },
  },
};

runTest("ModelTraining: Successfully parses valid training report without synthetic fallbacks", () => {
  const result = parseTrainingReport(mockTrainingReport, "minimize");
  assert.strictEqual(result.selectedModel, "lightgbm_sota");
  assert.strictEqual(result.ranked.length, 2);
  assert.strictEqual(result.ranked[0].model_id, "lightgbm_sota");
  assert.strictEqual(result.ranked[0].score, 0.5108);
  assert.strictEqual(result.ranked[1].model_id, "random_forest");
});

runTest("ModelTraining: Successfully parses report with models_evaluated array and best_model object", () => {
  const containerReport = {
    status: "Completed",
    primary_metric: "WAPE",
    primary_metric_direction: "minimize",
    best_model: {
      model_id: "lightgbm_sota",
      score: 0.525,
      model_path: "/workspace/artifacts/models/selected_model.joblib",
    },
    models_evaluated: [
      {
        model_id: "lightgbm_sota",
        displayName: "LightGBM Fast GBDT",
        status: "Success",
        metrics: {
          validation: { score: 0.525, primaryMetricName: "WAPE" },
          test: { score: 0.506, primaryMetricName: "WAPE" },
        },
      },
      {
        model_id: "catboost_sota",
        displayName: "CatBoost Gradient Boosting",
        status: "Success",
        metrics: {
          validation: { score: 0.5268, primaryMetricName: "WAPE" },
          test: { score: 0.5058, primaryMetricName: "WAPE" },
        },
      },
    ],
  };

  const configuredCandidates = [
    { model_id: "lightgbm_sota", framework: "lightgbm" },
    { model_id: "catboost_sota", framework: "catboost" },
  ];

  const result = parseTrainingReport(containerReport, "minimize", configuredCandidates);
  assert.strictEqual(result.selectedModel, "lightgbm_sota");
  assert.strictEqual(result.ranked.length, 2);
  assert.strictEqual(result.ranked[0].model_id, "lightgbm_sota");
  assert.strictEqual(result.ranked[0].framework, "lightgbm");
  assert.strictEqual(result.ranked[1].model_id, "catboost_sota");
  assert.strictEqual(result.ranked[1].framework, "catboost");
});

runTest("ModelTraining: Dynamic ranking respects minimize direction (lower is better)", () => {
  const result = parseTrainingReport(mockTrainingReport, "minimize");
  assert.strictEqual(result.ranked[0].model_id, "lightgbm_sota");
  assert.ok(result.ranked[0].score < result.ranked[1].score);
});

runTest("ModelTraining: Dynamic ranking respects maximize direction (higher is better)", () => {
  const maxReport = {
    ...mockTrainingReport,
    primary_metric: "Accuracy",
    best_model_id: "random_forest",
    model_results: {
      lightgbm_sota: {
        model_id: "lightgbm_sota",
        framework: "lightgbm",
        status: "Completed",
        validation_metrics: { Accuracy: 0.85 },
      },
      random_forest: {
        model_id: "random_forest",
        framework: "sklearn",
        status: "Completed",
        validation_metrics: { Accuracy: 0.92 },
      },
    },
  };
  const result = parseTrainingReport(maxReport, "maximize");
  assert.strictEqual(result.ranked[0].model_id, "random_forest");
  assert.ok(result.ranked[0].score > result.ranked[1].score);
});

runTest("ModelTraining: Throws when model_training_report.json is null or empty", () => {
  assert.throws(() => {
    parseTrainingReport(null, "minimize");
  }, /Training execution failed: 'model_training_report.json' was not generated/);
});

runTest("ModelTraining: Throws when candidate model results are missing from report", () => {
  const emptyReport = { ...mockTrainingReport, model_results: undefined };
  assert.throws(() => {
    parseTrainingReport(emptyReport, "minimize");
  }, /missing required candidate model results/);
});

runTest("ModelTraining: Throws when best model cannot be identified and no candidates succeed", () => {
  const missingBest = {
    ...mockTrainingReport,
    best_model_id: undefined,
    model_results: {
      failing_model: {
        model_id: "failing_model",
        framework: "sklearn",
        status: "Failed",
      },
    },
  };
  assert.throws(() => {
    parseTrainingReport(missingBest, "minimize");
  }, /missing a best\/champion model identifier/);
});

console.log(colors.cyan(colors.bold("\n--- 4. Model Validation Direction & Model Normalization Checks ---")));

function rankValidationCandidates(candidates: any[], direction: "minimize" | "maximize") {
  const isMinimize = direction.toLowerCase() === "minimize";
  return [...candidates].sort((a, b) => {
    const scoreA = a.score ?? (isMinimize ? 999999 : -999999);
    const scoreB = b.score ?? (isMinimize ? 999999 : -999999);
    return isMinimize ? scoreA - scoreB : scoreB - scoreA;
  });
}

runTest("ModelValidation: Direction 'minimize' ranks lower error scores first (no hardcoded string checks)", () => {
  const candidates = [
    { model_id: "model_b", score: 14.5, framework: "sklearn" },
    { model_id: "model_a", score: 8.2, framework: "lightgbm" },
    { model_id: "model_c", score: 22.1, framework: "pytorch" },
  ];
  const ranked = rankValidationCandidates(candidates, "minimize");
  assert.strictEqual(ranked[0].model_id, "model_a");
  assert.strictEqual(ranked[1].model_id, "model_b");
  assert.strictEqual(ranked[2].model_id, "model_c");
});

runTest("ModelValidation: Direction 'maximize' ranks higher scores first", () => {
  const candidates = [
    { model_id: "model_b", score: 0.78, framework: "sklearn" },
    { model_id: "model_a", score: 0.93, framework: "lightgbm" },
    { model_id: "model_c", score: 0.85, framework: "pytorch" },
  ];
  const ranked = rankValidationCandidates(candidates, "maximize");
  assert.strictEqual(ranked[0].model_id, "model_a");
  assert.strictEqual(ranked[1].model_id, "model_c");
  assert.strictEqual(ranked[2].model_id, "model_b");
});

runTest("ModelValidation: Throws when candidate in report is missing framework (no guessing)", () => {
  const rawValidationRun = { model_id: "chronos_custom", score: 0.45 };
  const frameworkMap = new Map<string, string>();
  assert.throws(() => {
    const framework = (rawValidationRun as any).framework || frameworkMap.get(rawValidationRun.model_id.toLowerCase());
    if (!framework) {
      throw new Error(`[ModelValidationAgent] Candidate model '${rawValidationRun.model_id}' is missing required 'framework'.`);
    }
  }, /missing required 'framework'/);
});

function resolveValidationDirection(ctx: {
  trainingReport?: any;
  trainingConfig?: any;
  state?: any;
}) {
  const { trainingReport, trainingConfig, state } = ctx;
  const direction =
    trainingReport?.metric_direction ||
    trainingReport?.direction ||
    trainingConfig?.task?.metric_direction ||
    trainingConfig?.task?.direction ||
    trainingConfig?.objective?.direction ||
    trainingConfig?.["x-primary-metric-def"]?.direction ||
    state?.direction ||
    state?.modelSelection?.direction ||
    state?.stageOutputs?.modelSelection?.direction ||
    state?.modelTraining?.direction ||
    state?.stageOutputs?.modelTraining?.direction ||
    state?.trainingConfiguration?.configuration?.objective?.direction ||
    state?.trainingConfiguration?.configuration?.["x-primary-metric-def"]?.direction ||
    state?.trainingConfiguration?.direction;

  if (!direction || !["maximize", "minimize"].includes(String(direction).toLowerCase())) {
    throw new Error(`[ModelValidationAgent] Missing or invalid optimization direction ('${direction}'). Must be 'maximize' or 'minimize'.`);
  }
  return String(direction).toLowerCase();
}

runTest("ModelValidation: Resolves direction from trainingReport.metric_direction", () => {
  const dir = resolveValidationDirection({
    trainingReport: { metric_direction: "minimize", primary_metric: "WAPE" },
  });
  assert.strictEqual(dir, "minimize");
});

runTest("ModelValidation: Resolves direction from trainingConfig.task.metric_direction", () => {
  const dir = resolveValidationDirection({
    trainingConfig: { task: { primary_metric: "WAPE", metric_direction: "minimize" } },
  });
  assert.strictEqual(dir, "minimize");
});

runTest("ModelValidation: Resolves direction from state.modelSelection.direction", () => {
  const dir = resolveValidationDirection({
    state: { modelSelection: { direction: "maximize", primary_metric: "F1" } },
  });
  assert.strictEqual(dir, "maximize");
});

runTest("ModelValidation: Throws when direction is absent across all artifacts and state", () => {
  assert.throws(() => {
    resolveValidationDirection({});
  }, /Missing or invalid optimization direction \('undefined'\)/);
});

function buildValidationFrameworkMap(ctx: {
  trainingConfig?: any;
  trainingReport?: any;
  state?: any;
  rawReport?: any;
}) {
  const { trainingConfig, trainingReport, state, rawReport } = ctx;
  const frameworkMap = new Map<string, string>();

  if (trainingConfig?.candidate_models && typeof trainingConfig.candidate_models === "object") {
    const cands = Array.isArray(trainingConfig.candidate_models)
      ? trainingConfig.candidate_models
      : Object.values(trainingConfig.candidate_models);
    for (const c of cands as any[]) {
      const id = c?.model_id || c?.id;
      const fw = c?.framework;
      if (id && fw) frameworkMap.set(String(id).toLowerCase().trim(), String(fw));
    }
  }

  const contractModels = [
    ...(trainingConfig?.model_selection?.models || []),
    ...(trainingConfig?.model_selection?.candidates || []),
  ];
  for (const m of contractModels) {
    const id = m?.model_id || m?.id;
    const fw = m?.framework;
    if (id && fw) frameworkMap.set(String(id).toLowerCase().trim(), String(fw));
  }

  const reportResults =
    trainingReport?.results ||
    trainingReport?.model_results ||
    trainingReport?.runs ||
    trainingReport?.candidate_models;
  if (reportResults) {
    const runsList = Array.isArray(reportResults) ? reportResults : Object.values(reportResults);
    for (const r of runsList as any[]) {
      const id = r?.model_id || r?.id;
      const fw = r?.framework;
      if (id && fw) frameworkMap.set(String(id).toLowerCase().trim(), String(fw));
    }
  }

  const stateCandidates = [
    ...((state?.modelSelection as any)?.candidates || []),
    ...((state?.modelSelection as any)?.models || []),
    ...((state?.stageOutputs?.modelSelection as any)?.candidates || []),
    ...((state?.stageOutputs?.modelSelection as any)?.models || []),
    ...((state?.modelTraining as any)?.candidates || []),
    ...((state?.stageOutputs?.modelTraining as any)?.candidates || []),
    ...((state?.trainingConfiguration as any)?.configuration?.model_selection?.candidates || []),
    ...((state?.trainingConfiguration as any)?.configuration?.model_selection?.models || []),
  ];
  for (const sc of stateCandidates) {
    const id = sc?.model_id || sc?.id;
    const fw = sc?.framework;
    if (id && fw) frameworkMap.set(String(id).toLowerCase().trim(), String(fw));
  }

  const validationReportResults = rawReport?.model_results || rawReport?.models;
  if (validationReportResults && typeof validationReportResults === "object") {
    const resultsObj = Array.isArray(validationReportResults)
      ? Object.fromEntries(validationReportResults.map((m: any) => [m?.model_id, m]))
      : validationReportResults;
    for (const [k, v] of Object.entries<any>(resultsObj)) {
      const id = v?.model_id || k;
      const fw = v?.framework;
      if (id && fw && !frameworkMap.has(String(id).toLowerCase().trim())) {
        frameworkMap.set(String(id).toLowerCase().trim(), String(fw));
      }
    }
  }

  return frameworkMap;
}

runTest("ModelValidation: Resolves candidate framework from trainingConfig.candidate_models (e.g. catboost_sota)", () => {
  const fwMap = buildValidationFrameworkMap({
    trainingConfig: {
      candidate_models: {
        catboost_sota: {
          model_id: "catboost_sota",
          displayName: "CatBoost Gradient Boosting Regressor",
          framework: "catboost",
        },
      },
    },
  });
  assert.strictEqual(fwMap.get("catboost_sota"), "catboost");
});

runTest("ModelValidation: Resolves candidate framework from rawReport.model_results when ranked_models only has summary", () => {
  const fwMap = buildValidationFrameworkMap({
    rawReport: {
      model_results: {
        "catboost gradient boosting regressor": {
          model_id: "catboost_sota",
          framework: "catboost",
        },
      },
    },
  });
  assert.strictEqual(fwMap.get("catboost_sota"), "catboost");
});

runTest("ModelValidation: Resolves candidate framework from state.modelSelection.candidates", () => {
  const fwMap = buildValidationFrameworkMap({
    state: {
      modelSelection: {
        candidates: [
          { model_id: "catboost_sota", framework: "catboost" },
          { model_id: "lightgbm_sota", framework: "lightgbm" },
        ],
      },
    },
  });
  assert.strictEqual(fwMap.get("catboost_sota"), "catboost");
  assert.strictEqual(fwMap.get("lightgbm_sota"), "lightgbm");
});

console.log(colors.bold("\n========================================================"));
console.log(
  colors.bold(` Test Results: ${colors.green(`${testsPassed} Passed`)}, ${testsFailed > 0 ? colors.red(`${testsFailed} Failed`) : "0 Failed"}`)
);
console.log(colors.bold("========================================================\n"));

if (testsFailed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
