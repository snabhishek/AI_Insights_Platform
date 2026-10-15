import { z } from "zod";
import { ChatOllama } from "@langchain/ollama";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatOpenAI } from "@langchain/openai";
import { BindToolsInput } from "@langchain/core/language_models/chat_models";
import { getModel, SupportedChatModel } from "../utils/agentUtils";
import { modelProviderSchema, ModelRuntimeParameters } from "../utils/modelRuntime";
import { ChatMode } from "./chatMode";
import { sparrowRunContext } from "./executionContext";

const tuningParameters = z.record(z.string(), z.unknown()).refine(value => Object.keys(value).length > 0, "Declare at least one native mode control.");
export const modelCapabilitiesSchema = z.object({
  provider: modelProviderSchema,
  model: z.string().trim().min(1),
  fast: tuningParameters,
  expert: tuningParameters,
}).strict();

export interface SparrowModelAdapter {
  model: SupportedChatModel;
  modeStrategy?: "application" | "application+native";
}

export const SPARROW_RESPONSE_NAME = "sparrow_output";

export function createSparrowResponseModel<T extends Record<string, unknown>>(adapter: SparrowModelAdapter, schema: z.ZodType<T>) {
  const { model } = adapter;
  if (model instanceof ChatOpenAI) {
    return { runnable: model.withStructuredOutput(schema, { name: SPARROW_RESPONSE_NAME, method: "jsonMode" }), transport: "text" as const };
  }
  if (model instanceof ChatGoogleGenerativeAI || model instanceof ChatOllama) {
    return { runnable: model.withStructuredOutput(schema, { name: SPARROW_RESPONSE_NAME, method: "jsonSchema" }), transport: "text" as const };
  }
  if (model instanceof ChatAnthropic) {
    return { runnable: model.withStructuredOutput(schema, { name: SPARROW_RESPONSE_NAME, method: "functionCalling" }), transport: "tool" as const };
  }
  throw new Error("The configured model adapter does not support structured response streaming.");
}

export function createSparrowModel(mode: ChatMode | undefined, capabilityConfig: string | undefined): SparrowModelAdapter {
  let runtime: ModelRuntimeParameters | undefined;
  if (mode !== undefined && capabilityConfig !== undefined) {
    const capabilities = modelCapabilitiesSchema.parse(JSON.parse(capabilityConfig));
    runtime = { provider: capabilities.provider, model: capabilities.model, parameters: capabilities[mode] };
  }
  const model = getModel(runtime);
  if (!model) throw new Error("Configure an LLM provider before using Sparrow.");
  return {
    model,
    ...(mode !== undefined ? { modeStrategy: runtime ? "application+native" as const : "application" as const } : {}),
  };
}

export function getSparrowModel(): SparrowModelAdapter {
  const run = sparrowRunContext.getStore();
  if (run?.modelAdapter) return run.modelAdapter;
  const adapter = createSparrowModel(run?.chatMode, process.env.SPARROW_MODEL_CAPABILITIES);
  if (run) {
    run.modelAdapter = adapter;
    if (adapter.modeStrategy) run.modeStrategy = adapter.modeStrategy;
  }
  return adapter;
}

export function bindSparrowTools(adapter: SparrowModelAdapter, tools: BindToolsInput[]) {
  if (!adapter.model.bindTools) throw new Error("The configured model adapter does not support Sparrow tool calling.");
  // Claude thinking uses automatic tool selection. Ollama cannot enforce a tool
  // choice. Every caller still validates the returned tool call locally.
  if (adapter.model instanceof ChatAnthropic) {
    return adapter.model.bindTools(tools, { tool_choice: "auto" });
  }
  return adapter.model instanceof ChatOllama
    ? adapter.model.bindTools(tools)
    : adapter.model.bindTools(tools, { tool_choice: "any" });
}
