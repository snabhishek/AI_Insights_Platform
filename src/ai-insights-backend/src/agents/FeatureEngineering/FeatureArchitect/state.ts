import { Annotation } from "@langchain/langgraph";
import { BatchedTableState } from "../../state";

export interface OrchestrationDecisionOutput extends Record<string, unknown> {
  status: string;
  summary: string;
  problemType?: string;
  targetColumn?: string;
  predictionEntity?: string;
  timeColumn?: string;
  leakageColumns?: string[];
  decisions?: Array<{
    tableName: string;
    confidence: string;
    rationale: string;
  }>;
}

export interface FeatureCreationOutput extends Record<string, unknown> {
  status: string;
  summary: string;
  recommendations?: Array<{
    tableName: string;
    newFeatures: Array<{
      featureName: string;
      technique: string;
      sourceColumns: string[];
      description: string;
    }>;
  }>;
  pythonCode?: string;
  yamlLineage?: string;
}

export interface FeatureTransformationOutput extends Record<string, unknown> {
  status: string;
  summary: string;
  recommendations?: Array<{
    tableName: string;
    transformations: Array<{
      columnName: string;
      technique: string;
      description: string;
    }>;
  }>;
  pythonCode?: string;
  yamlLineage?: string;
}

export interface BuildDatasetOutput extends Record<string, unknown> {
  status: string;
  summary: string;
  pythonCode?: string;
  yamlLineage?: string;
}

export interface DataValidationOutput extends Record<string, unknown> {
  status: string;
  summary: string;
  pythonCode?: string;
  yamlLineage?: string;
  validationReport?: {
    nullRates: Record<string, number>;
    anomalies: string[];
    leakageFound: boolean;
  };
}

export interface FeatureExtractionOutput extends Record<string, unknown> {
  status: string;
  summary: string;
  recommendations?: Array<{
    tableName: string;
    extractions: Array<{
      technique: string;
      targetColumns: string[];
      numberOfComponents: number;
      rationale: string;
    }>;
  }>;
  pythonCode?: string;
  yamlLineage?: string;
}

export interface FeatureSelectionOutput extends Record<string, unknown> {
  status: string;
  summary: string;
  recommendations?: Array<{
    tableName: string;
    selections: Array<{
      selectedFeatures: string[];
      discardedFeatures: string[];
      methodology: string;
      rationale: string;
    }>;
  }>;
  pythonCode?: string;
  yamlLineage?: string;
}

/**
 * Feature Architect LangGraph State Annotation Schema
 */
export const FeatureArchitectAnnotation = Annotation.Root({
  // Inputs
  batchedTables: Annotation<BatchedTableState[]>({
    reducer: (left, right) => right ?? left,
    default: () => [],
  }),
  inspector: Annotation<Record<string, unknown>>({
    reducer: (left, right) => right ?? left,
    default: () => ({}),
  }),
  dataProfile: Annotation<Record<string, unknown>>({
    reducer: (left, right) => right ?? left,
    default: () => ({}),
  }),

  userPrompt: Annotation<string>({
    reducer: (left, right) => right ?? left,
    default: () => "",
  }),
  connectorId: Annotation<string[]>({
    reducer: (left, right) => right ?? left,
    default: () => [],
  }),
  runTimestamp: Annotation<string>({
    reducer: (left, right) => right ?? left,
    default: () => "",
  }),

  // Orchestrator decision
  orchestrationDecision: Annotation<OrchestrationDecisionOutput>({
    reducer: (left, right) => right ?? left,
    default: () => ({ status: "Pending", summary: "" }),
  }),

  // Outputs of individual steps
  featureCreation: Annotation<FeatureCreationOutput>({
    reducer: (left, right) => right ?? left,
    default: () => ({ status: "Pending", summary: "" }),
  }),
  featureTransformation: Annotation<FeatureTransformationOutput>({
    reducer: (left, right) => right ?? left,
    default: () => ({ status: "Pending", summary: "" }),
  }),
  buildDataset: Annotation<BuildDatasetOutput>({
    reducer: (left, right) => right ?? left,
    default: () => ({ status: "Pending", summary: "" }),
  }),
  dataValidation: Annotation<DataValidationOutput>({
    reducer: (left, right) => right ?? left,
    default: () => ({ status: "Pending", summary: "" }),
  }),
  featureExtraction: Annotation<FeatureExtractionOutput>({
    reducer: (left, right) => right ?? left,
    default: () => ({ status: "Pending", summary: "" }),
  }),
  featureSelection: Annotation<FeatureSelectionOutput>({
    reducer: (left, right) => right ?? left,
    default: () => ({ status: "Pending", summary: "" }),
  }),

  // Supervisor tracking
  nextWorker: Annotation<string>({
    reducer: (left, right) => right ?? left,
    default: () => "",
  }),
  history: Annotation<Array<{ worker: string; summary: string }>>({
    reducer: (left = [], right = []) => [...left, ...right],
    default: () => [],
  }),
  currentExecutionLogs: Annotation<string>({
    reducer: (left, right) => right ?? left,
    default: () => "",
  }),

  // Aggregated output of Feature Architect
  finalOutput: Annotation<Record<string, unknown>>({
    reducer: (left, right) => ({ ...left, ...right }),
    default: () => ({}),
  }),
});

export type FeatureArchitectStateType = typeof FeatureArchitectAnnotation.State;
