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

  /**
   * Validates an arbitrary configuration object against TrainingJobContract rules.
   * Acts as both gatekeeper and feedback generator for validateWithRetry.
   */
  public static validate(config: any): ValidationResult {
    const errors: string[] = [];
    if (!config || typeof config !== "object") {
      return { isValid: false, errors: ["Configuration output is empty or not a valid object"] };
    }

    const conf = config.configuration || config;

    // 1. Check primary metric
    const metric = conf["x-primary-metric-name"] || conf.primary_metric_name || conf.objective?.optimization_metric;
    if (!metric || typeof metric !== "string" || metric.trim().length === 0) {
      errors.push("Missing primary metric name ('x-primary-metric-name' or 'primary_metric_name')");
    }

    // 2. Check split configuration and ratios
    if (conf.split) {
      const train = Number(conf.split.train_ratio ?? 0);
      const val = Number(conf.split.validation_ratio ?? 0);
      const test = Number(conf.split.test_ratio ?? 0);
      const sum = train + val + test;
      if (Math.abs(sum - 1.0) > 0.02) {
        errors.push(`Split ratios (train: ${train}, val: ${val}, test: ${test}) must sum to 1.0 (current sum: ${sum.toFixed(3)})`);
      }
      if (conf.split.strategy && !TrainingConfigValidator.VALID_SPLIT_STRATEGIES.includes(conf.split.strategy)) {
        errors.push(`Invalid split strategy '${conf.split.strategy}'. Expected one of: ${TrainingConfigValidator.VALID_SPLIT_STRATEGIES.join(", ")}`);
      }
    } else {
      errors.push("Missing required 'split' section");
    }

    // 3. Check task definition
    if (!conf.task || !conf.task.task_type) {
      errors.push("Missing required 'task' section with 'task.task_type'");
    } else if (!TrainingConfigValidator.VALID_TASK_TYPES.includes(String(conf.task.task_type).toLowerCase())) {
      errors.push(`Invalid task_type '${conf.task.task_type}'. Expected one of: ${TrainingConfigValidator.VALID_TASK_TYPES.join(", ")}`);
    }

    // 4. Check hyperparameter optimization
    if (!conf.hyperparameter_optimization) {
      errors.push("Missing required 'hyperparameter_optimization' section");
    } else if (conf.hyperparameter_optimization.method && !TrainingConfigValidator.VALID_HPO_METHODS.includes(conf.hyperparameter_optimization.method)) {
      errors.push(`Invalid HPO method '${conf.hyperparameter_optimization.method}'. Expected one of: ${TrainingConfigValidator.VALID_HPO_METHODS.join(", ")}`);
    }

    // 5. Check search space
    if (!conf.search_space || typeof conf.search_space !== "object" || Object.keys(conf.search_space).length === 0) {
      errors.push("Missing required 'search_space' hyperparameter distributions");
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }
}
