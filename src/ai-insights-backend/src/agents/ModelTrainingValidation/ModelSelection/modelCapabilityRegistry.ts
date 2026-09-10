import {
  MLPredictionType,
  MLTaskSubtype,
  MLTaskType,
  ModelDefinition,
} from "../../../models/modelSelection.types";

/**
 * Lean, high-quality base set of proven production models.
 * Kept concise per user requirements (not overpopulated).
 */
export const DEFAULT_BASE_MODELS: ModelDefinition[] = [
  // --- Tabular Classification ---
  {
    modelId: "lightgbm_classifier",
    displayName: "LightGBM Classifier",
    algorithm: "Gradient Boosted Decision Trees (Leaf-wise)",
    framework: "lightgbm",
    supportedTasks: ["tabular_classification"],
    supportedSubTasks: ["binary_classification", "multiclass_classification"],
    supportedPredictionTypes: ["label", "probability", "probability_thresholded", "score"],
    capabilities: ["numerical_features", "categorical_features", "missing_values", "high_cardinality"],
    strengths: [
      "Extremely fast training and low memory usage",
      "Native categorical feature handling without one-hot encoding",
      "Robust to outliers and sparse features",
    ],
    weaknesses: [
      "Can overfit on very small datasets (<1000 rows)",
      "Sensitive to leaf-wise hyperparameter tuning",
    ],
    isBaseline: false,
    source: "builtin",
  },
  {
    modelId: "xgboost_classifier",
    displayName: "XGBoost Classifier",
    algorithm: "Extreme Gradient Boosting (Depth-wise)",
    framework: "xgboost",
    supportedTasks: ["tabular_classification"],
    supportedSubTasks: ["binary_classification", "multiclass_classification"],
    supportedPredictionTypes: ["label", "probability", "probability_thresholded", "score"],
    capabilities: ["numerical_features", "categorical_features", "missing_values"],
    strengths: [
      "Consistently high predictive accuracy across diverse tabular problems",
      "Sophisticated regularization (L1/L2) preventing overfitting",
      "Supports monotonic constraints and custom loss functions",
    ],
    weaknesses: [
      "Slightly higher memory overhead than LightGBM",
      "Can require careful hyperparameter tuning for max performance",
    ],
    isBaseline: false,
    source: "builtin",
  },
  {
    modelId: "catboost_classifier",
    displayName: "CatBoost Classifier",
    algorithm: "Gradient Boosted Decision Trees (Oblivious Trees)",
    framework: "xgboost",
    supportedTasks: ["tabular_classification"],
    supportedSubTasks: ["binary_classification", "multiclass_classification"],
    supportedPredictionTypes: ["label", "probability", "probability_thresholded", "score"],
    capabilities: ["numerical_features", "categorical_features", "missing_values", "high_cardinality"],
    strengths: [
      "Best-in-class categorical feature support with target encoding",
      "Low susceptibility to overfitting due to symmetric trees",
      "Requires minimal hyperparameter tuning out of the box",
    ],
    weaknesses: [
      "Slower training time compared to LightGBM",
      "Larger model artifact size",
    ],
    isBaseline: false,
    source: "builtin",
  },
  {
    modelId: "random_forest_classifier",
    displayName: "Random Forest Classifier",
    algorithm: "Bootstrap Aggregated Decision Trees (Ensemble)",
    framework: "sklearn",
    supportedTasks: ["tabular_classification"],
    supportedSubTasks: ["binary_classification", "multiclass_classification"],
    supportedPredictionTypes: ["label", "probability", "score"],
    capabilities: ["numerical_features", "categorical_features"],
    strengths: [
      "Highly stable and resistant to overfitting",
      "Requires minimal feature scaling or normalization",
      "Provides interpretable feature importance rankings",
    ],
    weaknesses: [
      "Can be slow to predict on large test sets",
      "Cannot extrapolate beyond observed training range",
    ],
    isBaseline: false,
    source: "builtin",
  },
  {
    modelId: "logistic_regression",
    displayName: "Logistic Regression",
    algorithm: "Generalized Linear Model with Logit Link",
    framework: "sklearn",
    supportedTasks: ["tabular_classification"],
    supportedSubTasks: ["binary_classification", "multiclass_classification"],
    supportedPredictionTypes: ["label", "probability", "score"],
    capabilities: ["numerical_features"],
    strengths: [
      "Ideal linear baseline benchmark with instant training",
      "Fully interpretable coefficients and odds ratios",
      "Extremely low latency inference",
    ],
    weaknesses: [
      "Assumes linear decision boundaries between log-odds and features",
      "Cannot capture complex feature interactions without manual feature engineering",
    ],
    isBaseline: true,
    source: "builtin",
  },

  // --- Tabular Regression ---
  {
    modelId: "lightgbm_regressor",
    displayName: "LightGBM Regressor",
    algorithm: "Gradient Boosted Decision Trees (Leaf-wise Regression)",
    framework: "lightgbm",
    supportedTasks: ["tabular_regression"],
    supportedSubTasks: ["standard_regression"],
    supportedPredictionTypes: ["value", "point", "quantile"],
    capabilities: ["numerical_features", "categorical_features", "missing_values"],
    strengths: [
      "High speed on large continuous target datasets",
      "Supports quantile regression for prediction intervals",
      "Robust to outliers with Huber or L1 objectives",
    ],
    weaknesses: [
      "Prone to overfitting on small sample sizes without regularization",
    ],
    isBaseline: false,
    source: "builtin",
  },
  {
    modelId: "xgboost_regressor",
    displayName: "XGBoost Regressor",
    algorithm: "Extreme Gradient Boosting Regressor",
    framework: "xgboost",
    supportedTasks: ["tabular_regression"],
    supportedSubTasks: ["standard_regression"],
    supportedPredictionTypes: ["value", "point"],
    capabilities: ["numerical_features", "categorical_features", "missing_values"],
    strengths: [
      "Excellent tabular regression accuracy across diverse domains",
      "Strong regularization capabilities",
    ],
    weaknesses: [
      "Slower than LightGBM on large datasets",
    ],
    isBaseline: false,
    source: "builtin",
  },
  {
    modelId: "catboost_regressor",
    displayName: "CatBoost Regressor",
    algorithm: "Gradient Boosted Decision Trees Regressor",
    framework: "xgboost",
    supportedTasks: ["tabular_regression"],
    supportedSubTasks: ["standard_regression"],
    supportedPredictionTypes: ["value", "point"],
    capabilities: ["numerical_features", "categorical_features", "missing_values"],
    strengths: [
      "Exceptional accuracy on data with complex categorical interactions",
      "Robust default hyperparameters",
    ],
    weaknesses: [
      "Higher training time",
    ],
    isBaseline: false,
    source: "builtin",
  },
  {
    modelId: "random_forest_regressor",
    displayName: "Random Forest Regressor",
    algorithm: "Bootstrap Aggregated Decision Trees Regressor",
    framework: "sklearn",
    supportedTasks: ["tabular_regression"],
    supportedSubTasks: ["standard_regression"],
    supportedPredictionTypes: ["value", "point"],
    capabilities: ["numerical_features"],
    strengths: [
      "Robust baseline ensemble model requiring minimal tuning",
      "Handles non-linear relationships smoothly",
    ],
    weaknesses: [
      "Cannot extrapolate trends outside observed target bounds",
    ],
    isBaseline: false,
    source: "builtin",
  },
  {
    modelId: "linear_regression",
    displayName: "Linear Regression (OLS / Ridge)",
    algorithm: "Ordinary Least Squares / L2 Penalized Linear Model",
    framework: "sklearn",
    supportedTasks: ["tabular_regression"],
    supportedSubTasks: ["standard_regression"],
    supportedPredictionTypes: ["value", "point"],
    capabilities: ["numerical_features"],
    strengths: [
      "Standard transparent linear benchmark",
      "Instantaneous fitting and deterministic coefficient evaluation",
    ],
    weaknesses: [
      "Assumes strictly linear relationship",
      "Sensitive to multicollinearity and unscaled outliers",
    ],
    isBaseline: true,
    source: "builtin",
  },

  // --- Time Series Forecasting ---
  {
    modelId: "prophet",
    displayName: "Prophet",
    algorithm: "Additive Decomposable Time Series Model (Trend + Seasonality + Holidays)",
    framework: "prophet",
    supportedTasks: ["time_series_forecasting"],
    supportedSubTasks: ["univariate_forecasting", "multivariate_forecasting"],
    supportedPredictionTypes: ["value", "point", "interval"],
    capabilities: ["temporal_data", "seasonality", "holiday_effects", "missing_values"],
    strengths: [
      "Intuitive decomposition of multiple seasonalities (daily, weekly, yearly)",
      "Handles missing dates and regime shifts automatically",
      "Provides interpretable trend changepoints and uncertainty intervals",
    ],
    weaknesses: [
      "Can be slower on dense granular series (e.g. sub-hourly)",
      "Cannot easily learn complex cross-series panel interactions",
    ],
    isBaseline: false,
    source: "builtin",
  },
  {
    modelId: "arima",
    displayName: "AutoARIMA / SARIMAX",
    algorithm: "Autoregressive Integrated Moving Average with Exogenous Regressors",
    framework: "statsmodels",
    supportedTasks: ["time_series_forecasting"],
    supportedSubTasks: ["univariate_forecasting", "multivariate_forecasting"],
    supportedPredictionTypes: ["value", "point", "interval"],
    capabilities: ["temporal_data", "stationarity_transforms"],
    strengths: [
      "Standard classical statistical time series benchmark",
      "Strong theoretical foundation for stationary linear series",
      "Provides confidence intervals based on residual variance",
    ],
    weaknesses: [
      "Computationally heavy grid search for p, d, q order selection",
      "Poor scaling on high-dimensional multi-entity panel datasets",
    ],
    isBaseline: true,
    source: "builtin",
  },
  {
    modelId: "lightgbm_forecaster",
    displayName: "LightGBM Autoregressive Forecaster",
    algorithm: "Recursive / Direct Lag-based Gradient Boosted Panel Forecaster",
    framework: "lightgbm",
    supportedTasks: ["time_series_forecasting"],
    supportedSubTasks: ["univariate_forecasting", "multivariate_forecasting", "panel_forecasting"],
    supportedPredictionTypes: ["value", "point", "quantile"],
    capabilities: ["temporal_data", "panel_data", "exogenous_features", "lag_features", "categorical_features"],
    strengths: [
      "SOTA performance on multi-series and hierarchical panel demand datasets",
      "Simultaneously learns from cross-entity relationships and exogenous signals",
      "Fast training and scalable to millions of time steps",
    ],
    weaknesses: [
      "Requires explicit lag and rolling window feature construction",
    ],
    isBaseline: false,
    source: "builtin",
  },
];

export class ModelCapabilityRegistry {
  private models: Map<string, ModelDefinition> = new Map();

  constructor(initialModels: ModelDefinition[] = DEFAULT_BASE_MODELS) {
    for (const model of initialModels) {
      this.models.set(model.modelId.toLowerCase().trim(), model);
    }
  }

  /**
   * Registers or updates a model in the registry.
   * Useful for dynamically explored models (e.g. TimeGPT, Hugging Face models).
   */
  public registerModel(model: ModelDefinition): void {
    const id = model.modelId.toLowerCase().trim();
    this.models.set(id, {
      ...model,
      modelId: id,
    });
  }

  /**
   * Bulk registers dynamic models (e.g. loaded from PostgreSQL dynamic_model_registry).
   */
  public registerDynamicModels(models: ModelDefinition[]): void {
    for (const model of models) {
      this.registerModel({ ...model, isDynamic: true });
    }
  }

  public getModel(modelId: string): ModelDefinition | undefined {
    if (!modelId) return undefined;
    return this.models.get(modelId.toLowerCase().trim());
  }

  public isModelSupported(modelId: string): boolean {
    if (!modelId) return false;
    return this.models.has(modelId.toLowerCase().trim());
  }

  public getAllModels(): ModelDefinition[] {
    return Array.from(this.models.values());
  }

  /**
   * Deterministically filter candidate models by task, subtype, and prediction type.
   */
  public filterCandidates(criteria: {
    task?: MLTaskType;
    subtype?: MLTaskSubtype;
    predictionType?: MLPredictionType;
    excludedModelIds?: string[];
    preferredFrameworks?: string[];
  }): ModelDefinition[] {
    const excluded = new Set((criteria.excludedModelIds || []).map((id) => id.toLowerCase().trim()));
    const preferred = criteria.preferredFrameworks?.map((f) => f.toLowerCase().trim()) || [];

    return Array.from(this.models.values()).filter((model) => {
      // 1. Check exclusions
      if (excluded.has(model.modelId.toLowerCase().trim())) {
        return false;
      }

      // 2. Check task match
      if (criteria.task && !model.supportedTasks.includes(criteria.task)) {
        return false;
      }

      // 3. Check subtype match if provided
      if (criteria.subtype && model.supportedSubTasks?.length > 0) {
        if (!model.supportedSubTasks.includes(criteria.subtype)) {
          return false;
        }
      }

      // 4. Check prediction type if provided
      if (criteria.predictionType && model.supportedPredictionTypes?.length > 0) {
        if (!model.supportedPredictionTypes.includes(criteria.predictionType)) {
          return false;
        }
      }

      // 5. Check preferred frameworks if provided
      if (preferred.length > 0 && !preferred.includes(model.framework.toLowerCase())) {
        // We still keep it as alternative unless strictly excluded
      }

      return true;
    });
  }

  /**
   * Find baseline models compatible with the given task.
   */
  public getBaselinesForTask(task: MLTaskType): ModelDefinition[] {
    return Array.from(this.models.values()).filter(
      (m) => m.isBaseline && m.supportedTasks.includes(task)
    );
  }
}

// Export singleton instance initialized with default lean base models
export const defaultModelCapabilityRegistry = new ModelCapabilityRegistry();
