export interface CandidateModelRun {
  model_id: string;
  displayName?: string;
  framework?: string;
  status: "Completed" | "Failed";
  durationSeconds?: number;
  validationMetrics?: Record<string, number>;
  testMetrics?: Record<string, number>;
  score?: number;
  error?: string;
  artifact?: string;
  plots?: Record<string, string>;
}

export interface ModelTrainingReport {
  problemType: string;
  targetColumn: string;
  rowCount?: number;
  featureCount?: number;
  splits?: { train: number; validation: number; test: number };
  selectedModel?: string;
  selectedModelArtifact?: string;
  validationMetrics?: Record<string, number>;
  runs: CandidateModelRun[];
  comparisonPlots?: Record<string, string>;
}

export interface ModelTrainingAgentOutput {
  status: "Completed" | "Failed" | "Requires Attention";
  summary: string;
  phase: "Model Training";
  projectDirectory: string;
  report?: ModelTrainingReport;
  candidates: CandidateModelRun[];
  rankedCandidates: CandidateModelRun[];
  selectedModel?: string;
  selectedModelArtifact?: string;
  validationMetrics?: Record<string, number>;
  plots?: Record<string, string>;
  filesCreated?: string[];
  executionLogs?: string;
  hasDateColumn?: boolean;
  dateColumnName?: string;
}
