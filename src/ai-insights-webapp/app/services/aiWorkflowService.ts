import { BACKEND_URL } from "../components/providers/AppContext";

export interface WorkflowRequestPayload {
  connectorId: string[];
  userPrompt?: string;
  projectId?: string;
  sessionId?: string;
  action?: "approve" | "retry" | "resume";
  step?: string;
  splitDate?: string;
  splitEndDate?: string;
  selectedModels?: string[];
  predictionHorizon?: number;
  predictionFrequency?: string;
  predictionObjectiveStartDate?: string;
}

export interface WorkflowResponseData {
  status: string;
  summary: string;
  stageStatuses?: Record<string, string>;
  stageOutputs?: Record<string, unknown>;
  agentThinking?: Record<string, Array<{ time: string; text: string; done: boolean }>>;
  sessionId?: string;
  requiresApproval?: boolean;
  nextStep?: string;
  currentNode?: string;
  currentStage?: string;
  message?: string;
  runTimestamp?: string;
}

export interface WorkflowApiResponse {
  success: boolean;
  data: WorkflowResponseData;
}

export async function executeWorkflowApi(
  payload: WorkflowRequestPayload,
  signal?: AbortSignal
): Promise<Response> {
  const res = await fetch(`${BACKEND_URL}/ai/ingestion`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });

  if (!res.ok) {
    if (res.status === 409) {
      const errData = await res.json().catch(() => ({}));
      const error = new Error(
        errData.message ||
        "Another pipeline is currently running and wait until the current progress is completed to run the workflow."
      );
      (error as any).status = 409;
      throw error;
    }
    throw new Error(`Workflow request failed with status ${res.status}`);
  }

  return res;
}

export async function fetchActiveWorkflowApi(): Promise<{
  success: boolean;
  data: { active: boolean; projectId?: string | null; sessionId?: string | null; status?: string };
}> {
  try {
    const res = await fetch(`${BACKEND_URL}/ai/active`);
    if (res.ok) return await res.json();
  } catch (e) {
    console.warn("Failed to check active workflow:", e);
  }
  return { success: false, data: { active: false, projectId: null, sessionId: null, status: "idle" } };
}

export async function pauseWorkflowApi(sessionId?: string, projectId?: string): Promise<void> {
  if (!sessionId && !projectId) return;

  await fetch(`${BACKEND_URL}/ai/ingestion/pause`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, projectId }),
  }).catch((err) => {
    console.warn("Failed to notify backend of workflow pause:", err);
  });
}

export async function stopWorkflowApi(sessionId?: string, projectId?: string): Promise<void> {
  if (!sessionId && !projectId) return;

  await fetch(`${BACKEND_URL}/ai/ingestion/stop`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, projectId }),
  }).catch((err) => {
    console.warn("Failed to notify backend of workflow stop:", err);
  });
}

export async function fetchAgentThinkingApi(
  projectId: string,
  pipeline: string,
  substep: string
): Promise<{ success: boolean; data?: { thinking: Array<{ time: string; text: string; done: boolean }> } }> {
  const url = `${BACKEND_URL}/ai/thinking?projectId=${encodeURIComponent(projectId)}&pipeline=${encodeURIComponent(pipeline)}&substep=${encodeURIComponent(substep)}`;
  const res = await fetch(url, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) {
    if (res.status === 404) return { success: true };
    throw new Error(`Failed to fetch agent thinking: ${res.statusText}`);
  }
  return res.json();
}

export async function fetchProjectThinkingApi(
  projectId: string,
  pipeline?: string
): Promise<{ success: boolean; data?: { agentThinking: Record<string, Array<{ time: string; text: string; done: boolean }>> } }> {
  let url = `${BACKEND_URL}/ai/thinking?projectId=${encodeURIComponent(projectId)}`;
  if (pipeline) {
    url += `&pipeline=${encodeURIComponent(pipeline)}`;
  }
  const res = await fetch(url, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) {
    if (res.status === 404) return { success: true };
    throw new Error(`Failed to fetch project thinking: ${res.statusText}`);
  }
  return res.json();
}
