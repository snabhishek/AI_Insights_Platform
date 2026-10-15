import { ISparrowChatService, SendChatMessageInput } from "./sparrowChat.service.interface";
import { SparrowChatResponse } from "../../agents/sparrow/types";
import { SparrowOrchestrator } from "../../agents/sparrow/sparrowOrchestrator";
import { ProjectService } from "../project/project.service";
import { IDuckDBService } from "../duckdb/duckdb.service.interface";
import { IModelValidationService } from "../ai/model-validation/modelValidation.service.interface";
import { BaseCheckpointSaver } from "@langchain/langgraph";
import { Pool } from "pg";
import { ISparrowIntentRepository } from "../../repositories/sparrowIntent.repository";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ISparrowChatRepository, PostgresSparrowChatRepository, StoredChatTurn } from "../../repositories/sparrowChat.repository";
import { sparrowRunContext, SparrowRunContext, stoppedResponse } from "../../agents/sparrow/executionContext";
import { setupTimestampedLogging } from "../../utils/logger";

const identifier = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
const metadataSchema = z.object({ title: z.string().max(255).optional(), agentPersona: z.string().max(100).optional(),
  projectName: z.string().max(255).optional(), pinned: z.boolean().optional() }).strict();

export class SparrowChatService implements ISparrowChatService {
  private orchestrator: Pick<SparrowOrchestrator, "run" | "getInteraction">;
  private readonly repository: ISparrowChatRepository;
  private readonly active = new Map<string, { controller: AbortController; context: SparrowRunContext; turn: StoredChatTurn; finished: Promise<void> }>();

  constructor(
    private readonly projectService: ProjectService,
    private readonly duckDBService: IDuckDBService,
    private readonly modelValidationService: IModelValidationService,
    persistence: { checkpointer: BaseCheckpointSaver; intentRepository: ISparrowIntentRepository; lockPool: Pool;
      chatRepository?: ISparrowChatRepository; orchestrator?: Pick<SparrowOrchestrator, "run" | "getInteraction"> }
  ) {
    setupTimestampedLogging();
    this.repository = persistence.chatRepository ?? new PostgresSparrowChatRepository(persistence.lockPool);
    this.orchestrator = new SparrowOrchestrator({
      projectService: this.projectService,
      duckDBService: this.duckDBService,
      modelValidationService: this.modelValidationService,
      checkpointer: persistence.checkpointer,
      intentRepository: persistence.intentRepository,
      withConversationLock: async (threadId, work) => {
        const client = await persistence.lockPool.connect();
        let locked = false;
        try {
          const result = await client.query("SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked", [threadId]);
          locked = result.rows[0].locked;
          if (!locked) throw new Error("This conversation is already processing a message. Please wait for it to finish.");
          return await work();
        } finally {
          try {
            if (locked) await client.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [threadId]);
          } catch (error) {
            client.release(error instanceof Error ? error : new Error(String(error)));
            throw error;
          }
          client.release();
        }
      },
    });
    if (persistence.orchestrator) this.orchestrator = persistence.orchestrator;
  }

  public async sendMessage(input: SendChatMessageInput): Promise<SparrowChatResponse> {
    const turn = await this.turn(input);
    const key = `${turn.projectId}:${turn.conversationId}`;
    while (this.active.has(key)) {
      const running = this.active.get(key)!;
      if (!running.controller.signal.aborted) throw new Error("This conversation is already processing a message.");
      await running.finished;
    }
    const controller = new AbortController();
    const context: SparrowRunContext = { signal: controller.signal, projectId: turn.projectId, conversationId: turn.conversationId, requestId: turn.requestId, thinking: [] };
    let done!: () => void;
    const finished = new Promise<void>(resolve => { done = resolve; });
    this.active.set(key, { controller, context, turn, finished });
    let poll: ReturnType<typeof setInterval> | undefined;
    let writes = Promise.resolve(); let lastSave = 0; let polling = false;
    const persistProgress = () => {
      const thinking = [...context.thinking];
      writes = writes.then(() => this.repository.progress(turn, thinking));
      // Observe errors now; finalization still awaits and reports the original failure.
      void writes.catch(error => console.error("[Sparrow] Could not persist chat progress:", error.message));
    };
    try {
      const previous = await this.repository.latest(turn.projectId, turn.conversationId);
      const saved = await this.repository.begin(turn);
      if (saved?.status !== "sending") return saved;
      poll = setInterval(() => {
        if (polling || controller.signal.aborted) return;
        polling = true;
        void this.repository.get(turn).then(message => {
          if (message?.status === "stopped") controller.abort(new Error("Agent was stopped"));
        }).catch(error => console.error("[Sparrow] Could not check chat cancellation:", error.message)).finally(() => { polling = false; });
      }, 500);
      console.info(`[Sparrow] Chat execution started (project=${turn.projectId} conversation=${turn.conversationId} request=${turn.requestId})`);
      let response: SparrowChatResponse;
      try {
        response = await sparrowRunContext.run(context, () => this.orchestrator.run({ ...input, ...turn, resetStoppedTurn: previous?.status === "stopped",
          onThinkingUpdate: thinking => {
            if (controller.signal.aborted) return;
            context.thinking = thinking;
            input.onThinkingUpdate?.(thinking);
            if (Date.now() - lastSave >= 250) { lastSave = Date.now(); persistProgress(); }
          } }));
      } catch (error: any) {
        if (controller.signal.aborted) response = stoppedResponse(context.thinking, { projectId: turn.projectId, threadId: turn.conversationId });
        else {
          console.error("[Sparrow] Chat execution failed:", error);
          response = { status: "error", content: "Sparrow could not complete this request. Please try again or start a new conversation.",
            thinking: context.thinking.map(step => step.done ? step : { ...step, status: "failed" }), error: error.message || String(error) };
        }
      }
      if (controller.signal.aborted) response = stoppedResponse(context.thinking, { projectId: turn.projectId, threadId: turn.conversationId });
      await writes;
      const persisted = await this.repository.finish(turn, response);
      if (!persisted) throw new Error("The chat response could not be saved.");
      console.info(`[Sparrow] Chat execution ${persisted.status} and saved (project=${turn.projectId} conversation=${turn.conversationId} request=${turn.requestId})`);
      return persisted;
    } finally {
      if (poll) clearInterval(poll);
      this.active.delete(key); done();
    }
  }

  private async turn(input: SendChatMessageInput): Promise<StoredChatTurn> {
    const projectId = z.string().trim().min(1).max(50).parse(input.projectId);
    if (!await this.projectService.getById(projectId)) throw new Error("Project does not exist or access is restricted.");
    return { projectId, conversationId: identifier.parse(input.conversationId ?? input.executionState?.threadId ?? randomUUID()),
      requestId: identifier.parse(input.requestId ?? randomUUID()), messageId: identifier.parse(input.messageId ?? randomUUID()),
      userMessageId: identifier.parse(input.userMessageId ?? randomUUID()), userQuery: z.string().trim().min(1).max(12000).parse(input.userQuery),
      userContent: input.userContent === undefined ? undefined : z.string().max(16000).parse(input.userContent),
      session: input.session ? metadataSchema.parse(input.session) : undefined };
  }

  public async stop(input: SendChatMessageInput & { conversationId: string; requestId: string; messageId: string }) {
    const turn = await this.turn(input);
    const running = this.active.get(`${turn.projectId}:${turn.conversationId}`);
    const matching = running?.context.requestId === turn.requestId ? running : undefined;
    const saved = await this.repository.get(turn);
    const response = stoppedResponse(matching?.context.thinking ?? saved?.thinking ?? [], { projectId: turn.projectId, threadId: turn.conversationId });
    const persisted = await this.repository.stop(turn, response);
    if (persisted?.status === "stopped") matching?.controller.abort(new Error("Agent was stopped"));
    console.info(`[Sparrow] Stop requested (project=${turn.projectId} conversation=${turn.conversationId} request=${turn.requestId}, status=${persisted?.status})`);
    return persisted;
  }

  public async listSessions(projectIds: string[]) {
    const allowed: string[] = [];
    for (const id of z.array(z.string().min(1).max(50)).max(200).parse(projectIds)) if (await this.projectService.getById(id)) allowed.push(id);
    return this.repository.list(allowed);
  }
  public async updateSession(projectId: string, conversationId: string, metadata: Record<string, unknown>) {
    await this.turn({ projectId, conversationId, userQuery: "metadata" });
    await this.repository.metadata(projectId, conversationId, metadataSchema.parse(metadata));
  }
  public async deleteSession(projectId: string, conversationId: string) {
    await this.turn({ projectId, conversationId, userQuery: "delete" });
    const running = this.active.get(`${projectId}:${conversationId}`);
    if (running) { running.controller.abort(new Error("Agent was stopped")); await running.finished; }
    await this.repository.remove(projectId, conversationId);
  }
  public async importSessions(sessions: any[]) {
    for (const session of z.array(z.object({ id: identifier, projectId: z.string().min(1).max(50), title: z.string().max(255),
      agentPersona: z.string().max(100), projectName: z.string().max(255).optional(), createdAt: z.string().optional(), updatedAt: z.string().optional(), pinned: z.boolean().optional(),
      messages: z.array(z.object({ id: identifier, role: z.enum(["user", "assistant", "system"]), content: z.string().max(100000), timestamp: z.string(),
        requestId: identifier.optional(), isThinking: z.boolean().optional(),
        thinking: z.array(z.object({ time: z.string(), text: z.string(), done: z.boolean(), timestamp: z.string().optional(),
          status: z.enum(["running", "completed", "stopped", "failed"]).optional() }).passthrough()).optional()
      }).passthrough()).max(1000) }).strict()).max(200).parse(sessions)) {
      if (await this.projectService.getById(session.projectId)) await this.repository.importSession(session);
    }
  }

  public getInteraction(input: { projectId: string; conversationId: string }): Promise<Partial<SparrowChatResponse>> {
    return this.orchestrator.getInteraction(input);
  }
}
