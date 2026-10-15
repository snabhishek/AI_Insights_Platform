import { Pool } from "pg";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { PostgresSparrowIntentRepository } from "../../repositories/sparrowIntent.repository";

// Initialize infrastructure once before requests; graph execution owns writes.
export async function initializeSparrowPersistence(databasePool: Pool) {
  const checkpointer = new PostgresSaver(databasePool);
  await checkpointer.setup();
  // Conversation locks remain held while graph nodes need DB connections.
  const lockPool = new Pool({ ...databasePool.options, connectionTimeoutMillis: 5000 });
  return {
    checkpointer,
    intentRepository: new PostgresSparrowIntentRepository(databasePool),
    lockPool,
  };
}
