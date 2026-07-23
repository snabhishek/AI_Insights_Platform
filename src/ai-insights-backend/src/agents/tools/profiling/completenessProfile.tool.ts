import { tool } from "@langchain/core/tools";
import { z } from "zod";

type SampleRow = Record<string, unknown>;

const DEFAULT_PLACEHOLDER_VALUES = new Set([
  "", " ", "-", "--", "n/a", "na", "none", "null", "nil", "unknown", "undefined",
  "not available", "not applicable", "tbd", "tba", "#n/a", "#ref!", "#value!",
]);

const normalizeCellValue = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  return String(value).trim().toLowerCase();
};

const isNullish = (value: unknown): boolean => value === null || value === undefined;
const isBlank = (value: unknown): boolean => {
  if (isNullish(value)) return true;
  return String(value).trim().length === 0;
};

const isPlaceholder = (value: unknown, customPatterns: Set<string>): boolean => {
  const normalized = normalizeCellValue(value);
  return customPatterns.has(normalized) || DEFAULT_PLACEHOLDER_VALUES.has(normalized);
};

const inferMissingPattern = (
  columnValues: unknown[],
  allRows: SampleRow[],
  columnName: string,
  allColumns: string[]
): "MCAR" | "MAR" | "MNAR" | "unknown" => {
  const missingIndices = new Set<number>();
  columnValues.forEach((val, idx) => {
    if (isNullish(val) || isBlank(val)) missingIndices.add(idx);
  });

  if (missingIndices.size === 0 || missingIndices.size === columnValues.length) return "unknown";

  const missingRate = missingIndices.size / columnValues.length;

  // Check for MAR: is missingness correlated with other columns?
  for (const otherCol of allColumns) {
    if (otherCol === columnName) continue;

    const otherValues = allRows.map((row) => row[otherCol]);
    const otherMissing = otherValues.filter((_, i) => missingIndices.has(i));
    const otherPresent = otherValues.filter((_, i) => !missingIndices.has(i));

    const missingDistinct = new Set(otherMissing.map((v) => normalizeCellValue(v)));
    const presentDistinct = new Set(otherPresent.map((v) => normalizeCellValue(v)));

    const overlap = [...missingDistinct].filter((v) => presentDistinct.has(v)).length;
    const totalDistinct = new Set([...missingDistinct, ...presentDistinct]).size;
    if (totalDistinct > 0 && overlap / totalDistinct < 0.3) {
      return "MAR";
    }
  }

  // Check for MNAR: are the non-missing values clustered in a specific range?
  const nonMissingValues = columnValues
    .filter((v) => !isNullish(v) && !isBlank(v))
    .map((v) => {
      const num = Number(v);
      return Number.isFinite(num) ? num : null;
    })
    .filter((v): v is number => v !== null);

  if (nonMissingValues.length > 5) {
    const sorted = [...nonMissingValues].sort((a, b) => a - b);
    const p10 = sorted[Math.floor(sorted.length * 0.1)];
    const p90 = sorted[Math.floor(sorted.length * 0.9)];
    const range = p90 - p10;
    const mean = nonMissingValues.reduce((s, v) => s + v, 0) / nonMissingValues.length;

    if (range > 0 && (mean - p10) / range > 0.8) {
      return "MNAR";
    }
  }

  return missingRate < 0.3 ? "MCAR" : "unknown";
};

export const createCompletenessProfileTool = () =>
  tool(
    async ({ rows, columns, tableName, placeholderPatterns }) => {
      const sampleRows = Array.isArray(rows) ? (rows as SampleRow[]) : [];
      const allColumns = sampleRows.length > 0 ? Object.keys(sampleRows[0]) : [];
      const targetColumns = Array.isArray(columns) && columns.length > 0 ? columns : allColumns;

      const customPatterns = new Set(DEFAULT_PLACEHOLDER_VALUES);
      if (Array.isArray(placeholderPatterns)) {
        for (const p of placeholderPatterns) {
          if (typeof p === "string") customPatterns.add(p.trim().toLowerCase());
        }
      }

      const totalRows = sampleRows.length;

      let fullyPopulatedRows = 0;
      for (const row of sampleRows) {
        const allPresent = allColumns.every((col) => {
          const val = row[col];
          return !isNullish(val) && !isBlank(val) && !isPlaceholder(val, customPatterns);
        });
        if (allPresent) fullyPopulatedRows++;
      }

      const columnProfiles = targetColumns.map((colName) => {
        const values = sampleRows.map((row) => row[colName]);

        let nullCount = 0;
        let blankCount = 0;
        let placeholderCount = 0;

        for (const val of values) {
          if (isNullish(val)) {
            nullCount++;
          } else if (String(val).trim().length === 0) {
            blankCount++;
          } else if (isPlaceholder(val, customPatterns)) {
            placeholderCount++;
          }
        }

        const totalMissing = nullCount + blankCount + placeholderCount;
        const completenessPercent = totalRows > 0
          ? Number((((totalRows - totalMissing) / totalRows) * 100).toFixed(2))
          : 100;

        const missingPattern = inferMissingPattern(values, sampleRows, colName, allColumns);

        let recommendation = "Column appears complete";
        if (completenessPercent < 50) {
          recommendation = "Critical: consider dropping column or investigating data source";
        } else if (completenessPercent < 75) {
          recommendation = "High priority: impute missing values or review data pipeline";
        } else if (completenessPercent < 90) {
          recommendation = "Moderate: apply imputation strategy based on column type";
        } else if (completenessPercent < 100) {
          recommendation = "Minor: small number of missing values, imputation recommended";
        }

        return {
          name: colName,
          nullCount,
          blankCount,
          placeholderCount,
          totalMissing,
          completenessPercent,
          missingPattern,
          recommendation,
        };
      });

      return {
        tableName: tableName || "unknown",
        profileType: "completeness",
        totalRows,
        fullyPopulatedRows,
        rowCompletenessPercent: totalRows > 0
          ? Number(((fullyPopulatedRows / totalRows) * 100).toFixed(2))
          : 100,
        columnsProfiled: columnProfiles.length,
        columns: columnProfiles,
      };
    },
    {
      name: "completenessProfile",
      description:
        "Profile data completeness for specified columns. " +
        "Computes null counts, blank counts, placeholder value counts, completeness percentages, " +
        "and infers missing value patterns (MCAR/MAR/MNAR). " +
        "Also calculates row-level completeness. Use this to identify columns with data quality issues.",
      schema: z.object({
        rows: z.array(z.record(z.string(), z.any())).describe("Sample rows to analyze"),
        columns: z.array(z.string()).optional().describe("Specific columns to check; omit to check all"),
        tableName: z.string().optional().describe("Table name for context"),
        placeholderPatterns: z.array(z.string()).optional().describe(
          "Additional placeholder strings to treat as missing (e.g. 'TBD', 'NOT SET')"
        ),
      }),
    }
  );
