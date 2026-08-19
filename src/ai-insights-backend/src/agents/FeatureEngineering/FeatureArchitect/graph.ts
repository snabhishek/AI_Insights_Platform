import { StateGraph } from "@langchain/langgraph";
import { FeatureArchitectAnnotation } from "./state";
import { supervisorNode } from "./supervisorNode";
import { featureCreationNode } from "./featureCreationNode";
import { featureTransformationNode } from "./featureTransformationNode";
import { featureExtractionNode } from "./featureExtractionNode";
import { featureSelectionNode } from "./featureSelectionNode";

/**
 * Router function that maps the supervisor's choice to the corresponding node
 */
function routeSupervisor(state: typeof FeatureArchitectAnnotation.State) {
  const choice = state.nextWorker;
  if (choice === "featureCreation") {
    return "featureCreation";
  }
  if (choice === "featureTransformation") {
    return "featureTransformation";
  }
  if (choice === "featureExtraction") {
    return "featureExtraction";
  }
  if (choice === "featureSelection") {
    return "featureSelection";
  }
  return "finish";
}

/**
 * Builds and compiles the LangGraph StateGraph for Feature Architect Agent
 * using a Supervisor-Worker pattern.
 */
export function createFeatureArchitectGraph() {
  return new StateGraph(FeatureArchitectAnnotation)
    .addNode("supervisorNode", supervisorNode)
    .addNode("featureCreationNode", featureCreationNode)
    .addNode("featureTransformationNode", featureTransformationNode)
    .addNode("featureExtractionNode", featureExtractionNode)
    .addNode("featureSelectionNode", featureSelectionNode)
    
    // Start at the supervisor
    .addEdge("__start__", "supervisorNode")
    
    // Supervisor routing based on nextWorker decision
    .addConditionalEdges("supervisorNode", routeSupervisor, {
      featureCreation: "featureCreationNode",
      featureTransformation: "featureTransformationNode",
      featureExtraction: "featureExtractionNode",
      featureSelection: "featureSelectionNode",
      finish: "__end__",
    })
    
    // Worker nodes loop back to supervisor
    .addEdge("featureCreationNode", "supervisorNode")
    .addEdge("featureTransformationNode", "supervisorNode")
    .addEdge("featureExtractionNode", "supervisorNode")
    .addEdge("featureSelectionNode", "supervisorNode")
    
    .compile();
}
