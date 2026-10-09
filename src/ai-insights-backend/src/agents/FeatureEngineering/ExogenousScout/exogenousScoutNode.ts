import { RunnableConfig } from "@langchain/core/runnables";
import { AgentState, IngestionServices, BatchedTableState } from "../../state";
import {
  getPromptFromFile,
  chunkInspectionTableNames,
  mergeBatchedTableStates,
  logMilestoneThinking,
} from "../../utils/agentUtils";
import {
  ExogenousSourceRecommendation,
  TableExogenousAnalysis,
  ExogenousScoutBatchResult,
  TableMetaEntry,
  WorkerBatchInput,
  ExogenousScoutAnnotation,
  ExogenousScoutStateType,
} from "./state";
import {
  extractTableMetadataMap,
  createFallbackBatchResult,
  EXOGENOUS_BATCH_USER_PROMPT_TEMPLATE,
  EXOGENOUS_INITIAL_BATCH_SIZE,
  EXOGENOUS_FOLLOW_UP_BATCH_SIZE,
  MAX_CONCURRENT_WORKERS,
} from "./utils";
import { exogenousWorkerNode, exogenousAggregatorNode } from "./workerNode";
import { createExogenousScoutGraph, dispatchBatches } from "./graph";

export {
  ExogenousSourceRecommendation,
  TableExogenousAnalysis,
  ExogenousScoutBatchResult,
  TableMetaEntry,
  WorkerBatchInput,
  ExogenousScoutAnnotation,
  ExogenousScoutStateType,
  extractTableMetadataMap,
  createFallbackBatchResult,
  EXOGENOUS_BATCH_USER_PROMPT_TEMPLATE,
  exogenousWorkerNode,
  exogenousAggregatorNode,
  createExogenousScoutGraph,
  dispatchBatches,
};

export async function exogenousScoutNode(state: typeof AgentState.State, config?: RunnableConfig) {
  const services = config?.configurable?.services as IngestionServices;
  if (!services) {
    throw new Error("Services dependency is not provided in config");
  }
  if (services.isCancelled?.() || services.abortSignal?.aborted) {
    console.info(`[Workflow] exogenousScoutNode skipping execution because workflow is stopped/paused.`);
    return { status: "Stopped" };
  }

  let tableNames: string[] = [];
  if (Array.isArray(state.batchedTables) && state.batchedTables.length > 0) {
    tableNames = state.batchedTables
      .map((t: BatchedTableState) => t.tableName)
      .filter((name: string) => typeof name === "string" && name.trim().length > 0);
  }

  if (tableNames.length === 0) {
    const metaMap = extractTableMetadataMap(state);
    tableNames = Array.from(metaMap.keys());
  }

  tableNames = Array.from(new Set(tableNames));

  if (tableNames.length === 0) {
    tableNames = ["default_table"];
  }

  const tableMetaMap = extractTableMetadataMap(state);
  const projectDomain = (state.schemaResolution as any)?.domain || (state.schemaResolution as any)?.domainKnowledge?.tier2;
  const safeUserPrompt = typeof state.userPrompt === "string" ? state.userPrompt : "";

  const batches = chunkInspectionTableNames(tableNames, EXOGENOUS_INITIAL_BATCH_SIZE, EXOGENOUS_FOLLOW_UP_BATCH_SIZE);

  const systemPrompt = await getPromptFromFile(
    "exogenous.md",
    "You are an expert AI Feature Engineering & Exogenous Variable Scout Agent. Search the web for external datasets and APIs to enrich internal tables."
  );

  await logMilestoneThinking(
    services,
    "Exogenous Scout",
    `Spawning LangGraph worker subagents for ${tableNames.length} tables in ${batches.length} batch(es)...`
  );

  const scoutGraph = createExogenousScoutGraph();
  const graphResult = await scoutGraph.invoke(
    {
      batches,
      tableMetaMap,
      userPrompt: safeUserPrompt,
      projectDomain,
      systemPrompt,
      workerResults: [],
      workerStatuses: [],
      finalOutput: {},
    },
    {
      configurable: { services },
      maxConcurrency: MAX_CONCURRENT_WORKERS,
    }
  );

  const finalOutput = graphResult.finalOutput || {};
  const workerStatuses: BatchedTableState[] = graphResult.workerStatuses || [];
  const updatedBatchedTables = mergeBatchedTableStates(state.batchedTables, workerStatuses);

  return {
    exogenousScout: finalOutput,
    batchedTables: updatedBatchedTables,
    status: "In-Progress",
    summary: "Exogenous data scouting completed",
    steps: [{ name: "Exogenous Scout", status: "Completed", summary: "Scouted external data via LangGraph worker nodes" }],
    exogenous: finalOutput,
    stageOutputs: { exogenous: finalOutput },
    stageStatuses: { exogenous: "Completed" },
  };
}
