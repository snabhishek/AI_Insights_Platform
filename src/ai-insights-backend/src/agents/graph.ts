import { StateGraph } from "@langchain/langgraph";
import { AgentState } from "./state";
import { inspectorNode } from "./IngestionLayer/inspector/inspectorNode";
import { profilerNode } from "./IngestionLayer/profiler/profilerNode";
import { schemaResolverNode } from "./IngestionLayer/resolver/schemaResolverNode";
import { hierarchyMapperNode } from "./FeatureEngineering/HierarchyMapper/hierarchyMapperNode";
import { featureArchitectNode } from "./FeatureEngineering/FeatureArchitect/featureArchitectNode";
import { exogenousScoutNode } from "./FeatureEngineering/ExogenousScout/exogenousScoutNode";
import { trainingDataPreparationNode, modelTrainingNode, modelEvaluationNode, modelValidationNode, modelSelectionNode } from "./ModelTrainingValidation/nodes";

export function createAgentGraph(checkpointer: any) {
  const workflow = new StateGraph(AgentState)
    .addNode("inspect", inspectorNode)
    .addNode("profileData", profilerNode)
    .addNode("resolveSchema", schemaResolverNode)
    .addNode("hierarchyMapperNode", hierarchyMapperNode)
    .addNode("featureArchitectNode", featureArchitectNode)
    .addNode("exogenous", exogenousScoutNode)
    .addNode("trainingDataPreparation", trainingDataPreparationNode)
    .addNode("modelTraining", modelTrainingNode)
    .addNode("modelEvaluation", modelEvaluationNode)
    .addNode("modelValidation", modelValidationNode)
    .addNode("modelSelection", modelSelectionNode)
    .addEdge("__start__", "inspect")
    .addEdge("inspect", "profileData")
    .addEdge("profileData", "resolveSchema")
    .addEdge("resolveSchema", "hierarchyMapperNode")
    .addEdge("hierarchyMapperNode", "featureArchitectNode")
    .addEdge("featureArchitectNode", "exogenous")
    .addEdge("exogenous", "trainingDataPreparation")
    .addEdge("trainingDataPreparation", "modelTraining")
    .addEdge("modelTraining", "modelEvaluation")
    .addEdge("modelEvaluation", "modelValidation")
    .addEdge("modelValidation", "modelSelection")
    .addEdge("modelSelection", "__end__");

  return workflow.compile({
    checkpointer,
    interruptBefore: ["hierarchyMapperNode"],
  });
}
