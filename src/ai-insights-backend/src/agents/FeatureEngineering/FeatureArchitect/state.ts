import { Annotation } from "@langchain/langgraph";
import { BatchedTableState } from "../../state";

export interface OrchestrationDecisionOutput extends Record<string, unknown> {
  status: string;
  summary: string;
  decisions?: Array<{
    tableName: string;
    featureCreationTargets: Array<{
      columnNames: string[];
      proposedFeatureName: string;
      technique: string;
      rationale: string;
    }>;
    featureTransformationTargets: Array<{
      columnName: string;
      technique: string;
      rationale: string;
    }>;
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
  userPrompt: Annotation<string>({
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

  // Aggregated output of Feature Architect
  finalOutput: Annotation<Record<string, unknown>>({
    reducer: (left, right) => ({ ...left, ...right }),
    default: () => ({}),
  }),
});

export type FeatureArchitectStateType = typeof FeatureArchitectAnnotation.State;
