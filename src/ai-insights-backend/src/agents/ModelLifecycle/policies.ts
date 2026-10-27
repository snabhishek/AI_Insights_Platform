export const LIFECYCLE_GRAPH_RECURSION_LIMIT = 500;
export const MAX_CANDIDATE_FAILURES_BEFORE_SKIP = 5;
export const MAX_CUMULATIVE_TRAINING_ERRORS = 20;

export function shouldSkipCandidate(failureCount: number): boolean {
  return failureCount > MAX_CANDIDATE_FAILURES_BEFORE_SKIP;
}

export function shouldStopTraining(errorCount: number): boolean {
  return errorCount > MAX_CUMULATIVE_TRAINING_ERRORS;
}
