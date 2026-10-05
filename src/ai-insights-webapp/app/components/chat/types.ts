export type AgentPersonaId =
  | "orchestrator"
  | "data-engineer"
  | "feature-architect"
  | "ml-scientist"
  | "validation-analyst"
  | "hierarchy-expert";

export interface AgentPersona {
  id: AgentPersonaId;
  name: string;
  role: string;
  avatar: string;
  badge: string;
  description: string;
  systemPrompt: string;
  capabilities: string[];
  suggestedQuestions: string[];
}

export interface ThinkingStep {
  time: string;
  text: string;
  done: boolean;
}

export interface ChatSourceRef {
  title: string;
  type: string;
  details?: string;
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

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string;
  thinking?: ThinkingStep[];
  isThinking?: boolean;
  sources?: ChatSourceRef[];
  suggestedActions?: string[];
  metricCards?: MetricCardData[];
  tables?: TableData[];
  chart?: ChartData;
  codeSnippet?: {
    language: string;
    code: string;
    filename?: string;
  };
  agentId?: AgentPersonaId;
  agentName?: string;
  agentBadge?: string;
  agentAvatar?: string;
  status?: "sending" | "complete" | "error";
  error?: string;
  userLiked?: boolean;
  userDisliked?: boolean;
}

export interface ChatSession {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  projectId?: string;
  projectName?: string;
  agentPersona: AgentPersonaId;
  messages: ChatMessage[];
  pinned?: boolean;
}

export interface PromptTemplate {
  id: string;
  category: "Discovery" | "Features" | "Models" | "Validation" | "SQL & Hygiene";
  title: string;
  prompt: string;
  recommendedPersona: AgentPersonaId;
  icon: string;
}

export interface TrainedModelOption {
  id: string;
  displayName: string;
  framework?: string;
  isChampion?: boolean;
}
