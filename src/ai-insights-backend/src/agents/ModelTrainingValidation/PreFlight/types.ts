export type PreFlightDecisionStatus =
  | "APPROVED"
  | "APPROVED_WITH_WARNINGS"
  | "REQUIRES_CONFIGURATION_CHANGE"
  | "REQUIRES_USER_CONFIRMATION"
  | "BLOCKED"
  | "FAILED";

export type CheckStatus = "PASSED" | "WARNING" | "FAILED" | "SKIPPED";

export interface PreFlightCheck {
  id: string;
  stage: number;
  stageName: string;
  category: string;
  name: string;
  status: CheckStatus;
  details: string;
  metric?: string;
  remediation?: string;
}

export interface GPUInfo {
  index: number;
  name: string;
  total_vram_gb: number;
  free_vram_gb: number;
}

export interface SystemHardwareSnapshot {
  os_name: string;
  architecture: string;
  cpu_physical: number;
  cpu_logical: number;
  ram_total_gb: number;
  ram_available_gb: number;
  disk_free_gb: number;
  gpus: GPUInfo[];
  warnings: string[];
}

export interface ResourceEstimations {
  ram_gb: number | null;
  vram_gb: number | null;
  disk_gb: number | null;
  training_time_seconds: number | null;
  model_size_mb: number | null;
  confidence: "high" | "medium" | "low" | "insufficient_data";
  source: "measured" | "calculated" | "heuristic" | "insufficient_data";
  bottleneck: string;
  warnings: string[];
}

export interface OptimizationRecommendation {
  id: string;
  name: string;
  category: string;
  priority: "CRITICAL" | "RECOMMENDED" | "OPTIONAL";
  currentValue?: any;
  proposedValue?: any;
  reason: string;
  expectedImpact: string;
}

export interface PreFlightReport {
  decision: PreFlightDecisionStatus;
  status: "Completed" | "Failed" | "Requires Attention";
  summary: string;
  verifiedAt: string;
  modelCount: number;
  frameworks: string[];
  system: SystemHardwareSnapshot;
  estimates: ResourceEstimations;
  checks: PreFlightCheck[];
  recommendations: OptimizationRecommendation[];
  pythonServiceStatus: "online" | "fallback_cli" | "unavailable";
  rawPipelineResult?: any;
}
