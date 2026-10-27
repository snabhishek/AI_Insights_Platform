import { promises as fs } from "fs";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { createAgent } from "langchain";
import type { RunnableConfig } from "@langchain/core/runnables";
import type { BaseMessage } from "@langchain/core/messages";
import type { ZodType } from "zod";
import {
  buildAgentMiddlewares,
  extractModelText,
  getLatestAgentMessage,
  getModel,
  logAgentMessagesAsThinking,
  logMilestoneThinking,
  parseJson,
  parseJsonObject,
  resolvePromptFilePath,
} from "../utils/agentUtils";
import type { LifecycleAgentRole, PrivateAgentMemory } from "./memory/privateAgentMemory";
import { updatePrivateAgentMemory } from "./memory/privateAgentMemory";

export const LIFECYCLE_AGENT_SUMMARIZATION_OPTIONS = {
  triggerTokens: 500_000,
  keepTokens: 25_000,
} as const;

export function lifecycleAgentMiddlewares(model: ReturnType<typeof getModel>): ReturnType<typeof buildAgentMiddlewares> {
  return buildAgentMiddlewares({
    middlewareOptions: {
      summarization: LIFECYCLE_AGENT_SUMMARIZATION_OPTIONS,
    },
  }, model);
}

export interface LifecycleAgentInvocation<T> {
  role: LifecycleAgentRole;
  promptFile: string;
  task: string;
  outputContract: string;
  schema: ZodType<T>;
  tools: unknown[];
  memory?: PrivateAgentMemory;
  signal?: AbortSignal;
  config?: RunnableConfig;
}

export interface LifecycleAgentResult<T> {
  output: T;
  memory: PrivateAgentMemory;
}

export async function reportLifecycleProgress(
  config: RunnableConfig | undefined,
  step: string,
  detail: string,
  fallbackServices?: any
): Promise<void> {
  const callback = config?.configurable?.onLifecycleProgress;
  if (typeof callback === "function") {
    try {
      await callback({ step, detail });
    } catch { }
  }

  const services = config?.configurable?.services || fallbackServices;
  if (services?.agentThinkingService && services?.projectId) {
    const substep =
      config?.configurable?.substep ||
      (step.toLowerCase().includes("validation") ? "Model Validation" : "Model Training");
    try {
      await logMilestoneThinking(services, substep, detail);
    } catch { }
  }
}

export async function invokeLifecycleAgent<T>(
  invocation: LifecycleAgentInvocation<T>
): Promise<LifecycleAgentResult<T>> {
  const model = getModel();
  if (!model) {
    throw new Error(`No language model is configured for ${invocation.role}.`);
  }

  const promptPath = resolvePromptFilePath(`ModelLifecycle/${invocation.promptFile}`);
  const systemPrompt = await fs.readFile(promptPath, "utf8");
  const priorMessages = invocation.memory?.[invocation.role] || [];
  const inputMessages: BaseMessage[] = [
    ...priorMessages,
    new HumanMessage(
      `${invocation.task}\n\nReturn only one valid JSON object with this response shape: ${invocation.outputContract}`
    ),
  ];
  const agent = createAgent({
    model,
    tools: invocation.tools as never[],
    systemPrompt,
    middleware: lifecycleAgentMiddlewares(model),
  });

  const services = invocation.config?.configurable?.services || (invocation as any).services;
  const substep =
    invocation.config?.configurable?.substep ||
    (invocation.role.toLowerCase().includes("validation") ? "Model Validation" : "Model Training");

  await reportLifecycleProgress(invocation.config, invocation.role, "Agent reasoning started.", services);

  let lastResult: any = null;
  try {
    const stream = await agent.stream(
      { messages: inputMessages },
      {
        ...invocation.config,
        streamMode: "values",
        recursionLimit: 1000,
        signal: invocation.signal,
      }
    );

    for await (const chunk of stream) {
      if (services?.isCancelled?.() || invocation.signal?.aborted) {
        break;
      }
      lastResult = chunk;
      if (services?.agentThinkingService && services?.projectId) {
        try {
          await logAgentMessagesAsThinking(services, substep, chunk);
        } catch { }
      }
    }
  } catch (streamErr: any) {
    if (invocation.signal?.aborted || services?.isCancelled?.()) {
      throw streamErr;
    }
    // If streaming had an error, fall back to invoke if not yet executed
    console.warn(`[invokeLifecycleAgent] Streaming encountered an issue, falling back to direct invoke:`, streamErr?.message || streamErr);
  }

  const result = lastResult || await agent.invoke(
    { messages: inputMessages },
    {
      ...invocation.config,
      signal: invocation.signal,
    }
  );

  const response = extractModelText(getLatestAgentMessage(result));
  let parsed: T;
  try {
    const rawParsed = parseJson(response, null as any) || parseAgentJsonResponse(response);
    parsed = invocation.schema.parse(rawParsed);
  } catch (parseError: any) {
    console.error(
      `[invokeLifecycleAgent] Failed to parse/validate output for role "${invocation.role}":`,
      parseError?.message || parseError
    );
    console.error(
      `[invokeLifecycleAgent] Raw response text was:`,
      typeof response === "string" ? response.slice(0, 1000) : response
    );
    throw parseError;
  }

  const resultMessages = Array.isArray(result?.messages) ? (result.messages as BaseMessage[]) : inputMessages;
  await reportLifecycleProgress(invocation.config, invocation.role, "Agent response validated.", services);

  if (services?.agentThinkingService && services?.projectId) {
    try {
      await logAgentMessagesAsThinking(services, substep, result);
    } catch { }
  }

  return {
    output: parsed,
    memory: updatePrivateAgentMemory(invocation.memory, invocation.role, resultMessages),
  };
}

export function parseAgentJsonResponse<T = unknown>(rawText: string): T {
  if (!rawText || typeof rawText !== "string") {
    throw new Error("Agent returned an empty or non-string response.");
  }

  const fallbackToken = { __parseFailed: true };
  const parsed = parseJson(rawText, fallbackToken);
  if (parsed !== fallbackToken && parsed && typeof parsed === "object") {
    return parsed as T;
  }

  const trimmed = rawText.trim();
  const stripped = trimmed
    .replace(/^```(?:json|yaml|yml)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    return JSON.parse(stripped) as T;
  } catch {
    const firstBrace = stripped.indexOf("{");
    const lastBrace = stripped.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      try {
        return JSON.parse(stripped.slice(firstBrace, lastBrace + 1)) as T;
      } catch { }
    }
  }

  throw new Error(`Unable to parse valid JSON from agent response: ${trimmed.slice(0, 300)}`);
}

export function lifecycleTask(context: Record<string, unknown>, details: Record<string, unknown>): string {
  return JSON.stringify({ context, details }, null, 2);
}

export function lifecycleConfig(config?: RunnableConfig): RunnableConfig | undefined {
  return config;
}

export function requireLifecycleRunId(input: { projectId: string; runTimestamp: string }): void {
  if (!input.projectId.trim() || !input.runTimestamp.trim()) {
    throw new Error("A project ID and active run timestamp are required.");
  }
}

export function resultText(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}
