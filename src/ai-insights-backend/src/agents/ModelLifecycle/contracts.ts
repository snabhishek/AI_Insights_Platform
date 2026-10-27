export type LifecycleRunStatus = "Completed" | "Failed" | "Partial";

export type CandidateRunStatus = "Completed" | "Failed" | "Skipped";

export interface CandidateOutcome {
  modelId: string;
  status: CandidateRunStatus;
  failureCount: number;
  summary: string;
  metrics?: Record<string, unknown>;
  qualityAssessment?: string;
  qualityRecommendations?: string[];
}

export interface LifecycleAssessment {
  action:
    | "accept"
    | "diagnose"
    | "improve_quality"
    | "skip_candidate"
    | "terminal_failure";
  rationale: string;
  candidateId?: string;
  metricsValid?: boolean;
  modelQuality?: "good" | "needs_improvement" | "undetermined";
  recommendations?: string[];
}

export interface LifecycleInput {
  projectId: string;
  workspaceName: string;
  projectName: string;
  runTimestamp: string;
  projectDirectory: string;
  additionalProjectDirectories?: string[];
  context: Record<string, unknown>;
  selectedModels: string[];
  abortSignal?: AbortSignal;
  services?: any;
}

export interface LifecycleExecutionPlan {
  service: string;
  command: string[];
  reportPath?: string;
}

export interface LifecycleExecutionResult {
  success: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  logFilePath?: string;
}

export interface LifecycleRunResult {
  status: LifecycleRunStatus;
  summary: string;
  projectDirectory: string;
  candidates: CandidateOutcome[];
  qualityRecommendations: string[];
  championCandidateId?: string;
  candidateRankings?: string[];
  execution?: LifecycleExecutionResult;
  assessment?: LifecycleAssessment;
}
