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

export type ModelFramework = string;

export interface ModelSourceTypeRecord {
  id: string;
  name: string;
  description?: string | null;
  createdAt?: string;
}

export interface ModelSourceProviderRecord {
  id: string;
  name: string;
  sourceTypeId: string;
  baseUrl?: string | null;
  metadata?: Record<string, unknown>;
  createdAt?: string;
}

export interface ModelSourceMetadata {
  sourceTypeId: string;
  sourceType?: string;
  sourceProviderId?: string | null;
  source: string;
  repositoryUrl?: string | null;
  repositoryId?: string | null;
  version?: string | null;
  license?: string | null;
  discoveredAt?: string;
  provider?: string | null;
}

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
  source_type_id?: string;
  source_type?: string;
  source_provider_id?: string | null;
  source?: string;
  repository_url?: string | null;
  repository_id?: string | null;
  version?: string | null;
  license?: string | null;
  discovered_at?: string;
}

export interface RecommendedModel {
  model_id: string;
  rank: number;
  suitability_score: number;
  recommendation: "primary";
  displayName?: string;
  reasoning?: ModelCandidateReasoning;
  source_type_id?: string;
  source_type?: string;
  source_provider_id?: string | null;
  source?: string;
  repository_url?: string | null;
  repository_id?: string | null;
  version?: string | null;
  license?: string | null;
  discovered_at?: string;
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
  source?: string;
  source_type?: string;
  repository_url?: string | null;
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
  problem_type?: string;
  task_type?: string;
  task_subtype?: string;
  prediction_type?: string;
  primary_metric?: string;
  direction?: "maximize" | "minimize";
  secondary_metrics?: string[];
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
  framework: string;
  supportedTasks: (MLTaskType | string)[];
  supportedSubTasks: (MLTaskSubtype | string)[];
  supportedPredictionTypes: (MLPredictionType | string)[];
  capabilities: string[];
  strengths: string[];
  weaknesses: string[];
  isBaseline: boolean;
  isDynamic?: boolean;
  sourceTypeId?: string;
  sourceType?: string;
  sourceProviderId?: string | null;
  source?: string;
  repositoryUrl?: string | null;
  repositoryId?: string | null;
  version?: string | null;
  license?: string | null;
  discoveredAt?: string;
  updatedAt?: string;
  modalities?: string[];
  benchmarkResults?: Record<string, unknown>;
  suitabilityDetails?: Record<string, unknown>;
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
