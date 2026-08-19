import { tool } from "@langchain/core/tools";
import { z } from "zod";
import pl from "nodejs-polars";
import { fetchRowsOnDemand } from "../helpers/samplingHelper";
import { ConnectionTesterService } from "../../../services/connector/connectionTester.service";
import { ConnectorService } from "../../../services/connector/connector.service";
import { connectionConfigSchema, foreignKeyValuesSchema } from "../helpers/commonSchemas";

type SampleRow = Record<string, unknown>;

type Method = "iqr" | "zscore";

type Strategy = "clip" | "flag";

export const detectAndTransformOutliersPl = (
  rows: SampleRow[],
  columnName: string,
  method: Method = "iqr",
  strategy: Strategy = "clip"
) => {
  if (rows.length === 0) {
    return {
      columnName,
      method,
      strategy,
      outlierCount: 0,
      transformedRows: [],
      bounds: { lower: 0, upper: 0 },
    };
  }

  const df = pl.DataFrame(rows);
  const s = df.getColumn(columnName);

  let numericS: pl.Series;
  try {
    numericS = s.filter(s.isNotNull()).cast(pl.Float64).filter(s.filter(s.isNotNull()).isNotNull());
  } catch {
    return {
      columnName,
      method,
      strategy,
      outlierCount: 0,
      transformedRows: rows,
      bounds: { lower: 0, upper: 0 },
    };
  }

  const n = numericS.length;
  if (n === 0) {
    return {
      columnName,
      method,
      strategy,
      outlierCount: 0,
      transformedRows: rows,
      bounds: { lower: 0, upper: 0 },
    };
  }

  const q1 = numericS.quantile(0.25) ?? 0;
  const q3 = numericS.quantile(0.75) ?? 0;
  const iqr = q3 - q1;
  const lowerBound = q1 - 1.5 * iqr;
  const upperBound = q3 + 1.5 * iqr;

  const arr = s.toArray().map((val: any) => {
    if (val === null || val === undefined) {
      return val;
    }
    const num = Number(val);
    if (isNaN(num)) {
      return val;
    }
    const isOutlier = num < lowerBound || num > upperBound;
    if (!isOutlier) {
      return val;
    }

    return strategy === "clip"
      ? Math.min(upperBound, Math.max(lowerBound, num))
      : "__outlier__";
  });

  const transformedS = pl.Series(columnName, arr);
  const changedS = s.neq(transformedS).fillNull("zero");
  const outlierCount = changedS.cast(pl.Int32).sum() as number;

  const dfTransformed = df.withColumn(transformedS);

  return {
    columnName,
    method,
    strategy,
    outlierCount,
    transformedRows: dfTransformed.toRecords(),
    bounds: { lower: lowerBound, upper: upperBound },
  };
};

export const createOutlierTool = (
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
      method = "iqr",
      strategy = "clip",
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
          columnName,
          method,
          strategy,
          outlierCount: 0,
          transformedRows: [],
          bounds: { lower: 0, upper: 0 },
          error,
        };
      }

      const result = detectAndTransformOutliersPl(
        allRows as SampleRow[],
        String(columnName || ""),
        method as Method,
        strategy as Strategy
      );

      return {
        columnName,
        method,
        strategy,
        outlierCount: result.outlierCount,
        transformedRows: result.transformedRows.slice(0, 100),
        bounds: result.bounds,
      };
    },
    {
      name: "detectOutliers",
      description: "Identify numeric outliers and clip or flag them using bounds computed from all records in the table.",
      schema: z.object({
        connectorId: z.string().optional().describe("Connector ID to resolve connection settings"),
        connectorType: z.string().optional().describe("Connector type fallback"),
        connectionConfig: connectionConfigSchema,
        tableName: z.string().describe("Table to clean"),
        sampleMethod: z.enum(["random", "stratified", "interval"]).optional().describe("Sampling method"),
        seed: z.number().optional().describe("Deterministic seed for reproducible sampling"),
        stratifyColumn: z.string().optional().describe("Column to group by for stratified sampling"),
        relationships: z.array(z.object({
          column: z.string().describe("Local FK column"),
          foreignTable: z.string().describe("Referenced table"),
          foreignColumn: z.string().describe("Referenced column"),
        })).optional().describe("Table relationships for referential integrity filtering"),
        foreignKeyValues: foreignKeyValuesSchema,
        columnName: z.string().describe("Numeric column to inspect"),
        method: z.enum(["iqr", "zscore"]).optional().describe("Outlier detection method"),
        strategy: z.enum(["clip", "flag"]).optional().describe("Deterministic remediation strategy"),
      }),
    }
  );
