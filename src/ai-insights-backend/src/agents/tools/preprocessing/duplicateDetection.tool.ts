import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { ConnectionTesterService } from "../../../services/connector/connectionTester.service";
import { ConnectorService } from "../../../services/connector/connector.service";
import { ConnectionConfig, ConnectorType } from "../../../models/connector.types";
import { connectionConfigSchema } from "../helpers/commonSchemas";
import pl from "nodejs-polars";

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
  connectorService: ConnectorService,
  defaultConnector?: any
) =>
  tool(
    async ({ connectorId, connectorType, connectionConfig, tableName, keyColumns, strategy, sampleSize }) => {
      let resolvedType = connectorType as ConnectorType | undefined;
      let config = connectionConfig as ConnectionConfig | undefined;

      let connector: any;
      if (typeof connectorId === "string" && connectorId.trim().length > 0) {
        connector = await connectorService.getById(connectorId);
        if (!connector && defaultConnector && (defaultConnector.id === connectorId || defaultConnector.name === connectorId)) {
          connector = defaultConnector;
        }
        if (!connector) {
          try {
            const allConnectors = await connectorService.getAll();
            connector = allConnectors.find(
              (c) => c.id === connectorId || c.name === connectorId || c.name.toLowerCase() === connectorId.toLowerCase()
            );
          } catch {
            // Ignore error
          }
        }
      }

      if (!connector && defaultConnector) {
        connector = defaultConnector;
      }

      if (connector) {
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
        // Fetch a sample to scan for duplicates
        const sample = await connectionTester.getRandomSample(type, config, tableName, limit, 42);
        const rows = sample.rows as SampleRow[];

        if (rows.length === 0) {
          return {
            success: true,
            tableName,
            keyColumns: keys,
            strategy: dedupeStrategy,
            sampleSize: 0,
            totalRowCount: sample.totalRowCount,
            duplicateCount: 0,
            estimatedTotalDuplicates: 0,
            duplicateGroupCount: 0,
            duplicateGroups: [],
            action: "No rows fetched to analyze for duplicates",
          };
        }

        const df = pl.DataFrame(rows);
        const dfCounts = df.groupBy(keys).agg(pl.col(keys[0]).count().alias("count"));
        const dfDuplicates = dfCounts.filter(dfCounts.getColumn("count").gt(1));

        const duplicateGroups: Array<{ key: string; count: number; sampleRows: SampleRow[] }> = [];
        if (dfDuplicates.shape.height > 0) {
          const duplicateRecords = dfDuplicates.toRecords();
          for (const dup of duplicateRecords) {
            const keyParts = keys.map((k) => String(dup[k] ?? "").trim().toLowerCase());
            const key = keyParts.join("|");
            const count = Number(dup["count"]);

            let filterExpr = pl.lit(true);
            for (const k of keys) {
              const val = dup[k];
              if (val === null || val === undefined) {
                filterExpr = filterExpr.and(pl.col(k).isNull());
              } else {
                filterExpr = filterExpr.and(
                  pl.col(k).cast(pl.Utf8).str.strip().str.toLowerCase().eq(String(val).trim().toLowerCase())
                );
              }
            }
            const sampleRows = df.filter(filterExpr).head(3).toRecords() as SampleRow[];

            duplicateGroups.push({
              key,
              count,
              sampleRows,
            });
          }
        }

        const duplicateCount = duplicateGroups.reduce((sum, g) => sum + g.count - 1, 0);

        if (type === "postgres" || type === "mysql" || type === "sqlserver") {
          const totalRowCount = await connectionTester.getRowCount(type, config, tableName);
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
        connectionConfig: connectionConfigSchema,
        tableName: z.string().describe("Table to check for duplicates"),
        keyColumns: z.array(z.string()).describe("Columns to use as the composite key for duplicate detection"),
        strategy: z.enum(["flag", "remove_exact", "remove_fuzzy"]).optional().describe(
          "How to handle duplicates: 'flag' (report only), 'remove_exact' (exact match removal), 'remove_fuzzy' (similarity-based)"
        ),
        sampleSize: z.number().optional().describe("Number of rows to sample for duplicate detection (default 500)"),
      }),
    }
  );
