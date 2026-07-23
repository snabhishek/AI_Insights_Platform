import { tool } from "@langchain/core/tools";
import { z } from "zod";

type RowValue = string | number | boolean | null | undefined;
type SampleRow = Record<string, unknown>;

type MissingStrategy = "mean" | "median" | "mode" | "constant";

const PLACEHOLDER_VALUES = new Set([
  "",
  " ",
  "-",
  "--",
  "n/a",
  "na",
  "none",
  "null",
  "nil",
  "unknown",
  "undefined",
]);

const normalizeValue = (value: unknown): string => {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value).trim().toLowerCase();
};

const isMissingValue = (value: unknown): boolean => {
  if (value === null || value === undefined) {
    return true;
  }
  const normalized = normalizeValue(value);
  return normalized.length === 0 || PLACEHOLDER_VALUES.has(normalized);
};

export const applyMissingValueStrategy = (rows: SampleRow[], columnName: string, strategy: MissingStrategy, fillValue?: string | number, statistics?: Record<string, unknown>) => {
  const transformedRows = rows.map((row) => {
    const currentValue = row[columnName];
    if (!isMissingValue(currentValue)) {
      return row;
    }

    const replacement = (() => {
      if (strategy === "constant" && fillValue !== undefined) {
        return fillValue;
      }
      if (strategy === "mean" && typeof statistics?.mean === "number") {
        return statistics.mean;
      }
      if (strategy === "median" && typeof statistics?.median === "number") {
        return statistics.median;
      }
      if (strategy === "mode" && statistics?.mode !== undefined && statistics.mode !== null) {
        return statistics.mode as string | number;
      }
      return fillValue ?? "";
    })();

    return {
      ...row,
      [columnName]: replacement,
    };
  });

  const filledCount = transformedRows.filter((row, index) => row[columnName] !== rows[index][columnName]).length;
  return {
    columnName,
    strategy,
    filledCount,
    rows: transformedRows,
  };
};

export const createMissingValueTool = () =>
  tool(
    async ({ rows, columnName, strategy = "median", fillValue, statistics }) => {
      const sampleRows = Array.isArray(rows) ? rows : [];
      const normalizedStrategy = (strategy as MissingStrategy) || "median";
      const normalizedStatistics = (statistics || {}) as Record<string, unknown>;
      return applyMissingValueStrategy(sampleRows as SampleRow[], String(columnName || ""), normalizedStrategy, typeof fillValue === "string" || typeof fillValue === "number" ? fillValue : undefined, normalizedStatistics);
    },
    {
      name: "imputeMissingValues",
      description: "Fill missing or placeholder values in a column using a deterministic imputation strategy derived from profile statistics.",
      schema: z.object({
        rows: z.array(z.record(z.string(), z.any())).describe("Sample rows to transform"),
        columnName: z.string().describe("Column to impute"),
        strategy: z.enum(["mean", "median", "mode", "constant"]).optional().describe("Imputation strategy"),
        fillValue: z.union([z.number(), z.string()]).optional().describe("Fallback value used for constant replacement"),
        statistics: z.record(z.string(), z.any()).optional().describe("Stats computed for the target column"),
      }),
    }
  );
