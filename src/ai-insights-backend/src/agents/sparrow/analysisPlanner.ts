import { z } from "zod";
import { invokeSparrowJson } from "./llm";
import { AnalysisPlan, QueryUnderstanding } from "./types";
import { clarificationSchema } from "./clarification";

export const analysisPlanSchema = z.object({
  action: z.enum(["tool", "clarify", "respond"]),
  planType: z.enum(["data_analysis", "model_inference", "what_if_scenario", "general_response", "clarification"]),
  steps: z.array(z.object({
    toolName: z.string().min(1), args: z.record(z.string(), z.unknown()), description: z.string(),
  })).max(1),
  rationale: z.string().min(1),
  clarification: clarificationSchema.optional(),
}).superRefine((plan, ctx) => {
  if ((plan.action === "tool") !== (plan.steps.length === 1)) {
    ctx.addIssue({ code: "custom", message: "Tool decisions require exactly one step; other decisions require no steps." });
  }
  if (plan.action === "clarify" && !plan.clarification) {
    ctx.addIssue({ code: "custom", message: "Clarify decision requires a question." });
  }
});

export class AnalysisPlanner {
  static async createPlan(
    understanding: QueryUnderstanding,
    projectContext: Record<string, any>,
    executionContext: Record<string, unknown> = {}
  ): Promise<AnalysisPlan> {
    const { toolSchemas, ...context } = executionContext;
    if (!Array.isArray(toolSchemas) || !toolSchemas.length) {
      throw new Error("Supervisor planning requires the registered tool argument schemas.");
    }
    const stepSchemas = toolSchemas.map((tool) => z.object({
      toolName: z.literal(String(tool.name)), args: tool.schema as z.ZodType<Record<string, unknown>, Record<string, unknown>>, description: z.string(),
    }));
    // Explicit per-tool properties are essential: some providers discard values
    // in open-ended JSON objects even when the prompt describes those values.
    const schema = analysisPlanSchema.safeExtend({
      steps: z.array(z.union(stepSchemas as unknown as [typeof stepSchemas[number], typeof stepSchemas[number], ...typeof stepSchemas[number][]])).max(1),
    });
    return invokeSparrowJson("analysisPlanner.md", {
      understanding, projectContext, ...context,
    }, schema);
  }
}
