import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { ConnectorType } from "../../../models/connector.types";

export const createPreprocessTool = () =>
  tool(
    async ({ connectorType, dataProfile }) => {
      const type = connectorType as ConnectorType;
      const selectedTables = Array.isArray((dataProfile as any)?.selectedTables) ? (dataProfile as any).selectedTables : [];
      const profileTables = Array.isArray((dataProfile as any)?.profile?.tables) ? (dataProfile as any).profile.tables : [];
      const steps = new Set<string>();
      const notes: string[] = [];

      steps.add("normalize_nulls");
      steps.add("trim_strings");

      for (const table of profileTables) {
        const columns = Array.isArray(table?.columns) ? table.columns : [];
        const hasManyNulls = columns.some((col: any) => col.nullCount > (table.sampleSize || 0) / 2);
        if (hasManyNulls) {
          steps.add("impute_missing");
          notes.push(`Table ${table.name} has high null ratios.`);
        }
        const hasLowCardinality = columns.some((col: any) => col.uniqueCount <= 1);
        if (hasLowCardinality) {
          steps.add("drop_constant_columns");
        }
      }

      if (["csv", "tsv", "excel"].includes(type)) {
        steps.add("standardize_headers");
      }

      return {
        normalized: true,
        tableCount: selectedTables.length,
        steps: Array.from(steps),
        notes: notes.length > 0 ? notes.join(" ") : "Data staged for downstream ingestion.",
      };
    },
    {
      name: "preprocessData",
      description: "Derive preprocessing steps based on profiling output and connector type.",
      schema: z.object({
        connectorType: z.string().describe("Connector type"),
        dataProfile: z.record(z.string(), z.any()).describe("Profile output from the data profiling step"),
      }),
    }
  );
