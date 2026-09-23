import { PIPELINE_NAMES, PipelineName } from "./pipelineNames";

export const DATA_INGESTION_SUBSTEPS: Record<string, PipelineName> = {
  "inspect": PIPELINE_NAMES.DATA_INGESTION,
  "profileData": PIPELINE_NAMES.DATA_INGESTION,
  "preprocess": PIPELINE_NAMES.DATA_INGESTION,
  "resolveSchema": PIPELINE_NAMES.DATA_INGESTION,
  "Data Inspection": PIPELINE_NAMES.DATA_INGESTION,
  "Data Profiling": PIPELINE_NAMES.DATA_INGESTION,
  "Schema Resolver": PIPELINE_NAMES.DATA_INGESTION,
  "Data Ingestion": PIPELINE_NAMES.DATA_INGESTION,
};
