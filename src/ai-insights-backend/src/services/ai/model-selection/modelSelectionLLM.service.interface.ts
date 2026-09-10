import {
  ModelCapabilityRegistry,
} from "../../../agents/ModelTrainingValidation/ModelSelection/modelCapabilityRegistry";
import {
  ModelSelectionContext,
  ModelSelectionDecision,
} from "../../../models/modelSelection.types";

export interface IModelSelectionLLMService {
  /**
   * Generates a structured model selection decision from the normalized context
   * and filtered candidate models using the prompt from prompts/ModelSelection/modelSelection.md
   * and the web search exploration tool.
   */
  generateDecision(
    context: ModelSelectionContext,
    registry: ModelCapabilityRegistry,
    options?: {
      temperature?: number;
      timeoutMs?: number;
    }
  ): Promise<ModelSelectionDecision>;

  /**
   * Returns current prompt version.
   */
  getPromptVersion(): string;
}
