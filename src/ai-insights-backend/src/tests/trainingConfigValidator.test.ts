import assert from "node:assert/strict";
import { test } from "node:test";
import { TrainingConfigValidator } from "../agents/ModelTrainingValidation/TrainingConfiguration/trainingConfigValidator";

const validContract = {
  "x-primary-metric-name": "WAPE",
  "x-primary-metric-def": {
    value: "WAPE",
    direction: "minimize",
    confidence: 0.95,
    rationale: "Retail demand forecasting accuracy metric",
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
    candidates: [{
      model_id: "lightgbm_sota",
      framework: "lightgbm",
      algorithm: "LGBMRegressor",
    }],
    models: [{
      model_id: "lightgbm_sota",
      framework: "lightgbm",
      algorithm: "LGBMRegressor",
      enabled: true,
      export_capabilities: {
        default_format: "joblib",
        selection_rationale: "Supported portable Python inference artifact.",
        post_training_validation_required: true,
        formats: [{
          format_id: "joblib",
          extension: ".joblib",
          format_name: "Joblib",
          status: "supported",
          selectable: true,
          role: "native_model",
          runtime: "python",
          requires_preprocessing: false,
          required_assets: [],
          validation_required: true,
          limitations: [],
        }],
      },
    }],
  },
  hyperparameter_optimization: { method: "bayesian" },
  search_space: { learning_rate: [0.01, 0.1] },
  artifacts: {
    export_policy: {
      mode: "multiple_formats",
      include_native_format: true,
      include_conditional_formats: false,
      validate_after_export: true,
      require_prediction_parity: false,
      include_preprocessing_assets: true,
      include_inference_manifest: false,
    },
  },
};

test("training configuration accepts a complete contract", () => {
  const result = TrainingConfigValidator.validate(validContract);
  assert.equal(result.isValid, true);
  assert.deepEqual(result.errors, []);
});

test("training configuration rejects missing required contract fields", () => {
  const cases = [
    [{ ...validContract, "x-primary-metric-name": undefined }, /x-primary-metric-name/],
    [{ ...validContract, task: { prediction_type: "value" } }, /task\.task_type/],
    [{
      ...validContract,
      split: { strategy: "random", train_ratio: 0.8, validation_ratio: 0.1, test_ratio: 0.05 },
    }, /must sum to 1\.0/],
    [{
      ...validContract,
      model_selection: {
        ...validContract.model_selection,
        models: [{
          ...validContract.model_selection.models[0],
          framework: undefined,
        }],
      },
    }, /missing framework/],
    [{ ...validContract, objective: { optimization_metric: "WAPE" } }, /objective\.direction/],
    [{ ...validContract, search_space: {} }, /search_space/],
  ] as const;

  for (const [contract, expectedError] of cases) {
    const result = TrainingConfigValidator.validate(contract);
    assert.equal(result.isValid, false);
    assert.ok(result.errors.some((error) => expectedError.test(error)), result.errors.join("; "));
  }
});
