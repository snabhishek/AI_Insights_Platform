import { BACKEND_URL } from "../components/providers/AppContext";

export interface WorkflowRequestPayload {
  connectorId: string[];
  userPrompt?: string;
  projectId?: string;
  sessionId?: string;
  action?: "approve" | "retry";
  step?: string;
}

export interface WorkflowResponseData {
  status: string;
  summary: string;
  stageStatuses?: Record<string, string>;
  stageOutputs?: Record<string, unknown>;
  sessionId?: string;
  requiresApproval?: boolean;
  nextStep?: string;
  currentNode?: string;
  currentStage?: string;
  message?: string;
}

export interface WorkflowApiResponse {
  success: boolean;
  data: WorkflowResponseData;
}

/**
  Executes or resumes an AI ingestion workflow.
 */
export async function executeWorkflowApi(
  payload: WorkflowRequestPayload,
  signal?: AbortSignal
): Promise<WorkflowApiResponse> {
  const res = await fetch(`${BACKEND_URL}/ai/ingestion`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });

  if (!res.ok) {
    throw new Error(`Workflow request failed with status ${res.status}`);
  }

  return (await res.json()) as WorkflowApiResponse;
}

/**
  Signals the backend to cancel/stop an active AI workflow session.
 */
export async function stopWorkflowApi(sessionId?: string): Promise<void> {
  if (!sessionId) return;

  await fetch(`${BACKEND_URL}/ai/ingestion/stop`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId }),
  }).catch((err) => {
    console.warn("Failed to notify backend of workflow stop:", err);
  });
}
