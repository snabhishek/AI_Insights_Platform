import { tool } from "@langchain/core/tools";
import { z } from "zod";
import pl from "nodejs-polars";
import { fetchRowsOnDemand } from "../helpers/samplingHelper";
import { ConnectionTesterService } from "../../../services/connector/connectionTester.service";
import { ConnectorService } from "../../../services/connector/connector.service";
import { connectionConfigSchema, foreignKeyValuesSchema } from "../helpers/commonSchemas";

type SampleRow = Record<string, unknown>;

const PATTERN_CHECKS: Array<{ name: string; regex: RegExp }> = [
  { name: "email", regex: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ },
  { name: "url", regex: /^https?:\/\/.+/ },
  { name: "uuid", regex: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i },
  { name: "phone", regex: /^[\+]?[(]?[0-9]{1,4}[)]?[-\s./0-9]{6,}$/ },
  { name: "date_iso", regex: /^\d{4}-\d{2}-\d{2}/ },
  { name: "date_us", regex: /^\d{1,2}\/\d{1,2}\/\d{2,4}$/ },
  { name: "numeric_integer", regex: /^-?\d+$/ },
  { name: "numeric_decimal", regex: /^-?\d+\.\d+$/ },
  { name: "boolean", regex: /^(true|false|yes|no|0|1)$/i },
  { name: "id_pattern", regex: /^[A-Z]{1,5}[-_]?\d{3,}$/i },
  { name: "zip_code", regex: /^\d{5}(-\d{4})?$/ },
  { name: "currency", regex: /^[\$€£¥]\s?[\d,]+\.?\d*$/ },
];


const filterNonEmptySeries = (s: pl.Series): pl.Series => {
  const lengths = s.str.lengths();
  const zeroSeries = pl.Series("zeros", Array(lengths.length).fill(0));
  return s.filter(lengths.gt(zeroSeries));
};

const inferTypePl = (s: pl.Series): { inferredType: string; mixedTypePercent: number } => {
  const nonNullS = s.filter(s.isNotNull());
  const valid = nonNullS.length;
  if (valid === 0) return { inferredType: "unknown", mixedTypePercent: 0 };

  const strS = nonNullS.cast(pl.Utf8).str.strip();
  const validStr = filterNonEmptySeries(strS);
  const validCount = validStr.length;
  if (validCount === 0) return { inferredType: "unknown", mixedTypePercent: 0 };

  let numericCount = 0;
  let booleanCount = 0;
  let dateCount = 0;
  let stringCount = 0;

  const arr = validStr.toArray().map(String);
  for (const str of arr) {
    if (/^-?\d+(\.\d+)?$/.test(str)) {
      numericCount++;
    } else if (/^(true|false)$/i.test(str)) {
      booleanCount++;
    } else if (!isNaN(Date.parse(str)) && /\d{4}/.test(str)) {
      dateCount++;
    } else {
      stringCount++;
    }
  }

  const typeCounts = {
    numeric: numericCount,
    boolean: booleanCount,
    date: dateCount,
    string: stringCount,
  };

  const sorted = Object.entries(typeCounts).sort((a, b) => b[1] - a[1]);
  const dominant = sorted[0];
  const mixedCount = validCount - dominant[1];
  const mixedTypePercent = Number(((mixedCount / validCount) * 100).toFixed(2));

  return { inferredType: dominant[1] > 0 ? dominant[0] : "unknown", mixedTypePercent };
};

const detectPatternsPl = (s: pl.Series): string[] => {
  const nonNullS = s.filter(s.isNotNull());
  const strS = nonNullS.cast(pl.Utf8).str.strip();
  const nonEmpty = filterNonEmptySeries(strS);
  const total = nonEmpty.length;
  if (total === 0) return [];

  const arr = nonEmpty.toArray().map(String);
  const sampleArr = arr.length > 250 ? arr.slice(0, 250) : arr;
  const sampleTotal = sampleArr.length;
  const detected: string[] = [];
  for (const check of PATTERN_CHECKS) {
    const matchCount = sampleArr.filter((v) => check.regex.test(v)).length;
    if (matchCount / sampleTotal >= 0.5) {
      detected.push(check.name);
    }
  }
  return detected;
};

const classifyCategoricalOrContinuous = (
  distinctCount: number,
  totalCount: number,
  inferredType: string
): "categorical" | "continuous" | "binary" | "identifier" | "unknown" => {
  if (totalCount === 0) return "unknown";
  if (distinctCount <= 2) return "binary";
  if (inferredType === "numeric" && distinctCount / totalCount > 0.8) return "continuous";
  if (inferredType === "date") return "continuous";
  if (distinctCount <= 20 || distinctCount / totalCount < 0.05) return "categorical";
  if (distinctCount / totalCount > 0.9) return "identifier";
  return distinctCount <= 50 ? "categorical" : "continuous";
};

const buildFrequencyDistributionPl = (s: pl.Series, totalCount: number, topN: number = 10) => {
  const nonNullS = s.filter(s.isNotNull());
  const strS = nonNullS.cast(pl.Utf8).str.strip();
  const nonEmpty = filterNonEmptySeries(strS);
  if (nonEmpty.length === 0) return [];

  const vc = nonEmpty.valueCounts();
  const sortedVc = vc.sort("count", true);
  const headVc = sortedVc.head(topN);

  const valuesArr = headVc.getColumn(nonEmpty.name).toArray().map(String);
  const countsArr = headVc.getColumn("count").toArray().map(Number);

  const results = [];
  for (let i = 0; i < headVc.shape.height; i++) {
    const val = String(valuesArr[i]);
    const count = Number(countsArr[i]);
    results.push({
      value: val,
      count,
      percentage: Number(((count / totalCount) * 100).toFixed(2)),
    });
  }
  return results;
};

export const createContentValueProfileTool = (
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
      // sampleSize,
      seed,
      stratifyColumn,
      relationships,
      foreignKeyValues,
      columns,
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
          // sampleSize,
          seed,
          stratifyColumn,
          relationships,
          foreignKeyValues,
        }
      );

      if (error || sampleRows.length === 0) {
        return {
          tableName: tableName || "unknown",
          profileType: "content_value_distribution",
          totalRows: 0,
          columnsProfiled: 0,
          columns: [],
          rows: [],
          error,
        };
      }

      const df = pl.DataFrame(sampleRows);
      const allColumns = df.columns;
      const targetColumns = Array.isArray(columns) && columns.length > 0 ? columns : allColumns;

      const columnProfiles = targetColumns.map((colName) => {
        const s = df.getColumn(colName);
        const nonNullS = s.filter(s.isNotNull());
        const strS = nonNullS.cast(pl.Utf8).str.strip();
        const nonEmpty = filterNonEmptySeries(strS);

        const distinctCount = nonEmpty.nUnique();
        const { inferredType, mixedTypePercent } = inferTypePl(s);
        const patterns = detectPatternsPl(s);
        const topValues = buildFrequencyDistributionPl(s, sampleRows.length, 10);
        const categoricalOrContinuous = classifyCategoricalOrContinuous(
          distinctCount,
          sampleRows.length,
          inferredType
        );

        return {
          name: colName,
          inferredType,
          distinctCount,
          totalValues: sampleRows.length,
          nonEmptyCount: nonEmpty.length,
          topValues,
          patterns,
          mixedTypePercent,
          categoricalOrContinuous,
        };
      });

      return {
        tableName: tableName || "unknown",
        profileType: "content_value_distribution",
        totalRows: sampleRows.length,
        columnsProfiled: columnProfiles.length,
        columns: columnProfiles,
        // rows: sampleRows, // Retain fetched rows so the agent can extract PKs to sync child tables
      };
    },
    {
      name: "contentValueProfile",
      description:
        "Profile content and value distribution for specified columns in sample data. " +
        "Fetches the required sample records on demand.",
      schema: z.object({
        connectorId: z.string().optional().describe("Connector ID to resolve connection settings"),
        connectorType: z.string().optional().describe("Connector type fallback"),
        connectionConfig: connectionConfigSchema,
        tableName: z.string().describe("Table name for context"),
        sampleMethod: z.enum(["random", "stratified", "interval"]).optional().describe("Sampling method"),
        // sampleSize: z.number().optional().describe("Number of sample records to fetch (stratified defaults to 40% of table row count)"),
        seed: z.number().optional().describe("Deterministic seed for reproducible sampling"),
        stratifyColumn: z.string().optional().describe("Column to group by for stratified sampling"),
        relationships: z.array(z.object({
          column: z.string().describe("Local FK column"),
          foreignTable: z.string().describe("Referenced table"),
          foreignColumn: z.string().describe("Referenced column"),
        })).optional().describe("Table relationships from inspector output for referential integrity filtering"),
        foreignKeyValues: foreignKeyValuesSchema,
        columns: z.array(z.string()).optional().describe("Specific columns to profile; omit to profile all columns"),
      }),
    }
  );
