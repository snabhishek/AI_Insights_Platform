/**
 * Constants for Feature Engineering & Feature Architect Pipeline Artifacts and Stages
 */

export const ARTIFACT_FEATURE_CREATED = "feature_created.parquet";
export const ARTIFACT_FEATURE_TRANSFORMATION = "feature_transformation.parquet";
export const ARTIFACT_DATASET = "dataset.parquet";
export const ARTIFACT_FEATURE_EXTRACTION = "feature_extraction.parquet";
export const ARTIFACT_FEATURE_SELECTION = "feature_selection.parquet";
export const ARTIFACT_FEATURE_VALIDATION = "feature_validation.parquet";
export const ARTIFACT_FEATURE_VALIDATION_REPORT = "feature_validation_report.json";
export const ARTIFACT_VALIDATION_REPORT = "validation_report.json";
export const ARTIFACT_METADATA_YAML = "metadata.yaml";

export const DEFAULT_PIPELINE_SCRIPT_NAME = "aggregated_feature_pipeline.py";

export const REGION_SHARED_IMPORTS = "SHARED_IMPORTS";
export const REGION_FEATURE_CREATION = "FEATURE_CREATION";
export const REGION_FEATURE_TRANSFORMATION = "FEATURE_TRANSFORMATION";
export const REGION_BUILD_DATASET = "BUILD_DATASET";
export const REGION_DATA_VALIDATION = "DATA_VALIDATION";
export const REGION_FEATURE_EXTRACTION = "FEATURE_EXTRACTION";
export const REGION_FEATURE_SELECTION = "FEATURE_SELECTION";
export const REGION_FEATURE_VALIDATION = "FEATURE_VALIDATION";

export const WORKER_SUPERVISOR = "featureSupervisor";
export const WORKER_FEATURE_CREATION = "featureCreation";
export const WORKER_FEATURE_TRANSFORMATION = "featureTransformation";
export const WORKER_BUILD_DATASET = "buildDataset";
export const WORKER_DATA_VALIDATION = "dataValidation";
export const WORKER_FEATURE_EXTRACTION = "featureExtraction";
export const WORKER_FEATURE_SELECTION = "featureSelection";
export const WORKER_FEATURE_VALIDATOR = "featureValidator";
export const WORKER_PROGRAM_RECTIFIER = "programRectifier";
export const WORKER_FINISH = "FINISH";

export const STATUS_SUCCESS = "Success";
export const STATUS_COMPLETED = "Completed";
export const STATUS_FAILED = "Failed";
export const STATUS_PENDING = "Pending";
export const STATUS_RUNNING = "running";
export const STATUS_OK = "OK";

export const TRACE_FEATURE_CREATION = "featureArchitect:featureCreation";
export const TRACE_FEATURE_TRANSFORMATION = "featureArchitect:featureTransformation";
export const TRACE_BUILD_DATASET = "featureArchitect:buildDataset";
export const TRACE_DATA_VALIDATION = "featureArchitect:dataValidation";
export const TRACE_FEATURE_EXTRACTION = "featureArchitect:featureExtraction";
export const TRACE_FEATURE_SELECTION = "featureArchitect:featureSelection";
export const TRACE_FEATURE_VALIDATOR = "featureArchitect:featureValidator";
export const TRACE_SUPERVISOR = "featureArchitect:supervisor";
export const TRACE_RECTIFIER = "featureArchitect:rectifier";

export const PROMPT_FEATURE_CREATION = "FeatureArchitect/featureCreation.md";
export const PROMPT_FEATURE_TRANSFORMATION = "FeatureArchitect/featureTransformation.md";
export const PROMPT_BUILD_DATASET = "FeatureArchitect/buildDataset.md";
export const PROMPT_DATA_VALIDATION = "FeatureArchitect/dataValidation.md";
export const PROMPT_FEATURE_EXTRACTION = "FeatureArchitect/featureExtraction.md";
export const PROMPT_FEATURE_SELECTION = "FeatureArchitect/featureSelection.md";
export const PROMPT_FEATURE_VALIDATOR = "FeatureValidator/featureValidator.md";
export const PROMPT_FEATURE_SUPERVISOR = "FeatureArchitect/featureSupervisor.md";
export const PROMPT_PROGRAM_RECTIFIER = "FeatureArchitect/programRectifier.md";
