import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { ConnectionTesterService } from "../../../services/connector/connectionTester.service";
import { ConnectorService } from "../../../services/connector/connector.service";
import { ConnectionConfig, ConnectorType } from "../../../models/connector.types";

type CleaningOperation = {
  columnName: string;
  method: string;
  params?: Record<string, unknown>;
};

type OperationResult = {
  columnName: string;
  method: string;
  success: boolean;
  rowsAffected: number;
  details?: string;
};

export const createApplyDataCleaningTool = (
  connectionTester: ConnectionTesterService,
  connectorService: ConnectorService,
  defaultConnector?: any
) =>
  tool(
    async ({ connectorId, connectorType, connectionConfig, tableName, operations }) => {
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
        return { success: false, tableName, error: "Missing connector configuration", results: [] };
      }

      const type = resolvedType;
      const ops = Array.isArray(operations) ? (operations as CleaningOperation[]) : [];

      if (ops.length === 0) {
        return { success: true, tableName, results: [], message: "No operations to apply" };
      }

      // Fetch a before-sample for comparison
      let beforeSample: any[] = [];
      try {
        const preview = await connectionTester.getRandomSample(type, config, tableName, 5, 42);
        beforeSample = preview.rows;
      } catch {
        // Non-critical
      }

      const { results } = await connectionTester.applyCleaningOperations(type, config, tableName, ops);

      // Fetch after-sample for comparison
      let afterSample: any[] = [];
      try {
        const preview = await connectionTester.getRandomSample(type, config, tableName, 5, 42);
        afterSample = preview.rows;
      } catch {
        // Non-critical
      }

      return {
        success: results.every((r) => r.success),
        tableName,
        operationsApplied: results.filter((r) => r.success).length,
        operationsFailed: results.filter((r) => !r.success).length,
        results,
        beforeSample: beforeSample.slice(0, 3),
        afterSample: afterSample.slice(0, 3),
      };
    },
    {
      name: "applyDataCleaning",
      description:
        "Execute data cleaning operations on a datasource table. " +
        "Supports imputation (constant/median/mean/mode), category normalization, outlier clipping, " +
        "column dropping, type coercion, header standardization, and log transforms. " +
        "For database sources, applies changes via SQL. For file sources, records operations for the export pipeline. " +
        "Returns before/after samples for verification.",
      schema: z.object({
        connectorId: z.string().optional().describe("Connector ID to resolve connection settings"),
        connectorType: z.string().optional().describe("Connector type fallback"),
        connectionConfig: z.record(z.string(), z.any()).optional().describe("Fallback connection settings"),
        tableName: z.string().describe("Table to apply cleaning operations on"),
        operations: z.array(z.object({
          columnName: z.string().describe("Target column"),
          method: z.string().describe("Cleaning method: impute_constant, impute_median, normalize_categories, clip_iqr, drop_column, coerce_type, standardize_headers, log_transform"),
          params: z.object({}).catchall(z.any()).optional().describe("Method-specific parameters (e.g. fillValue, targetType, lowerBound, upperBound)"),
        })).describe("List of cleaning operations to apply"),
      }),
    }
  );
