import { SparrowChatResponse, SparrowThinkingStep, SparrowInteraction } from "./types";
import { ProjectService } from "../../services/project/project.service";
import { IDuckDBService } from "../../services/duckdb/duckdb.service.interface";
import { IModelValidationService } from "../../services/ai/model-validation/modelValidation.service.interface";
import {
  createGetProjectContextTool,
  createGetProjectDataSchemaTool,
} from "./tools/projectContext.tools";
import {
  createQueryProjectDataTool,
  createAggregateMetricsTool,
  createComparePeriodsTool,
} from "./tools/dataAnalysis.tools";
import {
  createDiscoverAvailableModelsTool,
  createRunModelInferenceTool,
} from "./tools/modelInference.tools";
import { createWebSearchTool } from "../tools/search/websearch";

import { BaseCheckpointSaver, Command } from "@langchain/langgraph";
import { randomUUID } from "crypto";
import { ISparrowIntentRepository } from "../../repositories/sparrowIntent.repository";
import { createSparrowGraph } from "./graph";
import { SparrowMessage } from "./sparrowState";
import { clarificationSchema, CLARIFICATION_WINDOW_MS, interactionAt } from "./clarification";
import { projectBusinessContext } from "./projectContext";
import { createCalculateMetricTool } from "./tools/calculation.tools";

if (typeof BigInt !== "undefined" && !(BigInt.prototype as any).toJSON) {
  (BigInt.prototype as any).toJSON = function () {
    const num = Number(this);
    return Number.isSafeInteger(num) ? num : this.toString();
  };
}

function savedInteraction(snapshot: any): SparrowInteraction {
  if (snapshot.values.interaction) return snapshot.values.interaction;
  // Earlier checkpoints already have durable interrupt IDs and creation times.
  // Derive transport metadata from them without mutating the pending task.
  const interrupt = snapshot.tasks.flatMap((task: any) => task.interrupts ?? [])[0];
  if (!interrupt?.id || !snapshot.createdAt || !Number.isFinite(Date.parse(snapshot.createdAt))) {
    throw new Error("The saved clarification has no durable interaction metadata.");
  }
  return { id: interrupt.id, requestedAt: snapshot.createdAt,
    expiresAt: new Date(Date.parse(snapshot.createdAt) + CLARIFICATION_WINDOW_MS).toISOString(), status: "waiting" };
}

export interface SparrowOrchestratorDependencies {
  projectService: ProjectService;
  duckDBService: IDuckDBService;
  modelValidationService: IModelValidationService;
  checkpointer: BaseCheckpointSaver;
  intentRepository: ISparrowIntentRepository;
  now?: () => number;
  withConversationLock?: <T>(threadId: string, work: () => Promise<T>) => Promise<T>;
}

export interface RunSparrowInput {
  userQuery: string;
  projectId: string;
  conversationId?: string;
  conversationHistory?: Array<{ role: string; content: string }>;
  executionState?: Record<string, any>;
  interactionId?: string;
  onThinkingUpdate?: (steps: SparrowThinkingStep[]) => void;
}

export class SparrowOrchestrator {
  private readonly checkpointer: BaseCheckpointSaver;
  private readonly intents: ISparrowIntentRepository;

  constructor(private readonly deps: SparrowOrchestratorDependencies) {
    this.checkpointer = deps.checkpointer;
    this.intents = deps.intentRepository;
  }

  public async getInteraction(input: { projectId: string; conversationId: string }): Promise<Partial<SparrowChatResponse>> {
    if (typeof input.projectId !== "string" || !input.projectId.trim()
      || typeof input.conversationId !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(input.conversationId)) {
      throw new Error("A valid project and conversation are required.");
    }
    const projectId = input.projectId.trim();
    if (!await this.deps.projectService.getById(projectId)) throw new Error("Project does not exist or access is restricted.");
    const threadId = `sparrow:${projectId}:${input.conversationId}`;
    const work = async () => {
      const graph = createSparrowGraph({ tools: this.createToolsMap(projectId), checkpointer: this.checkpointer, now: this.deps.now });
      const config = { configurable: { thread_id: threadId } };
      const snapshot = await graph.getState(config);
      if (snapshot.values.projectId && snapshot.values.projectId !== projectId) throw new Error("Checkpoint project mismatch.");
      const prompt = snapshot.tasks.flatMap(task => task.interrupts ?? [])[0]?.value;
      if (!prompt) return { ...(snapshot.values.response ?? { status: "complete" as const }),
        clarificationReplies: (snapshot.values.clarificationHistory ?? []).map((reply: { question: string; answer: string }) => ({ question: reply.question, answer: reply.answer })),
        interaction: snapshot.values.interaction ?? undefined, executionState: { projectId, threadId: input.conversationId } };
      const interaction = interactionAt(savedInteraction(snapshot), this.deps.now?.());
      // Expiry stops the active interaction window; the native interrupt remains
      // checkpointed and can still be resumed by a later answer.
      return { status: "awaiting_user_input" as const, clarification: clarificationSchema.parse(prompt), interaction,
        clarificationReplies: (snapshot.values.clarificationHistory ?? []).map((reply: { question: string; answer: string }) => ({ question: reply.question, answer: reply.answer })),
        serverNow: new Date(this.deps.now?.() ?? Date.now()).toISOString(),
        executionState: { projectId, threadId: input.conversationId } };
    };
    return this.deps.withConversationLock ? this.deps.withConversationLock(threadId, work) : work();
  }

  public async run(input: RunSparrowInput): Promise<SparrowChatResponse> {
    if (typeof input.projectId !== "string" || !input.projectId.trim()) throw new Error("A valid projectId is required.");
    if (typeof input.userQuery !== "string" || !input.userQuery.trim()) throw new Error("A user query is required.");
    const projectId = input.projectId.trim();
    const project = await this.deps.projectService.getById(projectId);
    if (!project) throw new Error("Project does not exist or access is restricted.");
    if (input.executionState?.projectId && input.executionState.projectId !== projectId) {
      throw new Error("Conversation state belongs to a different project.");
    }
    if (input.executionState?.pendingIntent && !input.executionState.threadId) {
      throw new Error("This clarification predates Sparrow graph checkpoints. Please resend the original request.");
    }
    if (input.conversationId && input.executionState?.threadId && input.conversationId !== input.executionState.threadId) {
      throw new Error("Conversation identifier does not match the checkpoint token.");
    }
    const conversationId = input.conversationId ?? input.executionState?.threadId ?? randomUUID();
    if (typeof conversationId !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(conversationId)) {
      throw new Error("Invalid conversation identifier.");
    }
    // Project scoping is derived on the server, never restored from client state.
    const threadId = `sparrow:${projectId}:${conversationId}`;
    const work = () => this.invokeGraph(input, project, projectId, conversationId, threadId);
    return this.deps.withConversationLock ? this.deps.withConversationLock(threadId, work) : work();
  }

  private async invokeGraph(input: RunSparrowInput, project: any, projectId: string, conversationId: string, threadId: string): Promise<SparrowChatResponse> {
    const graph = createSparrowGraph({
      tools: this.createToolsMap(projectId), checkpointer: this.checkpointer,
      now: this.deps.now,
      onThinkingUpdate: input.onThinkingUpdate,
    });
    const config = { configurable: { thread_id: threadId }, recursionLimit: 80 };
    const snapshot = await graph.getState(config);
    const hasCheckpoint = Boolean(snapshot.values?.projectId);
    const pendingInterrupt = snapshot.tasks.some((task) => task.interrupts?.length);
    const retryIncompleteTurn = hasCheckpoint && !pendingInterrupt && snapshot.next.length > 0;
    if (hasCheckpoint && snapshot.values.projectId !== projectId) throw new Error("Checkpoint project mismatch.");
    const stateToken = { projectId, threadId: conversationId };
    if (input.interactionId) {
      const acceptedAnswer = snapshot.values.clarificationHistory?.find((reply: { id: string; answer: string }) => reply.id === input.interactionId);
      const alreadyAccepted = acceptedAnswer?.answer === input.userQuery.trim();
      if (alreadyAccepted && pendingInterrupt && snapshot.values.interaction?.id !== input.interactionId) {
        const currentPrompt = clarificationSchema.parse(snapshot.tasks.flatMap(task => task.interrupts ?? [])[0].value);
        return { status: "awaiting_user_input", content: currentPrompt.question, clarification: currentPrompt,
          interaction: interactionAt(snapshot.values.interaction, this.deps.now?.()),
          serverNow: new Date(this.deps.now?.() ?? Date.now()).toISOString(), thinking: snapshot.values.thinking,
          executionState: stateToken };
      }
      if (!pendingInterrupt && snapshot.values.interaction?.id === input.interactionId
        && snapshot.values.interaction.status === "answered"
        && snapshot.values.clarificationAnswer === input.userQuery.trim() && snapshot.values.response) {
        return { ...snapshot.values.response, executionState: stateToken };
      }
      if ((!pendingInterrupt && !(alreadyAccepted && retryIncompleteTurn))
        || (!alreadyAccepted && (!pendingInterrupt || savedInteraction(snapshot).id !== input.interactionId))) {
        throw new Error("This clarification is no longer pending. Refresh the conversation before answering.");
      }
    }
    const intents = await this.intents.getActiveIntents();
    if (retryIncompleteTurn && input.userQuery.trim() !== snapshot.values.userQuery && input.userQuery.trim() !== snapshot.values.clarificationAnswer) {
      throw new Error("The previous turn is incomplete. Start a new conversation before submitting another query.");
    }
    const seedHistory: SparrowMessage[] = !hasCheckpoint ? (input.conversationHistory ?? [])
      .filter((message) => (message.role === "user" || message.role === "assistant") && typeof message.content === "string")
      .slice(-23).map((message) => ({ role: message.role as "user" | "assistant", content: message.content.slice(0, 12000) })) : [];
    const result = await graph.invoke(pendingInterrupt ? new Command({ resume: {
      answer: input.userQuery.trim(), intentCatalog: intents, interaction: savedInteraction(snapshot),
    } }) : retryIncompleteTurn ? null : {
      projectId, userQuery: input.userQuery.trim(),
      messages: [...(hasCheckpoint && Array.isArray(snapshot.values?.messages) ? snapshot.values.messages : seedHistory), { role: "user" as const, content: input.userQuery.trim() }].slice(-24),
      projectContext: { ...projectBusinessContext(project), projectId },
      intentCatalog: intents, queryUnderstanding: null, plan: null, response: null,
      toolResults: [], thinking: [], nextAction: "resolve" as const,
      hitlState: null, interaction: null, clarificationAnswer: "", clarificationHistory: [], contextInspected: false,
      toolCalls: 0, rectifications: 0, correctedResultsCount: 0, decisionReady: false, stopReason: "",
    }, config);
    const next = await graph.getState(config);
    const clarification = next.tasks.flatMap((task) => task.interrupts ?? [])[0]?.value;
    if (clarification) {
      const prompt = clarificationSchema.parse(clarification);
      const interaction = interactionAt(savedInteraction(next), this.deps.now?.());
      return {
        status: "awaiting_user_input", content: prompt.question,
        clarification: prompt, interaction, serverNow: new Date(this.deps.now?.() ?? Date.now()).toISOString(), thinking: Array.isArray(next.values?.thinking) ? next.values.thinking : [],
        executionState: stateToken,
      };
    }
    if (!result.response) throw new Error("Sparrow graph ended without a response.");
    return { ...result.response, executionState: stateToken };
  }

  private createToolsMap(projectId: string): Map<string, any> {
    const map = new Map<string, any>();

    const projCtxTool = createGetProjectContextTool(projectId, {
      projectService: this.deps.projectService,
      duckDBService: this.deps.duckDBService,
    });
    map.set("getProjectContext", projCtxTool);

    const projSchemaTool = createGetProjectDataSchemaTool(projectId, {
      projectService: this.deps.projectService,
      duckDBService: this.deps.duckDBService,
    });
    map.set("getProjectDataSchema", projSchemaTool);

    const queryDataTool = createQueryProjectDataTool(projectId, {
      projectService: this.deps.projectService,
      duckDBService: this.deps.duckDBService,
    });
    map.set("queryProjectData", queryDataTool);

    const aggMetricsTool = createAggregateMetricsTool(projectId, {
      projectService: this.deps.projectService,
      duckDBService: this.deps.duckDBService,
    });
    map.set("aggregateMetrics", aggMetricsTool);

    const compPeriodsTool = createComparePeriodsTool(projectId, {
      projectService: this.deps.projectService,
      duckDBService: this.deps.duckDBService,
    });
    map.set("comparePeriods", compPeriodsTool);

    const discModelsTool = createDiscoverAvailableModelsTool(projectId, {
      projectService: this.deps.projectService,
      modelValidationService: this.deps.modelValidationService,
    });
    map.set("discoverAvailableModels", discModelsTool);

    map.set("calculateMetric", createCalculateMetricTool());

    const runInferenceTool = createRunModelInferenceTool(projectId, {
      projectService: this.deps.projectService,
      modelValidationService: this.deps.modelValidationService,
    });
    map.set("runModelInference", runInferenceTool);

    const searchTool = createWebSearchTool();
    map.set("web_search", searchTool);

    return map;
  }
}
