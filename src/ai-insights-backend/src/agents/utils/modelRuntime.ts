import { z } from "zod";

export const modelProviderSchema = z.enum(["openai", "azure", "gemini", "litellm", "anthropic", "ollama", "openai-compatible"]);
export type ModelProvider = z.infer<typeof modelProviderSchema>;

const openaiParameters = z.object({
  reasoning_effort: z.enum(["none", "minimal", "low", "medium", "high", "xhigh", "max"]).optional(),
  verbosity: z.enum(["low", "medium", "high"]).optional(),
}).strict();
const googleParameters = z.object({
  thinkingConfig: z.union([
    z.object({ thinkingLevel: z.enum(["LOW", "MEDIUM", "HIGH"]) }).strict(),
    z.object({ thinkingBudget: z.number().int().nonnegative() }).strict(),
  ]),
}).strict();
const anthropicParameters = z.object({
  thinking: z.discriminatedUnion("type", [
    z.object({ type: z.literal("adaptive") }).strict(),
    z.object({ type: z.literal("enabled"), budget_tokens: z.number().int().positive() }).strict(),
    z.object({ type: z.literal("disabled") }).strict(),
  ]).optional(),
  output_config: z.object({ effort: z.enum(["low", "medium", "high", "xhigh", "max"]) }).strict().optional(),
}).strict();
const ollamaParameters = z.object({ think: z.boolean() }).strict();

export interface ModelRuntimeParameters {
  provider: ModelProvider;
  model: string;
  parameters: Record<string, unknown>;
}

export function validateRuntimeTarget(runtime: ModelRuntimeParameters | undefined, provider: ModelProvider, model: string): void {
  if (runtime && (runtime.provider !== provider || runtime.model !== model)) {
    throw new Error("Sparrow model capabilities do not match the configured provider and deployment.");
  }
}

export function parseModelParameters(provider: ModelProvider, parameters: Record<string, unknown>) {
  switch (provider) {
    case "openai": case "azure": case "litellm": case "openai-compatible": {
      const { verbosity, ...modelKwargs } = openaiParameters.parse(parameters);
      return { modelKwargs, ...(verbosity !== undefined ? { verbosity } : {}) };
    }
    case "gemini":
      return googleParameters.parse(parameters);
    case "anthropic": {
      const parsed = anthropicParameters.parse(parameters);
      return { thinking: parsed.thinking, outputConfig: parsed.output_config };
    }
    case "ollama":
      return ollamaParameters.parse(parameters);
  }
}

export function requiredModelSetting(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} must be configured for the selected model provider.`);
  return value;
}

export function requiredModelTokenLimit(name: string): number {
  return z.coerce.number().int().positive().parse(requiredModelSetting(name));
}
