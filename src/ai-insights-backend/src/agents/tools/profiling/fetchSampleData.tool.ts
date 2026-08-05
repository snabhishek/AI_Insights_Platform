import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { ConnectionTesterService } from "../../../services/connector/connectionTester.service";
import { ConnectorService } from "../../../services/connector/connector.service";
import { ConnectionConfig, ConnectorType } from "../../../models/connector.types";
import { connectionConfigSchema, foreignKeyValuesSchema, parseForeignKeyValues } from "../commonSchemas";

type SampleRow = Record<string, unknown>;

export const createFetchSampleDataTool = (
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
      sampleSize = 100000,
      seed = 42,
      intervals,
      stratifyColumn,
      relationships,
      foreignKeyValues,
    }) => {
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
        return { success: false, tableName, error: "Missing connector configuration", rows: [], totalRowCount: 0 };
      }

      const type = resolvedType;
      const method = sampleMethod || "random";

      try {
        const totalRowCount = await connectionTester.getRowCount(type, config, tableName);

        let rows: SampleRow[] = [];
        let metadata: Record<string, unknown> = {};

        if (method === "interval") {
          const intervalPoints = Array.isArray(intervals) && intervals.length > 0
            ? intervals
            : [0, 25, 50, 75, 100];

          const perInterval = Math.max(1, Math.ceil(sampleSize / intervalPoints.length));
          const collectedRows: SampleRow[] = [];
          const intervalsUsed: Array<{ percentile: number; offset: number; fetched: number }> = [];

          for (const percentile of intervalPoints) {
            const offset = Math.max(0, Math.floor((totalRowCount * Math.min(percentile, 99)) / 100));
            const result = await connectionTester.getSampleWithOffset(type, config, tableName, perInterval, offset);
            collectedRows.push(...result.rows);
            intervalsUsed.push({ percentile, offset, fetched: result.rows.length });
          }

          const seen = new Set<string>();
          rows = collectedRows.filter((row) => {
            const key = JSON.stringify(row);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });
          metadata = { intervalsUsed, method: "interval" };
        } else if (method === "stratified") {
          if (!stratifyColumn) {
            return { success: false, tableName, error: "stratifyColumn is required for stratified sampling", rows: [], totalRowCount };
          }

          const limitPerGroup = Math.max(1, Math.ceil(sampleSize / 10));
          const result = await connectionTester.getStratifiedSample(type, config, tableName, stratifyColumn, limitPerGroup, seed);
          rows = result.rows;
          metadata = { ...(result.metadata || {}), method: "stratified" };
        } else {
          const result = await connectionTester.getRandomSample(type, config, tableName, sampleSize, seed);
          rows = result.rows;
          metadata = { method: "random", seed };
        }

        if (Array.isArray(relationships) && relationships.length > 0 && foreignKeyValues) {
          const fkMap = parseForeignKeyValues(foreignKeyValues);
          for (const rel of relationships) {
            const relObj = rel as { column?: string; foreignTable?: string; foreignColumn?: string };
            const localCol = relObj.column;
            const foreignTable = relObj.foreignTable;
            if (!localCol || !foreignTable) continue;

            const allowedValues = fkMap[foreignTable];
            if (!Array.isArray(allowedValues) || allowedValues.length === 0) continue;

            const allowedSet = new Set(allowedValues.map((v) => String(v).toLowerCase().trim()));
            rows = rows.filter((row) => {
              const val = row[localCol];
              if (val === null || val === undefined) return true;
              return allowedSet.has(String(val).toLowerCase().trim());
            });
          }
          metadata.relationshipsApplied = relationships.length;
        }

        const headers = rows.length > 0 ? Object.keys(rows[0]) : [];

        return {
          success: true,
          tableName,
          method,
          rows: rows.slice(0, sampleSize),
          totalRowCount,
          headers,
          rowsFetched: Math.min(rows.length, sampleSize),
          metadata,
        };
      } catch (error) {
        return {
          success: false,
          tableName,
          error: error instanceof Error ? error.message : "Sampling failed",
          rows: [],
          totalRowCount: 0,
        };
      }
    },
    {
      name: "fetchSampleData",
      description:
        "Fetch sample data from a datasource table using different sampling methods. " +
        "Use 'interval' to get records from different parts of the table (beginning, middle, end) for initial data understanding. " +
        "Use 'stratified' for proportional representation by a grouping column. " +
        "Use 'random' for simple random sampling. " +
        "Supports relationship filtering to maintain referential integrity across tables.",
      schema: z.object({
        connectorId: z.string().optional().describe("Connector ID to resolve connection settings"),
        connectorType: z.string().optional().describe("Connector type fallback"),
        connectionConfig: connectionConfigSchema,
        tableName: z.string().describe("Table name to sample from"),
        sampleMethod: z.enum(["random", "stratified", "interval"]).describe(
          "Sampling method: 'interval' fetches from different record positions, 'stratified' groups by a column, 'random' is simple random"
        ),
        sampleSize: z.number().optional().describe("Total number of sample records to fetch (default 100000)"),
        seed: z.number().optional().describe("Deterministic seed for reproducible sampling"),
        intervals: z.array(z.number()).optional().describe("Percentile offsets for interval sampling, e.g. [0, 25, 50, 75, 100]"),
        stratifyColumn: z.string().optional().describe("Column to group by for stratified sampling"),
        relationships: z.array(z.object({
          column: z.string().describe("Local FK column"),
          foreignTable: z.string().describe("Referenced table"),
          foreignColumn: z.string().describe("Referenced column"),
        })).optional().describe("Table relationships from inspector output for referential integrity filtering"),
        foreignKeyValues: foreignKeyValuesSchema,
      }),
    }
  );
