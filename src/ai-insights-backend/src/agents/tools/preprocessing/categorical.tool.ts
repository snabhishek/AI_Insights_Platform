import { tool } from "@langchain/core/tools";
import { z } from "zod";
import pl from "nodejs-polars";
import { fetchRowsOnDemand } from "../helpers/samplingHelper";
import { ConnectionTesterService } from "../../../services/connector/connectionTester.service";
import { ConnectorService } from "../../../services/connector/connector.service";
import { connectionConfigSchema, foreignKeyValuesSchema } from "../helpers/commonSchemas";

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

export const normalizeCategoricalValuesPl = (rows: SampleRow[], columnName: string) => {
  if (rows.length === 0) {
    return {
      columnName,
      transformedRows: [],
      uniqueValues: [],
    };
  }

  const df = pl.DataFrame(rows);
  const s = df.getColumn(columnName);
  const placeholderArr = Array.from(PLACEHOLDER_VALUES);

  const arr = s.cast(pl.Utf8).toArray().map((val: any) => {
    if (val === null || val === undefined) {
      return "unknown";
    }
    const trimmed = String(val).trim();
    if (trimmed.length === 0) {
      return "unknown";
    }
    const normalized = trimmed.replace(/\s+/g, " ").toLowerCase();
    return placeholderArr.includes(normalized) ? "unknown" : normalized;
  });

  const normalizedS = pl.Series(columnName, arr);
  const dfTransformed = df.withColumn(normalizedS);
  const uniqueValues = normalizedS.unique().toArray().map(String);

  return {
    columnName,
    transformedRows: dfTransformed.toRecords(),
    uniqueValues,
  };
};

export const createCategoricalTool = (
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
      columnName,
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
          columnName: columnName || "unknown",
          transformedRows: [],
          uniqueValues: [],
          error,
        };
      }

      return normalizeCategoricalValuesPl(sampleRows as SampleRow[], String(columnName || ""));
    },
    {
      name: "normalizeCategoricalValues",
      description: "Normalize categorical values by trimming whitespace, collapsing placeholders, and standardizing casing.",
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
        columnName: z.string().describe("Categorical column to normalize"),
      }),
    }
  );
