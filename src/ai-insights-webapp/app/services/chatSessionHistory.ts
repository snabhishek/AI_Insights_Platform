import type { ChatSession } from "../components/chat/types";

// The database identity is (project_id, id), including for legacy conversations
// whose raw IDs were reused when their project was changed.
export function chatSessionKey(session: Pick<ChatSession, "projectId" | "id">): string {
  return JSON.stringify([session.projectId ?? null, session.id]);
}

export function normalizeChatSessions(sessions: ChatSession[]): ChatSession[] {
  const byKey = new Map<string, ChatSession>();
  for (const session of sessions) {
    const key = chatSessionKey(session);
    const existing = byKey.get(key);
    if (!existing || Date.parse(session.updatedAt) > Date.parse(existing.updatedAt)) {
      byKey.set(key, session);
    }
  }
  return [...byKey.values()];
}

export function mergeChatSessionHistory(
  current: ChatSession[],
  saved: ChatSession[],
  activeRequest?: { projectId: string; conversationId: string } | null,
): ChatSession[] {
  const currentByKey = new Map(normalizeChatSessions(current).map(session => [chatSessionKey(session), session]));
  const activeKey = activeRequest ? chatSessionKey({ projectId: activeRequest.projectId, id: activeRequest.conversationId }) : null;
  const result = normalizeChatSessions(saved).map(session => {
    const key = chatSessionKey(session);
    const local = currentByKey.get(key);
    currentByKey.delete(key);
    // An in-flight response must not be replaced by an older database snapshot.
    return key === activeKey && local ? local : session;
  });
  return [...result, ...currentByKey.values()];
}

export function resolveActiveSessionKey(sessions: ChatSession[], storedKey: string | null): string {
  // Older clients saved only the raw ID. Migrate that selection once, then save
  // the complete key so navigation restores the right project and transcript.
  const selected = sessions.find(session => chatSessionKey(session) === storedKey)
    ?? sessions.find(session => session.id === storedKey)
    ?? sessions[0];
  return selected ? chatSessionKey(selected) : "";
}

export function createChatSession(projectId: string, projectName: string | undefined, agentPersona: ChatSession["agentPersona"]): ChatSession {
  const timestamp = new Date().toISOString();
  return {
    id: `session-${crypto.randomUUID()}`,
    title: "New AI Inquiry",
    createdAt: timestamp,
    updatedAt: timestamp,
    projectId,
    projectName,
    agentPersona,
    messages: [],
  };
}
