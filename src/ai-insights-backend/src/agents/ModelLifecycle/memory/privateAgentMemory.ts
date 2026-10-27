import type { BaseMessage } from "@langchain/core/messages";

export type LifecycleAgentRole =
  | "trainingAuthor"
  | "trainingFailureReview"
  | "trainingMetricsQuality"
  | "trainingResearch"
  | "trainingRepair"
  | "trainingQualityImprovement"
  | "validationAuthor"
  | "validationFailureReview"
  | "validationMetricsQuality"
  | "validationResearch"
  | "validationRepair"
  | "validationQualityImprovement";

export type PrivateAgentMemory = Partial<Record<LifecycleAgentRole, BaseMessage[]>>;

export function updatePrivateAgentMemory(
  memory: PrivateAgentMemory | undefined,
  role: LifecycleAgentRole,
  messages: BaseMessage[]
): PrivateAgentMemory {
  return {
    ...(memory || {}),
    [role]: messages,
  };
}
