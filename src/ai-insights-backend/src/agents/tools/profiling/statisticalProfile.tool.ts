import { tool } from "@langchain/core/tools";
import { z } from "zod";

type SampleRow = Record<string, unknown>;

const toNumber = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) return undefined;
    const result = Number(trimmed);
    return Number.isFinite(result) ? result : undefined;
  }
  return undefined;
};

const toDate = (value: unknown): Date | undefined => {
  if (value instanceof Date && !isNaN(value.getTime())) return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0 || !/\d{4}/.test(trimmed)) return undefined;
    const d = new Date(trimmed);
    return isNaN(d.getTime()) ? undefined : d;
  }
  return undefined;
};

const percentile = (sorted: number[], p: number): number => {
  if (sorted.length === 0) return 0;
  const idx = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (idx - lower) * (sorted[upper] - sorted[lower]);
};

const classifyDistribution = (skewness: number, kurtosis: number, distinctRatio: number): string => {
  if (distinctRatio <= 0.02) return "constant";
  if (Math.abs(skewness) < 0.5 && Math.abs(kurtosis - 3) < 1) return "normal";
  if (skewness > 1) return "right_skewed";
  if (skewness < -1) return "left_skewed";
  if (kurtosis > 5) return "heavy_tailed";
  if (kurtosis < 2) return "light_tailed";
  if (Math.abs(skewness) < 0.5) return "approximately_normal";
  return "skewed";
};

const profileNumericColumn = (colName: string, values: number[]) => {
  if (values.length === 0) {
    return {
      name: colName,
      dataCategory: "numeric" as const,
      count: 0,
      mean: 0, median: 0, mode: null as number | null, min: 0, max: 0,
      variance: 0, stddev: 0, skewness: 0, kurtosis: 0,
      percentiles: { p5: 0, p25: 0, p50: 0, p75: 0, p95: 0 },
      iqr: 0,
      outliers: { count: 0, lowerBound: 0, upperBound: 0, outlierValues: [] as number[] },
      distributionShape: "unknown",
    };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const n = values.length;
  const mean = values.reduce((s, v) => s + v, 0) / n;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  const stddev = Math.sqrt(variance);

  const median = n % 2 === 0
    ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2
    : sorted[Math.floor(n / 2)];

  // Mode
  const freq = new Map<number, number>();
  values.forEach((v) => freq.set(v, (freq.get(v) || 0) + 1));
  const maxFreq = Math.max(...freq.values());
  const mode = maxFreq > 1
    ? [...freq.entries()].filter(([, c]) => c === maxFreq).sort((a, b) => a[0] - b[0])[0][0]
    : null;

  // Skewness & kurtosis
  const skewness = stddev > 0
    ? values.reduce((s, v) => s + ((v - mean) / stddev) ** 3, 0) / n
    : 0;
  const kurtosis = stddev > 0
    ? values.reduce((s, v) => s + ((v - mean) / stddev) ** 4, 0) / n
    : 0;

  // Percentiles
  const p5 = percentile(sorted, 5);
  const p25 = percentile(sorted, 25);
  const p50 = percentile(sorted, 50);
  const p75 = percentile(sorted, 75);
  const p95 = percentile(sorted, 95);
  const iqr = p75 - p25;

  // Outliers
  const lowerBound = p25 - 1.5 * iqr;
  const upperBound = p75 + 1.5 * iqr;
  const outlierValues = values.filter((v) => v < lowerBound || v > upperBound);

  const distinctRatio = new Set(values).size / n;
  const distributionShape = classifyDistribution(skewness, kurtosis, distinctRatio);

  return {
    name: colName,
    dataCategory: "numeric" as const,
    count: n,
    mean: Number(mean.toFixed(4)),
    median: Number(median.toFixed(4)),
    mode,
    min: sorted[0],
    max: sorted[n - 1],
    variance: Number(variance.toFixed(4)),
    stddev: Number(stddev.toFixed(4)),
    skewness: Number(skewness.toFixed(4)),
    kurtosis: Number(kurtosis.toFixed(4)),
    percentiles: {
      p5: Number(p5.toFixed(4)),
      p25: Number(p25.toFixed(4)),
      p50: Number(p50.toFixed(4)),
      p75: Number(p75.toFixed(4)),
      p95: Number(p95.toFixed(4)),
    },
    iqr: Number(iqr.toFixed(4)),
    outliers: {
      count: outlierValues.length,
      lowerBound: Number(lowerBound.toFixed(4)),
      upperBound: Number(upperBound.toFixed(4)),
      outlierValues: outlierValues.slice(0, 20),
    },
    distributionShape,
  };
};

const profileDateColumn = (colName: string, dates: Date[]) => {
  if (dates.length === 0) {
    return {
      name: colName,
      dataCategory: "date" as const,
      count: 0,
      minDate: null, maxDate: null, rangeInDays: 0,
      gaps: [] as Array<{ from: string; to: string; gapDays: number }>,
      temporalPatterns: [] as string[],
    };
  }

  const sorted = [...dates].sort((a, b) => a.getTime() - b.getTime());
  const minDate = sorted[0];
  const maxDate = sorted[sorted.length - 1];
  const rangeMs = maxDate.getTime() - minDate.getTime();
  const rangeInDays = Math.round(rangeMs / (1000 * 60 * 60 * 24));

  // Gap detection: find gaps > 2x median gap
  const dayGaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const gap = (sorted[i].getTime() - sorted[i - 1].getTime()) / (1000 * 60 * 60 * 24);
    dayGaps.push(gap);
  }

  const gaps: Array<{ from: string; to: string; gapDays: number }> = [];
  if (dayGaps.length > 2) {
    const sortedGaps = [...dayGaps].sort((a, b) => a - b);
    const medianGap = sortedGaps[Math.floor(sortedGaps.length / 2)];
    const threshold = Math.max(medianGap * 3, 7);

    dayGaps.forEach((gap, i) => {
      if (gap > threshold) {
        gaps.push({
          from: sorted[i].toISOString().split("T")[0],
          to: sorted[i + 1].toISOString().split("T")[0],
          gapDays: Math.round(gap),
        });
      }
    });
  }

  // Temporal patterns
  const patterns: string[] = [];
  const dayOfWeekCounts = new Array(7).fill(0);
  const monthCounts = new Array(12).fill(0);
  for (const d of dates) {
    dayOfWeekCounts[d.getDay()]++;
    monthCounts[d.getMonth()]++;
  }

  const avgDow = dates.length / 7;
  const weekdayConcentration = dayOfWeekCounts.filter((c) => c > avgDow * 2).length;
  if (weekdayConcentration > 0 && weekdayConcentration <= 2) {
    patterns.push("weekly_concentration");
  }

  const avgMonth = dates.length / 12;
  const monthConcentration = monthCounts.filter((c) => c > avgMonth * 2).length;
  if (monthConcentration > 0 && monthConcentration <= 3) {
    patterns.push("seasonal_pattern");
  }

  return {
    name: colName,
    dataCategory: "date" as const,
    count: dates.length,
    minDate: minDate.toISOString().split("T")[0],
    maxDate: maxDate.toISOString().split("T")[0],
    rangeInDays,
    gaps: gaps.slice(0, 10),
    temporalPatterns: patterns,
  };
};

export const createStatisticalProfileTool = () =>
  tool(
    async ({ rows, columns, tableName, columnTypes }) => {
      const sampleRows = Array.isArray(rows) ? (rows as SampleRow[]) : [];
      const allColumns = sampleRows.length > 0 ? Object.keys(sampleRows[0]) : [];
      const targetColumns = Array.isArray(columns) && columns.length > 0 ? columns : allColumns;
      const typeMap = (columnTypes || {}) as Record<string, string>;

      const numericProfiles: ReturnType<typeof profileNumericColumn>[] = [];
      const dateProfiles: ReturnType<typeof profileDateColumn>[] = [];
      const skippedColumns: string[] = [];

      for (const colName of targetColumns) {
        const colType = typeMap[colName] || "auto";
        const rawValues = sampleRows.map((row) => row[colName]);

        if (colType === "date" || colType === "timestamp") {
          const dates = rawValues.map(toDate).filter((d): d is Date => d !== undefined);
          if (dates.length > 0) {
            dateProfiles.push(profileDateColumn(colName, dates));
          } else {
            skippedColumns.push(colName);
          }
          continue;
        }

        if (colType === "string" || colType === "boolean") {
          skippedColumns.push(colName);
          continue;
        }

        // Auto-detect: try numeric first, then date
        const numericValues = rawValues.map(toNumber).filter((n): n is number => n !== undefined);
        if (numericValues.length >= rawValues.filter((v) => v !== null && v !== undefined).length * 0.5) {
          numericProfiles.push(profileNumericColumn(colName, numericValues));
          continue;
        }

        const dateValues = rawValues.map(toDate).filter((d): d is Date => d !== undefined);
        if (dateValues.length >= rawValues.filter((v) => v !== null && v !== undefined).length * 0.5) {
          dateProfiles.push(profileDateColumn(colName, dateValues));
          continue;
        }

        skippedColumns.push(colName);
      }

      return {
        tableName: tableName || "unknown",
        profileType: "statistical",
        totalRows: sampleRows.length,
        numericColumns: numericProfiles,
        dateColumns: dateProfiles,
        skippedColumns,
      };
    },
    {
      name: "statisticalProfile",
      description:
        "Compute statistical profiles for numeric and date columns in sample data. " +
        "For numeric columns: mean, median, mode, min, max, variance, stddev, skewness, kurtosis, " +
        "percentiles (p5/p25/p50/p75/p95), IQR, outlier detection, and distribution shape classification. " +
        "For date columns: min/max date, range, gap detection, and temporal patterns. " +
        "Use columnTypes from contentValueProfile output to target the right columns. " +
        "Non-numeric/non-date columns are automatically skipped.",
      schema: z.object({
        rows: z.array(z.record(z.string(), z.any())).describe("Sample rows to analyze"),
        columns: z.array(z.string()).optional().describe("Columns to profile; omit to auto-detect all numeric/date columns"),
        tableName: z.string().optional().describe("Table name for context"),
        columnTypes: z.record(z.string(), z.string()).optional().describe(
          "Map of column name → inferred type from contentValueProfile (e.g. 'numeric', 'date', 'string'). Helps skip non-applicable columns."
        ),
      }),
    }
  );
