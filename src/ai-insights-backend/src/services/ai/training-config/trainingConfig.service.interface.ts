export interface TrainingContractResult {
  yamlContent: string;
  parsedConfig: Record<string, any>;
  filePath: string;
  filename: string;
}

export interface SaveTrainingContractResult {
  success: boolean;
  filePath: string;
  filename: string;
  parsedConfig: Record<string, any>;
}

export interface ITrainingConfigService {
  /**
   * Retrieves the Training Job Contract YAML and parsed JSON for a given project.
   */
  getContract(projectId: string, timestamp?: string): Promise<TrainingContractResult>;

  /**
   * Validates and persists edited Training Job Contract YAML back to the project schemas folder
   * on the file server, updating the project's agent state.
   */
  saveContract(projectId: string, yamlContent: string, timestamp?: string): Promise<SaveTrainingContractResult>;
}
