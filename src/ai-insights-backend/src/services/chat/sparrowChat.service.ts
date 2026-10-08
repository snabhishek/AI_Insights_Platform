import { ISparrowChatService, SendChatMessageInput } from "./sparrowChat.service.interface";
import { SparrowChatResponse } from "../../agents/sparrow/types";
import { SparrowOrchestrator } from "../../agents/sparrow/sparrowOrchestrator";
import { ProjectService } from "../project/project.service";
import { IDuckDBService } from "../duckdb/duckdb.service.interface";
import { IModelValidationService } from "../ai/model-validation/modelValidation.service.interface";
import { BaseCheckpointSaver } from "@langchain/langgraph";
import { Pool } from "pg";
import { ISparrowIntentRepository } from "../../repositories/sparrowIntent.repository";

export class SparrowChatService implements ISparrowChatService {
  private orchestrator: SparrowOrchestrator;

  constructor(
    private readonly projectService: ProjectService,
    private readonly duckDBService: IDuckDBService,
    private readonly modelValidationService: IModelValidationService,
    persistence: { checkpointer: BaseCheckpointSaver; intentRepository: ISparrowIntentRepository; lockPool: Pool }
  ) {
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
  }

  public async sendMessage(input: SendChatMessageInput): Promise<SparrowChatResponse> {
    try {
      return await this.orchestrator.run(input);
    } catch (err: any) {
      console.error("[SparrowChatService] Error processing chat query:", err);
      return {
        status: "error",
        content: "Sparrow could not complete this request. Please try again or start a new conversation.",
        thinking: [
          { time: "00:01", text: "Processing failed due to internal error.", done: true },
        ],
        error: err?.message || String(err),
      };
    }
  }

  public getInteraction(input: { projectId: string; conversationId: string }): Promise<Partial<SparrowChatResponse>> {
    return this.orchestrator.getInteraction(input);
  }
}
