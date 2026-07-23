import { StateGraph } from "@langchain/langgraph";
import { AgentState } from "./state";
import { inspectorNode } from "./IngestionLayer/inspector/inspectorNode";
import { profilerNode } from "./IngestionLayer/profiler/profilerNode";
import { preprocessorNode } from "./IngestionLayer/preprocessor/preprocessorNode";
import { schemaResolverNode } from "./IngestionLayer/resolver/schemaResolverNode";

export function createAgentGraph(checkpointer: any) {
  const workflow = new StateGraph(AgentState)
    .addNode("inspect", inspectorNode as any)
    .addNode("profileData", profilerNode as any)
    .addNode("preprocess", preprocessorNode as any)
    .addNode("resolveSchema", schemaResolverNode as any)
    .addEdge("__start__", "inspect")
    .addEdge("inspect", "profileData")
    .addEdge("profileData", "preprocess")
    .addEdge("preprocess", "resolveSchema")
    .addEdge("resolveSchema", "__end__");

  return workflow.compile({
    checkpointer,
    interruptBefore: ["profileData", "resolveSchema"],
  });
}
