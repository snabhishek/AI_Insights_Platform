import { ModelDefinition, ModelSelectionContext } from "../../../models/modelSelection.types";
import { ModelCapabilityRegistry } from "../../../agents/ModelTrainingValidation/ModelSelection/modelCapabilityRegistry";
import { IngestionServices } from "../../../agents/state";

export interface IModelDiscoveryService {

  discoverAndRegisterModels(
    context: ModelSelectionContext,
    registry: ModelCapabilityRegistry,
    services?: IngestionServices
  ): Promise<ModelDefinition[]>;
}
