import { StateGraph } from "@langchain/langgraph";
import { SparrowAnnotation, SparrowState } from "./sparrowState";
import { createSparrowNodes, SparrowGraphDependencies } from "./nodes";
import { sparrowRunContext, throwIfSparrowStopped } from "./executionContext";

export type { SparrowGraphDependencies } from "./nodes";

export function routeSparrow(state: SparrowState) { return state.nextAction; }

export function createSparrowGraph(deps: SparrowGraphDependencies) {
  const nodes = createSparrowNodes(deps);
  const logged = (name: string, execute: (state: SparrowState) => Promise<Partial<SparrowState>>) => async (state: SparrowState) => {
    throwIfSparrowStopped();
    const run = sparrowRunContext.getStore();
    const scope = `project=${state.projectId} conversation=${run?.conversationId ?? "checkpoint"} request=${run?.requestId ?? "checkpoint"}`;
    const started = Date.now();
    console.info(`[Sparrow] Node [${name}] started agent execution (${scope})`);
    try {
      const result = await execute(state);
      throwIfSparrowStopped();
      console.info(`[Sparrow] Node [${name}] completed (${scope}, ${Date.now() - started}ms)`);
      return result;
    } catch (error: any) {
      const status = run?.signal.aborted ? "stopped" : error?.name === "GraphInterrupt" ? "waiting for clarification" : "failed";
      console.info(`[Sparrow] Node [${name}] ${status} (${scope}, ${Date.now() - started}ms)`);
      throw error;
    }
  };
  return new StateGraph(SparrowAnnotation)
    .addNode("supervisorNode", logged("supervisorNode", nodes.supervisorNode))
    .addNode("queryResolverNode", logged("queryResolverNode", nodes.queryResolverNode))
    .addNode("projectContextNode", logged("projectContextNode", nodes.projectContextNode))
    .addNode("toolExecutorNode", logged("toolExecutorNode", nodes.toolExecutorNode))
    .addNode("programRectificationNode", logged("programRectificationNode", nodes.programRectificationNode))
    .addNode("clarificationNode", logged("clarificationNode", nodes.clarificationNode))
    .addNode("responderNode", logged("responderNode", nodes.responderNode))
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
