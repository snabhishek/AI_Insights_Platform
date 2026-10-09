import { Pool } from "pg";
import { SparrowChatResponse, SparrowThinkingStep } from "../agents/sparrow/types";

export interface ChatTurnIdentity { projectId: string; conversationId: string; requestId: string; messageId: string }
export interface StoredChatTurn extends ChatTurnIdentity {
  userQuery: string; userMessageId: string; userContent?: string;
  session?: { title?: string; agentPersona?: string; projectName?: string; pinned?: boolean };
}
export interface ISparrowChatRepository {
  begin(turn: StoredChatTurn): Promise<any>;
  progress(turn: ChatTurnIdentity, thinking: SparrowThinkingStep[]): Promise<void>;
  finish(turn: ChatTurnIdentity, response: SparrowChatResponse): Promise<any>;
  stop(turn: StoredChatTurn, response: SparrowChatResponse): Promise<any>;
  get(turn: ChatTurnIdentity): Promise<any>;
  latest(projectId: string, conversationId: string): Promise<any>;
  list(projectIds: string[]): Promise<any[]>;
  metadata(projectId: string, conversationId: string, metadata: Record<string, unknown>): Promise<void>;
  remove(projectId: string, conversationId: string): Promise<void>;
  importSession(session: any): Promise<void>;
}
const clock = () => new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
const keys = (turn: ChatTurnIdentity) => [turn.projectId, turn.conversationId, turn.messageId, turn.requestId];

export class PostgresSparrowChatRepository implements ISparrowChatRepository {
  constructor(private readonly pool: Pool) {}

  private async initialize(turn: StoredChatTurn, response?: SparrowChatResponse) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`INSERT INTO sparrow_chat_sessions(project_id,id,metadata) VALUES ($1,$2,$3::jsonb)
        ON CONFLICT(project_id,id) DO UPDATE SET metadata=sparrow_chat_sessions.metadata || EXCLUDED.metadata,updated_at=NOW()`,
        [turn.projectId, turn.conversationId, JSON.stringify({ title: turn.userQuery.slice(0, 36), agentPersona: "orchestrator", ...turn.session })]);
      if (turn.userQuery) await client.query(`INSERT INTO sparrow_chat_messages(project_id,conversation_id,id,request_id,payload)
        VALUES ($1,$2,$3,$4,$5::jsonb) ON CONFLICT(project_id,conversation_id,id) DO NOTHING`,
        [turn.projectId, turn.conversationId, turn.userMessageId, turn.requestId, JSON.stringify({ id: turn.userMessageId, role: "user", content: turn.userContent ?? turn.userQuery, timestamp: clock() })]);
      const payload = { id: turn.messageId, role: "assistant", timestamp: clock(), agentId: turn.session?.agentPersona ?? "orchestrator", agentName: "Sparrow", agentBadge: "Master Agent",
        requestId: turn.requestId, content: "", thinking: [], status: "sending", isThinking: true, ...response };
      if (response) payload.isThinking = false;
      await client.query(`INSERT INTO sparrow_chat_messages(project_id,conversation_id,id,request_id,payload) VALUES($1,$2,$3,$4,$5::jsonb)
        ON CONFLICT(project_id,conversation_id,id) DO UPDATE SET request_id=EXCLUDED.request_id,payload=EXCLUDED.payload,
        position=nextval(pg_get_serial_sequence('sparrow_chat_messages','position')),updated_at=NOW()
        WHERE sparrow_chat_messages.request_id <> EXCLUDED.request_id AND NOT $6`, [...keys(turn), JSON.stringify(payload), Boolean(response)]);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
    return this.get(turn);
  }
  begin(turn: StoredChatTurn) { return this.initialize(turn); }

  async progress(turn: ChatTurnIdentity, thinking: SparrowThinkingStep[]) {
    await this.pool.query(`UPDATE sparrow_chat_messages SET payload=jsonb_set(payload,'{thinking}',$5::jsonb),updated_at=NOW()
      WHERE project_id=$1 AND conversation_id=$2 AND id=$3 AND request_id=$4 AND payload->>'status'='sending'`, [...keys(turn), JSON.stringify(thinking)]);
  }
  async finish(turn: ChatTurnIdentity, response: SparrowChatResponse) {
    await this.pool.query(`UPDATE sparrow_chat_messages SET payload=payload || $5::jsonb,updated_at=NOW()
      WHERE project_id=$1 AND conversation_id=$2 AND id=$3 AND request_id=$4 AND payload->>'status'='sending'`,
      [...keys(turn), JSON.stringify({ ...response, isThinking: false })]);
    await this.pool.query("UPDATE sparrow_chat_sessions SET updated_at=NOW() WHERE project_id=$1 AND id=$2", [turn.projectId, turn.conversationId]);
    return this.get(turn);
  }
  async stop(turn: StoredChatTurn, response: SparrowChatResponse) {
    const row = await this.pool.query("SELECT request_id,payload FROM sparrow_chat_messages WHERE project_id=$1 AND conversation_id=$2 AND id=$3", keys(turn).slice(0, 3));
    const existing = row.rows[0];
    if (existing && existing.request_id !== turn.requestId) return existing.payload;
    if (!existing) await this.initialize(turn, response);
    return this.finish(turn, response);
  }
  async get(turn: ChatTurnIdentity) {
    const result = await this.pool.query("SELECT payload FROM sparrow_chat_messages WHERE project_id=$1 AND conversation_id=$2 AND id=$3 AND request_id=$4", keys(turn));
    return result.rows[0]?.payload;
  }
  async latest(projectId: string, conversationId: string) {
    const result = await this.pool.query("SELECT payload FROM sparrow_chat_messages WHERE project_id=$1 AND conversation_id=$2 AND payload->>'role'='assistant' ORDER BY position DESC LIMIT 1", [projectId, conversationId]);
    return result.rows[0]?.payload;
  }
  async list(projectIds: string[]) {
    const result = await this.pool.query(`SELECT s.project_id,s.id,s.metadata,s.created_at,s.updated_at,
      COALESCE(jsonb_agg(m.payload ORDER BY m.position) FILTER(WHERE m.id IS NOT NULL),'[]'::jsonb) AS messages
      FROM sparrow_chat_sessions s LEFT JOIN sparrow_chat_messages m ON m.project_id=s.project_id AND m.conversation_id=s.id
      WHERE s.project_id=ANY($1::varchar[]) GROUP BY s.project_id,s.id ORDER BY s.updated_at DESC`, [projectIds]);
    return result.rows.map(row => ({ ...row.metadata, id: row.id, projectId: row.project_id, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(),
      title: row.metadata.title || "New AI Inquiry", agentPersona: row.metadata.agentPersona || "orchestrator",
      messages: row.messages.map((message: any) => ({ ...message, chart: Array.isArray(message.chart) ? message.chart[0] : message.chart })) }));
  }
  async metadata(projectId: string, conversationId: string, metadata: Record<string, unknown>) {
    await this.pool.query(`INSERT INTO sparrow_chat_sessions(project_id,id,metadata) VALUES($1,$2,$3::jsonb)
      ON CONFLICT(project_id,id) DO UPDATE SET metadata=sparrow_chat_sessions.metadata || EXCLUDED.metadata,updated_at=NOW()`, [projectId, conversationId, JSON.stringify(metadata)]);
  }
  async remove(projectId: string, conversationId: string) {
    await this.pool.query("DELETE FROM sparrow_chat_sessions WHERE project_id=$1 AND id=$2", [projectId, conversationId]);
  }
  async importSession(session: any) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const { messages, id, projectId, ...metadata } = session;
      const inserted = await client.query(`INSERT INTO sparrow_chat_sessions(project_id,id,metadata) VALUES($1,$2,$3::jsonb)
        ON CONFLICT(project_id,id) DO NOTHING RETURNING id`, [projectId, id, JSON.stringify(metadata)]);
      // Existing database transcripts always win over stale browser snapshots.
      if (inserted.rowCount) for (const message of messages) {
        const payload = message.isThinking || message.status === "sending" ? { ...message, status: "stopped", isThinking: false, content: "Agent was stopped",
          thinking: (message.thinking ?? []).map((step: any) => step.done ? step : { ...step, status: "stopped" }) } : message;
        await client.query(`INSERT INTO sparrow_chat_messages(project_id,conversation_id,id,request_id,payload)
          VALUES($1,$2,$3,$4,$5::jsonb) ON CONFLICT(project_id,conversation_id,id) DO NOTHING`, [projectId, id, message.id, message.requestId || message.id, JSON.stringify(payload)]);
      }
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }
}
