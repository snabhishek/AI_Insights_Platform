import { z } from "zod";
import { pool } from "../../db";
import { PostgresSparrowIntentRepository, SparrowIntent } from "../../repositories/sparrowIntent.repository";
import { invokeSparrowJson } from "./llm";
import { QueryUnderstanding } from "./types";
import { clarificationSchema } from "./clarification";

export const queryUnderstandingSchema = z.object({
  intent: z.string().min(1),
  metricRelationship: z.enum(["direct", "derived", "unsupported"]).optional(),
  derivation: z.object({ forecastTarget: z.string().min(1), rationale: z.string().min(1), requiredInputs: z.array(z.string().min(1)) }).optional(),
  targetMetric: z.string().nullish(), targetEntity: z.string().nullish(),
  dimensions: z.array(z.string()).optional(),
  timeRange: z.object({
    anchor: z.enum(["calendar", "latest_data", "explicit"]).optional(),
    horizon: z.number().int().positive().nullish(), frequency: z.enum(["Monthly", "Weekly", "Yearly"]).nullish(),
    startDate: z.string().nullish(), endDate: z.string().nullish(),
  }).nullish(),
  filters: z.array(z.object({
    column: z.string(), operator: z.enum(["eq", "neq", "in", "gt", "gte", "lt", "lte", "contains"]),
    value: z.union([z.string(), z.number(), z.boolean(), z.array(z.union([z.string(), z.number()]))]),
  })).optional(),
  requestedModel: z.string().nullish(),
  scenarioChanges: z.array(z.object({ feature: z.string(), change: z.string() })).optional(),
  responseStyle: z.enum(["brief", "detailed"]),
  isGeneralConversation: z.boolean(), isProjectIrrelevant: z.boolean(),
  needsClarification: z.boolean(),
  clarificationQuestion: z.string().nullish(), missingField: z.string().nullish(),
  clarificationOptions: z.array(z.string()).optional(),
  explanation: z.string(),
  requiresWebSearch: z.boolean(), searchQuery: z.string().nullish(),
});

export function validateUnderstanding(value: unknown, intents: SparrowIntent[]): QueryUnderstanding {
  const parsed = queryUnderstandingSchema.parse(value);
  const definition = intents.find((intent) => intent.code === parsed.intent);
  if (!definition) throw new Error(`Unregistered Sparrow intent '${parsed.intent}'.`);
  if (parsed.isGeneralConversation && !definition.conversational) {
    throw new Error("Analytical intent cannot be treated as a greeting.");
  }
  if (parsed.needsClarification) {
    clarificationSchema.parse({ question: parsed.clarificationQuestion,
      missingField: parsed.missingField, options: parsed.clarificationOptions });
  }
  if (parsed.metricRelationship === "derived" && !parsed.derivation) {
    throw new Error("A derived metric requires the agent's forecast basis, rationale and required inputs.");
  }
  // Normalize nullable output without inventing business parameters.
  return JSON.parse(JSON.stringify(parsed, (_key, item) => item === null ? undefined : item));
}

export class QueryResolver {
  static async resolveQuery(
    userQuery: string,
    projectContext: Record<string, any>,
    conversationHistory: Array<{ role: string; content: string }> = [],
    intents?: SparrowIntent[],
    memory?: Record<string, unknown>
  ): Promise<QueryUnderstanding> {
    const catalog = intents ?? await new PostgresSparrowIntentRepository(pool).getActiveIntents();
    const parsed = await invokeSparrowJson("queryResolver.md", {
      userQuery, projectContext, conversationHistory, memory, intentCatalog: catalog,
      currentDate: projectContext.currentDate ?? new Date().toISOString().slice(0, 10),
    }, queryUnderstandingSchema);
    return validateUnderstanding(parsed, catalog);
  }
}
