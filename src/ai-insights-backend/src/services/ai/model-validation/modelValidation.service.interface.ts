export interface ValidateModelsInput {
  projectId: string;
  predictionObjectiveStartDate: string;
  predictionHorizon: number;
  predictionFrequency: string;
  selectedModels: string[];
  filters?: Record<string, any>;
}

export interface IModelValidationService {
  validateModels(input: ValidateModelsInput): Promise<any>;
  getValidationResults(projectId: string): Promise<any>;
  getValidationCandidates(projectId: string): Promise<any>;
}
