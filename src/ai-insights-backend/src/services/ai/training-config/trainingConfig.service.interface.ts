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

  getContract(projectId: string, timestamp?: string): Promise<TrainingContractResult>;

  saveContract(projectId: string, yamlContent: string, timestamp?: string): Promise<SaveTrainingContractResult>;

  getDateRange(projectId: string, timestamp?: string): Promise<DateRangeResult>;
}
