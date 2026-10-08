import { SparrowChatResponse, SparrowThinkingStep } from "../../agents/sparrow/types";

export interface SendChatMessageInput {
  userQuery: string;
  projectId: string;
  conversationId?: string;
  conversationHistory?: Array<{ role: string; content: string }>;
  executionState?: Record<string, any>;
  onThinkingUpdate?: (steps: SparrowThinkingStep[]) => void;
}

export interface ISparrowChatService {
  sendMessage(input: SendChatMessageInput): Promise<SparrowChatResponse>;
}
