export type ValidationMode = "backtesting" | "future_prediction";

export type ValidationFrequency = "Weekly" | "Monthly" | "Yearly";

export interface MetricDetail {
  value: number | null;
  status: "available" | "unavailable" | "undefined";
  unit?: string;
  reason?: string;
}

export interface ModelValidationTotals {
  actualTotal: number | null;
  forecastTotal: number;
  difference: number | null;
  differencePercentage: number | null;
}

export interface ModelValidationChartData {
  dates: string[];
  actualSeries: Array<number | null>;
  predictedSeries: number[];
  residuals?: Array<number | null>;
}

export interface CandidateModelValidationRun {
  model_id: string;
  displayName: string;
  framework: string;
  status: "Completed" | "Failed";
  score?: number;
  primaryMetricName?: string;
  metrics: Record<string, MetricDetail>;
  totals: ModelValidationTotals;
  chartData: ModelValidationChartData;
  evaluationRecordCount: number;
  actualDataCoverage: number | null; // 0 - 100 percentage
  modelArtifactPath?: string;
  error?: string;
}

export interface ModelValidationReport {
  validation_run_id: string;
  project_id: string;
  mode: ValidationMode;
  prediction_objective_start_date: string;
  prediction_objective_horizon: number;
  prediction_objective_frequency: ValidationFrequency;
  time_column: string;
  target_column: string;
  entity_column?: string | null;
  problem_type: string;
  dataset_reference: string;
  dataset_schema_version?: string;
  evaluation_period: {
    start_date: string;
    end_date: string;
  };
  coverage_percentage: number | null;
  champion_model_id: string;
  models: Record<string, CandidateModelValidationRun>;
  ranked_models: CandidateModelValidationRun[];
  warnings: string[];
  created_at: string;
}

export interface ModelValidationAgentOutput {
  status: "Completed" | "Failed" | "Ready";
  summary: string;
  phase: "Model Validation";
  projectDirectory: string;
  validationDirectory: string;
  mode: ValidationMode;
  predictionObjectiveStartDate: string;
  predictionObjectiveHorizon: number;
  predictionObjectiveFrequency: ValidationFrequency;
  report?: ModelValidationReport;
  candidates: CandidateModelValidationRun[];
  championModel?: CandidateModelValidationRun;
  predictionsArtifact?: string;
  reportArtifact?: string;
  warnings?: string[];
  error?: string;
}
