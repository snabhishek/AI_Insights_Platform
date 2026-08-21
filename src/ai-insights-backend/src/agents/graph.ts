import { StateGraph } from "@langchain/langgraph";
import { AgentState } from "./state";
import { inspectorNode } from "./IngestionLayer/inspector/inspectorNode";
import { profilerNode } from "./IngestionLayer/profiler/profilerNode";
import { preprocessorNode } from "./IngestionLayer/preprocessor/preprocessorNode";
import { schemaResolverNode } from "./IngestionLayer/resolver/schemaResolverNode";
import { hierarchyMapperNode } from "./FeatureEngineering/HierarchyMapper/hierarchyMapperNode";
import { exogenousScoutNode } from "./FeatureEngineering/ExogenousScout/exogenousScoutNode";
import { featureArchitectNode } from "./FeatureEngineering/FeatureArchitect/featureArchitectNode";

export function createAgentGraph(checkpointer: any) {
  const workflow = new StateGraph(AgentState)
    .addNode("inspect", inspectorNode)
    .addNode("profileData", profilerNode)
    // .addNode("preprocess", preprocessorNode)
    .addNode("resolveSchema", schemaResolverNode)
    .addNode("hierarchyMapperNode", hierarchyMapperNode)
    .addNode("exogenous", exogenousScoutNode)
    .addNode("featureArchitectNode", featureArchitectNode)
    .addEdge("__start__", "inspect")
    .addEdge("inspect", "profileData")
    // .addEdge("profileData", "preprocess")
    .addEdge("profileData", "resolveSchema")
    .addEdge("resolveSchema", "hierarchyMapperNode")
    .addEdge("hierarchyMapperNode", "exogenous")
    .addEdge("exogenous", "featureArchitectNode")
    .addEdge("featureArchitectNode", "__end__");

  return workflow.compile({
    checkpointer,
  });
}
