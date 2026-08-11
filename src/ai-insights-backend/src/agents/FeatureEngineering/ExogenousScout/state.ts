import { Annotation } from "@langchain/langgraph";
import { BatchedTableState } from "../../state";

export interface ExogenousSourceRecommendation {
  sourceName: string;
  category: "macroeconomic" | "weather" | "demographic" | "financial" | "geospatial" | "industry_benchmark" | "calendar_events" | "public_api" | "other";
  providerOrUrl?: string;
  description: string;
  joinStrategy: {
    datasetField: string;
    exogenousKey: string;
    joinType: "temporal" | "geospatial" | "categorical_key" | "fuzzy";
    frequency?: "daily" | "monthly" | "yearly" | "realtime" | "static";
  };
  featuresToExtract: string[];
  expectedImpact: string;
  feasibility: "high" | "medium" | "low";
}

export interface TableExogenousAnalysis {
  tableName: string;
  domain?: string;
  summary: string;
  exogenousSources: ExogenousSourceRecommendation[];
  featureOpportunities: string[];
}

export interface ExogenousScoutBatchResult extends Record<string, unknown> {
  status: string;
  summary: string;
  tables: TableExogenousAnalysis[];
  searchQueriesExecuted?: string[];
}

export interface TableMetaEntry {
  columns: Array<{ name: string; type?: string }>;
  domain?: string;
}

export interface WorkerBatchInput {
  workerId: number;
  batchTableNames: string[];
  batchIndex: number;
  totalBatches: number;
  tableMetaMap: Map<string, TableMetaEntry>;
  userPrompt: string;
  projectDomain?: string;
  systemPrompt: string;
}

/**
 * Exogenous Scout LangGraph State Annotation Schema
 */
export const ExogenousScoutAnnotation = Annotation.Root({
  batches: Annotation<string[][]>({
    reducer: (left, right) => right ?? left,
    default: () => [],
  }),
  tableMetaMap: Annotation<Map<string, TableMetaEntry>>({
    reducer: (left, right) => right ?? left,
    default: () => new Map(),
  }),
  userPrompt: Annotation<string>({
    reducer: (left, right) => right ?? left,
    default: () => "",
  }),
  projectDomain: Annotation<string | undefined>({
    reducer: (left, right) => right ?? left,
    default: () => undefined,
  }),
  systemPrompt: Annotation<string>({
    reducer: (left, right) => right ?? left,
    default: () => "",
  }),
  workerResults: Annotation<ExogenousScoutBatchResult[]>({
    reducer: (left, right) => [...left, ...right],
    default: () => [],
  }),
  workerStatuses: Annotation<BatchedTableState[]>({
    reducer: (left, right) => [...left, ...right],
    default: () => [],
  }),
  finalOutput: Annotation<Record<string, unknown>>({
    reducer: (left, right) => ({ ...left, ...right }),
    default: () => ({}),
  }),
});

export type ExogenousScoutStateType = typeof ExogenousScoutAnnotation.State;
