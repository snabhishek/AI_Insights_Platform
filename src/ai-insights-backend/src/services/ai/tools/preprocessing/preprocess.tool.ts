import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { ConnectorType } from "../../../../models/connector.types";
import { calculateAggregateStats } from "./statistics.tool";
import { applyMissingValueStrategy } from "./missingValue.tool";
import { normalizeCategoricalValues } from "./categorical.tool";
import { detectAndTransformOutliers } from "./outlier.tool";
import { normalizeRowsAndHeaders } from "./normalization.tool";

type Action = {
  issue: string;
  method: string;
  priority: "HIGH" | "MEDIUM" | "LOW";
  confidence: "HIGH" | "MEDIUM" | "LOW";
};

type ProfileTable = Record<string, unknown> & {
  tableName?: string;
  contentProfile?: {
    sampleRows?: Array<Record<string, unknown>>;
    columns?: Array<Record<string, unknown>>;
  };
  completenessProfile?: {
    columns?: Array<Record<string, unknown>>;
  };
  statisticalProfile?: {
    columns?: Array<Record<string, unknown>>;
  };
  recommendations?: Array<Record<string, unknown>>;
};

const inferActions = (connectorType: string, profilePayload: Record<string, unknown>) => {
  const selectedTables = Array.isArray((profilePayload as any)?.selectedTables) ? (profilePayload as any).selectedTables : [];
  const tables = Array.isArray((profilePayload as any)?.profilingResults?.tables)
    ? (profilePayload as any).profilingResults.tables
    : Array.isArray((profilePayload as any)?.profile?.tables)
      ? (profilePayload as any).profile.tables
      : [];
  const actions: Action[] = [];

  for (const table of tables) {
    const profileColumns = Array.isArray(table?.contentProfile?.columns) ? table.contentProfile.columns : [];
    const completeness = Array.isArray((table as any)?.completenessProfile?.columns) ? (table as any).completenessProfile.columns : [];
    const issues = completeness.filter((column: any) => typeof column?.completenessPercentage === "number" && column.completenessPercentage < 85);
    if (issues.length > 0) {
      actions.push({ issue: `${table.tableName || "table"} has low completeness`, method: "impute_missing", priority: "HIGH", confidence: "HIGH" });
    }
    const lowCardinality = profileColumns.some((column: any) => typeof column?.distinctCount === "number" && column.distinctCount <= 1);
    if (lowCardinality) {
      actions.push({ issue: `${table.tableName || "table"} contains near-constant columns`, method: "drop_constant_columns", priority: "MEDIUM", confidence: "MEDIUM" });
    }
    if (profileColumns.some((column: any) => Array.isArray(column?.inconsistentCategoricalValues) && column.inconsistentCategoricalValues.length > 0)) {
      actions.push({ issue: `${table.tableName || "table"} has inconsistent categories`, method: "normalize_categories", priority: "MEDIUM", confidence: "MEDIUM" });
    }
    if (["csv", "tsv", "excel"].includes(String(connectorType))) {
      actions.push({ issue: `${table.tableName || "table"} should be normalized for downstream ingestion`, method: "standardize_headers", priority: "LOW", confidence: "MEDIUM" });
    }
  }

  if (actions.length === 0 && selectedTables.length > 0) {
    actions.push({ issue: "No remediation needed from current profile", method: "noop", priority: "LOW", confidence: "LOW" });
  }

  return actions;
};

const extractTables = (profilePayload: Record<string, unknown>) => {
  const profilingTables = Array.isArray((profilePayload as any)?.profilingResults?.tables)
    ? (profilePayload as any).profilingResults.tables
    : Array.isArray((profilePayload as any)?.profile?.tables)
      ? (profilePayload as any).profile.tables
      : [];
  const selectedTables = Array.isArray((profilePayload as any)?.selectedTables)
    ? (profilePayload as any).selectedTables.filter((value: unknown) => typeof value === "string" && value.trim().length > 0)
    : [];
  return {
    tables: profilingTables as ProfileTable[],
    selectedTables,
  };
};

const applyTableTransforms = (connectorType: string, table: ProfileTable) => {
  const rows = Array.isArray(table?.contentProfile?.sampleRows) ? table.contentProfile.sampleRows : [];
  const completenessColumns = Array.isArray(table?.completenessProfile?.columns) ? table.completenessProfile.columns : [];
  const statisticalColumns = Array.isArray(table?.statisticalProfile?.columns) ? table.statisticalProfile.columns : [];
  const contentColumns = Array.isArray(table?.contentProfile?.columns) ? table.contentProfile.columns : [];
  const actions: Action[] = [];
  let transformedRows = rows.map((row) => ({ ...row }));

  completenessColumns.forEach((column: Record<string, unknown>) => {
    const columnName = typeof column?.name === "string" ? column.name : "";
    const completenessPercentage = typeof column?.completenessPercentage === "number" ? column.completenessPercentage : 100;
    if (!columnName || completenessPercentage >= 85) {
      return;
    }

    const statistics = calculateAggregateStats(transformedRows.map((row) => row[columnName] as number | string | null | undefined));
    const imputed = applyMissingValueStrategy(transformedRows, columnName, "median", undefined, statistics as Record<string, unknown>);
    transformedRows = imputed.rows as Array<Record<string, unknown>>;
    actions.push({ issue: `${table.tableName || columnName} has low completeness on ${columnName}`, method: "impute_missing", priority: "HIGH", confidence: "HIGH" });
  });

  contentColumns.forEach((column: Record<string, unknown>) => {
    const columnName = typeof column?.name === "string" ? column.name : "";
    if (!columnName || !Array.isArray(column?.inconsistentCategoricalValues) || column.inconsistentCategoricalValues.length === 0) {
      return;
    }
    const normalized = normalizeCategoricalValues(transformedRows, columnName);
    transformedRows = normalized.transformedRows as Array<Record<string, unknown>>;
    actions.push({ issue: `${table.tableName || columnName} has inconsistent categories on ${columnName}`, method: "normalize_categories", priority: "MEDIUM", confidence: "MEDIUM" });
  });

  statisticalColumns.forEach((column: Record<string, unknown>) => {
    const columnName = typeof column?.name === "string" ? column.name : "";
    const outlierCount = typeof column?.outlierCount === "number" ? column.outlierCount : 0;
    if (!columnName || outlierCount <= 0) {
      return;
    }
    const transformed = detectAndTransformOutliers(transformedRows, columnName, "iqr", "clip");
    transformedRows = transformed.transformedRows as Array<Record<string, unknown>>;
    actions.push({ issue: `${table.tableName || columnName} has outliers on ${columnName}`, method: "clip_or_remove_outliers", priority: "MEDIUM", confidence: "MEDIUM" });
  });

  if (["csv", "tsv", "excel"].includes(String(connectorType))) {
    const normalized = normalizeRowsAndHeaders(transformedRows);
    transformedRows = normalized.rows as Array<Record<string, unknown>>;
    actions.push({ issue: `${table.tableName || "table"} headers were normalized for downstream ingestion`, method: "standardize_headers", priority: "LOW", confidence: "MEDIUM" });
  }

  return {
    tableName: typeof table?.tableName === "string" ? table.tableName : "table",
    transformedRows,
    actions,
  };
};

export const createPreprocessTool = () =>
  tool(
    async ({ connectorType, dataProfile }) => {
      const type = connectorType as ConnectorType;
      const profilePayload = (dataProfile || {}) as Record<string, unknown>;
      const { tables, selectedTables } = extractTables(profilePayload);
      const actions = inferActions(type, profilePayload);
      const transformedTables = tables.map((table) => applyTableTransforms(type, table));
      return {
        normalized: true,
        tableCount: selectedTables.length > 0 ? selectedTables.length : transformedTables.length,
        preprocessingPlan: {
          connectorType: type,
          actions: actions.length > 0 ? actions : transformedTables.flatMap((table) => table.actions),
        },
        transformedTables,
      };
    },
    {
      name: "preprocessData",
      description: "Apply deterministic preprocessing actions to profile-derived sample rows and return a structured plan for downstream ingestion.",
      schema: z.object({
        connectorType: z.string().describe("Connector type"),
        dataProfile: z.record(z.string(), z.any()).describe("Profile output from the data profiling step"),
      }),
    }
  );
