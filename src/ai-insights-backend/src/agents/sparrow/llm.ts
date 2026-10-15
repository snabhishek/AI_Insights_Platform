import { readFile } from "fs/promises";
import { AIMessageChunk, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import { toJsonSchema } from "@langchain/core/utils/json_schema";
import { resolvePromptFilePath } from "../utils/agentUtils";
import { sparrowRunContext, sparrowSignal, throwIfSparrowStopped } from "./executionContext";
import { CHAT_MODE_POLICIES, chatModeInstructions } from "./chatMode";
import { bindSparrowTools, createSparrowResponseModel, getSparrowModel, SPARROW_RESPONSE_NAME } from "./modelAdapter";
import { sparrowUsageCallbacks } from "./modelUsage";
import { JsonStringFieldStream } from "./responseStream";

const promptCache = new Map<string, Promise<string>>();
function readPrompt(name: string): Promise<string> {
  let prompt = promptCache.get(name);
  if (!prompt) {
    prompt = readFile(resolvePromptFilePath(name), "utf8").then(text => {
      if (!text.trim()) throw new Error(`Sparrow prompt '${name}' is empty.`);
      return text;
    });
    promptCache.set(name, prompt);
  }
  return prompt;
}

function invocationSettings(prompt: string, includeModeInstructions: boolean) {
  const mode = sparrowRunContext.getStore()?.chatMode;
  return {
    prompt: mode && includeModeInstructions ? `${prompt}\n\n${chatModeInstructions(mode)}` : prompt,
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
  const prompt = await readPrompt("analysisPlanner.md");
  const definitions = tools.map(tool => ({ type: "function" as const, function: {
    name: tool.name, description: tool.description, parameters: decisionTransportSchema(tool.schema),
  } }));
  const settings = invocationSettings(prompt, true);
  const result = await bindSparrowTools(adapter, definitions).invoke([
    new SystemMessage(settings.prompt), new HumanMessage(JSON.stringify(payload)),
  ], { signal: settings.signal, callbacks: sparrowUsageCallbacks("planner") });
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
  
  const prompt = await readPrompt(promptName);
  
  const structuredModel = model.withStructuredOutput(schema, { name: SPARROW_RESPONSE_NAME, method: "functionCalling" });
  
  const settings = invocationSettings(prompt, false);
  const result = await structuredModel.invoke([
    new SystemMessage(settings.prompt), new HumanMessage(JSON.stringify(payload)),
  ], { signal: settings.signal, callbacks: sparrowUsageCallbacks(promptName) });
  throwIfSparrowStopped();
  
  return schema.parse(result);
}

export async function streamSparrowResponse<T extends Record<string, unknown>>(payload: unknown, schema: z.ZodType<T>): Promise<T> {
  throwIfSparrowStopped();
  const response = createSparrowResponseModel(getSparrowModel(), schema);
  const settings = invocationSettings(await readPrompt("insightsResponder.md"), true);
  const stream = response.runnable.streamEvents([
    new SystemMessage(settings.prompt), new HumanMessage(JSON.stringify(payload)),
  ], { version: "v2", signal: settings.signal, callbacks: sparrowUsageCallbacks("responder") },
  { includeTypes: ["chat_model", "chain"] });
  const content = new JsonStringFieldStream("content");
  const run = sparrowRunContext.getStore();
  let responseRunId: string | undefined;
  let toolIndex: number | undefined;
  let result: unknown;
  const emit = async (fragment: string) => {
    const delta = content.push(fragment);
    if (delta) await run?.onResponseDelta?.(delta, settings.signal);
  };
  for await (const event of stream) {
    throwIfSparrowStopped();
    if (event.event === "on_chain_start" && responseRunId === undefined) responseRunId = event.run_id;
    if (event.event === "on_chain_end" && event.run_id === responseRunId) result = event.data.output;
    if (event.event !== "on_chat_model_stream") continue;
    const chunk = event.data.chunk as AIMessageChunk;
    if (response.transport === "text") {
      const text = typeof chunk.content === "string" ? chunk.content
        : chunk.content.filter(block => block.type === "text" && typeof block.text === "string").map(block => block.text).join("");
      if (text) await emit(text);
    } else for (const call of chunk.tool_call_chunks ?? []) {
      if (call.name && call.name !== SPARROW_RESPONSE_NAME) throw new Error("Responder selected an unexpected response function.");
      if (typeof call.index !== "number") throw new Error("Responder tool stream is missing its call index.");
      if (toolIndex === undefined) toolIndex = call.index;
      if (call.index !== toolIndex) throw new Error("Responder must submit exactly one structured answer.");
      if (typeof call.args === "string" && call.args) await emit(call.args);
    }
  }
  throwIfSparrowStopped();
  return schema.parse(result);
}
