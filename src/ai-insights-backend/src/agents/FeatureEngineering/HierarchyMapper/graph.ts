import { StateGraph } from "@langchain/langgraph";
import { AgentState } from "../../state";
import { relationshipBuilderNode } from "./RelationshipBuilder/relationshipBuilderNode";
import { formBuilderNode } from "./FormBuilder/formBuilderNode";

export function createHierarchyMapperGraph() {
  const workflow = new StateGraph(AgentState)
    .addNode("relationshipBuilder", relationshipBuilderNode)
    .addNode("formBuilder", formBuilderNode)
    .addEdge("__start__", "relationshipBuilder")
    .addEdge("relationshipBuilder", "formBuilder")
    .addEdge("formBuilder", "__end__");

  return workflow.compile();
}
