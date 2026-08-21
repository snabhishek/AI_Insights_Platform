import { RunnableConfig } from "@langchain/core/runnables";
import { AgentState, IngestionServices } from "../../state";
import { logMilestoneThinking } from "../../utils/agentUtils";
import { createFeatureArchitectGraph } from "./graph";

export async function featureArchitectNode(state: typeof AgentState.State, config?: RunnableConfig) {
  const services = config?.configurable?.services as IngestionServices;
  if (!services) {
    throw new Error("Services dependency is not provided in config");
  }

  await logMilestoneThinking(
    services,
    "Feature Engineering",
    "Feature Architect Agent is starting feature engineering design workflow..."
  );

  // 1. Invoke the compiled Feature Architect subgraph
  const architectGraph = createFeatureArchitectGraph();
  const graphResult = await architectGraph.invoke(
    {
      batchedTables: state.batchedTables,
      inspector: state.inspection, // Pass state.inspection as inspector input
      dataProfile: state.dataProfile, // Pass state.dataProfile
      userPrompt: state.userPrompt, // Pass userPrompt from main state
      connectorId: state.connectorId, // Pass connectorId from main state
      runTimestamp: state.runTimestamp, // Pass runTimestamp from main state
    },

    {
      configurable: { services },
    }
  );

  const finalOutput = graphResult.finalOutput || {};

  await logMilestoneThinking(
    services,
    "Feature Engineering",
    "Feature Architect Agent design workflow completed successfully."
  );

  return {
    featureArchitect: finalOutput,
    status: "completed",
    summary: "Feature Engineering completed successfully",
    steps: [
      {
        name: "Feature Engineering",
        status: "completed",
        summary: "Architected feature creation, transformation, extraction, and selection.",
      },
    ],
    stageOutputs: { featureArchitect: finalOutput },
    stageStatuses: { featureArchitect: "Completed" },
  };
}
