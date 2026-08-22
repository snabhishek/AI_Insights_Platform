import { RunnableConfig } from "@langchain/core/runnables";
import { IngestionServices } from "../../state";
import { getModel, invokeAgentJson, getPromptFromFile, logMilestoneThinking } from "../../utils/agentUtils";
import { FeatureArchitectAnnotation } from "./state";
import { createGetTableNamesTool, createGetTableColumnsAndProfileTool } from "../../tools";


interface SupervisorOutput extends Record<string, unknown> {
  status: string;
  nextWorker: string;
  rationale: string;
  orchestrationDecision?: {
    summary: string;
    problemType: string;
    targetColumn: string;
    predictionEntity: string;
    timeColumn?: string;
    leakageColumns?: string[];
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

  const historyWorkers = state.history.map((h) => h.worker);

  // 1. Deterministic code execution routing to programRectifier
  if (
    state.featureCreation?.pythonCode &&
    !historyWorkers.includes("featureCreation_executed") &&
    !historyWorkers.includes("featureCreation_executed_failed")
  ) {
    return { nextWorker: "programRectifier" };
  }
  if (
    state.featureTransformation?.pythonCode &&
    !historyWorkers.includes("featureTransformation_executed") &&
    !historyWorkers.includes("featureTransformation_executed_failed")
  ) {
    return { nextWorker: "programRectifier" };
  }
  if (
    state.buildDataset?.pythonCode &&
    !historyWorkers.includes("buildDataset_executed") &&
    !historyWorkers.includes("buildDataset_executed_failed")
  ) {
    return { nextWorker: "programRectifier" };
  }
  if (
    state.dataValidation?.pythonCode &&
    !historyWorkers.includes("dataValidation_executed") &&
    !historyWorkers.includes("dataValidation_executed_failed")
  ) {
    return { nextWorker: "programRectifier" };
  }
  if (
    state.featureExtraction?.pythonCode &&
    !historyWorkers.includes("featureExtraction_executed") &&
    !historyWorkers.includes("featureExtraction_executed_failed")
  ) {
    return { nextWorker: "programRectifier" };
  }
  if (
    state.featureSelection?.pythonCode &&
    !historyWorkers.includes("featureSelection_executed") &&
    !historyWorkers.includes("featureSelection_executed_failed")
  ) {
    return { nextWorker: "programRectifier" };
  }

  // 2. Otherwise, check state progression to call workers or finish
  if (services) {
    await logMilestoneThinking(
      services,
      "Feature Engineering",
      `Supervisor is planning next agent tasks. Executed workers history: [${historyWorkers.join(" -> ") || "none"}]`
    );
  }

  const userMessage = [
    "Analyze the schema, user requirements, and history to choose the next feature engineering worker node.",
    `User Requirements: ${state.userPrompt || "None provided"}`,
    `Selected Tables: ${JSON.stringify(state.batchedTables.map((t) => t.tableName))}`,
    // `Inspector details: ${JSON.stringify(state.inspector)}`,
    `Execution History: ${JSON.stringify(state.history)}`,
  ].join("\n\n");

  try {
    const getTableNamesTool = createGetTableNamesTool(state.batchedTables);
    const getTableColumnsAndProfileTool = createGetTableColumnsAndProfileTool(state.inspector, state.dataProfile);

    const result = await invokeAgentJson<SupervisorOutput>(
      "featureArchitect",
      model,
      userMessage,
      fallback,
      services,
      {
        systemPrompt,
        traceLabel: "featureArchitect:supervisor",
        tools: [getTableNamesTool, getTableColumnsAndProfileTool],
        recursionLimit: 100,
      }
    );

    const safeNextWorker = result.nextWorker || "FINISH";

    if (services) {
      await logMilestoneThinking(
        services,
        "Feature Engineering",
        `Supervisor scheduled task: "${safeNextWorker}". Rationale: ${result.rationale || "None"}`
      );
    }

    if (safeNextWorker === "FINISH") {
      const finalOutput = {
        status: "completed",
        orchestrationDecision: state.orchestrationDecision,
        featureCreation: state.featureCreation,
        featureTransformation: state.featureTransformation,
        buildDataset: state.buildDataset,
        dataValidation: state.dataValidation,
        featureExtraction: state.featureExtraction,
        featureSelection: state.featureSelection,
        summary: "Feature Architecture planning and execution completed successfully under supervisor control.",
      };
      return {
        nextWorker: safeNextWorker,
        finalOutput,
      };
    }

    const updates: Record<string, any> = {
      nextWorker: safeNextWorker,
    };

    if (result.orchestrationDecision) {
      updates.orchestrationDecision = {
        status: "OK",
        summary: result.orchestrationDecision.summary || "",
        problemType: result.orchestrationDecision.problemType || "",
        targetColumn: result.orchestrationDecision.targetColumn || "",
        predictionEntity: result.orchestrationDecision.predictionEntity || "",
        timeColumn: result.orchestrationDecision.timeColumn || "",
        leakageColumns: result.orchestrationDecision.leakageColumns || [],
        decisions: result.orchestrationDecision.decisions || [],
      };
    }

    return updates;
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
