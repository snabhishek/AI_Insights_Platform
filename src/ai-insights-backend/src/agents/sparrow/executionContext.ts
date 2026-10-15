import { AsyncLocalStorage } from "node:async_hooks";
import { SparrowChatResponse, SparrowThinkingStep } from "./types";

export interface SparrowRunContext {
  signal: AbortSignal; projectId: string; conversationId: string; requestId: string;
  thinking: SparrowThinkingStep[];
}
export const sparrowRunContext = new AsyncLocalStorage<SparrowRunContext>();
export function throwIfSparrowStopped() { sparrowRunContext.getStore()?.signal.throwIfAborted(); }
export function sparrowSignal(timeoutMs: number): AbortSignal {
  const signal = sparrowRunContext.getStore()?.signal;
  return signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
}
export function stoppedResponse(thinking: SparrowThinkingStep[], executionState?: Record<string, unknown>): SparrowChatResponse {
  return { status: "stopped", content: "Agent was stopped", executionState,
    thinking: thinking.map(step => step.done ? step : { ...step, status: "stopped", done: false }) };
}
