import { END, START, StateGraph } from "@langchain/langgraph";
import type { BaseCheckpointSaver } from "@langchain/langgraph";
import { ValidationGraphState } from "./types";
import { LIFECYCLE_GRAPH_RECURSION_LIMIT, shouldSkipCandidate } from "../policies";
import {
  advanceValidationCandidate,
  assessValidationMetricsAndQualityAgent,
  authorValidationProjectAgent,
  checkValidationProjectStructure,
  executeValidationCandidate,
  improveValidationQualityAgent,
  loadValidationContext,
  persistValidationFailure,
  persistValidationResult,
  repairValidationProjectAgent,
  researchValidationFailureAgent,
  reviewValidationRunAgent,
  selectValidationCandidate,
} from "./nodes";

function afterStructure(state: typeof ValidationGraphState.State): "select" | "repair" {
  return state.structureCheck?.valid ? "select" : "repair";
}

function afterReview(state: typeof ValidationGraphState.State): "assess" | "research" | "skip" | "fail" {
  const action = state.review?.action;
  if (action === "assess") return "assess";
  if (action === "diagnose") return "research";
  if (action === "skip_candidate") {
    const id = state.currentCandidateId || "";
    return shouldSkipCandidate(state.candidateFailures[id] || 0) ? "skip" : "research";
  }
  return "fail";
}

function afterAssessment(state: typeof ValidationGraphState.State): "accept" | "improve" | "skip" | "research" | "fail" {
  const action = state.assessment?.action;
  if (action === "accept") return "accept";
  if (action === "improve_quality") return "improve";
  if (action === "skip_candidate") {
    const id = state.currentCandidateId || "";
    return shouldSkipCandidate(state.candidateFailures[id] || 0) ? "skip" : "research";
  }
  return "fail";
}

export function createModelValidationGraph(checkpointer?: BaseCheckpointSaver) {
  const graph = new StateGraph(ValidationGraphState)
    .addNode("loadValidationContext", loadValidationContext)
    .addNode("authorValidationProjectAgent", authorValidationProjectAgent)
    .addNode("checkValidationProjectStructureAndDependencies", checkValidationProjectStructure)
    .addNode("selectCandidate", selectValidationCandidate)
    .addNode("executeValidation", executeValidationCandidate)
    .addNode("reviewValidationRunAgent", reviewValidationRunAgent)
    .addNode("assessValidationMetricsAndModelQualityAgent", assessValidationMetricsAndQualityAgent)
    .addNode("researchValidationFailureAgent", researchValidationFailureAgent)
    .addNode("repairValidationProjectAgent", repairValidationProjectAgent)
    .addNode("improveValidationQualityAgent", improveValidationQualityAgent)
    .addNode("advanceCandidate", advanceValidationCandidate)
    .addNode("persistValidationResult", persistValidationResult)
    .addNode("persistValidationFailure", persistValidationFailure)
    .addEdge(START, "loadValidationContext")
    .addEdge("loadValidationContext", "authorValidationProjectAgent")
    .addEdge("authorValidationProjectAgent", "checkValidationProjectStructureAndDependencies")
    .addConditionalEdges("checkValidationProjectStructureAndDependencies", afterStructure, {
      select: "selectCandidate",
      repair: "repairValidationProjectAgent",
    })
    .addEdge("repairValidationProjectAgent", "checkValidationProjectStructureAndDependencies")
    .addConditionalEdges("selectCandidate", (state) =>
      state.currentCandidateId ? "execute" : "persist",
    {
      execute: "executeValidation",
      persist: "persistValidationResult",
    })
    .addEdge("executeValidation", "reviewValidationRunAgent")
    .addConditionalEdges("reviewValidationRunAgent", afterReview, {
      assess: "assessValidationMetricsAndModelQualityAgent",
      research: "researchValidationFailureAgent",
      skip: "advanceCandidate",
      fail: "persistValidationFailure",
    })
    .addEdge("researchValidationFailureAgent", "repairValidationProjectAgent")
    .addConditionalEdges("assessValidationMetricsAndModelQualityAgent", afterAssessment, {
      accept: "advanceCandidate",
      improve: "improveValidationQualityAgent",
      skip: "advanceCandidate",
      research: "researchValidationFailureAgent",
      fail: "persistValidationFailure",
    })
    .addEdge("improveValidationQualityAgent", "checkValidationProjectStructureAndDependencies")
    .addConditionalEdges("advanceCandidate", (state) =>
      state.currentCandidateId ? "execute" : "persist",
    {
      execute: "executeValidation",
      persist: "persistValidationResult",
    })
    .addEdge("persistValidationResult", END)
    .addEdge("persistValidationFailure", END);

  return graph.compile({ checkpointer });
}

export async function invokeModelValidationGraph(
  graph: ReturnType<typeof createModelValidationGraph>,
  input: Parameters<ReturnType<typeof createModelValidationGraph>["invoke"]>[0],
  config?: Parameters<ReturnType<typeof createModelValidationGraph>["invoke"]>[1]
) {
  const services = config?.configurable?.services || (input as any)?.input?.services;
  return graph.invoke(input, {
    ...(config || {}),
    configurable: {
      ...(config?.configurable || {}),
      services,
      substep: "Model Validation",
    },
    recursionLimit: LIFECYCLE_GRAPH_RECURSION_LIMIT,
  });
}
