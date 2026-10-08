import { SparrowChatResponse, SparrowThinkingStep } from "./types";
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
  createGetModelValidationResultsTool,
  createRunModelInferenceTool,
} from "./tools/modelInference.tools";
import { createWebSearchTool } from "../tools/search/websearch";

import { BaseCheckpointSaver, Command } from "@langchain/langgraph";
import { randomUUID } from "crypto";
import { ISparrowIntentRepository } from "../../repositories/sparrowIntent.repository";
import { createSparrowGraph } from "./graph";
import { SparrowMessage } from "./sparrowState";

export interface SparrowOrchestratorDependencies {
  projectService: ProjectService;
  duckDBService: IDuckDBService;
  modelValidationService: IModelValidationService;
  checkpointer: BaseCheckpointSaver;
  intentRepository: ISparrowIntentRepository;
  withConversationLock?: <T>(threadId: string, work: () => Promise<T>) => Promise<T>;
}

export interface RunSparrowInput {
  userQuery: string;
  projectId: string;
  conversationId?: string;
  conversationHistory?: Array<{ role: string; content: string }>;
  executionState?: Record<string, any>;
  onThinkingUpdate?: (steps: SparrowThinkingStep[]) => void;
}

export class SparrowOrchestrator {
  private readonly checkpointer: BaseCheckpointSaver;
  private readonly intents: ISparrowIntentRepository;

  constructor(private readonly deps: SparrowOrchestratorDependencies) {
    this.checkpointer = deps.checkpointer;
    this.intents = deps.intentRepository;
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
      onThinkingUpdate: input.onThinkingUpdate,
    });
    const config = { configurable: { thread_id: threadId }, recursionLimit: 80 };
    const snapshot = await graph.getState(config);
    const hasCheckpoint = Boolean(snapshot.values?.projectId);
    const pendingInterrupt = snapshot.tasks.some((task) => task.interrupts?.length);
    const retryIncompleteTurn = hasCheckpoint && !pendingInterrupt && snapshot.next.length > 0;
    if (hasCheckpoint && snapshot.values.projectId !== projectId) throw new Error("Checkpoint project mismatch.");
    const stateToken = { projectId, threadId: conversationId };
    const intents = await this.intents.getActiveIntents();
    if (pendingInterrupt) {
      // Refresh the catalog after pauses without replacing the preserved execution state.
      await graph.updateState(config, { intentCatalog: intents });
    } else if (retryIncompleteTurn && input.userQuery.trim() !== snapshot.values.userQuery && input.userQuery.trim() !== snapshot.values.clarificationAnswer) {
      throw new Error("The previous turn is incomplete. Start a new conversation before submitting another query.");
    }
    const seedHistory: SparrowMessage[] = !hasCheckpoint ? (input.conversationHistory ?? [])
      .filter((message) => (message.role === "user" || message.role === "assistant") && typeof message.content === "string")
      .slice(-23).map((message) => ({ role: message.role as "user" | "assistant", content: message.content.slice(0, 12000) })) : [];
    const state = project.agentState ?? {};
    const result = await graph.invoke(pendingInterrupt ? new Command({ resume: input.userQuery.trim() }) : retryIncompleteTurn ? null : {
      projectId, userQuery: input.userQuery.trim(),
      messages: [...(hasCheckpoint ? snapshot.values.messages : seedHistory), { role: "user" as const, content: input.userQuery.trim() }].slice(-24),
      projectContext: {
        projectId, projectName: project.projectName || project.name,
        domain: project.domain, useCase: project.useCase,
        targetColumn: state.targetColumn || state.prediction_target_column,
        stageStatuses: state.stageStatuses, availableModels: state.modelTraining?.report?.ranked_models,
      },
      intentCatalog: intents, queryUnderstanding: null, plan: null, response: null,
      toolResults: [], thinking: [], nextAction: "resolve" as const,
      hitlState: null, clarificationAnswer: "", contextInspected: false,
      toolCalls: 0, rectifications: 0, correctedResultsCount: 0, decisionReady: false, stopReason: "",
    }, config);
    const next = await graph.getState(config);
    const clarification = next.tasks.flatMap((task) => task.interrupts ?? [])[0]?.value;
    if (clarification) {
      return {
        status: "awaiting_user_input", content: (clarification as any).question,
        clarification: clarification as any, thinking: next.values.thinking ?? [],
        suggestedActions: (clarification as any).options, executionState: stateToken,
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

    const getValResultsTool = createGetModelValidationResultsTool(projectId, {
      projectService: this.deps.projectService,
      modelValidationService: this.deps.modelValidationService,
    });
    map.set("getModelValidationResults", getValResultsTool);

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
