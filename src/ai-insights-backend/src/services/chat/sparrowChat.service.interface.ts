import { SparrowChatResponse, SparrowThinkingStep } from "../../agents/sparrow/types";

export interface SendChatMessageInput {
  requestId?: string;
  messageId?: string;
  userMessageId?: string;
  userContent?: string;
  session?: { title?: string; agentPersona?: string; projectName?: string; pinned?: boolean };
  userQuery: string;
  projectId: string;
  conversationId?: string;
  conversationHistory?: Array<{ role: string; content: string }>;
  executionState?: Record<string, any>;
  interactionId?: string;
  onThinkingUpdate?: (steps: SparrowThinkingStep[]) => void;
}

export interface ISparrowChatService {
  sendMessage(input: SendChatMessageInput): Promise<SparrowChatResponse>;
  getInteraction(input: { projectId: string; conversationId: string }): Promise<Partial<SparrowChatResponse>>;
  stop(input: SendChatMessageInput & { conversationId: string; requestId: string; messageId: string }): Promise<any>;
  listSessions(projectIds: string[]): Promise<any[]>;
  updateSession(projectId: string, conversationId: string, metadata: Record<string, unknown>): Promise<void>;
  deleteSession(projectId: string, conversationId: string): Promise<void>;
  importSessions(sessions: any[]): Promise<void>;
}
