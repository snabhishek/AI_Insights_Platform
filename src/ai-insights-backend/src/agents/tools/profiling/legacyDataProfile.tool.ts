import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { ConnectionTesterService } from "../../../services/connector/connectionTester.service";
import { ConnectionConfig, ConnectorType } from "../../../models/connector.types";
import { connectionConfigSchema } from "../commonSchemas";
import pl from "nodejs-polars";

type ScalarValue = string | number | boolean | null | undefined;

type SampleRow = Record<string, unknown>;

type ColumnProfile = {
  name: string;
  nullCount: number;
  blankCount: number;
  placeholderCount: number;
  distinctCount: number;
  completenessPercentage: number;
  topValues: Array<{ value: string; count: number }>;
  frequencyDistribution: Array<{ value: string; count: number }>;
  inconsistentCategoricalValues: string[];
  recommendation: string;
  statistics: {
    variance: number;
    standardDeviation: number;
    outlierCount: number;
    iqr: number;
    zScoreThreshold: number;
  };
};

type RecommendationAction = {
  issue: string;
  method: string;
  priority: "HIGH" | "MEDIUM" | "LOW";
  confidence: "HIGH" | "MEDIUM" | "LOW";
};

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

const createSeededRandom = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const deterministicShuffle = <T>(values: T[], seed: number): T[] => {
  const cloned = [...values];
  const random = createSeededRandom(seed);
  for (let index = cloned.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    const current = cloned[index];
    cloned[index] = cloned[swapIndex];
    cloned[swapIndex] = current;
  }
  return cloned;
};

const normalizeCellValue = (value: unknown): string => {
  if (value === null || value === undefined) {
    return "";
  }
  const text = String(value).trim().toLowerCase();
  return text.length > 0 ? text : "";
};

const isPlaceholder = (value: unknown): boolean => {
  const normalized = normalizeCellValue(value);
  return normalized.length === 0 || PLACEHOLDER_VALUES.has(normalized);
};

const toNumber = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return undefined;
    }
    const result = Number(trimmed);
    return Number.isFinite(result) ? result : undefined;
  }
  return undefined;
};

const filterRowsByRelationships = (
  rows: SampleRow[],
  tableName: string,
  inspectionTables: Array<Record<string, unknown>>,
  sampledRowsByTable: Map<string, SampleRow[]>
): SampleRow[] => {
  const inspectionTable = inspectionTables.find((candidate) => {
    const candidateName = typeof candidate?.name === "string"
      ? candidate.name
      : typeof candidate?.tableName === "string"
        ? candidate.tableName
        : "";
    return candidateName === tableName;
  });
  const relationEntries = Array.isArray((inspectionTable as Record<string, unknown> | undefined)?.relations)
    ? ((inspectionTable as Record<string, unknown>).relations as Array<Record<string, unknown>>)
    : [];

  let filteredRows = [...rows];
  for (const relation of relationEntries) {
    const foreignTableName = typeof relation.foreignTable === "string" ? relation.foreignTable : "";
    const currentColumn = typeof relation.column === "string" ? relation.column : "";
    const foreignColumn = typeof relation.foreignColumn === "string" ? relation.foreignColumn : "";
    const relationshipRows = sampledRowsByTable.get(foreignTableName);

    if (!foreignTableName || !currentColumn || !foreignColumn || !relationshipRows || relationshipRows.length === 0) {
      continue;
    }

    const allowedValues = new Set<string>();
    for (const relationshipRow of relationshipRows) {
      const value = normalizeCellValue(relationshipRow?.[foreignColumn]);
      if (value.length > 0) {
        allowedValues.add(value);
      }
    }

    if (allowedValues.size === 0) {
      continue;
    }

    filteredRows = filteredRows.filter((row) => allowedValues.has(normalizeCellValue(row?.[currentColumn])));
    if (filteredRows.length === 0) {
      break;
    }
  }

  return filteredRows;
};

const buildHybridSample = (rows: SampleRow[], targetSize: number, seed: number): SampleRow[] => {
  const shuffled = deterministicShuffle(rows, seed);
  const randomSample = shuffled.slice(0, Math.max(0, Math.min(targetSize, shuffled.length)));
  const buckets = new Map<string, SampleRow[]>();
  for (const row of shuffled) {
    const bucketKey = Object.values(row).find((value) => value !== null && value !== undefined && String(value).trim().length > 0);
    const bucket = bucketKey === undefined ? "__empty__" : String(bucketKey);
    const existing = buckets.get(bucket) || [];
    existing.push(row);
    buckets.set(bucket, existing);
  }
  const stratifiedSample: SampleRow[] = [];
  for (const bucketRows of buckets.values()) {
    if (stratifiedSample.length >= targetSize) {
      break;
    }
    if (bucketRows.length > 0) {
      stratifiedSample.push(bucketRows[0]);
    }
  }

  const combined = [...stratifiedSample, ...randomSample];
  const uniqueRows = combined.filter((row, index, array) => index === array.findIndex((candidate) => JSON.stringify(candidate) === JSON.stringify(row)));
  return uniqueRows.slice(0, Math.max(1, Math.min(targetSize, uniqueRows.length)));
};

const summarizeFrequency = (rows: Array<string>) => {
  const map = new Map<string, number>();
  rows.forEach((value) => {
    const current = map.get(value) || 0;
    map.set(value, current + 1);
  });
  return Array.from(map.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 5)
    .map(([value, count]) => ({ value, count }));
};

const buildStatistics = (numericValues: number[]) => {
  if (numericValues.length === 0) {
    return {
      variance: 0,
      standardDeviation: 0,
      outlierCount: 0,
      iqr: 0,
      zScoreThreshold: 0,
    };
  }

  const mean = numericValues.reduce((total, value) => total + value, 0) / numericValues.length;
  const variance = numericValues.reduce((total, value) => total + (value - mean) ** 2, 0) / numericValues.length;
  const standardDeviation = Math.sqrt(variance);
  const sortedValues = [...numericValues].sort((left, right) => left - right);
  const mid = Math.floor(sortedValues.length / 2);
  const lowerHalf = sortedValues.slice(0, Math.floor(sortedValues.length / 2));
  const upperHalf = sortedValues.slice(Math.ceil(sortedValues.length / 2));
  const q1 = lowerHalf.length > 0 ? lowerHalf[Math.floor(lowerHalf.length / 2)] : sortedValues[0];
  const q3 = upperHalf.length > 0 ? upperHalf[Math.floor(upperHalf.length / 2)] : sortedValues[sortedValues.length - 1];
  const iqr = q3 - q1;
  const lowerBound = q1 - 1.5 * iqr;
  const upperBound = q3 + 1.5 * iqr;
  const outlierCount = numericValues.filter((value) => value < lowerBound || value > upperBound).length;
  const zScoreThreshold = standardDeviation > 0 ? 2.5 * standardDeviation : 0;
  return {
    variance,
    standardDeviation,
    outlierCount,
    iqr,
    zScoreThreshold,
  };
};

const createRecommendations = (tableName: string, profiles: ColumnProfile[]): RecommendationAction[] => {
  const recommendations: RecommendationAction[] = [];
  for (const column of profiles) {
    if (column.completenessPercentage < 85) {
      recommendations.push({
        issue: `${column.name} has low completeness`,
        method: "impute_missing",
        priority: "HIGH",
        confidence: "HIGH",
      });
    }
    if (column.inconsistentCategoricalValues.length > 0) {
      recommendations.push({
        issue: `${column.name} contains inconsistent categorical values`,
        method: "normalize_categories",
        priority: "MEDIUM",
        confidence: "MEDIUM",
      });
    }
    if (column.statistics.outlierCount > 0) {
      recommendations.push({
        issue: `${column.name} contains outliers`,
        method: "clip_or_remove_outliers",
        priority: "MEDIUM",
        confidence: "MEDIUM",
      });
    }
  }

  return recommendations.length > 0
    ? recommendations.map((action) => ({ ...action, issue: `${tableName}: ${action.issue}` }))
    : [{ issue: `${tableName} appears structurally clean`, method: "noop", priority: "LOW", confidence: "LOW" }];
};

export const createDataProfileTool = (connectionTester: ConnectionTesterService) =>
  tool(
    async ({ connectorType, connectionConfig, tables, inspectionOutput, seed = 42, sampleSize = 8 }) => {
      const type = connectorType as ConnectorType;
      const config = (connectionConfig || {}) as ConnectionConfig;
      const selectedTables = Array.isArray(tables) ? tables.filter((table): table is string => typeof table === "string" && table.trim().length > 0) : [];
      const stateTables = Array.isArray((inspectionOutput as { selectedTables?: unknown })?.selectedTables)
        ? ((inspectionOutput as { selectedTables?: unknown }).selectedTables as string[]).filter((table): table is string => typeof table === "string" && table.trim().length > 0)
        : [];
      const validTables = selectedTables.length > 0 ? selectedTables : stateTables;
      const inspectionTables = Array.isArray((inspectionOutput as { tables?: unknown })?.tables)
        ? ((inspectionOutput as { tables?: unknown }).tables as Array<Record<string, unknown>>)
        : [];
      const profileTables: Array<{
        tableName: string;
        contentProfile: {
          sampleRows: SampleRow[];
          columns: Array<{ name: string; sampleValues: string[]; distinctCount: number; topValues: Array<{ value: string; count: number }>; frequencyDistribution: Array<{ value: string; count: number }>; inconsistentCategoricalValues: string[] }>;
        };
        completenessProfile: Record<string, unknown>;
        statisticalProfile: Record<string, unknown>;
        recommendations: RecommendationAction[];
      }> = [];
      const warnings: string[] = [];
      const sampledRowsByTable = new Map<string, SampleRow[]>();

      if (validTables.length === 0) {
        return {
          status: "FAILED",
          errorCode: "INVALID_STATE",
          message: "No valid selected tables were supplied for profiling.",
          retryable: false,
          profilingResults: {
            sampling: { method: "Hybrid", sampleSize: 0, seed },
            tables: [],
          },
        };
      }

      for (const tableName of validTables) {
        try {
          const preview = await connectionTester.getPreview(type, config, tableName);
          const rows = Array.isArray(preview.rows) ? preview.rows : [];
          const headers = Array.isArray(preview.headers) ? preview.headers : [];
          const rowsToSample = filterRowsByRelationships(rows, tableName, inspectionTables, sampledRowsByTable);
          const sampledRows = buildHybridSample(rowsToSample, Math.max(1, Math.floor(sampleSize)), seed + validTables.indexOf(tableName));
          sampledRowsByTable.set(tableName, sampledRows);
          const df = pl.DataFrame(sampledRows);
          const columnProfiles: ColumnProfile[] = headers.map((header) => {
            const s = df.getColumn(header);
            
            const nullCount = s.isNull().cast(pl.Int32).sum() as number;
            
            const nonNullStrS = s.filter(s.isNotNull()).cast(pl.Utf8);
            const blankCount = nonNullStrS.str.strip().eq("").cast(pl.Int32).sum() as number;
            
            const nonNullBlankStrS = nonNullStrS.filter(nonNullStrS.str.strip().neq(""));
            const placeholderCount = nonNullBlankStrS.str.strip().str.toLowerCase().isIn(Array.from(PLACEHOLDER_VALUES)).cast(pl.Int32).sum() as number;
            
            const normalizedArray = nonNullBlankStrS.str.strip().str.toLowerCase().toArray().map(String);
            const distinctValues = new Set(normalizedArray);
            
            const frequencyDistribution = summarizeFrequency(Array.from(distinctValues));
            const topValues = summarizeFrequency(Array.from(distinctValues));
            
            const inconsistentCategoricalValues = normalizedArray.filter((value: string) => /^\d+(\.\d+)?$/.test(value) === false && value.length > 20).slice(0, 3);
            
            const totalMissing = nullCount + blankCount + placeholderCount;
            const completenessPercentage = sampledRows.length > 0
              ? Number(((sampledRows.length - totalMissing) / sampledRows.length * 100).toFixed(2))
              : 100;

            let numericValues: number[] = [];
            try {
              numericValues = s.filter(s.isNotNull()).cast(pl.Float64).filter(s.filter(s.isNotNull()).isNotNull()).toArray().map(Number);
            } catch {
              // Ignore
            }
            const statistics = buildStatistics(numericValues);

            return {
              name: header,
              nullCount,
              blankCount,
              placeholderCount,
              distinctCount: distinctValues.size,
              completenessPercentage,
              topValues,
              frequencyDistribution,
              inconsistentCategoricalValues,
              recommendation: completenessPercentage < 85 ? "Impute or review missing values" : "Column appears complete",
              statistics,
            };
          });

          profileTables.push({
            tableName,
            contentProfile: {
              sampleRows: sampledRows,
              columns: columnProfiles.map((column) => ({
                name: column.name,
                sampleValues: sampledRows.map((row) => String(row?.[column.name] ?? "")).slice(0, sampleSize),
                distinctCount: column.distinctCount,
                topValues: column.topValues,
                frequencyDistribution: column.frequencyDistribution,
                inconsistentCategoricalValues: column.inconsistentCategoricalValues,
              })),
            },
            completenessProfile: {
              columns: columnProfiles.map((column) => ({
                name: column.name,
                completenessPercentage: column.completenessPercentage,
                recommendation: column.recommendation,
              })),
            },
            statisticalProfile: {
              columns: columnProfiles.map((column) => ({
                name: column.name,
                variance: column.statistics.variance,
                standardDeviation: column.statistics.standardDeviation,
                outlierCount: column.statistics.outlierCount,
                iqr: column.statistics.iqr,
                zScoreThreshold: column.statistics.zScoreThreshold,
              })),
            },
            recommendations: createRecommendations(tableName, columnProfiles),
          });
        } catch (error) {
          warnings.push(error instanceof Error ? error.message : "Profiling failed");
          profileTables.push({
            tableName,
            contentProfile: { sampleRows: [], columns: [] },
            completenessProfile: { columns: [] },
            statisticalProfile: { columns: [] },
            recommendations: [{ issue: `${tableName} could not be profiled`, method: "review_input", priority: "HIGH", confidence: "LOW" }],
          });
        }
      }

      return {
        status: "OK",
        profilingResults: {
          sampling: {
            method: "Hybrid",
            sampleSize: Math.max(1, Math.floor(sampleSize)),
            seed,
            strategy: "Random sampling followed by deterministic stratified sampling",
          },
          tables: profileTables,
        },
        selectedTables: validTables,
        profile: {
          sampleSize: Math.max(1, Math.floor(sampleSize)),
          quality: warnings.length > 0 ? "needs-review" : "ready",
          warnings,
          tables: profileTables,
        },
      };
    },
    {
      name: "profileData",
      description: "Profile selected tables using deterministic hybrid sampling and structured metrics derived from the inspection output.",
      schema: z.object({
        connectorType: z.string().describe("Connector type"),
        connectionConfig: connectionConfigSchema,
        tables: z.array(z.string()).optional().describe("Tables to profile"),
        inspectionOutput: z.union([z.string(), z.object({ tables: z.array(z.object({ name: z.string().optional() })).optional() })]).optional().describe("Inspection output context"),
        seed: z.number().optional().describe("Deterministic seed value for repeated sampling"),
        sampleSize: z.number().optional().describe("Maximum number of sampled rows to inspect"),
      }),
    }
  );
