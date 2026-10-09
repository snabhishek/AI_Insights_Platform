// Intent definitions are administered in sparrow_intents, not a code enum.
export type QueryIntent = string;

export interface TimeRangeContext {
  anchor?: "calendar" | "latest_data" | "explicit";
  horizon?: number;
  frequency?: string;
  startDate?: string;
  endDate?: string;
}

export interface QueryUnderstanding {
  metricRelationship?: "direct" | "derived" | "unsupported";
  derivation?: { forecastTarget: string; rationale: string; requiredInputs: string[] };
  intent: QueryIntent;
  targetMetric?: string;
  targetEntity?: string;
  dimensions?: string[];
  timeRange?: TimeRangeContext;
  filters?: Array<{ column: string; operator: "eq" | "neq" | "in" | "gt" | "gte" | "lt" | "lte" | "contains"; value: string | number | boolean | Array<string | number> }>;
  requestedModel?: string;
  scenarioChanges?: Array<{ feature: string; change: string }>;
  responseStyle: "brief" | "detailed";
  isGeneralConversation: boolean;
  isProjectIrrelevant: boolean;
  needsClarification: boolean;
  clarificationQuestion?: string;
  missingField?: string;
  clarificationOptions?: string[];
  explanation?: string;
  requiresWebSearch?: boolean;
  searchQuery?: string;
}

export interface PlanStep {
  toolName: string;
  args: Record<string, any>;
  description: string;
}

export interface AnalysisPlan {
  action: "tool" | "clarify" | "respond";
  clarification?: SparrowClarification;
  planType: "data_analysis" | "model_inference" | "what_if_scenario" | "general_response" | "clarification";
  steps: PlanStep[];
  rationale: string;
}

export interface ExecutionToolResult {
  args?: Record<string, unknown>;
  executedAt?: string;
  toolName: string;
  success: boolean;
  data?: any;
  error?: string;
}

export interface SparrowClarification {
  question: string;
  missingField: string;
  options?: string[];
  context?: Record<string, any>;
}

export interface SparrowInteraction {
  id: string;
  requestedAt: string;
  expiresAt: string;
  status: "waiting" | "timed_out" | "answered";
  answeredAt?: string;
}

export interface SparrowThinkingStep {
  time: string;
  text: string;
  done: boolean;
}

export interface MetricCardData {
  label: string;
  value: string | number;
  change?: string;
  trend?: "up" | "down" | "neutral";
  details?: string;
}

export interface TableData {
  columns: string[];
  rows: Array<Record<string, any>>;
}

export interface ChartData {
  type: "bar" | "line" | "pie";
  title: string;
  labels: string[];
  data: number[];
}

export interface SparrowChatResponse {
  status: "complete" | "awaiting_user_input" | "error";
  content: string;
  thinking: SparrowThinkingStep[];
  metricCards?: MetricCardData[];
  tables?: TableData[];
  chart?: ChartData[];
  suggestedActions?: string[];
  clarification?: SparrowClarification;
  interaction?: SparrowInteraction;
  serverNow?: string;
  clarificationReplies?: Array<{ question: string; answer: string }>;
  executionState?: Record<string, any>;
  error?: string;
}

export interface SparrowExecutionState {
  projectId: string;
  threadId: string;
}
