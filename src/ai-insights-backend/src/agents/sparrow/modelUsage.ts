import type { ChatGeneration, LLMResult } from "@langchain/core/outputs";
import { isAIMessage } from "@langchain/core/messages";
import { sparrowRunContext } from "./executionContext";
import type { SparrowTokenUsage } from "./types";

export function sparrowUsageCallbacks(stage: string) {
  const started = performance.now();
  const run = sparrowRunContext.getStore();
  return [{
    name: "sparrow_model_usage",
    handleLLMEnd(output: LLMResult) {
      for (const generations of output.generations) for (const generation of generations) {
        const message = (generation as ChatGeneration).message;
        if (!message || !isAIMessage(message) || !message.usage_metadata) continue;
        const usage = message.usage_metadata;
        const observed: SparrowTokenUsage = {
          modelCalls: 1, inputTokens: usage.input_tokens, outputTokens: usage.output_tokens, totalTokens: usage.total_tokens,
        };
        if (typeof usage.input_token_details?.cache_read === "number") observed.cachedTokens = usage.input_token_details.cache_read;
        if (typeof usage.output_token_details?.reasoning === "number") observed.reasoningTokens = usage.output_token_details.reasoning;
        if (run) {
          if (!run.usage) run.usage = { ...observed };
          else for (const key of Object.keys(observed) as Array<keyof SparrowTokenUsage>) {
            const value = observed[key];
            if (value !== undefined) run.usage[key] = run.usage[key] === undefined ? value : run.usage[key]! + value;
          }
        }
        console.info(`[Sparrow] Model usage ${JSON.stringify({ stage, durationMs: Math.round(performance.now() - started),
          projectId: run?.projectId, conversationId: run?.conversationId, requestId: run?.requestId, ...observed })}`);
      }
    },
  }];
}
