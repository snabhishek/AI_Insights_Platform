import { StateGraph } from "@langchain/langgraph";
import { FeatureArchitectAnnotation } from "./state";
import { supervisorNode } from "./supervisorNode";
import { featureCreationNode } from "./featureCreationNode";
import { featureTransformationNode } from "./featureTransformationNode";
import { buildDatasetNode } from "./buildDatasetNode";
import { dataValidationNode } from "./dataValidationNode";
import { featureExtractionNode } from "./featureExtractionNode";
import { featureSelectionNode } from "./featureSelectionNode";
import { featureValidatorNode } from "../FeatureValidator/featureValidatorNode";
import { programRectificationNode } from "./programRectificationNode";

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
  if (choice === "buildDataset") {
    return "buildDataset";
  }
  if (choice === "dataValidation") {
    return "dataValidation";
  }
  if (choice === "featureExtraction") {
    return "featureExtraction";
  }
  if (choice === "featureSelection") {
    return "featureSelection";
  }
  if (choice === "featureValidator") {
    return "featureValidator";
  }
  if (choice === "programRectifier") {
    return "programRectifier";
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
    .addNode("buildDatasetNode", buildDatasetNode)
    .addNode("dataValidationNode", dataValidationNode)
    .addNode("featureExtractionNode", featureExtractionNode)
    .addNode("featureSelectionNode", featureSelectionNode)
    .addNode("featureValidatorNode", featureValidatorNode)
    .addNode("programRectificationNode", programRectificationNode)

    // Start at the supervisor
    .addEdge("__start__", "supervisorNode")

    // Supervisor routing based on nextWorker decision
    .addConditionalEdges("supervisorNode", routeSupervisor, {
      featureCreation: "featureCreationNode",
      featureTransformation: "featureTransformationNode",
      buildDataset: "buildDatasetNode",
      dataValidation: "dataValidationNode",
      featureExtraction: "featureExtractionNode",
      featureSelection: "featureSelectionNode",
      featureValidator: "featureValidatorNode",
      programRectifier: "programRectificationNode",
      finish: "__end__",
    })

    // Worker nodes loop back to supervisor
    .addEdge("featureCreationNode", "supervisorNode")
    .addEdge("featureTransformationNode", "supervisorNode")
    .addEdge("buildDatasetNode", "supervisorNode")
    .addEdge("dataValidationNode", "supervisorNode")
    .addEdge("featureExtractionNode", "supervisorNode")
    .addEdge("featureSelectionNode", "supervisorNode")
    .addEdge("featureValidatorNode", "supervisorNode")
    .addEdge("programRectificationNode", "supervisorNode")

    .compile();
}
