import { z } from "zod";
import { invokeSparrowJson } from "./llm";
import { AnalysisPlan, ExecutionToolResult, QueryUnderstanding, SparrowChatResponse, SparrowThinkingStep } from "./types";

const responseSchema = z.object({
  content: z.string().trim().min(1),
  metricCards: z.array(z.object({
    label: z.string(), value: z.union([z.string(), z.number().finite()]), change: z.string().optional(),
    trend: z.enum(["up", "down", "neutral"]).optional(), details: z.string().optional(),
  })).optional(),
  tables: z.array(z.object({
    columns: z.array(z.string()),
    rows: z.array(z.array(z.union([z.string(), z.number().finite(), z.boolean(), z.null()]))),
  }).refine((table) => table.rows.every((row) => row.length === table.columns.length), "Table cells and columns must align")).optional(),
  chart: z.array(z.object({
    type: z.enum(["bar", "line", "pie"]), title: z.string(), labels: z.array(z.string()), data: z.array(z.number().finite()),
  }).refine((chart) => chart.labels.length === chart.data.length, "Chart labels and data must align")).optional(),
  suggestedActions: z.array(z.string()).optional(),
});

export class InsightsResponder {
  static async generateResponse(
    userQuery: string, understanding: QueryUnderstanding, plan: AnalysisPlan,
    toolResults: ExecutionToolResult[], projectContext: Record<string, any>,
    thinkingSteps: SparrowThinkingStep[], memory?: Record<string, unknown>
  ): Promise<SparrowChatResponse> {
    const result = await invokeSparrowJson("insightsResponder.md", {
      userQuery, understanding, plan, toolResults, projectContext, memory,
    }, responseSchema);
    return {
      ...result,
      tables: result.tables?.map((table) => ({
        columns: table.columns,
        rows: table.rows.map((row) => Object.fromEntries(table.columns.map((column, index) => [column, row[index]]))),
      })),
      status: "complete", thinking: thinkingSteps,
    };
  }
}
