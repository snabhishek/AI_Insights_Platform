export type ModelSelectionStatus =
  | "READY"
  | "NEEDS_CLARIFICATION"
  | "UNSUPPORTED"
  | "INVALID_DATA";

export type MLTaskType =
  | "tabular_classification"
  | "tabular_regression"
  | "time_series_forecasting"
  | "clustering"
  | "anomaly_detection";

export type MLTaskSubtype =
  | "binary_classification"
  | "multiclass_classification"
  | "standard_regression"
  | "univariate_forecasting"
  | "multivariate_forecasting"
  | "panel_forecasting"
  | "unsupervised_clustering"
  | "outlier_detection";

export type MLPredictionType =
  | "label"
  | "probability"
  | "probability_thresholded"
  | "score"
  | "value"
  | "point"
  | "interval"
  | "quantile";

export type MLLearningType = "supervised" | "unsupervised" | "semi_supervised";

export type ModelFramework =
  | "xgboost"
  | "lightgbm"
  | "sklearn"
  | "pytorch"
  | "tensorflow"
  | "prophet"
  | "statsmodels"
  | "nixtla"
  | "custom";

export interface TargetEntitySpec {
  name: string | null;
  datatype: "boolean" | "categorical" | "numeric" | null;
  description: string | null;
  source: string | null;
}

export interface PredictionGrainSpec {
  entity: string;
  keys: string[];
  frequency: string | null;
}

export interface ModelCandidateReasoning {
  strengths: string[];
  weaknesses: string[];
  suitability: string[];
}

export interface ModelSelectionCandidate {
  model_id: string;
  displayName?: string;
  framework?: string;
  algorithm?: string;
  rank: number;
  suitability_score: number;
  recommendation: "primary" | "alternative";
  reasoning: ModelCandidateReasoning;
}

export interface RecommendedModel {
  model_id: string;
  rank: number;
  suitability_score: number;
  recommendation: "primary";
  displayName?: string;
  reasoning?: ModelCandidateReasoning;
}

export interface TrainingStrategySpec {
  mode: "automl_search" | "single_model" | "ensemble";
  baseline_model: string | null;
  ensemble: {
    enabled: boolean;
    strategy: "stacking" | "voting" | "blending" | null;
  };
  random_seed: number;
  early_stopping: {
    enabled: boolean;
    patience: number | null;
    metric: string;
  };
}

export interface ModelConfigItem {
  model_id: string;
  framework: string;
  algorithm: string;
  enabled: boolean;
  parameters: Record<string, unknown>;
}

export interface FeatureRequirement {
  feature: string;
  requirement: string;
  reason: string;
  priority?: "required" | "recommended" | "optional";
}

export interface HPORecommendation {
  recommended: boolean;
  approach: "grid_search" | "random_search" | "bayesian_optimization" | "hyperband" | "none";
  rationale: string;
  suggestedSearchBudget?: {
    maxTrials?: number;
    timeoutMinutes?: number;
  };
}

export interface ModelSelectionDecision {
  status: ModelSelectionStatus;
  target_entity: TargetEntitySpec;
  derivation: string | null;
  positive_class: string | null;
  negative_class: string | null;
  prediction_grain: PredictionGrainSpec;
  prediction_horizon?: string | null;
  recommended_model: RecommendedModel;
  candidates: ModelSelectionCandidate[];
  primary_metric?: string;
  direction?: "maximize" | "minimize";
  tie_breakers?: string[];
  constraints?: Record<string, unknown>;
  selection_strategy?: string;
  training: TrainingStrategySpec;
  max_training_time: string | null;
  model_selection_strategy: string;
  models: ModelConfigItem[];
  featureRequirements?: FeatureRequirement[];
  hyperparameterOptimization?: HPORecommendation;
  assumptions?: string[];
  confidence: {
    score: number;
    rationale: string;
  };
}

export interface ModelDefinition {
  modelId: string;
  displayName: string;
  algorithm: string;
  framework: ModelFramework;
  supportedTasks: MLTaskType[];
  supportedSubTasks: MLTaskSubtype[];
  supportedPredictionTypes: MLPredictionType[];
  capabilities: string[];
  strengths: string[];
  weaknesses: string[];
  isBaseline: boolean;
  isDynamic?: boolean;
  source?: "builtin" | "web_search" | "user" | "huggingface";
  defaultParameters?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface ModelSelectionContext {
  businessContext: {
    useCase?: string;
    domain?: string;
    subDomain?: string;
    predictionGoal?: string;
    businessProblem?: string;
    latencyConstraintMs?: number;
    interpretabilityPriority?: "high" | "medium" | "low";
  };
  dataContext: {
    rowCount?: number;
    columnCount?: number;
    targetColumn?: string;
    candidateTargets?: string[];
    temporalColumn?: string;
    dateGrain?: string;
    missingValueRate?: number;
    columns?: Array<{
      name: string;
      type: string;
      nunique?: number;
      sampleValues?: unknown[];
    }>;
  };
  featureContext: {
    candidateFeatures?: string[];
    categoricalFeatures?: string[];
    numericalFeatures?: string[];
    timeIndex?: string;
    entityKeys?: string[];
    engineeredFeatureTypes?: string[];
    datasetPath?: string;
  };
  modelContext?: {
    preferredFrameworks?: string[];
    excludedModels?: string[];
    maxModelsToRank?: number;
  };
  additionalContext?: Record<string, unknown>;
}

export interface UserSelectionHandoff {
  selectedModelIds: string[];
  confirmedAt: string;
}

export interface ModelSelectionDecisionRecord {
  id: string;
  projectId: string;
  useCase?: string;
  status: ModelSelectionStatus;
  datasetVersion?: string;
  featureSetVersion?: string;
  modelCatalogVersion: string;
  promptVersion: string;
  agentVersion: string;
  llmProvider?: string;
  llmModel?: string;
  executionDurationMs?: number;
  candidateCount: number;
  primaryModelId: string;
  inputContextSnapshot: ModelSelectionContext;
  decision: ModelSelectionDecision;
  userSelection?: UserSelectionHandoff;
  isStale: boolean;
  createdAt: string;
  updatedAt: string;
}
