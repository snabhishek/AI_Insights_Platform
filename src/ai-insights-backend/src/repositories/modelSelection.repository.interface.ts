import {
  ModelDefinition,
  ModelSelectionDecisionRecord,
  ModelSourceProviderRecord,
  ModelSourceTypeRecord,
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

  // Source type & provider lookups
  getSourceTypes(): Promise<ModelSourceTypeRecord[]>;
  getSourceProviders(): Promise<ModelSourceProviderRecord[]>;
  ensureSourceProvider(provider: {
    id: string;
    name: string;
    sourceTypeId: string;
    baseUrl?: string;
  }): Promise<void>;

  // Dynamic model exploration persistence
  saveDynamicModel(model: ModelDefinition): Promise<void>;
  getDynamicModels(): Promise<ModelDefinition[]>;
  clearDynamicModels(): Promise<void>;
}

