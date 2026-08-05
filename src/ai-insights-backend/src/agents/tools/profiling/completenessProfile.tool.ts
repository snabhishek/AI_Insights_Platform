import { tool } from "@langchain/core/tools";
import { z } from "zod";
import pl from "nodejs-polars";
import { fetchRowsOnDemand } from "../samplingHelper";
import { ConnectionTesterService } from "../../../services/connector/connectionTester.service";
import { ConnectorService } from "../../../services/connector/connector.service";
import { connectionConfigSchema, foreignKeyValuesSchema } from "../commonSchemas";

type SampleRow = Record<string, unknown>;

const DEFAULT_PLACEHOLDER_VALUES = new Set([
  "", " ", "-", "--", "n/a", "na", "none", "null", "nil", "unknown", "undefined",
  "not available", "not applicable", "tbd", "tba", "#n/a", "#ref!", "#value!",
]);

const inferMissingPatternPl = (
  df: pl.DataFrame,
  columnName: string,
  allColumns: string[]
): "MCAR" | "MAR" | "MNAR" | "unknown" => {
  const s = df.getColumn(columnName);
  const totalRows = df.shape.height;
  const isNullS = s.isNull();
  const nullCount = isNullS.cast(pl.Int32).sum() as number;

  if (nullCount === 0 || nullCount === totalRows) return "unknown";

  const missingRate = nullCount / totalRows;

  // Check for MAR: is missingness correlated with other columns?
  for (const otherCol of allColumns) {
    if (otherCol === columnName) continue;

    const otherS = df.getColumn(otherCol).cast(pl.Utf8).str.strip().str.toLowerCase();
    const otherMissing = otherS.filter(isNullS);
    const otherPresent = otherS.filter(s.isNotNull());

    const missingDistinct = new Set(otherMissing.unique().toArray().map(String));
    const presentDistinct = new Set(otherPresent.unique().toArray().map(String));

    const overlap = [...missingDistinct].filter((v) => presentDistinct.has(v)).length;
    const totalDistinct = new Set([...missingDistinct, ...presentDistinct]).size;
    if (totalDistinct > 0 && overlap / totalDistinct < 0.3) {
      return "MAR";
    }
  }

  // Check for MNAR: are the non-missing values clustered in a specific range?
  const nonMissingS = s.filter(s.isNotNull());
  
  // Try to parse as float for range check
  try {
    const nonMissingNumeric = nonMissingS.cast(pl.Float64).filter(nonMissingS.isNotNull());
    const nNumeric = nonMissingNumeric.length;

    if (nNumeric > 5) {
      const statsDf = pl.DataFrame({ v: nonMissingNumeric });
      const p10 = statsDf.select(pl.col("v").quantile(0.1)).toRecords()[0]["v"] as number ?? 0;
      const p90 = statsDf.select(pl.col("v").quantile(0.9)).toRecords()[0]["v"] as number ?? 0;
      const range = p90 - p10;
      const mean = statsDf.select(pl.col("v").mean()).toRecords()[0]["v"] as number ?? 0;

      if (range > 0 && (mean - p10) / range > 0.8) {
        return "MNAR";
      }
    }
  } catch {
    // Ignore casting error if string values
  }

  return missingRate < 0.3 ? "MCAR" : "unknown";
};

export const createCompletenessProfileTool = (
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
      columns,
      placeholderPatterns,
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
          sampleMethod,
          sampleSize,
          seed,
          stratifyColumn,
          relationships,
          foreignKeyValues,
        }
      );

      if (error || sampleRows.length === 0) {
        return {
          tableName: tableName || "unknown",
          profileType: "completeness",
          totalRows: 0,
          fullyPopulatedRows: 0,
          rowCompletenessPercent: 100,
          columnsProfiled: 0,
          columns: [],
          rows: [],
          error,
        };
      }

      const df = pl.DataFrame(sampleRows);
      const allColumns = df.columns;
      const targetColumns = Array.isArray(columns) && columns.length > 0 ? columns : allColumns;

      const customPatterns = new Set(DEFAULT_PLACEHOLDER_VALUES);
      if (Array.isArray(placeholderPatterns)) {
        for (const p of placeholderPatterns) {
          if (typeof p === "string") customPatterns.add(p.trim().toLowerCase());
        }
      }

      const totalRows = df.shape.height;
      const placeholderList = Array.from(customPatterns);
      
      // We can construct a mask using Polars Expressions
      let maskExpr = pl.lit(true);
      for (const colName of targetColumns) {
        const isMissing = pl.col(colName).isNull()
          .or(pl.col(colName).cast(pl.Utf8).str.strip().eq(""))
          .or(pl.col(colName).cast(pl.Utf8).str.strip().str.toLowerCase().isIn(placeholderList));
        maskExpr = maskExpr.and(isMissing.not());
      }
      
      const fullyPopulatedRows = df.select(maskExpr.sum().alias("sum")).toRecords()[0]["sum"] as number ?? 0;

      const columnProfiles = targetColumns.map((colName) => {
        const s = df.getColumn(colName);
        const strS = s.cast(pl.Utf8);

        const nullCount = s.isNull().cast(pl.Int32).sum() as number;
        
        // Non-null series for checking blanks
        const nonNullStrS = s.filter(s.isNotNull()).cast(pl.Utf8);
        const blankCount = nonNullStrS.str.strip().eq("").cast(pl.Int32).sum() as number;

        // Non-null and non-blank series for checking placeholders
        const nonNullBlankStrS = nonNullStrS.filter(nonNullStrS.str.strip().neq(""));
        const placeholderCount = nonNullBlankStrS.str.strip().str.toLowerCase().isIn(placeholderList).cast(pl.Int32).sum() as number;

        const totalMissing = nullCount + blankCount + placeholderCount;
        const completenessPercent = totalRows > 0
          ? Number((((totalRows - totalMissing) / totalRows) * 100).toFixed(2))
          : 100;

        const missingPattern = inferMissingPatternPl(df, colName, allColumns);

        let recommendation = "Column appears complete";
        if (completenessPercent < 50) {
          recommendation = "Critical: consider dropping column or investigating data source";
        } else if (completenessPercent < 75) {
          recommendation = "High priority: impute missing values or review data pipeline";
        } else if (completenessPercent < 90) {
          recommendation = "Moderate: apply imputation strategy based on column type";
        } else if (completenessPercent < 100) {
          recommendation = "Minor: small number of missing values, imputation recommended";
        }

        return {
          name: colName,
          nullCount,
          blankCount,
          placeholderCount,
          totalMissing,
          completenessPercent,
          missingPattern,
          recommendation,
        };
      });

      return {
        tableName: tableName || "unknown",
        profileType: "completeness",
        totalRows,
        fullyPopulatedRows,
        rowCompletenessPercent: totalRows > 0
          ? Number(((fullyPopulatedRows / totalRows) * 100).toFixed(2))
          : 100,
        columnsProfiled: columnProfiles.length,
        columns: columnProfiles,
        // rows: sampleRows, // Retain fetched rows so the agent can extract PKs to sync child tables
      };
    },
    {
      name: "completenessProfile",
      description:
        "Profile data completeness for specified columns. " +
        "Fetches the required sample records on demand.",
      schema: z.object({
        connectorId: z.string().optional().describe("Connector ID to resolve connection settings"),
        connectorType: z.string().optional().describe("Connector type fallback"),
        connectionConfig: connectionConfigSchema,
        tableName: z.string().describe("Table name for context"),
        sampleMethod: z.enum(["random", "stratified", "interval"]).optional().describe("Sampling method"),
        sampleSize: z.number().optional().describe("Number of sample records to fetch (stratified defaults to 40% of table row count)"),
        seed: z.number().optional().describe("Deterministic seed for reproducible sampling"),
        stratifyColumn: z.string().optional().describe("Column to group by for stratified sampling"),
        relationships: z.array(z.object({
          column: z.string().describe("Local FK column"),
          foreignTable: z.string().describe("Referenced table"),
          foreignColumn: z.string().describe("Referenced column"),
        })).optional().describe("Table relationships from inspector output for referential integrity filtering"),
        foreignKeyValues: foreignKeyValuesSchema,
        columns: z.array(z.string()).optional().describe("Specific columns to check; omit to check all"),
        placeholderPatterns: z.array(z.string()).optional().describe(
          "Additional placeholder strings to treat as missing (e.g. 'TBD', 'NOT SET')"
        ),
      }),
    }
  );
