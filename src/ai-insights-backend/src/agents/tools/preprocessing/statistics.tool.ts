import { tool } from "@langchain/core/tools";
import { z } from "zod";
import pl from "nodejs-polars";
import { fetchRowsOnDemand } from "../samplingHelper";
import { ConnectionTesterService } from "../../../services/connector/connectionTester.service";
import { ConnectorService } from "../../../services/connector/connector.service";
import { connectionConfigSchema, foreignKeyValuesSchema } from "../commonSchemas";

const toNumber = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return undefined;
    }
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
};

export const calculateAggregateStatsPl = (values: Array<unknown>) => {
  const numericValues = values
    .map((value) => toNumber(value))
    .filter((value): value is number => typeof value === "number");

  if (numericValues.length === 0) {
    return {
      count: 0,
      mean: 0,
      median: 0,
      mode: null,
      min: 0,
      max: 0,
      variance: 0,
      standardDeviation: 0,
      percentile90: 0,
    };
  }

  const numericS = pl.Series("values", numericValues);

  const count = numericS.length;
  if (count === 0) {
    return {
      count: 0,
      mean: 0,
      median: 0,
      mode: null,
      min: 0,
      max: 0,
      variance: 0,
      standardDeviation: 0,
      percentile90: 0,
    };
  }

  const statsDf = pl.DataFrame({ v: numericS });
  const mean = statsDf.select(pl.col("v").mean()).toRecords()[0]["v"] as number ?? 0;
  const variance = statsDf.select(pl.col("v").var()).toRecords()[0]["v"] as number ?? 0;
  const standardDeviation = Math.sqrt(variance);
  const median = statsDf.select(pl.col("v").median()).toRecords()[0]["v"] as number ?? 0;

  const modeSeries = numericS.mode();
  const mode = modeSeries.length > 0 ? Number(modeSeries.get(0)) : null;

  const min = statsDf.select(pl.col("v").min()).toRecords()[0]["v"] as number ?? 0;
  const max = statsDf.select(pl.col("v").max()).toRecords()[0]["v"] as number ?? 0;
  const percentile90 = statsDf.select(pl.col("v").quantile(0.90)).toRecords()[0]["v"] as number ?? 0;

  return {
    count,
    mean,
    median,
    mode,
    min,
    max,
    variance,
    standardDeviation,
    percentile90,
  };
};

export const createStatisticsTool = (
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
      seed,
      stratifyColumn,
      relationships,
      foreignKeyValues,
      columnName,
    }) => {
      const { rows: allRows, totalRowCount, error } = await fetchRowsOnDemand(
        connectionTester,
        connectorService,
        defaultConnector,
        {
          connectorId,
          connectorType,
          connectionConfig,
          tableName,
          sampleMethod: sampleMethod || "random",
          seed,
          stratifyColumn,
          relationships,
          foreignKeyValues,
          fetchAll: true,
        }
      );

      if (error || allRows.length === 0) {
        return {
          columnName: typeof columnName === "string" ? columnName : "column",
          statistics: {
            count: 0,
            mean: 0,
            median: 0,
            mode: null,
            min: 0,
            max: 0,
            variance: 0,
            standardDeviation: 0,
            percentile90: 0,
          },
          error,
        };
      }

      const colName = typeof columnName === "string" ? columnName : "column";
      const values = allRows.map((r) => r[colName]);
      const numericValues = Array.isArray(values) ? values : [];
      const stats = calculateAggregateStatsPl(numericValues);
      return {
        columnName: colName,
        statistics: stats,
      };
    },
    {
      name: "computeStatistics",
      description: "Compute deterministic aggregate statistics such as mean, median, mode, variance, and percentile values for all records in a column.",
      schema: z.object({
        connectorId: z.string().optional().describe("Connector ID to resolve connection settings"),
        connectorType: z.string().optional().describe("Connector type fallback"),
        connectionConfig: connectionConfigSchema,
        tableName: z.string().describe("Table to profile"),
        sampleMethod: z.enum(["random", "stratified", "interval"]).optional().describe("Sampling method"),
        seed: z.number().optional().describe("Deterministic seed for reproducible sampling"),
        stratifyColumn: z.string().optional().describe("Column to group by for stratified sampling"),
        relationships: z.array(z.object({
          column: z.string().describe("Local FK column"),
          foreignTable: z.string().describe("Referenced table"),
          foreignColumn: z.string().describe("Referenced column"),
        })).optional().describe("Table relationships for referential integrity filtering"),
        foreignKeyValues: foreignKeyValuesSchema,
        columnName: z.string().describe("Column name to compute statistics for"),
      }),
    }
  );
