import { tool } from "@langchain/core/tools";
import { z } from "zod";

type SampleRow = Record<string, unknown>;

const normalizeHeader = (value: string): string => value.trim().replace(/\s+/g, "_").toLowerCase();

export const normalizeRowsAndHeaders = (rows: SampleRow[]) => {
  const normalizedRows = rows.map((row) => {
    const normalized: Record<string, unknown> = {};
    Object.entries(row).forEach(([key, value]) => {
      normalized[normalizeHeader(key)] = value;
    });
    return normalized;
  });

  const headers = Array.from(new Set(normalizedRows.flatMap((row) => Object.keys(row))));
  return {
    headers,
    rows: normalizedRows,
  };
};

export const createNormalizationTool = () =>
  tool(
    async ({ rows }) => normalizeRowsAndHeaders(Array.isArray(rows) ? (rows as SampleRow[]) : []),
    {
      name: "normalizeSchema",
      description: "Normalize row keys and column headers to a consistent shape that downstream ingestion steps can consume.",
      schema: z.object({
        rows: z.array(z.record(z.string(), z.any())).describe("Rows to normalize"),
      }),
    }
  );
