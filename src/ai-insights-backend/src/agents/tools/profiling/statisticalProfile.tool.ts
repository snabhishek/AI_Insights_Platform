import { tool } from "@langchain/core/tools";
import { z } from "zod";
import pl from "nodejs-polars";
import { fetchRowsOnDemand } from "../helpers/samplingHelper";
import { ConnectionTesterService } from "../../../services/connector/connectionTester.service";
import { ConnectorService } from "../../../services/connector/connector.service";
import { connectionConfigSchema, foreignKeyValuesSchema, parseColumnTypes } from "../helpers/commonSchemas";

type SampleRow = Record<string, unknown>;

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

const profileNumericColumnPl = (colName: string, s: pl.Series) => {
  const nonNullS = s.filter(s.isNotNull());
  
  let numericS: pl.Series;
  try {
    numericS = nonNullS.cast(pl.Float64).filter(nonNullS.isNotNull());
  } catch {
    // If casting fails, filter elements manually or return empty stats
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

  const n = numericS.length;
  if (n === 0) {
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

  const statsDf = pl.DataFrame({ v: numericS });
  const selResult: any = statsDf.select(
    pl.col("v").mean().alias("mean"),
    pl.col("v").var().alias("variance"),
    pl.col("v").std().alias("stddev"),
    pl.col("v").median().alias("median"),
    pl.col("v").skew().alias("skewness"),
    pl.col("v").kurtosis().alias("kurtosis"),
    pl.col("v").min().alias("minVal"),
    pl.col("v").max().alias("maxVal"),
    pl.col("v").quantile(0.05).alias("p5"),
    pl.col("v").quantile(0.25).alias("p25"),
    pl.col("v").quantile(0.50).alias("p50"),
    pl.col("v").quantile(0.75).alias("p75"),
    pl.col("v").quantile(0.95).alias("p95")
  );
  const aggregatedRec: Record<string, any> = selResult.toRecords()[0] || {};

  const mean = (aggregatedRec["mean"] as number) ?? 0;
  const variance = (aggregatedRec["variance"] as number) ?? 0;
  const stddev = (aggregatedRec["stddev"] as number) ?? 0;
  const median = (aggregatedRec["median"] as number) ?? 0;
  const skewness = (aggregatedRec["skewness"] as number) ?? 0;
  const kurtosis = (aggregatedRec["kurtosis"] as number) ?? 0;
  const minVal = (aggregatedRec["minVal"] as number) ?? 0;
  const maxVal = (aggregatedRec["maxVal"] as number) ?? 0;
  const p5 = (aggregatedRec["p5"] as number) ?? 0;
  const p25 = (aggregatedRec["p25"] as number) ?? 0;
  const p50 = (aggregatedRec["p50"] as number) ?? 0;
  const p75 = (aggregatedRec["p75"] as number) ?? 0;
  const p95 = (aggregatedRec["p95"] as number) ?? 0;

  const modeSeries = numericS.mode();
  const mode = modeSeries.length > 0 ? Number(modeSeries.get(0)) : null;
  const iqr = p75 - p25;

  const lowerBound = p25 - 1.5 * iqr;
  const upperBound = p75 + 1.5 * iqr;
  
  const isOutlierArr = numericS.toArray().map((val: any) => val < lowerBound || val > upperBound);
  const isOutlier = pl.Series("is_outlier", isOutlierArr);
  const outlierS = numericS.filter(isOutlier);
  const outlierValues = outlierS.slice(0, 20).toArray().map(Number);

  const distinctRatio = numericS.nUnique() / n;
  const distributionShape = classifyDistribution(skewness, kurtosis, distinctRatio);

  return {
    name: colName,
    dataCategory: "numeric" as const,
    count: n,
    mean: Number(mean.toFixed(4)),
    median: Number(median.toFixed(4)),
    mode,
    min: Number(minVal.toFixed(4)),
    max: Number(maxVal.toFixed(4)),
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
      count: outlierS.length,
      lowerBound: Number(lowerBound.toFixed(4)),
      upperBound: Number(upperBound.toFixed(4)),
      outlierValues,
    },
    distributionShape,
  };
};

const profileDateColumnPl = (colName: string, s: pl.Series) => {
  const dates = s.filter(s.isNotNull()).toArray().map((v) => new Date(String(v))).filter((d) => !isNaN(d.getTime()));
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

export const createStatisticalProfileTool = (
  connectionTester: ConnectionTesterService,
  connectorService: ConnectorService,
  defaultConnector?: any
) =>
  tool(
    async ({
      connectorId,
      connectorType,
      connectionConfig,
      tableName,
      sampleMethod,
      sampleSize,
      seed,
      stratifyColumn,
      relationships,
      foreignKeyValues,
      columns,
      columnTypes,
    }) => {
      const { rows: sampleRows, totalRowCount, error } = await fetchRowsOnDemand(
        connectionTester,
        connectorService,
        defaultConnector,
        {
          connectorId,
          connectorType,
          connectionConfig,
          tableName,
          sampleMethod,
          sampleSize,
          seed,
          stratifyColumn,
          relationships,
          foreignKeyValues,
        }
      );

      if (error || sampleRows.length === 0) {
        return {
          tableName: tableName || "unknown",
          profileType: "statistical",
          totalRows: 0,
          numericColumns: [],
          dateColumns: [],
          skippedColumns: [],
          rows: [],
          error,
        };
      }

      const df = pl.DataFrame(sampleRows);
      const allColumns = df.columns;
      const targetColumns = Array.isArray(columns) && columns.length > 0 ? columns : allColumns;
      const typeMap = parseColumnTypes(columnTypes);

      const numericProfiles: ReturnType<typeof profileNumericColumnPl>[] = [];
      const dateProfiles: ReturnType<typeof profileDateColumnPl>[] = [];
      const skippedColumns: string[] = [];

      for (const colName of targetColumns) {
        const colType = typeMap[colName] || "auto";
        const s = df.getColumn(colName);
        const nonNullCount = s.filter(s.isNotNull()).length;

        if (colType === "date" || colType === "timestamp") {
          const dates = s.filter(s.isNotNull()).toArray().map((v: any) => new Date(String(v))).filter((d: any) => !isNaN(d.getTime()));
          if (dates.length > 0) {
            dateProfiles.push(profileDateColumnPl(colName, s));
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
        let isNumeric = false;
        try {
          const numS = s.filter(s.isNotNull()).cast(pl.Float64);
          const validNumCount = numS.filter(numS.isNotNull()).length;
          if (validNumCount >= nonNullCount * 0.5) {
            numericProfiles.push(profileNumericColumnPl(colName, s));
            isNumeric = true;
          }
        } catch {
          // Ignore casting failure
        }

        if (isNumeric) continue;

        const dateValues = s.filter(s.isNotNull()).toArray().map((v: any) => new Date(String(v))).filter((d: any) => !isNaN(d.getTime()));
        if (dateValues.length >= nonNullCount * 0.5) {
          dateProfiles.push(profileDateColumnPl(colName, s));
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
        // rows: sampleRows, // Retain fetched rows so the agent can extract PKs to sync child tables
      };
    },
    {
      name: "statisticalProfile",
      description:
        "Compute statistical profiles for numeric and date columns in sample data. " +
        "Fetches the required sample records on demand.",
      schema: z.object({
        connectorId: z.string().optional().describe("Connector ID to resolve connection settings"),
        connectorType: z.string().optional().describe("Connector type fallback"),
        connectionConfig: connectionConfigSchema,
        tableName: z.string().describe("Table name for context"),
        sampleMethod: z.enum(["random", "stratified", "interval"]).optional().describe("Sampling method"),
        sampleSize: z.number().optional().describe("Number of sample records to fetch (stratified defaults to 40% of table row count)"),
        seed: z.number().optional().describe("Deterministic seed for reproducible sampling"),
        stratifyColumn: z.string().optional().describe("Column to group by for stratified sampling"),
        relationships: z.array(z.object({
          column: z.string().describe("Local FK column"),
          foreignTable: z.string().describe("Referenced table"),
          foreignColumn: z.string().describe("Referenced column"),
        })).optional().describe("Table relationships from inspector output for referential integrity filtering"),
        foreignKeyValues: foreignKeyValuesSchema,
        columns: z.array(z.string()).optional().describe("Columns to profile; omit to auto-detect all numeric/date columns"),
        columnTypes: z.array(z.object({
          columnName: z.string().describe("Column name"),
          inferredType: z.string().describe("Inferred type (numeric, date, string)"),
        })).optional().describe("List of column types inferred from contentValueProfile"),
      }),
    }
  );
