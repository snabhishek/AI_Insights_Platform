import { Annotation } from "@langchain/langgraph";
import { SparrowIntent } from "../../repositories/sparrowIntent.repository";
import { AnalysisPlan, ExecutionToolResult, QueryUnderstanding, SparrowChatResponse, SparrowClarification, SparrowInteraction, SparrowThinkingStep } from "./types";

export interface SparrowMessage { role: "user" | "assistant"; content: string }
export type SparrowAction = "resolve" | "context" | "tool" | "rectify" | "clarify" | "respond" | "finish";

function channel<T>(initial: () => T) {
  return Annotation<T>({
    reducer: (left, right) => (right !== undefined ? right : left),
    default: initial,
  });
}

function arrayChannel<T>() {
  return Annotation<T[]>({
    reducer: (left, right) => (Array.isArray(right) ? right : Array.isArray(left) ? left : []),
    default: () => [],
  });
}

export const SparrowAnnotation = Annotation.Root({
  projectId: channel(() => ""),
  userQuery: channel(() => ""),
  messages: arrayChannel<SparrowMessage>(),
  projectContext: channel<Record<string, any>>(() => ({})),
  intentCatalog: arrayChannel<SparrowIntent>(),
  queryUnderstanding: channel<QueryUnderstanding | null>(() => null),
  plan: channel<AnalysisPlan | null>(() => null),
  toolResults: arrayChannel<ExecutionToolResult>(),
  nextAction: channel<SparrowAction>(() => "resolve"),
  hitlState: channel<SparrowClarification | null>(() => null),
  interaction: channel<SparrowInteraction | null>(() => null),
  clarificationAnswer: channel(() => ""),
  clarificationHistory: arrayChannel<{ id: string; question: string; answer: string }>(),
  contextInspected: channel(() => false),
  toolCalls: channel(() => 0),
  rectifications: channel(() => 0),
  correctedResultsCount: channel(() => 0),
  decisionReady: channel(() => false),
  memory: channel<Record<string, unknown>>(() => ({})),
  thinking: arrayChannel<SparrowThinkingStep>(),
  history: Annotation<Array<{ node: string; summary: string }>>({
    reducer: (left, right) => [...(Array.isArray(left) ? left : []), ...(Array.isArray(right) ? right : [])].slice(-60),
    default: () => [],
  }),
  response: channel<SparrowChatResponse | null>(() => null),
  stopReason: channel(() => ""),
});

export type SparrowState = typeof SparrowAnnotation.State;
