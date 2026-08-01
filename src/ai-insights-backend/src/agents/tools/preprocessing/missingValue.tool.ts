import { tool } from "@langchain/core/tools";
import { z } from "zod";
import pl from "nodejs-polars";
import { fetchRowsOnDemand } from "../samplingHelper";
import { ConnectionTesterService } from "../../../services/connector/connectionTester.service";
import { ConnectorService } from "../../../services/connector/connector.service";

type SampleRow = Record<string, unknown>;

type MissingStrategy = "mean" | "median" | "mode" | "constant";

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

export const applyMissingValueStrategyPl = (
  rows: SampleRow[],
  columnName: string,
  strategy: MissingStrategy,
  fillValue?: string | number,
  statistics?: Record<string, unknown>
) => {
  if (rows.length === 0) {
    return {
      columnName,
      strategy,
      filledCount: 0,
      rows: [],
    };
  }

  const df = pl.DataFrame(rows);
  const s = df.getColumn(columnName);

  const replacement = (() => {
    if (strategy === "constant" && fillValue !== undefined) {
      return fillValue;
    }
    if (strategy === "mean" && typeof statistics?.mean === "number") {
      return statistics.mean;
    }
    if (strategy === "median" && typeof statistics?.median === "number") {
      return statistics.median;
    }
    if (strategy === "mode" && statistics?.mode !== undefined && statistics.mode !== null) {
      return statistics.mode as string | number;
    }
    return fillValue ?? "";
  })();

  const placeholderArr = Array.from(PLACEHOLDER_VALUES);

  const arr = s.toArray().map((val: any) => {
    if (val === null || val === undefined) {
      return replacement;
    }
    const strVal = String(val).trim().toLowerCase();
    if (strVal.length === 0 || placeholderArr.includes(strVal)) {
      return replacement;
    }
    return val;
  });

  const dtypeStr = s.dtype.toString().toLowerCase();
  const isNumeric = dtypeStr.includes("int") || dtypeStr.includes("float") || dtypeStr.includes("double");
  const coercedArr = arr.map((v) => {
    if (v === null || v === undefined) {
      return null;
    }
    if (isNumeric) {
      const num = Number(v);
      return isNaN(num) ? null : num;
    } else {
      return String(v);
    }
  });

  const filledS = pl.Series(columnName, coercedArr);
  const changedS = s.neq(filledS).fillNull("one");
  const filledCount = changedS.cast(pl.Int32).sum() as number;

  const dfTransformed = df.withColumn(filledS);

  return {
    columnName,
    strategy,
    filledCount,
    rows: dfTransformed.toRecords(),
  };
};

export const createMissingValueTool = (
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
      strategy = "median",
      fillValue,
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
          strategy,
          filledCount: 0,
          rows: [],
          error,
        };
      }

      const colName = String(columnName || "");
      const df = pl.DataFrame(allRows);
      const s = df.getColumn(colName);
      const nonNullS = s.filter(s.isNotNull());

      let computedValue: any = fillValue;

      if (strategy === "mean") {
        try {
          const numericS = nonNullS.cast(pl.Float64);
          const val = numericS.mean();
          computedValue = typeof val === "number" ? val : undefined;
        } catch {
          // ignore
        }
      } else if (strategy === "median") {
        try {
          const numericS = nonNullS.cast(pl.Float64);
          const val = numericS.median();
          computedValue = typeof val === "number" ? val : undefined;
        } catch {
          // ignore
        }
      } else if (strategy === "mode") {
        try {
          const modeSeries = nonNullS.mode();
          computedValue = modeSeries.length > 0 ? modeSeries.get(0) : undefined;
        } catch {
          // ignore
        }
      }

      const result = applyMissingValueStrategyPl(
        allRows,
        colName,
        "constant",
        computedValue !== undefined ? computedValue : "",
        {}
      );

      return {
        columnName,
        strategy,
        computedValue,
        filledCount: result.filledCount,
        rows: result.rows.slice(0, 100),
      };
    },
    {
      name: "imputeMissingValues",
      description: "Fill missing or placeholder values in a column by calculating a fresh imputation value from all records in the table.",
      schema: z.object({
        connectorId: z.string().optional().describe("Connector ID to resolve connection settings"),
        connectorType: z.string().optional().describe("Connector type fallback"),
        connectionConfig: z.record(z.string(), z.any()).optional().describe("Fallback connection settings"),
        tableName: z.string().describe("Table to clean"),
        sampleMethod: z.enum(["random", "stratified", "interval"]).optional().describe("Sampling method"),
        seed: z.number().optional().describe("Deterministic seed for reproducible sampling"),
        stratifyColumn: z.string().optional().describe("Column to group by for stratified sampling"),
        relationships: z.array(z.object({
          column: z.string().describe("Local FK column"),
          foreignTable: z.string().describe("Referenced table"),
          foreignColumn: z.string().describe("Referenced column"),
        })).optional().describe("Table relationships for referential integrity filtering"),
        foreignKeyValues: z.object({}).catchall(z.array(z.string())).optional().describe(
          "Map of foreignTable → array of allowed FK values collected from parent table samples"
        ),
        columnName: z.string().describe("Column to impute"),
        strategy: z.enum(["mean", "median", "mode", "constant"]).optional().describe("Imputation strategy"),
        fillValue: z.union([z.number(), z.string()]).optional().describe("Constant value replacement (only used for constant strategy)"),
      }),
    }
  );
