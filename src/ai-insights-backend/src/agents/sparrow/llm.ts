import { readFile } from "fs/promises";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import { toJsonSchema } from "@langchain/core/utils/json_schema";
import { getModel, resolvePromptFilePath } from "../utils/agentUtils";
import { sparrowSignal, throwIfSparrowStopped } from "./executionContext";

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
  const model = getModel();
  if (!model) throw new Error("Configure an LLM provider before using Sparrow.");
  const prompt = await readFile(resolvePromptFilePath("analysisPlanner.md"), "utf8");
  if (!prompt.trim()) throw new Error("Sparrow planner prompt is empty.");
  const definitions = tools.map(tool => ({ type: "function" as const, function: {
    name: tool.name, description: tool.description, parameters: decisionTransportSchema(tool.schema),
  } }));
  const result = await model.bindTools(definitions, { tool_choice: "any" }).invoke([
    new SystemMessage(prompt), new HumanMessage(JSON.stringify(payload)),
  ], { signal: sparrowSignal(60_000) });
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
  const model = getModel();
  if (!model) throw new Error("Configure an LLM provider before using Sparrow.");
  
  const prompt = await readFile(resolvePromptFilePath(promptName), "utf8");
  if (!prompt.trim()) throw new Error(`Sparrow prompt '${promptName}' is empty.`);
  
  const structuredModel = model.withStructuredOutput(schema, { name: "sparrow_output", method: "functionCalling" });
  
  const result = await structuredModel.invoke([
    new SystemMessage(prompt), new HumanMessage(JSON.stringify(payload)),
  ], { signal: sparrowSignal(60_000) });
  throwIfSparrowStopped();
  
  return schema.parse(result);
}
