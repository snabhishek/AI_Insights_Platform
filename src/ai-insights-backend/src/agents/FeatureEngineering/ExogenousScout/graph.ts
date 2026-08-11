import { StateGraph, Send } from "@langchain/langgraph";
import { ExogenousScoutAnnotation } from "./state";
import { exogenousWorkerNode, exogenousAggregatorNode } from "./workerNode";

/**
 * Dynamic routing function that maps each batch to a parallel workerNode via LangGraph Send API
 */
export function dispatchBatches(state: typeof ExogenousScoutAnnotation.State) {
  const { batches, tableMetaMap, userPrompt, projectDomain, systemPrompt } = state;
  if (!batches || batches.length === 0) {
    return [new Send("exogenousAggregatorNode", {})];
  }

  return batches.map((batchTableNames, index) => {
    return new Send("exogenousWorkerNode", {
      workerId: index + 1,
      batchTableNames,
      batchIndex: index,
      totalBatches: batches.length,
      tableMetaMap,
      userPrompt,
      projectDomain,
      systemPrompt,
    });
  });
}

/**
 * Builds and compiles the LangGraph Map-Reduce StateGraph for Exogenous Scouting
 */
export function createExogenousScoutGraph() {
  return new StateGraph(ExogenousScoutAnnotation)
    .addNode("exogenousWorkerNode", exogenousWorkerNode)
    .addNode("exogenousAggregatorNode", exogenousAggregatorNode)
    .addConditionalEdges("__start__", dispatchBatches)
    .addEdge("exogenousWorkerNode", "exogenousAggregatorNode")
    .addEdge("exogenousAggregatorNode", "__end__")
    .compile();
}
