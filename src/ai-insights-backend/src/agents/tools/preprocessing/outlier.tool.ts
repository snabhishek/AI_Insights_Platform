import { tool } from "@langchain/core/tools";
import { z } from "zod";

type SampleRow = Record<string, unknown>;

type Method = "iqr" | "zscore";

type Strategy = "clip" | "flag";

const toNumber = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return undefined;
    }
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
};

export const detectAndTransformOutliers = (rows: SampleRow[], columnName: string, method: Method = "iqr", strategy: Strategy = "clip") => {
  const numericValues = rows
    .map((row) => toNumber(row[columnName]))
    .filter((value): value is number => typeof value === "number");

  if (numericValues.length === 0) {
    return {
      columnName,
      method,
      strategy,
      outlierCount: 0,
      transformedRows: rows,
      bounds: { lower: 0, upper: 0 },
    };
  }

  const sorted = [...numericValues].sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  const lowerHalf = sorted.slice(0, Math.floor(sorted.length / 2));
  const upperHalf = sorted.slice(Math.ceil(sorted.length / 2));
  const q1 = lowerHalf.length > 0 ? lowerHalf[Math.floor(lowerHalf.length / 2)] : sorted[0];
  const q3 = upperHalf.length > 0 ? upperHalf[Math.floor(upperHalf.length / 2)] : sorted[sorted.length - 1];
  const iqr = q3 - q1;
  const lowerBound = q1 - 1.5 * iqr;
  const upperBound = q3 + 1.5 * iqr;

  const transformedRows = rows.map((row) => {
    const numericValue = toNumber(row[columnName]);
    if (numericValue === undefined) {
      return row;
    }
    const isOutlier = numericValue < lowerBound || numericValue > upperBound;
    if (!isOutlier) {
      return row;
    }

    const replacement = strategy === "clip"
      ? Math.min(upperBound, Math.max(lowerBound, numericValue))
      : `__outlier__`;

    return {
      ...row,
      [columnName]: replacement,
    };
  });

  return {
    columnName,
    method,
    strategy,
    outlierCount: transformedRows.filter((row, index) => row[columnName] !== rows[index][columnName]).length,
    transformedRows,
    bounds: { lower: lowerBound, upper: upperBound },
  };
};

export const createOutlierTool = () =>
  tool(
    async ({ rows, columnName, method = "iqr", strategy = "clip" }) => detectAndTransformOutliers(Array.isArray(rows) ? (rows as SampleRow[]) : [], String(columnName || ""), method as Method, strategy as Strategy),
    {
      name: "detectOutliers",
      description: "Identify numeric outliers and clip or flag them using deterministic IQR-based bounds.",
      schema: z.object({
        rows: z.array(z.record(z.string(), z.any())).describe("Sample rows to inspect"),
        columnName: z.string().describe("Numeric column to inspect"),
        method: z.enum(["iqr", "zscore"]).optional().describe("Outlier detection method"),
        strategy: z.enum(["clip", "flag"]).optional().describe("Deterministic remediation strategy"),
      }),
    }
  );
