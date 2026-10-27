import { BACKEND_URL } from "../components/providers/AppContext";

export interface LifecycleCandidateResult {
  modelId: string;
  status: "Completed" | "Failed" | "Skipped";
  failureCount: number;
  summary: string;
  metrics?: Record<string, unknown>;
  qualityAssessment?: string;
  qualityRecommendations?: string[];
}

export interface LifecycleRunResult {
  status: "Completed" | "Failed" | "Partial";
  summary: string;
  projectDirectory: string;
  candidates: LifecycleCandidateResult[];
  qualityRecommendations: string[];
  championCandidateId?: string;
  candidateRankings?: string[];
}

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  message?: string;
}

interface LifecycleApprovalResponse {
  approved: boolean;
  status?: string;
  summary?: string;
  result?: LifecycleRunResult;
}

export async function approvePendingModelLifecycle(
  projectId: string,
  approved: boolean
): Promise<LifecycleApprovalResponse> {
  const response = await fetch(`${BACKEND_URL}/model-lifecycle/${encodeURIComponent(projectId)}/approval`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ approved }),
  });
  const result = await response.json() as ApiResponse<LifecycleApprovalResponse>;
  if (!response.ok || !result.success || result.data === undefined) {
    throw new Error(result.message || "Model lifecycle approval request failed.");
  }
  return result.data;
}
