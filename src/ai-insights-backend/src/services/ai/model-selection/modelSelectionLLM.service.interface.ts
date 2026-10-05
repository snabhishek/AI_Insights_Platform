import {
  ModelCapabilityRegistry,
} from "../../../agents/ModelTrainingValidation/ModelSelection/modelCapabilityRegistry";
import { IngestionServices } from "../../../agents/state";
import {
  ModelSelectionContext,
  ModelSelectionDecision,
} from "../../../models/modelSelection.types";

export interface IModelSelectionLLMService {

  generateDecision(
    context: ModelSelectionContext,
    registry: ModelCapabilityRegistry,
    options?: {
      temperature?: number;
      timeoutMs?: number;
      services?: IngestionServices;
    }
  ): Promise<ModelSelectionDecision>;

  getPromptVersion(): string;
}
