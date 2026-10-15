import type { ChatMessage, ThinkingStep } from "../components/chat/types";

export function stopChatMessage(message: ChatMessage): ChatMessage {
  return { ...message, status: "stopped", isThinking: false, content: "Agent was stopped", clarification: undefined,
    thinking: message.thinking?.map(step => step.done ? step : { ...step, status: "stopped", done: false }) };
}
export function traceClock(step: ThinkingStep): string {
  if (step.timestamp && Number.isFinite(Date.parse(step.timestamp))) {
    return new Date(step.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  }
  return /^\d{2}:\d{2}:\d{2}$/.test(step.time) ? step.time : "—";
}
