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

export interface DateRangeResult {
  hasTemporalData: boolean;
  timeColumn?: string | null;
  minDate?: string | null;
  maxDate?: string | null;
  minYear?: number;
  maxYear?: number;
  minMonth?: number;
  maxMonth?: number;
  availableYears?: number[];
  datasetPath?: string | null;
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

  /**
   * Dynamically inspects the project's dataset and Training Job Contract to extract
   * the time column and the available date range (min/max date, min/max year, min/max month).
   */
  getDateRange(projectId: string, timestamp?: string): Promise<DateRangeResult>;
}
