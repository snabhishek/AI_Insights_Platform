import { z } from "zod";

export const chatModeSchema = z.enum(["expert", "fast"]);
export type ChatMode = z.infer<typeof chatModeSchema>;

export interface ChatModePolicy {
  responseStyle: "brief" | "detailed";
  instructions: string;
  llmTimeoutMs: number;
  scriptTimeoutMs: number;
  reviewEvidence: boolean;
}

export const CHAT_MODE_POLICIES: Readonly<Record<ChatMode, Readonly<ChatModePolicy>>> = {
  expert: {
    responseStyle: "detailed",
    instructions: "Expert mode: investigate the complete request, assess relevant alternatives and evidence gaps, and explain supported findings, assumptions and practical implications in detail. Review evidence before the final answer. Additional investigation must serve the user's request. Do not invent facts or expose private internal reasoning.",
    llmTimeoutMs: 180_000,
    scriptTimeoutMs: 240_000,
    reviewEvidence: true,
  },
  fast: {
    responseStyle: "brief",
    instructions: "Fast mode: choose the shortest sufficient analysis path and give a brief, direct answer with essential context. Avoid optional exploration and repeated explanations. Complete all required calculations, clarification and correctness checks. Never substitute assumptions for missing evidence or truncate required tool arguments or code.",
    llmTimeoutMs: 60_000,
    scriptTimeoutMs: 120_000,
    reviewEvidence: false,
  },
};

export function chatModeInstructions(mode: ChatMode | null | undefined): string {
  return mode ? CHAT_MODE_POLICIES[mode].instructions : "";
}

export function resolveTurnChatMode(requested: ChatMode | undefined, saved: ChatMode | null | undefined, continuing: boolean): ChatMode | undefined {
  if (!continuing) return requested;
  if (requested !== undefined && requested !== saved) {
    throw new Error("A clarification or retry must retain the original request's response mode.");
  }
  return saved === null ? undefined : saved;
}
