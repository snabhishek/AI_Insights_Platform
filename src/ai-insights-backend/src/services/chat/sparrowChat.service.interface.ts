import { SparrowChatResponse, SparrowThinkingStep } from "../../agents/sparrow/types";

export interface SendChatMessageInput {
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
}
