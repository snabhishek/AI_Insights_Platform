export const PIPELINE_NAMES = {
  DATA_INGESTION: "Data Ingestion",
  FEATURE_ENGINEERING: "Feature Engineering",
  MODEL_TRAINING_VALIDATION: "Model Training & Validation",
} as const;

export type PipelineName = typeof PIPELINE_NAMES[keyof typeof PIPELINE_NAMES];
