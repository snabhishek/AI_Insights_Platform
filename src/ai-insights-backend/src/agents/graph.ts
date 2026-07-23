import { StateGraph, START, END } from "@langchain/langgraph";
import { AgentState } from "./state";
import { inspectorNode } from "./inspector/inspectorNode";
import { profilerNode } from "./profiler/profilerNode";
import { schemaResolverNode } from "./resolver/schemaResolverNode";



// Define the state schema for LangGraph
const agentStateSchema = {
  connectorIds: {
    value: (x: string[], y: string[]) => x,
    default: () => [],
  },
  connectors: {
    value: (x: any[], y: any[]) => x,
    default: () => [],
  },
  sourceStructureFiles: {
    value: (x: string[], y: string[]) => x.concat(y),
    default: () => [],
  },
  llmInferredRelationshipsFiles: {
    value: (x: string[], y: string[]) => x.concat(y),
    default: () => [],
  },
  profilingDataFiles: {
    value: (x: string[], y: string[]) => x.concat(y),
    default: () => [],
  },
  resolvedSchemaFiles: {
    value: (x: string[], y: string[]) => x.concat(y),
    default: () => [],
  },
  systemPromptFiles: {
    value: (x: string[], y: string[]) => x.concat(y),
    default: () => [],
  },
  errors: {


    value: (x: string[], y: string[]) => x.concat(y),
    default: () => [],
  },
};

export function createAgentGraph() {
  const workflow = new StateGraph<AgentState>({ channels: agentStateSchema as any });

  // Add Nodes
  workflow.addNode("inspector", inspectorNode as any);
  workflow.addNode("profiler", profilerNode as any);
  workflow.addNode("resolver", schemaResolverNode as any);

  // Add Edges
  workflow.addEdge(START, "inspector" as any);
  workflow.addEdge("inspector" as any, "profiler" as any);
  workflow.addEdge("profiler" as any, "resolver" as any);
  workflow.addEdge("resolver" as any, END);

  // Compile
  return workflow.compile();
}
