import { AgentState, IngestionServices } from "../../state";
import { logMilestoneThinking } from "../../utils/agentUtils";
import { createTrainingConfigGraph } from "./trainingConfigGraph";

export class TrainingConfigurationAgent {
  /**
   * Executes the multi-agent conversational Training Configuration workflow
   * orchestrated via LangGraph StateGraph (TrainingConfigurationAgent <-> DatasetAnalyserAgent).
   */
  public static async execute(
    state: typeof AgentState.State,
    services: IngestionServices,
    feedbackPrompt?: string
  ) {
    const startTime = Date.now();
    await logMilestoneThinking(
      services,
      "Training Configuration",
      "Initiating multi-agent conversational workflow between Training Configuration Agent and Dataset Analyser Agent..."
    );

    const modelSelection = (state.modelSelection || {}) as any;
    const projectId = services.projectId || state.projectId || "default-project";
    const runTimestamp = state.runTimestamp || (services as any)?.runTimestamp;

    // Discover candidate models from modelSelection
    let allCandidates: Array<{ model_id: string; rank?: number; score?: number; framework?: string; algorithm?: string; isDynamic?: boolean }> = [];

    if (Array.isArray(modelSelection.candidates) && modelSelection.candidates.length > 0) {
      allCandidates = modelSelection.candidates.map((c: any) => ({
        model_id: c.model_id,
        rank: c.rank,
        score: c.suitability_score,
        framework: c.framework,
        algorithm: c.algorithm || c.displayName || c.model_id,
        isDynamic: c.source_type === "external" || c.source === "web_search",
      }));
    } else if (Array.isArray(modelSelection.models) && modelSelection.models.length > 0) {
      allCandidates = modelSelection.models.map((m: any, idx: number) => ({
        model_id: m.model_id,
        rank: idx + 1,
        score: 0.9,
        framework: m.framework,
        algorithm: m.algorithm || m.model_id,
        isDynamic: false,
      }));
    } else if (modelSelection.recommended_model?.model_id) {
      allCandidates = [
        {
          model_id: modelSelection.recommended_model.model_id,
          rank: 1,
          score: modelSelection.recommended_model.suitability_score || 0.95,
          framework: modelSelection.recommended_model.framework,
          algorithm: modelSelection.recommended_model.algorithm || modelSelection.recommended_model.model_id,
          isDynamic: false,
        },
      ];
    } else {
      allCandidates = [
        { model_id: "lightgbm_classifier", rank: 1, score: 0.92, framework: "lightgbm", algorithm: "LGBMClassifier" },
        { model_id: "random_forest_classifier", rank: 2, score: 0.88, framework: "sklearn", algorithm: "RandomForestClassifier" },
      ];
    }

    // Execute the LangGraph StateGraph
    const graph = createTrainingConfigGraph();
    const result = await graph.invoke({
      messages: [],
      turnCount: 0,
      isComplete: false,
      datasetAnalysisExplanation: "",
      configuration: {},
      contractPath: "",
      summary: "",
      services,
      parentState: state,
      feedbackPrompt,
      modelSelection,
      allCandidates,
      projectId,
      runTimestamp,
    });

    const durationMs = Date.now() - startTime;
    const finalSummary = result.summary || `Training configuration synthesized across multi-agent dialogue in ${durationMs}ms.`;

    const output = {
      status: "Completed",
      summary: finalSummary,
      phase: "Training Configuration",
      contractPath: result.contractPath,
      configuration: result.configuration,
    };

    return output;
  }
}
