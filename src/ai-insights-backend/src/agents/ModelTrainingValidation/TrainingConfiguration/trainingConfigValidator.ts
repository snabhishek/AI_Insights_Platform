export interface DatasetCharacteristics {
  datasetName: string;
  datasetPath?: string;
  rowCount: number;
  columnCount: number;
  targetColumn: string;
  problemType: string;
  isClassification: boolean;
  isTemporal: boolean;
  timeColumn: string | null;
  features: string[];
  classImbalance: {
    detected: boolean;
    ratio: number | null;
    distribution?: Record<string, number>;
  };
}

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
}

export class TrainingConfigValidator {
  private static readonly VALID_TASK_TYPES = [
    "classification",
    "regression",
    "clustering",
    "ranking",
    "forecasting",
  ];

  private static readonly VALID_SPLIT_STRATEGIES = [
    "random",
    "stratified",
    "temporal",
    "stratified_temporal",
    "group",
  ];

  private static readonly VALID_HPO_METHODS = [
    "bayesian",
    "random",
    "grid",
    "hyperband",
  ];

  public static validate(config: any): ValidationResult {
    const errors: string[] = [];
    if (!config || typeof config !== "object") {
      return { isValid: false, errors: ["Configuration output is empty or not a valid object"] };
    }

    const conf = config.configuration || config;

    const metricName = conf["x-primary-metric-name"] || conf.primary_metric_name;
    if (!metricName || typeof metricName !== "string" || metricName.trim().length === 0) {
      errors.push("Missing required 'x-primary-metric-name'");
    }

    const metricDef = conf["x-primary-metric-def"];
    if (!metricDef || typeof metricDef !== "object") {
      errors.push("Missing required 'x-primary-metric-def' section");
    } else {

      if (metricDef.value && metricName && metricDef.value.toLowerCase() !== metricName.toLowerCase()) {
        errors.push(`'x-primary-metric-def.value' ("${metricDef.value}") must match 'x-primary-metric-name' ("${metricName}")`);
      }
    }

    if (!conf.task || typeof conf.task !== "object") {
      errors.push("Missing required 'task' section");
    } else {
      if (!conf.task.task_type || typeof conf.task.task_type !== "string" || !conf.task.task_type.trim()) {
        errors.push("Missing required 'task.task_type'");
      }
      if (!conf.task.prediction_type || typeof conf.task.prediction_type !== "string" || !conf.task.prediction_type.trim()) {
        errors.push("Missing required 'task.prediction_type'");
      }
    }

    if (!conf.split || typeof conf.split !== "object") {
      errors.push("Missing required 'split' section");
    } else {
      const strategy = conf.split.strategy;
      if (!strategy || typeof strategy !== "string") {
        errors.push("Missing required 'split.strategy'");
      }
      if (conf.split.train_ratio !== undefined || conf.split.validation_ratio !== undefined || conf.split.test_ratio !== undefined) {
        const train = Number(conf.split.train_ratio ?? 0);
        const val = Number(conf.split.validation_ratio ?? 0);
        const test = Number(conf.split.test_ratio ?? 0);
        const sum = train + val + test;
        if (Math.abs(sum - 1.0) > 0.02) {
          errors.push(`Split ratios (train: ${train}, val: ${val}, test: ${test}) must sum to 1.0 (current sum: ${sum.toFixed(3)})`);
        }
      } else if (strategy !== "temporal" && !conf.split.split_date) {
        errors.push("Missing split ratios (train_ratio, validation_ratio, test_ratio) summing to 1.0");
      }
    }

    if (!conf.objective || typeof conf.objective !== "object") {
      errors.push("Missing required 'objective' section");
    } else {
      if (!conf.objective.optimization_metric) {
        errors.push("Missing required 'objective.optimization_metric'");
      }
      if (!conf.objective.direction || !["maximize", "minimize"].includes(String(conf.objective.direction).toLowerCase())) {
        errors.push("Missing or invalid 'objective.direction' ('maximize' or 'minimize')");
      }
    }

    if (!conf.evaluation || typeof conf.evaluation !== "object") {
      errors.push("Missing required 'evaluation' section");
    } else {
      if (!conf.evaluation.primary_metric) {
        errors.push("Missing required 'evaluation.primary_metric'");
      }
    }

    if (!conf.model_selection || typeof conf.model_selection !== "object") {
      errors.push("Missing required 'model_selection' section");
    } else {
      const candidates = conf.model_selection.candidates;
      if (!Array.isArray(candidates) || candidates.length === 0) {
        errors.push("Missing or empty 'model_selection.candidates' array");
      }

      const models = conf.model_selection.models;
      if (!Array.isArray(models) || models.length === 0) {
        errors.push("Missing or empty 'model_selection.models' array");
      } else {
        models.forEach((m: any, idx: number) => {
          if (!m.model_id) errors.push(`model_selection.models[${idx}] missing model_id`);
          if (!m.framework) errors.push(`model_selection.models[${idx}] missing framework`);
          if (!m.algorithm) errors.push(`model_selection.models[${idx}] missing algorithm`);
        });
      }
    }

    if (!conf.hyperparameter_optimization || typeof conf.hyperparameter_optimization !== "object") {
      errors.push("Missing required 'hyperparameter_optimization' section");
    } else {
      if (!conf.hyperparameter_optimization.method) {
        errors.push("Missing required 'hyperparameter_optimization.method'");
      }
    }

    if (!conf.search_space || typeof conf.search_space !== "object" || Object.keys(conf.search_space).length === 0) {
      errors.push("Missing required 'search_space' hyperparameter distributions");
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }
}
