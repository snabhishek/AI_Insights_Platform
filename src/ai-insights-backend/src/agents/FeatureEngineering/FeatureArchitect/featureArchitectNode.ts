import { RunnableConfig } from "@langchain/core/runnables";
import { AgentState, IngestionServices } from "../../state";
import { logMilestoneThinking } from "../../utils/agentUtils";
import { createFeatureArchitectGraph } from "./graph";
import { cleanupRunContainer } from "../../tools/helpers/pythonExecutor";

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

  try {
    // 1. Invoke the compiled Feature Architect subgraph
    const architectGraph = createFeatureArchitectGraph();
    const graphResult = await architectGraph.invoke(
      {
        batchedTables: state.batchedTables,
        inspector: state.inspection,
        dataProfile: state.dataProfile,
        userPrompt: state.userPrompt,
        connectorId: state.connectorId,
        runTimestamp: state.runTimestamp,
      },
      {
        configurable: { services },
        recursionLimit: 100,
      }
    );

    const finalOutput = graphResult.finalOutput || {};
    const featureValidatorOutput = finalOutput.featureValidator || graphResult.featureValidator || {};

    await logMilestoneThinking(
      services,
      "Feature Engineering",
      "Feature Architect & Validator workflow completed successfully."
    );

    return {
      featureArchitect: finalOutput,
      featureValidator: featureValidatorOutput,
      status: "running",
      summary: "Feature Engineering completed successfully",
      steps: [
        {
          name: "Feature Engineering",
          status: "completed",
          summary: "Architected and validated feature creation, transformation, extraction, and selection.",
        },
      ],
      stageOutputs: { 
        featureArchitect: finalOutput,
        featureValidator: featureValidatorOutput,
      },
      stageStatuses: { 
        featureArchitect: "Completed",
        featureValidator: "Completed",
      },
    };
  } finally {
    // Clean up container session upon completing the entire Feature Engineering stage
    await cleanupRunContainer(services?.projectId || "", state.runTimestamp || "");
  }
}
