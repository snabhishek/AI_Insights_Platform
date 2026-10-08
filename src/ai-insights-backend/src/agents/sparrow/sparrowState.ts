import { Annotation } from "@langchain/langgraph";
import { SparrowIntent } from "../../repositories/sparrowIntent.repository";
import { AnalysisPlan, ExecutionToolResult, QueryUnderstanding, SparrowChatResponse, SparrowClarification, SparrowThinkingStep } from "./types";

export interface SparrowMessage { role: "user" | "assistant"; content: string }
export type SparrowAction = "resolve" | "context" | "tool" | "rectify" | "clarify" | "respond" | "finish";

function channel<T>(initial: () => T) {
  return Annotation<T>({ reducer: (_left, right) => right, default: initial });
}

export const SparrowAnnotation = Annotation.Root({
  projectId: channel(() => ""),
  userQuery: channel(() => ""),
  messages: channel<SparrowMessage[]>(() => []),
  projectContext: channel<Record<string, any>>(() => ({})),
  intentCatalog: channel<SparrowIntent[]>(() => []),
  queryUnderstanding: channel<QueryUnderstanding | null>(() => null),
  plan: channel<AnalysisPlan | null>(() => null),
  toolResults: channel<ExecutionToolResult[]>(() => []),
  nextAction: channel<SparrowAction>(() => "resolve"),
  hitlState: channel<SparrowClarification | null>(() => null),
  clarificationAnswer: channel(() => ""),
  contextInspected: channel(() => false),
  toolCalls: channel(() => 0),
  rectifications: channel(() => 0),
  correctedResultsCount: channel(() => 0),
  decisionReady: channel(() => false),
  memory: channel<Record<string, unknown>>(() => ({})),
  thinking: channel<SparrowThinkingStep[]>(() => []),
  history: Annotation<Array<{ node: string; summary: string }>>({
    reducer: (left, right) => [...left, ...right].slice(-60), default: () => [],
  }),
  response: channel<SparrowChatResponse | null>(() => null),
  stopReason: channel(() => ""),
});

export type SparrowState = typeof SparrowAnnotation.State;
