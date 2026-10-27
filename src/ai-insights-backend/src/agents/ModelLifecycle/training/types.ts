import { Annotation } from "@langchain/langgraph";
import type {
  CandidateOutcome,
  LifecycleAssessment,
  LifecycleExecutionPlan,
  LifecycleExecutionResult,
  LifecycleInput,
  LifecycleRunResult,
} from "../contracts";
import type { PrivateAgentMemory } from "../memory/privateAgentMemory";
import type {
  MetricsQualityOutput,
  ProjectAuthorOutput,
  ResearchOutput,
  RunReviewOutput,
} from "../agentSchemas";

export const TrainingGraphState = Annotation.Root({
  input: Annotation<LifecycleInput>(),
  currentCandidateIndex: Annotation<number>({ reducer: (_left, right) => right, default: () => 0 }),
  currentCandidateId: Annotation<string | undefined>({ reducer: (_left, right) => right, default: () => undefined }),
  candidateFailures: Annotation<Record<string, number>>({ reducer: (_left, right) => right, default: () => ({}) }),
  trainingErrorCount: Annotation<number>({ reducer: (_left, right) => right, default: () => 0 }),
  candidates: Annotation<CandidateOutcome[]>({ reducer: (_left, right) => right, default: () => [] }),
  qualityRecommendations: Annotation<string[]>({ reducer: (_left, right) => right, default: () => [] }),
  championCandidateId: Annotation<string | undefined>({ reducer: (_left, right) => right, default: () => undefined }),
  candidateRankings: Annotation<string[]>({ reducer: (_left, right) => right, default: () => [] }),
  privateMemory: Annotation<PrivateAgentMemory>({
    reducer: (left, right) => ({ ...left, ...right }),
    default: () => ({}),
  }),
  authoring: Annotation<ProjectAuthorOutput | undefined>({ reducer: (_left, right) => right, default: () => undefined }),
  structureCheck: Annotation<{ valid: boolean; missingFiles: string[]; dependencyFileReadable: boolean } | undefined>({
    reducer: (_left, right) => right,
    default: () => undefined,
  }),
  executionPlan: Annotation<LifecycleExecutionPlan | undefined>({ reducer: (_left, right) => right, default: () => undefined }),
  execution: Annotation<LifecycleExecutionResult | undefined>({ reducer: (_left, right) => right, default: () => undefined }),
  review: Annotation<RunReviewOutput | undefined>({ reducer: (_left, right) => right, default: () => undefined }),
  assessment: Annotation<MetricsQualityOutput | undefined>({ reducer: (_left, right) => right, default: () => undefined }),
  research: Annotation<ResearchOutput | undefined>({ reducer: (_left, right) => right, default: () => undefined }),
  structuralIssues: Annotation<string[]>({ reducer: (_left, right) => right, default: () => [] }),
  stopReason: Annotation<string | undefined>({ reducer: (_left, right) => right, default: () => undefined }),
  result: Annotation<LifecycleRunResult | undefined>({ reducer: (_left, right) => right, default: () => undefined }),
});

export type TrainingGraphStateType = typeof TrainingGraphState.State;
