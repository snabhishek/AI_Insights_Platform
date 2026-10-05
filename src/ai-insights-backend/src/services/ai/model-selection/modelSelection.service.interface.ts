import { ModelCapabilityRegistry } from "../../../agents/ModelTrainingValidation/ModelSelection/modelCapabilityRegistry";
import { IngestionServices } from "../../../agents/state";
import {
  ModelSelectionDecisionRecord,
} from "../../../models/modelSelection.types";

export interface IModelSelectionService {

  analyze(inputContext: any, projectId?: string, services?: IngestionServices): Promise<ModelSelectionDecisionRecord>;

  getDecision(id: string): Promise<ModelSelectionDecisionRecord | undefined>;

  getLatestProjectDecision(projectId: string): Promise<ModelSelectionDecisionRecord | undefined>;

  recordUserSelection(
    decisionId: string,
    selectedModelIds: string[]
  ): Promise<ModelSelectionDecisionRecord>;

  recordUserSelectionByProject(
    projectId: string,
    selectedModelIds: string[]
  ): Promise<ModelSelectionDecisionRecord | { success: boolean; selectedModelIds: string[] }>;

  getRegistry(): ModelCapabilityRegistry;
}
