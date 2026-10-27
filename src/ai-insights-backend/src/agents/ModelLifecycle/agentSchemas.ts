import { z } from "zod";

export const ProjectAuthorSchema = z.object({
  summary: z.string(),
  executionPlans: z.record(z.string(), z.object({
    service: z.string(),
    command: z.array(z.string()),
    reportPath: z.string().optional().default("artifacts/metrics.json"),
  })),
});

export const RunReviewSchema = z.object({
  action: z.enum(["diagnose", "assess", "skip_candidate", "terminal_failure"]),
  rationale: z.string(),
  evidence: z.array(z.string()).default([]),
  candidateId: z.string().nullable().optional().transform((val) => val ?? undefined),
});

export const MetricsQualitySchema = z.object({
  action: z.enum(["accept", "improve_quality", "skip_candidate", "terminal_failure"]),
  rationale: z.string(),
  metricsValid: z.boolean().default(true),
  modelQuality: z.enum(["good", "needs_improvement", "undetermined"]).default("undetermined"),
  candidateRankings: z.array(z.string()).default([]),
  championCandidateId: z.string().nullable().optional().transform((val) => val ?? undefined),
  recommendations: z.array(z.string()).default([]),
  candidateMetrics: z.record(z.string(), z.record(z.string(), z.unknown())).nullable().optional().transform((val) => val ?? undefined),
});

export const ResearchSchema = z.object({
  diagnosis: z.string(),
  evidence: z.array(z.string()).default([]),
  proposedChanges: z.array(z.string()).default([]),
});

export const RepairSchema = z.object({
  summary: z.string(),
  changedFiles: z.array(z.string()).default([]),
});

export const TrainingAuthorPrompt = "trainingProject.md";
export const TrainingReviewPrompt = "trainingFailureReview.md";
export const TrainingQualityPrompt = "trainingMetricsQuality.md";
export const TrainingResearchPrompt = "trainingResearch.md";
export const TrainingRepairPrompt = "trainingRepair.md";
export const TrainingQualityImprovementPrompt = "trainingQualityImprovement.md";

export const ValidationAuthorPrompt = "validationProject.md";
export const ValidationReviewPrompt = "validationFailureReview.md";
export const ValidationQualityPrompt = "validationMetricsQuality.md";
export const ValidationResearchPrompt = "validationResearch.md";
export const ValidationRepairPrompt = "validationRepair.md";
export const ValidationQualityImprovementPrompt = "validationQualityImprovement.md";

export type ProjectAuthorOutput = z.infer<typeof ProjectAuthorSchema>;
export type RunReviewOutput = z.infer<typeof RunReviewSchema>;
export type MetricsQualityOutput = z.infer<typeof MetricsQualitySchema>;
export type ResearchOutput = z.infer<typeof ResearchSchema>;
export type RepairOutput = z.infer<typeof RepairSchema>;
