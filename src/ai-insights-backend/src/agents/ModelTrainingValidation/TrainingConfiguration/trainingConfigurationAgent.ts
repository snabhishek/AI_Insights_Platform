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

    let modelSelection = (state.modelSelection || {}) as any;
    const projectId = services.projectId || state.projectId || "default-project";
    const runTimestamp = state.runTimestamp || (services as any)?.runTimestamp;

    let savedAgentState: any = null;
    if (services.projectService && projectId) {
      try {
        const project = await services.projectService.getById(projectId);
        savedAgentState = project?.agentState as any;
      } catch (err: any) {
        console.warn("[TrainingConfigurationAgent] Warning loading project agentState:", err?.message || err);
      }
    }

    if (savedAgentState?.modelSelection) {
      modelSelection = {
        ...modelSelection,
        ...savedAgentState.modelSelection,
        userSelection: savedAgentState.modelSelection.userSelection || modelSelection.userSelection,
        selectedModelIds: savedAgentState.modelSelection.selectedModelIds || modelSelection.selectedModelIds,
        models: savedAgentState.modelSelection.models || modelSelection.models,
      };
    }

    const userSelectedIds: string[] = Array.from(
      new Set(
        [
          ...(modelSelection.userSelection?.selectedModelIds || []),
          ...(modelSelection.selectedModelIds || []),
          ...(Array.isArray(modelSelection.models)
            ? modelSelection.models.map((m: any) => (typeof m === "string" ? m : m?.model_id))
            : []),
          ...(Array.isArray(savedAgentState?.trainingConfiguration?.models)
            ? savedAgentState.trainingConfiguration.models.map((m: any) => (typeof m === "string" ? m : m?.model_id))
            : []),
        ].filter(Boolean)
      )
    );

    // Discover candidate models strictly from modelSelection
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
      throw new Error(
        "[TrainingConfigurationAgent] Model Selection candidate models are missing from state. Model Selection agent must execute and provide candidate models."
      );
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
      userSelectedIds,
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
