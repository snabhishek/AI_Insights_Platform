import { END, START, StateGraph } from "@langchain/langgraph";
import type { BaseCheckpointSaver } from "@langchain/langgraph";
import { TrainingGraphState } from "./types";
import {
  LIFECYCLE_GRAPH_RECURSION_LIMIT,
  shouldSkipCandidate,
  shouldStopTraining,
} from "../policies";
import {
  advanceTrainingCandidate,
  assessTrainingMetricsAndModelQualityAgent,
  authorTrainingProjectAgent,
  checkTrainingProjectStructure,
  executeTrainingCandidate,
  improveTrainingQualityAgent,
  loadTrainingContext,
  persistTrainingResult,
  repairTrainingProjectAgent,
  researchTrainingFailureAgent,
  reviewTrainingRunAgent,
  selectTrainingCandidate,
  withTrainingFailure,
} from "./nodes";

function afterReview(state: typeof TrainingGraphState.State):
  | "errorLimit"
  | "assess"
  | "research"
  | "skip"
  | "fail" {
  if (shouldStopTraining(state.trainingErrorCount)) return "errorLimit";
  const action = state.review?.action;
  if (action === "assess") return "assess";
  if (action === "diagnose") return "research";
  if (action === "skip_candidate") {
    const id = state.currentCandidateId || "";
    return shouldSkipCandidate(state.candidateFailures[id] || 0) ? "skip" : "research";
  }
  return "fail";
}

function afterAssessment(state: typeof TrainingGraphState.State):
  | "accept"
  | "improve"
  | "skip"
  | "research"
  | "errorLimit"
  | "fail" {
  if (shouldStopTraining(state.trainingErrorCount)) return "errorLimit";
  const action = state.assessment?.action;
  if (action === "accept") return "accept";
  if (action === "improve_quality") return "improve";
  if (action === "skip_candidate") {
    const id = state.currentCandidateId || "";
    return shouldSkipCandidate(state.candidateFailures[id] || 0) ? "skip" : "research";
  }
  return "fail";
}

function afterStructureCheck(state: typeof TrainingGraphState.State): "select" | "repair" {
  return state.structureCheck?.valid ? "select" : "repair";
}

function afterAdvance(state: typeof TrainingGraphState.State): "execute" | "persist" {
  return state.currentCandidateId ? "execute" : "persist";
}

export function createModelTrainingGraph(checkpointer?: BaseCheckpointSaver) {
  const graph = new StateGraph(TrainingGraphState)
    .addNode("loadTrainingContext", loadTrainingContext)
    .addNode("authorTrainingProjectAgent", authorTrainingProjectAgent)
    .addNode("checkTrainingProjectStructureAndDependencies", checkTrainingProjectStructure)
    .addNode("selectCandidate", selectTrainingCandidate)
    .addNode("executeCandidateTraining", executeTrainingCandidate)
    .addNode("reviewTrainingRunAgent", reviewTrainingRunAgent)
    .addNode("assessTrainingMetricsAndModelQualityAgent", assessTrainingMetricsAndModelQualityAgent)
    .addNode("researchTrainingFailureAgent", researchTrainingFailureAgent)
    .addNode("repairTrainingProjectAgent", repairTrainingProjectAgent)
    .addNode("improveTrainingQualityAgent", improveTrainingQualityAgent)
    .addNode("advanceCandidate", advanceTrainingCandidate)
    .addNode("persistTrainingResult", persistTrainingResult)
    .addNode("persistTrainingFailure", (state, config) =>
      withTrainingFailure(state, state.stopReason || "Training workflow reached its error or decision limit.", config)
    )
    .addEdge(START, "loadTrainingContext")
    .addEdge("loadTrainingContext", "authorTrainingProjectAgent")
    .addEdge("authorTrainingProjectAgent", "checkTrainingProjectStructureAndDependencies")
    .addConditionalEdges("checkTrainingProjectStructureAndDependencies", afterStructureCheck, {
      select: "selectCandidate",
      repair: "repairTrainingProjectAgent",
    })
    .addEdge("repairTrainingProjectAgent", "checkTrainingProjectStructureAndDependencies")
    .addConditionalEdges("selectCandidate", (state) =>
      state.currentCandidateId ? "execute" : "persist",
    {
      execute: "executeCandidateTraining",
      persist: "persistTrainingResult",
    })
    .addEdge("executeCandidateTraining", "reviewTrainingRunAgent")
    .addConditionalEdges("reviewTrainingRunAgent", afterReview, {
      errorLimit: "persistTrainingFailure",
      assess: "assessTrainingMetricsAndModelQualityAgent",
      research: "researchTrainingFailureAgent",
      skip: "advanceCandidate",
      fail: "persistTrainingFailure",
    })
    .addEdge("researchTrainingFailureAgent", "repairTrainingProjectAgent")
    .addConditionalEdges("assessTrainingMetricsAndModelQualityAgent", afterAssessment, {
      accept: "advanceCandidate",
      improve: "improveTrainingQualityAgent",
      skip: "advanceCandidate",
      research: "researchTrainingFailureAgent",
      errorLimit: "persistTrainingFailure",
      fail: "persistTrainingFailure",
    })
    .addEdge("improveTrainingQualityAgent", "checkTrainingProjectStructureAndDependencies")
    .addConditionalEdges("advanceCandidate", afterAdvance, {
      execute: "executeCandidateTraining",
      persist: "persistTrainingResult",
    })
    .addEdge("persistTrainingResult", END)
    .addEdge("persistTrainingFailure", END);

  return graph.compile({ checkpointer });
}

export async function invokeModelTrainingGraph(
  graph: ReturnType<typeof createModelTrainingGraph>,
  input: Parameters<ReturnType<typeof createModelTrainingGraph>["invoke"]>[0],
  config?: Parameters<ReturnType<typeof createModelTrainingGraph>["invoke"]>[1]
) {
  const services = config?.configurable?.services || (input as any)?.input?.services;
  return graph.invoke(input, {
    ...(config || {}),
    configurable: {
      ...(config?.configurable || {}),
      services,
      substep: "Model Training",
    },
    recursionLimit: LIFECYCLE_GRAPH_RECURSION_LIMIT,
  });
}
