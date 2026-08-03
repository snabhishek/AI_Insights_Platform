export interface ThinkingLog {
  time: string;
  text: string;
  done: boolean;
}

export interface AgentThinking {
  id: string;
  projectId: string;
  pipeline: string;
  substep: string;
  thinking: ThinkingLog[];
  createdAt: string;
  updatedAt: string;
}
