import { PIPELINE_NAMES, PipelineName } from "./pipelineNames";
import {
  getPipelineForSubstep as getCategoryForSubstep,
  resolveSafePredecessorNode as resolvePredecessor,
  getStageRuleByNode,
  WORKFLOW_STAGE_RULES,
} from "./workflowRules.config";

export { PIPELINE_NAMES, PipelineName };
export { getApprovalGateForNode, getStageRuleByNode, WORKFLOW_STAGE_RULES } from "./workflowRules.config";

/**
 * Dynamically resolves the pipeline domain category for any given substep or node name.
 */
export function getPipelineForSubstep(substepOrNode?: string | null): PipelineName {
  if (!substepOrNode) return PIPELINE_NAMES.DATA_INGESTION;
  const category = getCategoryForSubstep(substepOrNode);
  if (category === "Feature Engineering") return PIPELINE_NAMES.FEATURE_ENGINEERING;
  if (category === "Model Training & Validation") return PIPELINE_NAMES.MODEL_TRAINING_VALIDATION;
  return PIPELINE_NAMES.DATA_INGESTION;
}

/**
 * Defensively resolves the LangGraph predecessor node when restoring checkpointer state.
 */
export function resolveSafePredecessorNode(
  requestedStep: string | undefined,
  savedState: any
): string {
  return resolvePredecessor(requestedStep, savedState);
}
