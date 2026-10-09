export interface ValidateModelsInput {
  projectId: string;
  predictionObjectiveStartDate: string;
  predictionHorizon: number;
  predictionFrequency: string;
  selectedModels: string[];
  filters?: Record<string, any>;
  // Internal inference callers can forecast unobserved periods that precede today's date.
  executionMode?: "future_prediction" | "backtesting";
}

export interface IModelValidationService {
  validateModels(input: ValidateModelsInput): Promise<any>;
  getValidationResults(projectId: string): Promise<any>;
  getValidationCandidates(projectId: string): Promise<any>;
}
