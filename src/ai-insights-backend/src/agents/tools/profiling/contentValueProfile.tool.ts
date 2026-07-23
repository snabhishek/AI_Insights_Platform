import { tool } from "@langchain/core/tools";
import { z } from "zod";

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

const inferType = (values: unknown[]): { inferredType: string; mixedTypePercent: number } => {
  const typeCounts: Record<string, number> = {};
  let valid = 0;

  for (const val of values) {
    if (val === null || val === undefined) continue;
    const str = String(val).trim();
    if (str.length === 0) continue;
    valid++;

    if (typeof val === "number" || /^-?\d+(\.\d+)?$/.test(str)) {
      typeCounts["numeric"] = (typeCounts["numeric"] || 0) + 1;
    } else if (typeof val === "boolean" || /^(true|false)$/i.test(str)) {
      typeCounts["boolean"] = (typeCounts["boolean"] || 0) + 1;
    } else if (!isNaN(Date.parse(str)) && /\d{4}/.test(str)) {
      typeCounts["date"] = (typeCounts["date"] || 0) + 1;
    } else {
      typeCounts["string"] = (typeCounts["string"] || 0) + 1;
    }
  }

  if (valid === 0) return { inferredType: "unknown", mixedTypePercent: 0 };

  const sorted = Object.entries(typeCounts).sort((a, b) => b[1] - a[1]);
  const dominant = sorted[0];
  const mixedCount = valid - dominant[1];
  const mixedTypePercent = Number(((mixedCount / valid) * 100).toFixed(2));

  return { inferredType: dominant[0], mixedTypePercent };
};

const detectPatterns = (values: string[]): string[] => {
  const nonEmpty = values.filter((v) => v.length > 0);
  if (nonEmpty.length === 0) return [];

  const detected: string[] = [];
  for (const check of PATTERN_CHECKS) {
    const matchCount = nonEmpty.filter((v) => check.regex.test(v)).length;
    if (matchCount / nonEmpty.length >= 0.5) {
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

const buildFrequencyDistribution = (values: string[], topN: number = 10) => {
  const freq = new Map<string, number>();
  for (const val of values) {
    if (val.length === 0) continue;
    freq.set(val, (freq.get(val) || 0) + 1);
  }
  return Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, topN)
    .map(([value, count]) => ({ value, count, percentage: Number(((count / values.length) * 100).toFixed(2)) }));
};

export const createContentValueProfileTool = () =>
  tool(
    async ({ rows, columns, tableName }) => {
      const sampleRows = Array.isArray(rows) ? (rows as SampleRow[]) : [];
      const targetColumns = Array.isArray(columns) && columns.length > 0
        ? columns
        : sampleRows.length > 0 ? Object.keys(sampleRows[0]) : [];

      const columnProfiles = targetColumns.map((colName) => {
        const values = sampleRows.map((row) => row[colName]);
        const stringValues = values.map((v) => (v === null || v === undefined ? "" : String(v).trim()));
        const nonEmptyValues = stringValues.filter((v) => v.length > 0);

        const distinctValues = new Set(nonEmptyValues);
        const { inferredType, mixedTypePercent } = inferType(values);
        const patterns = detectPatterns(nonEmptyValues);
        const topValues = buildFrequencyDistribution(nonEmptyValues, 10);
        const categoricalOrContinuous = classifyCategoricalOrContinuous(
          distinctValues.size,
          sampleRows.length,
          inferredType
        );

        return {
          name: colName,
          inferredType,
          distinctCount: distinctValues.size,
          totalValues: sampleRows.length,
          nonEmptyCount: nonEmptyValues.length,
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
      };
    },
    {
      name: "contentValueProfile",
      description:
        "Profile content and value distribution for specified columns in sample data. " +
        "Computes distinct value counts, top-N frequency distribution, value pattern detection (email, date, ID, etc.), " +
        "data type inference (detects mixed types), and categorical vs continuous classification. " +
        "Use this to understand what kind of data each column contains before deciding profiling strategy.",
      schema: z.object({
        rows: z.array(z.record(z.string(), z.any())).describe("Sample rows to analyze"),
        columns: z.array(z.string()).optional().describe("Specific columns to profile; omit to profile all columns"),
        tableName: z.string().optional().describe("Table name for context"),
      }),
    }
  );
