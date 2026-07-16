import { tool } from "@langchain/core/tools";
import { z } from "zod";

type SampleRow = Record<string, unknown>;

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

const normalizeCellValue = (value: unknown): string => {
  if (value === null || value === undefined) {
    return "unknown";
  }
  const trimmed = String(value).trim();
  if (trimmed.length === 0) {
    return "unknown";
  }
  const normalized = trimmed.replace(/\s+/g, " ").toLowerCase();
  return PLACEHOLDER_VALUES.has(normalized) ? "unknown" : normalized;
};

export const normalizeCategoricalValues = (rows: SampleRow[], columnName: string) => {
  const transformedRows = rows.map((row) => ({
    ...row,
    [columnName]: normalizeCellValue(row[columnName]),
  }));

  const uniqueValues = Array.from(new Set(transformedRows.map((row) => String(row[columnName]))));
  return {
    columnName,
    transformedRows,
    uniqueValues,
  };
};

export const createCategoricalTool = () =>
  tool(
    async ({ rows, columnName }) => normalizeCategoricalValues(Array.isArray(rows) ? (rows as SampleRow[]) : [], String(columnName || "")),
    {
      name: "normalizeCategoricalValues",
      description: "Normalize categorical values by trimming whitespace, collapsing placeholders, and standardizing casing.",
      schema: z.object({
        rows: z.array(z.record(z.string(), z.any())).describe("Sample rows to transform"),
        columnName: z.string().describe("Categorical column to normalize"),
      }),
    }
  );
