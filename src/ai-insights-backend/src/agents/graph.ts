import { StateGraph } from "@langchain/langgraph";
import { AgentState } from "./state";
import { inspectorNode } from "./IngestionLayer/inspector/inspectorNode";
import { profilerNode } from "./IngestionLayer/profiler/profilerNode";
import { schemaResolverNode } from "./IngestionLayer/resolver/schemaResolverNode";
import { hierarchyMapperNode } from "./FeatureEngineering/HierarchyMapper/hierarchyMapperNode";
import { featureArchitectNode } from "./FeatureEngineering/FeatureArchitect/featureArchitectNode";
import { exogenousScoutNode } from "./FeatureEngineering/ExogenousScout/exogenousScoutNode";

export function createAgentGraph(checkpointer: any) {
  const workflow = new StateGraph(AgentState)
    .addNode("inspect", inspectorNode)
    .addNode("profileData", profilerNode)
    .addNode("resolveSchema", schemaResolverNode)
    .addNode("hierarchyMapperNode", hierarchyMapperNode)
    .addNode("featureArchitectNode", featureArchitectNode)
    .addNode("exogenous", exogenousScoutNode)
    .addEdge("__start__", "inspect")
    .addEdge("inspect", "profileData")
    .addEdge("profileData", "resolveSchema")
    .addEdge("resolveSchema", "hierarchyMapperNode")
    .addEdge("hierarchyMapperNode", "featureArchitectNode")
    .addEdge("featureArchitectNode", "exogenous")
    .addEdge("exogenous", "__end__");

  return workflow.compile({
    checkpointer,
    interruptBefore: ["hierarchyMapperNode"],
  });
}
