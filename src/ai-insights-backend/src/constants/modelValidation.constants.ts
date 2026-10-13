export const VALIDATION_FREQUENCY_OPTIONS = {
  WEEKLY: "Weekly",
  MONTHLY: "Monthly",
  YEARLY: "Yearly",
} as const;

export type ValidationFrequencyOption = typeof VALIDATION_FREQUENCY_OPTIONS[keyof typeof VALIDATION_FREQUENCY_OPTIONS];

export const VALID_FREQUENCY_VALUES = Object.values(VALIDATION_FREQUENCY_OPTIONS);

export const VALIDATION_MODE_OPTIONS = {
  BACKTESTING: "backtesting",
  FUTURE_PREDICTION: "future_prediction",
} as const;

export type ValidationModeOption = typeof VALIDATION_MODE_OPTIONS[keyof typeof VALIDATION_MODE_OPTIONS];

export const VALIDATION_STATUS_OPTIONS = {
  PENDING: "Pending",
  IN_PROGRESS: "In-Progress",
  COMPLETED: "Completed",
  FAILED: "Failed",
} as const;

export type ValidationStatusOption = typeof VALIDATION_STATUS_OPTIONS[keyof typeof VALIDATION_STATUS_OPTIONS];

export const VALIDATION_ERROR_MESSAGES = {
  MISSING_PROJECT_ID: "Project ID is required. Please specify a valid projectId.",
  PROJECT_NOT_FOUND: "Project with the specified ID was not found.",
  MISSING_START_DATE: "Prediction objective start date is required. Please specify a start date.",
  INVALID_START_DATE_FORMAT: "Prediction objective start date must be a valid date in YYYY-MM-DD format.",
  MISSING_HORIZON: "Prediction horizon is required. Please specify the number of forecast periods.",
  INVALID_HORIZON: "Prediction horizon must be an integer greater than 0.",
  MISSING_FREQUENCY: "Prediction frequency is required. Please select one of the allowed frequencies (Weekly, Monthly, Yearly).",
  INVALID_FREQUENCY: "Invalid prediction frequency specified.",
  MISSING_SELECTED_MODELS: "At least one candidate model must be selected for validation.",
  MODEL_TRAINING_NOT_COMPLETED: "Model training has not been executed or completed for this project.",
  VALIDATION_EXECUTION_FAILED: "Model validation execution failed.",
} as const;

export const VALIDATION_PIPELINE_CONSTANTS = {
  PIPELINE_NAME: "Model Validation",
  SUBSTEP_NAME: "Model Validation",
  STEP_DISPLAY_NAME: "Model Validation",
  DEFAULT_MAX_RETRIES: 20,
} as const;
