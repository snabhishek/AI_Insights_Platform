import {
  ModelDefinition,
  ModelSelectionDecisionRecord,
  UserSelectionHandoff,
} from "../models/modelSelection.types";

export interface IModelSelectionRepository {
  saveDecision(record: ModelSelectionDecisionRecord): Promise<ModelSelectionDecisionRecord>;
  getById(id: string): Promise<ModelSelectionDecisionRecord | undefined>;
  getLatestByProjectId(projectId: string): Promise<ModelSelectionDecisionRecord | undefined>;
  getAllByProjectId(projectId: string): Promise<ModelSelectionDecisionRecord[]>;
  updateUserSelection(
    id: string,
    userSelection: UserSelectionHandoff
  ): Promise<ModelSelectionDecisionRecord | undefined>;
  markStale(id: string): Promise<boolean>;

  // Dynamic model exploration persistence
  saveDynamicModel(model: ModelDefinition): Promise<void>;
  getDynamicModels(): Promise<ModelDefinition[]>;
}
