import { ModelDefinition, ModelSelectionContext } from "../../../models/modelSelection.types";
import { ModelCapabilityRegistry } from "../../../agents/ModelTrainingValidation/ModelSelection/modelCapabilityRegistry";
import { IngestionServices } from "../../../agents/state";

export interface IModelDiscoveryService {
  /**
   * Discovers relevant models dynamically via web search and external sources,
   * evaluates their suitability, registers them into the in-memory registry,
   * and persists them to PostgreSQL.
   */
  discoverAndRegisterModels(
    context: ModelSelectionContext,
    registry: ModelCapabilityRegistry,
    services?: IngestionServices
  ): Promise<ModelDefinition[]>;
}
