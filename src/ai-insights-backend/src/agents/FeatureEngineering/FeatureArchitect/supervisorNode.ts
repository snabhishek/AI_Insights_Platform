import { RunnableConfig } from "@langchain/core/runnables";
import { IngestionServices } from "../../state";
import { getModel, invokeAgentJson, getPromptFromFile, logMilestoneThinking } from "../../utils/agentUtils";
import { FeatureArchitectAnnotation } from "./state";

interface SupervisorOutput extends Record<string, unknown> {
  status: string;
  nextWorker: string;
  rationale: string;
  orchestrationDecision?: {
    summary: string;
    decisions: any[];
  };
}

export async function supervisorNode(
  state: typeof FeatureArchitectAnnotation.State,
  config?: RunnableConfig
) {
  const services = config?.configurable?.services as IngestionServices;
  const model = getModel();

  const fallback: SupervisorOutput = {
    status: "Failed",
    nextWorker: "FINISH",
    rationale: "Supervisor fallback triggered, choosing to finish.",
  };

  if (!model) {
    return {
      nextWorker: "FINISH",
      finalOutput: {
        status: "failed",
        summary: "No model available for Supervisor Node",
      },
    };
  }

  const systemPrompt = await getPromptFromFile(
    "featureSupervisor.md",
    "You are an expert AI Feature Engineering Supervisor Agent."
  );

  if (services) {
    await logMilestoneThinking(
      services,
      "Feature Engineering",
      `Supervisor is evaluating the next step. Completed steps history: [${state.history.map((h) => h.worker).join(" -> ") || "none"}]`
    );
  }

  const userMessage = [
    "Analyze the schema, user requirements, and history to choose the next feature engineering worker node.",
    `User Requirements: ${state.userPrompt || "None provided"}`,
    `Selected Tables: ${JSON.stringify(state.batchedTables.map((t) => t.tableName))}`,
    `Inspector details: ${JSON.stringify(state.inspector)}`,
    `Execution History: ${JSON.stringify(state.history)}`,
  ].join("\n\n");

  try {
    const result = await invokeAgentJson<SupervisorOutput>(
      "featureArchitect",
      model,
      userMessage,
      fallback,
      services,
      {
        systemPrompt,
        traceLabel: "featureArchitect:supervisor",
      }
    );

    const safeNextWorker = result.nextWorker || "FINISH";

    if (services) {
      await logMilestoneThinking(
        services,
        "Feature Engineering",
        `Supervisor chose next step: "${safeNextWorker}". Rationale: ${result.rationale || "None"}`
      );
    }

    if (safeNextWorker === "FINISH") {
      const finalOutput = {
        status: "completed",
        orchestrationDecision: state.orchestrationDecision,
        featureCreation: state.featureCreation,
        featureTransformation: state.featureTransformation,
        featureExtraction: state.featureExtraction,
        featureSelection: state.featureSelection,
        summary: "Feature Architecture planning completed successfully under supervisor control.",
      };
      return {
        nextWorker: safeNextWorker,
        finalOutput,
      };
    }

    if (result.orchestrationDecision) {
      return {
        nextWorker: safeNextWorker,
        orchestrationDecision: {
          status: "OK",
          summary: result.orchestrationDecision.summary,
          decisions: result.orchestrationDecision.decisions,
        },
      };
    }

    return {
      nextWorker: safeNextWorker,
    };
  } catch (error) {
    console.warn("[supervisorNode] Execution failed, using fallback", error);
    return {
      nextWorker: "FINISH",
      finalOutput: {
        status: "failed",
        summary: `Supervisor execution failed: ${error instanceof Error ? error.message : String(error)}`,
      },
    };
  }
}
