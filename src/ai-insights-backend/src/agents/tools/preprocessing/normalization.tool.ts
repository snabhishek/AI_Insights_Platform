import { tool } from "@langchain/core/tools";
import { z } from "zod";
import pl from "nodejs-polars";
import { fetchRowsOnDemand } from "../helpers/samplingHelper";
import { ConnectionTesterService } from "../../../services/connector/connectionTester.service";
import { ConnectorService } from "../../../services/connector/connector.service";
import { connectionConfigSchema, foreignKeyValuesSchema } from "../helpers/commonSchemas";

type SampleRow = Record<string, unknown>;

export const normalizeRowsAndHeadersPl = (rows: SampleRow[]) => {
  if (rows.length === 0) {
    return {
      headers: [],
      rows: [],
    };
  }

  const df = pl.DataFrame(rows);
  const originalHeaders = df.columns;
  const normalizedHeaders = originalHeaders.map((h) => h.trim().replace(/\s+/g, "_").toLowerCase());

  let dfTransformed = df;
  originalHeaders.forEach((h, idx) => {
    const norm = normalizedHeaders[idx];
    if (h !== norm) {
      dfTransformed = dfTransformed.rename({ [h]: norm });
    }
  });

  return {
    headers: dfTransformed.columns,
    rows: dfTransformed.toRecords(),
  };
};

export const createNormalizationTool = (
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
      sampleSize,
      seed,
      stratifyColumn,
      relationships,
      foreignKeyValues,
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
          sampleMethod: sampleMethod || "random",
          sampleSize: sampleSize || 100,
          seed,
          stratifyColumn,
          relationships,
          foreignKeyValues,
        }
      );

      if (error || sampleRows.length === 0) {
        return {
          headers: [],
          rows: [],
          error,
        };
      }

      return normalizeRowsAndHeadersPl(sampleRows as SampleRow[]);
    },
    {
      name: "normalizeSchema",
      description: "Normalize row keys and column headers to a consistent shape that downstream ingestion steps can consume.",
      schema: z.object({
        connectorId: z.string().optional().describe("Connector ID to resolve connection settings"),
        connectorType: z.string().optional().describe("Connector type fallback"),
        connectionConfig: connectionConfigSchema,
        tableName: z.string().describe("Table to clean"),
        sampleMethod: z.enum(["random", "stratified", "interval"]).optional().describe("Sampling method"),
        sampleSize: z.number().optional().describe("Number of sample records to fetch (defaults to 100)"),
        seed: z.number().optional().describe("Deterministic seed for reproducible sampling"),
        stratifyColumn: z.string().optional().describe("Column to group by for stratified sampling"),
        relationships: z.array(z.object({
          column: z.string().describe("Local FK column"),
          foreignTable: z.string().describe("Referenced table"),
          foreignColumn: z.string().describe("Referenced column"),
        })).optional().describe("Table relationships for referential integrity filtering"),
        foreignKeyValues: foreignKeyValuesSchema,
      }),
    }
  );
