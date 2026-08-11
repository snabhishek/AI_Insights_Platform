import { RunnableConfig } from "@langchain/core/runnables";
import { IngestionServices } from "../../state";
import { createWebSearchTool } from "../../tools/websearch";
import {
  getModel,
  buildBatchedTableState,
  invokeAgentJson,
  logMilestoneThinking,
} from "../../utils/agentUtils";
import {
  WorkerBatchInput,
  ExogenousScoutAnnotation,
  ExogenousScoutBatchResult,
  TableExogenousAnalysis,
} from "./state";
import {
  createFallbackBatchResult,
  EXOGENOUS_BATCH_USER_PROMPT_TEMPLATE,
} from "./utils";

/**
 * Worker Subagent Node in LangGraph
 * Processes a single batch of tables using websearch tool and invokeAgentJson.
 */
export async function exogenousWorkerNode(
  input: WorkerBatchInput,
  config?: RunnableConfig
) {
  const services = config?.configurable?.services as IngestionServices;
  const model = getModel();
  const fallback = createFallbackBatchResult(input.batchTableNames, input.tableMetaMap);

  const batchStatuses = buildBatchedTableState(
    input.batchTableNames,
    "exogenousScout",
    "scouted",
    `Exogenous data sources scouted in batch ${input.batchIndex + 1}/${input.totalBatches}`
  );

  if (!model) {
    return {
      workerResults: [fallback],
      workerStatuses: batchStatuses,
    };
  }

  const batchContext = input.batchTableNames.map((tblName) => {
    const meta = input.tableMetaMap.get(tblName);
    return {
      tableName: tblName,
      domain: meta?.domain || input.projectDomain || "General Business Domain",
      columns: meta?.columns || [],
    };
  });

  const userMessage = await EXOGENOUS_BATCH_USER_PROMPT_TEMPLATE.format({
    workerId: String(input.workerId),
    batchNumber: String(input.batchIndex + 1),
    totalBatches: String(input.totalBatches),
    batchTableNames: JSON.stringify(input.batchTableNames),
    domainSection: input.projectDomain ? `- Project Domain: "${input.projectDomain}"` : "",
    promptSection: input.userPrompt ? `- User Requirements / Prompt: "${input.userPrompt}"` : "",
    tableSchemaContext: JSON.stringify(batchContext, null, 2),
  });

  if (services) {
    await logMilestoneThinking(
      services,
      "Feature Engineering",
      `[Worker ${input.workerId}] Scouting exogenous data sources for batch ${input.batchIndex + 1}/${input.totalBatches}: [${input.batchTableNames.join(", ")}]...`
    );
  }

  const webSearchToolInstance = createWebSearchTool();

  try {
    const result = await invokeAgentJson<ExogenousScoutBatchResult>(
      "exogenousScout",
      model,
      userMessage,
      fallback,
      services,
      {
        systemPrompt: input.systemPrompt,
        tools: [webSearchToolInstance],
        traceLabel: `exogenousScout:worker-${input.workerId}:batch-${input.batchIndex + 1}`,
      }
    );

    const batchResult = (Array.isArray(result?.tables) && result.tables.length > 0)
      ? { ...fallback, ...result }
      : fallback;

    return {
      workerResults: [batchResult],
      workerStatuses: batchStatuses,
    };
  } catch (error) {
    console.warn(`[ExogenousWorker ${input.workerId}] Batch ${input.batchIndex + 1} execution failed, using fallback`, error);
    return {
      workerResults: [fallback],
      workerStatuses: batchStatuses,
    };
  }
}

/**
 * Aggregator / Fan-In Node in LangGraph
 * Aggregates all worker results and generates the final exogenous scout payload.
 */
export async function exogenousAggregatorNode(
  state: typeof ExogenousScoutAnnotation.State,
  config?: RunnableConfig
) {
  const services = config?.configurable?.services as IngestionServices;
  const accumulatedTables: TableExogenousAnalysis[] = [];
  const allSearchQueries: string[] = [];

  for (const batchResult of state.workerResults || []) {
    if (batchResult && Array.isArray(batchResult.tables)) {
      accumulatedTables.push(...batchResult.tables);
    }
    if (batchResult && Array.isArray(batchResult.searchQueriesExecuted)) {
      allSearchQueries.push(...batchResult.searchQueriesExecuted);
    }
  }

  if (services) {
    await logMilestoneThinking(
      services,
      "Feature Engineering",
      `Aggregated exogenous scouting results from all worker nodes for ${accumulatedTables.length} tables.`
    );
  }

  const finalOutput = {
    status: "completed",
    tableCount: accumulatedTables.length,
    tables: accumulatedTables,
    searchQueriesExecuted: Array.from(new Set(allSearchQueries)),
    summary: `Exogenous data scouting completed for ${accumulatedTables.length} tables across parallel worker subagents.`,
  };

  return {
    finalOutput,
  };
}
