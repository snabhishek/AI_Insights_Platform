import { z } from "zod";
import { invokeSparrowDecision, SparrowDecisionTool } from "./llm";
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
    const { toolSchemas, toolCatalog, ...context } = executionContext;
    if (!Array.isArray(toolSchemas) || !toolSchemas.length) {
      throw new Error("Supervisor planning requires the registered tool argument schemas.");
    }
    const metadata = { planType: analysisPlanSchema.shape.planType, rationale: z.string().min(1) };
    const actions: SparrowDecisionTool[] = toolSchemas.map(tool => ({
      name: String(tool.name),
      description: (toolCatalog as Array<{ name: string; description: string }> | undefined)
        ?.find(item => item.name === tool.name)?.description ?? `Execute ${tool.name}`,
      schema: z.object({ ...metadata, description: z.string().min(1), args: tool.schema as z.ZodType }).strict(),
    }));
    if (actions.some(action => ["sparrowClarify", "sparrowRespond"].includes(action.name))) {
      throw new Error("Registered tool name conflicts with a supervisor action.");
    }
    actions.push(
      { name: "sparrowClarify", description: "Ask the user for a genuinely unresolved input; checkpoint and preserve executed evidence.",
        schema: z.object({ ...metadata, clarification: clarificationSchema }).strict() },
      { name: "sparrowRespond", description: "Answer the complete request from sufficient evidence. Give a partial answer for a user-declined input or an established capability/execution limitation; clarify recoverable missing inputs first.",
        schema: z.object(metadata).strict() },
    );
    const decision = await invokeSparrowDecision({ understanding, projectContext, ...context }, actions);
    const args = decision.args as Record<string, any>;
    return analysisPlanSchema.parse({
      action: decision.name === "sparrowClarify" ? "clarify" : decision.name === "sparrowRespond" ? "respond" : "tool",
      planType: args.planType, rationale: args.rationale,
      steps: ["sparrowClarify", "sparrowRespond"].includes(decision.name) ? []
        : [{ toolName: decision.name, args: args.args, description: args.description }],
      ...(decision.name === "sparrowClarify" ? { clarification: args.clarification } : {}),
    });
  }
}
