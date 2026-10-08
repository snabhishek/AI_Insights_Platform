import { StateGraph } from "@langchain/langgraph";
import { SparrowAnnotation, SparrowState } from "./sparrowState";
import { createSparrowNodes, SparrowGraphDependencies } from "./nodes";

export type { SparrowGraphDependencies } from "./nodes";

export function routeSparrow(state: SparrowState) { return state.nextAction; }

export function createSparrowGraph(deps: SparrowGraphDependencies) {
  const nodes = createSparrowNodes(deps);
  return new StateGraph(SparrowAnnotation)
    .addNode("supervisorNode", nodes.supervisorNode)
    .addNode("queryResolverNode", nodes.queryResolverNode)
    .addNode("projectContextNode", nodes.projectContextNode)
    .addNode("toolExecutorNode", nodes.toolExecutorNode)
    .addNode("programRectificationNode", nodes.programRectificationNode)
    .addNode("clarificationNode", nodes.clarificationNode)
    .addNode("responderNode", nodes.responderNode)
    .addEdge("__start__", "supervisorNode")
    .addConditionalEdges("supervisorNode", routeSparrow, {
      resolve: "queryResolverNode", context: "projectContextNode", tool: "toolExecutorNode",
      rectify: "programRectificationNode", clarify: "clarificationNode", respond: "responderNode", finish: "__end__",
    })
    .addEdge("queryResolverNode", "supervisorNode")
    .addEdge("projectContextNode", "supervisorNode")
    .addEdge("toolExecutorNode", "supervisorNode")
    .addEdge("programRectificationNode", "supervisorNode")
    .addEdge("clarificationNode", "supervisorNode")
    .addEdge("responderNode", "supervisorNode")
    .compile({ checkpointer: deps.checkpointer });
}
