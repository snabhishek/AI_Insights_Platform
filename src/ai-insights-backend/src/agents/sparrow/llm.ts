import { readFile } from "fs/promises";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import { toJsonSchema } from "@langchain/core/utils/json_schema";
import { resolvePromptFilePath } from "../utils/agentUtils";
import { sparrowRunContext, sparrowSignal, throwIfSparrowStopped } from "./executionContext";
import { CHAT_MODE_POLICIES, chatModeInstructions } from "./chatMode";
import { bindSparrowTools, getSparrowModel } from "./modelAdapter";

function invocationSettings(prompt: string) {
  const mode = sparrowRunContext.getStore()?.chatMode;
  return {
    prompt: mode ? `${prompt}\n\n${chatModeInstructions(mode)}` : prompt,
    signal: sparrowSignal(mode ? CHAT_MODE_POLICIES[mode].llmTimeoutMs : 60_000),
  };
}

export interface SparrowDecisionTool {
  name: string;
  description: string;
  schema: z.ZodType;
}

export function decisionTransportSchema(schema: z.ZodType): Record<string, unknown> {
  // The configured Gemini backend rejects bounded arrays of complex optional
  // objects (maxItems=32 rejected; maxItems=8/unbounded accepted in live probes).
  // Keep all bounds in the authoritative Zod schema and enforce them locally.
  const simplify = (value: any): any => Array.isArray(value) ? value.map(simplify)
    : value && typeof value === "object" ? Object.fromEntries(Object.entries(value)
      .filter(([key, item]) => key !== "maxItems" || typeof item !== "number").map(([key, item]) => [key, simplify(item)])) : value;
  return simplify(toJsonSchema(schema));
}

// Expose each action as its own function schema, keeping tool arguments explicit
// without combining the entire registry into one union-shaped JSON plan.
export async function invokeSparrowDecision(payload: unknown, tools: SparrowDecisionTool[]) {
  throwIfSparrowStopped();
  const adapter = getSparrowModel();
  const prompt = await readFile(resolvePromptFilePath("analysisPlanner.md"), "utf8");
  if (!prompt.trim()) throw new Error("Sparrow planner prompt is empty.");
  const definitions = tools.map(tool => ({ type: "function" as const, function: {
    name: tool.name, description: tool.description, parameters: decisionTransportSchema(tool.schema),
  } }));
  const settings = invocationSettings(prompt);
  const result = await bindSparrowTools(adapter, definitions).invoke([
    new SystemMessage(settings.prompt), new HumanMessage(JSON.stringify(payload)),
  ], { signal: settings.signal });
  throwIfSparrowStopped();
  if (result.invalid_tool_calls?.length || result.tool_calls?.length !== 1) {
    throw new Error("Supervisor must select exactly one valid next action.");
  }
  const call = result.tool_calls[0];
  const selected = tools.find(tool => tool.name === call.name);
  if (!selected) throw new Error(`Supervisor selected unknown action '${call.name}'.`);
  return { name: call.name, args: await selected.schema.parseAsync(call.args) };
}

// One prompt source; configuration and malformed output errors stay explicit.
export async function invokeSparrowJson<T extends Record<string, unknown>>(promptName: string, payload: unknown, schema: z.ZodType<T>): Promise<T> {
  throwIfSparrowStopped();
  const { model } = getSparrowModel();
  
  const prompt = await readFile(resolvePromptFilePath(promptName), "utf8");
  if (!prompt.trim()) throw new Error(`Sparrow prompt '${promptName}' is empty.`);
  
  const structuredModel = model.withStructuredOutput(schema, { name: "sparrow_output", method: "functionCalling" });
  
  const settings = invocationSettings(prompt);
  const result = await structuredModel.invoke([
    new SystemMessage(settings.prompt), new HumanMessage(JSON.stringify(payload)),
  ], { signal: settings.signal });
  throwIfSparrowStopped();
  
  return schema.parse(result);
}
