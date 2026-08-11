import { StateGraph } from "@langchain/langgraph";
import { AgentState } from "./state";
import { inspectorNode } from "./IngestionLayer/inspector/inspectorNode";
import { profilerNode } from "./IngestionLayer/profiler/profilerNode";
import { preprocessorNode } from "./IngestionLayer/preprocessor/preprocessorNode";
import { schemaResolverNode } from "./IngestionLayer/resolver/schemaResolverNode";

export function createAgentGraph(checkpointer: any) {
  const workflow = new StateGraph(AgentState)
    .addNode("inspect", inspectorNode)
    .addNode("profileData", profilerNode)
    .addNode("preprocess", preprocessorNode)
    .addNode("resolveSchema", schemaResolverNode)
    .addEdge("__start__", "inspect")
    .addEdge("inspect", "profileData")
    .addEdge("profileData", "preprocess")
    .addEdge("preprocess", "resolveSchema")
    .addEdge("resolveSchema", "__end__");

  return workflow.compile({
    checkpointer,
  });
}
