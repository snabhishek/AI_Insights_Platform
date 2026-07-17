import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { ConnectionTesterService } from "../../../connectionTester.service";
import { ConnectorService } from "../../../connector.service";
import { ConnectionConfig, ConnectorType } from "../../../../models/connector.types";

type SampleRow = Record<string, unknown>;

const buildRowKey = (row: SampleRow, keyColumns: string[]): string => {
  return keyColumns
    .map((col) => {
      const val = row[col];
      return val === null || val === undefined ? "__null__" : String(val).trim().toLowerCase();
    })
    .join("|");
};

export const createDuplicateDetectionTool = (
  connectionTester: ConnectionTesterService,
  connectorService: ConnectorService
) =>
  tool(
    async ({ connectorId, connectorType, connectionConfig, tableName, keyColumns, strategy, sampleSize }) => {
      let resolvedType = connectorType as ConnectorType | undefined;
      let config = connectionConfig as ConnectionConfig | undefined;

      if (typeof connectorId === "string" && connectorId.trim().length > 0) {
        const connector = await connectorService.getById(connectorId);
        if (!connector) {
          return { success: false, tableName, error: "Connector not found" };
        }
        resolvedType = connector.type;
        config = connector.connectionConfig || {};
      }

      if (!resolvedType || !config) {
        return { success: false, tableName, error: "Missing connector configuration" };
      }

      const type = resolvedType;
      const keys = Array.isArray(keyColumns) ? keyColumns.filter((k) => typeof k === "string" && k.trim().length > 0) : [];
      const dedupeStrategy = strategy || "flag";
      const limit = typeof sampleSize === "number" && sampleSize > 0 ? sampleSize : 500;

      if (keys.length === 0) {
        return { success: false, tableName, error: "At least one keyColumn is required for duplicate detection" };
      }

      try {
        // For databases, use SQL-based duplicate detection
        if (type === "postgres" || type === "mysql" || type === "sqlserver") {
          const totalRowCount = await connectionTester.getRowCount(type, config, tableName);

          // Fetch a sample to scan for duplicates
          const sample = await connectionTester.getRandomSample(type, config, tableName, limit, 42);
          const rows = sample.rows as SampleRow[];

          const keyMap = new Map<string, SampleRow[]>();
          for (const row of rows) {
            const key = buildRowKey(row, keys);
            const existing = keyMap.get(key) || [];
            existing.push(row);
            keyMap.set(key, existing);
          }

          const duplicateGroups = Array.from(keyMap.entries())
            .filter(([, group]) => group.length > 1)
            .map(([key, group]) => ({
              key,
              count: group.length,
              sampleRows: group.slice(0, 3),
            }));

          const duplicateCount = duplicateGroups.reduce((sum, g) => sum + g.count - 1, 0);
          const estimatedTotalDuplicates = totalRowCount > 0
            ? Math.round((duplicateCount / rows.length) * totalRowCount)
            : duplicateCount;

          return {
            success: true,
            tableName,
            keyColumns: keys,
            strategy: dedupeStrategy,
            sampleSize: rows.length,
            totalRowCount,
            duplicateCount,
            estimatedTotalDuplicates,
            duplicateGroupCount: duplicateGroups.length,
            duplicateGroups: duplicateGroups.slice(0, 10),
            action: duplicateCount > 0
              ? `${duplicateCount} duplicate(s) found in sample of ${rows.length} rows (est. ${estimatedTotalDuplicates} total). Strategy: ${dedupeStrategy}`
              : "No duplicates detected in sample",
          };
        }

        // File-based duplicate detection
        const sample = await connectionTester.getRandomSample(type, config, tableName, limit, 42);
        const rows = sample.rows as SampleRow[];

        const keyMap = new Map<string, SampleRow[]>();
        for (const row of rows) {
          const key = buildRowKey(row, keys);
          const existing = keyMap.get(key) || [];
          existing.push(row);
          keyMap.set(key, existing);
        }

        const duplicateGroups = Array.from(keyMap.entries())
          .filter(([, group]) => group.length > 1)
          .map(([key, group]) => ({
            key,
            count: group.length,
            sampleRows: group.slice(0, 3),
          }));

        const duplicateCount = duplicateGroups.reduce((sum, g) => sum + g.count - 1, 0);

        return {
          success: true,
          tableName,
          keyColumns: keys,
          strategy: dedupeStrategy,
          sampleSize: rows.length,
          totalRowCount: sample.totalRowCount,
          duplicateCount,
          estimatedTotalDuplicates: duplicateCount,
          duplicateGroupCount: duplicateGroups.length,
          duplicateGroups: duplicateGroups.slice(0, 10),
          action: duplicateCount > 0
            ? `${duplicateCount} duplicate(s) found in ${rows.length} rows. Strategy: ${dedupeStrategy}`
            : "No duplicates detected in sample",
        };
      } catch (error) {
        return {
          success: false,
          tableName,
          error: error instanceof Error ? error.message : "Duplicate detection failed",
        };
      }
    },
    {
      name: "detectDuplicates",
      description:
        "Detect duplicate records in a datasource table by comparing values across specified key columns. " +
        "Samples data and identifies rows with identical key values. " +
        "Returns duplicate groups with counts and sample rows. " +
        "Estimates total duplicates based on sample ratio.",
      schema: z.object({
        connectorId: z.string().optional().describe("Connector ID to resolve connection settings"),
        connectorType: z.string().optional().describe("Connector type fallback"),
        connectionConfig: z.object({}).passthrough().optional().describe("Fallback connection settings"),
        tableName: z.string().describe("Table to check for duplicates"),
        keyColumns: z.array(z.string()).describe("Columns to use as the composite key for duplicate detection"),
        strategy: z.enum(["flag", "remove_exact", "remove_fuzzy"]).optional().describe(
          "How to handle duplicates: 'flag' (report only), 'remove_exact' (exact match removal), 'remove_fuzzy' (similarity-based)"
        ),
        sampleSize: z.number().optional().describe("Number of rows to sample for duplicate detection (default 500)"),
      }),
    }
  );
