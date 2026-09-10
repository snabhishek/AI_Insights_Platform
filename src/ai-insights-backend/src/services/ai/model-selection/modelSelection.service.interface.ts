import { ModelCapabilityRegistry } from "../../../agents/ModelTrainingValidation/ModelSelection/modelCapabilityRegistry";
import {
  ModelSelectionDecisionRecord,
} from "../../../models/modelSelection.types";

export interface IModelSelectionService {
  /**
   * Runs the complete Model Selection pipeline:
   * context normalization -> candidate filtering -> LLM reasoning & web search -> validation -> persistence.
   */
  analyze(inputContext: any, projectId?: string): Promise<ModelSelectionDecisionRecord>;

  /**
   * Retrieves a decision record by ID.
   */
  getDecision(id: string): Promise<ModelSelectionDecisionRecord | undefined>;

  /**
   * Retrieves the latest decision record for a specific project.
   */
  getLatestProjectDecision(projectId: string): Promise<ModelSelectionDecisionRecord | undefined>;

  /**
   * Records user-selected models for training and performs the handoff
   * to Training Configuration without mutating the original AI decision.
   */
  recordUserSelection(
    decisionId: string,
    selectedModelIds: string[]
  ): Promise<ModelSelectionDecisionRecord>;

  /**
   * Returns the underlying ModelCapabilityRegistry.
   */
  getRegistry(): ModelCapabilityRegistry;
}
