import { tool } from "@langchain/core/tools";
import { z } from "zod";

type NumericValue = number | string | null | undefined;

const toNumber = (value: NumericValue): number | undefined => {
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

export const calculateAggregateStats = (values: Array<NumericValue>) => {
  const numericValues = values
    .map((value) => toNumber(value))
    .filter((value): value is number => typeof value === "number");

  if (numericValues.length === 0) {
    return {
      count: 0,
      mean: 0,
      median: 0,
      mode: null,
      min: 0,
      max: 0,
      variance: 0,
      standardDeviation: 0,
      percentile90: 0,
    };
  }

  const sorted = [...numericValues].sort((left, right) => left - right);
  const count = numericValues.length;
  const mean = numericValues.reduce((total, value) => total + value, 0) / count;
  const variance = numericValues.reduce((total, value) => total + (value - mean) ** 2, 0) / count;
  const standardDeviation = Math.sqrt(variance);
  const median = count % 2 === 0
    ? (sorted[count / 2 - 1] + sorted[count / 2]) / 2
    : sorted[Math.floor(count / 2)];
  const frequency = new Map<number, number>();
  numericValues.forEach((value) => {
    frequency.set(value, (frequency.get(value) || 0) + 1);
  });
  const mode = Array.from(frequency.entries())
    .sort((left, right) => right[1] - left[1] || left[0] - right[0])[0]?.[0] ?? null;
  const percentileIndex = Math.max(0, Math.min(count - 1, Math.floor((count - 1) * 0.9)));
  const percentile90 = sorted[percentileIndex];

  return {
    count,
    mean,
    median,
    mode,
    min: sorted[0],
    max: sorted[count - 1],
    variance,
    standardDeviation,
    percentile90,
  };
};

export const createStatisticsTool = () =>
  tool(
    async ({ values, columnName }) => {
      const numericValues = Array.isArray(values) ? values : [];
      const stats = calculateAggregateStats(numericValues as Array<NumericValue>);
      return {
        columnName: typeof columnName === "string" ? columnName : "column",
        values: numericValues,
        statistics: stats,
      };
    },
    {
      name: "computeStatistics",
      description: "Compute deterministic aggregate statistics such as mean, median, mode, variance, and percentile values for a column.",
      schema: z.object({
        values: z.array(z.union([z.number(), z.string(), z.null(), z.undefined()])).describe("Values to summarize"),
        columnName: z.string().optional().describe("Column name for traceability"),
      }),
    }
  );
