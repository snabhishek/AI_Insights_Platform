import { z } from "zod";
import { ChatOllama } from "@langchain/ollama";
import { ChatAnthropic } from "@langchain/anthropic";
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
  const adapter = createSparrowModel(run?.chatMode, process.env.SPARROW_MODEL_CAPABILITIES);
  if (run && adapter.modeStrategy) run.modeStrategy = adapter.modeStrategy;
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
