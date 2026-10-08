import { ChatMessage, ChatSession, AgentPersonaId, ThinkingStep } from "../components/chat/types";
import { INITIAL_CHAT_SESSIONS } from "../components/chat/constants";
import { Project, DataSource, BACKEND_URL } from "../components/providers/AppContext";

const CHAT_STORAGE_KEY = "ai_insights_chat_sessions_v1";
const ACTIVE_SESSION_ID_KEY = "ai_insights_active_session_id_v1";

export function loadSavedChatSessions(): ChatSession[] {
  if (typeof window === "undefined") return INITIAL_CHAT_SESSIONS;
  try {
    const raw = localStorage.getItem(CHAT_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch (err) {
    console.warn("Failed to parse saved chat sessions:", err);
  }
  return INITIAL_CHAT_SESSIONS;
}

export function saveChatSessions(sessions: ChatSession[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(sessions));
  } catch (err) {
    console.warn("Failed to persist chat sessions:", err);
  }
}

export function loadActiveSessionId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(ACTIVE_SESSION_ID_KEY);
}

export function saveActiveSessionId(id: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(ACTIVE_SESSION_ID_KEY, id);
}

export async function generateAgentChatResponse(
  userQuery: string,
  personaId: AgentPersonaId,
  selectedProject?: Project | null,
  _allProjects: Project[] = [],
  _allDataSources: DataSource[] = [],
  onThinkingUpdate?: (thinking: ThinkingStep[]) => void,
  executionState?: Record<string, any>,
  conversationHistory?: Array<{ role: string; content: string }>,
  conversationId?: string,
  interactionId?: string
): Promise<Partial<ChatMessage>> {
  if (!selectedProject?.id) {
    return {
      role: "assistant", status: "error", isThinking: false,
      content: "Select a project so Sparrow can answer using its data and models.",
    };
  }
  onThinkingUpdate?.([{ time: "00:01", text: "Connecting to Sparrow...", done: false }]);
  const res = await fetch(`${BACKEND_URL}/chat/message`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userQuery, projectId: selectedProject.id, conversationId, conversationHistory, executionState, interactionId }),
  });
  if (!res.ok) throw new Error(`Sparrow could not process the request (HTTP ${res.status}). Please try again.`);
  const json = await res.json();
  if (!json.success || !json.data) throw new Error(json.error || "Sparrow returned an invalid response.");
  const data = json.data;
  if (data.status === "error") throw new Error(data.error || data.content);
  const thinking: ThinkingStep[] = Array.isArray(data.thinking) ? data.thinking : [];
  onThinkingUpdate?.(thinking);
  return {
    role: "assistant", content: data.content,
    timestamp: new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
    thinking, isThinking: false, agentId: personaId, agentName: "Sparrow", agentBadge: "Insights Agent",
    metricCards: data.metricCards, tables: data.tables,
    chart: Array.isArray(data.chart) ? data.chart[0] : data.chart,
    suggestedActions: data.suggestedActions, clarification: data.clarification,
    interaction: data.interaction, serverNow: data.serverNow,
    serverClockOffset: data.serverNow ? Date.parse(data.serverNow) - Date.now() : undefined,
    executionState: data.executionState, status: data.status,
  };
}

export async function getChatInteraction(projectId: string, conversationId: string): Promise<Partial<ChatMessage>> {
  const query = new URLSearchParams({ projectId, conversationId });
  const response = await fetch(`${BACKEND_URL}/chat/interaction?${query}`);
  const json = await response.json();
  if (!response.ok || !json.success) throw new Error(json.error || "Could not retrieve the saved interaction.");
  return { ...json.data, chart: Array.isArray(json.data.chart) ? json.data.chart[0] : json.data.chart,
    serverClockOffset: json.data.serverNow ? Date.parse(json.data.serverNow) - Date.now() : undefined };
}
