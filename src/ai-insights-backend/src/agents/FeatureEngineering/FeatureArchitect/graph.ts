import { StateGraph } from "@langchain/langgraph";
import { FeatureArchitectAnnotation } from "./state";
import { orchestratorNode } from "./orchestratorNode";
import { featureCreationNode } from "./featureCreationNode";
import { featureTransformationNode } from "./featureTransformationNode";
import { featureExtractionNode } from "./featureExtractionNode";
import { featureSelectionNode } from "./featureSelectionNode";

/**
 * Builds and compiles the LangGraph StateGraph for Feature Architect Agent
 */
export function createFeatureArchitectGraph() {
  return new StateGraph(FeatureArchitectAnnotation)
    .addNode("orchestratorNode", orchestratorNode)
    .addNode("featureCreationNode", featureCreationNode)
    .addNode("featureTransformationNode", featureTransformationNode)
    .addNode("featureExtractionNode", featureExtractionNode)
    .addNode("featureSelectionNode", featureSelectionNode)
    .addEdge("__start__", "orchestratorNode")
    .addEdge("orchestratorNode", "featureCreationNode")
    .addEdge("featureCreationNode", "featureTransformationNode")
    .addEdge("featureTransformationNode", "featureExtractionNode")
    .addEdge("featureExtractionNode", "featureSelectionNode")
    .addEdge("featureSelectionNode", "__end__")
    .compile();
}
