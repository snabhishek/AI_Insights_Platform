import { tool } from "@langchain/core/tools";
import { z } from "zod";
import * as fs from "fs";
import { IDuckDBService } from "../../../services/duckdb/duckdb.service.interface";
import { ProjectService } from "../../../services/project/project.service";

export interface DataAnalysisToolServices {
  projectService: ProjectService;
  duckDBService: IDuckDBService;
}

export function assertSafeReadOnlySql(sql: string): void {
  // Ignore literals/quoted column names when checking SQL operations.
  // Disallow comments, multiple statements and external table functions/paths.
  const normalized = sql.trim().replace(/;$/, "");
  const tokens = normalized.replace(/'(?:[^']|'')*'/g, "''").replace(/"(?:[^"]|"")*"/g, '""');
  if (!/^(SELECT|WITH|DESCRIBE|SHOW)\b/i.test(tokens)) throw new Error("Only read-only analytical queries are permitted.");
  if (/;|--|\/\*|\*\//.test(tokens)) throw new Error("SQL comments and multiple statements are not permitted.");
  if (/\b(DROP|DELETE|UPDATE|INSERT|ALTER|CREATE|TRUNCATE|REPLACE|GRANT|REVOKE|EXEC|EXECUTE|COPY|ATTACH|DETACH|INSTALL|LOAD|PRAGMA|CALL|SET|EXPORT|IMPORT|VACUUM|CHECKPOINT)\b/i.test(tokens)) {
    throw new Error("Unsafe SQL operation rejected.");
  }
  if (/\b(FROM|JOIN)\s+'|\b(FROM|JOIN)\s+(?:[\w.]+|"")\s*\(|""\s*\(|\b(read_\w+|\w+_scan|glob|getenv|query|query_table)\s*\(/i.test(tokens)) {
    throw new Error("External sources and dynamic SQL are not permitted. Use the inspected project tables.");
  }
}

export const createQueryProjectDataTool = (
  projectId: string,
  services: DataAnalysisToolServices
) =>
  tool(
    async ({ sql }: { sql: string }) => {
      try {
        assertSafeReadOnlySql(sql);

        const project = await services.projectService.getById(projectId);
        if (!project) {
          return { success: false, error: `Project '${projectId}' not found.` };
        }

        const pWs = await services.projectService.getProjectWithWorkspace(projectId);
        const projectName = project.projectName || project.name;
        const workspaceName = pWs?.workspaceName || "Default_Workspace";
        const dbPath = services.duckDBService.getProjectDuckDbPath(projectName, workspaceName);

        if (!fs.existsSync(dbPath)) {
          return {
            success: false,
            error: `Project database file not initialized for '${projectName}'.`,
          };
        }

        // Limit results defensively
        let querySql = sql.trim().replace(/;$/, "");
        if (/^(SELECT|WITH)\b/i.test(querySql) && !/LIMIT\s+\d+/i.test(querySql)) {
          querySql = `${querySql} LIMIT 100`;
        }

        const rows = await services.duckDBService.runQuery(dbPath, querySql);
        return {
          success: true,
          rowCount: rows.length,
          rows: rows.slice(0, 100),
        };
      } catch (err: any) {
        return {
          success: false,
          error: err?.message || String(err),
          rows: [],
        };
      }
    },
    {
      name: "queryProjectData",
      description: "Executes a read-only SQL query against inspected tables in the project's DuckDB database. External files and table functions are unavailable.",
      schema: z.object({
        sql: z.string().describe("Read-only SQL query (SELECT ...) to run on project data tables."),
      }),
    }
  );

export const createAggregateMetricsTool = (
  projectId: string,
  services: DataAnalysisToolServices
) =>
  tool(
    async ({
      metricColumn,
      dimensionColumn,
      aggregationType,
      tableName,
      limit = 20,
    }: {
      metricColumn: string;
      dimensionColumn?: string;
      aggregationType: "SUM" | "AVG" | "MIN" | "MAX" | "COUNT";
      tableName: string;
      limit?: number;
    }) => {
      try {
        const project = await services.projectService.getById(projectId);
        if (!project) {
          return { success: false, error: `Project '${projectId}' not found.` };
        }

        const pWs = await services.projectService.getProjectWithWorkspace(projectId);
        const projectName = project.projectName || project.name;
        const workspaceName = pWs?.workspaceName || "Default_Workspace";
        const dbPath = services.duckDBService.getProjectDuckDbPath(projectName, workspaceName);

        const targetTable = tableName;
        if (!targetTable) return { success: false, error: "An inspected table name is required." };

        const cleanTable = `"${targetTable.replace(/"/g, '""')}"`;
        const cleanMetric = `"${metricColumn.replace(/"/g, '""')}"`;
        const validAgg = aggregationType;

        let sql = "";
        if (dimensionColumn) {
          const cleanDim = `"${dimensionColumn.replace(/"/g, '""')}"`;
          sql = `SELECT ${cleanDim} AS dimension, ROUND(${validAgg}(${cleanMetric})::numeric, 2) AS metric_value FROM ${cleanTable} GROUP BY ${cleanDim} ORDER BY metric_value DESC LIMIT ${Math.min(limit, 100)};`;
        } else {
          sql = `SELECT ROUND(${validAgg}(${cleanMetric})::numeric, 2) AS metric_value, COUNT(*) AS record_count FROM ${cleanTable};`;
        }

        const rows = await services.duckDBService.runQuery(dbPath, sql);
        return {
          success: true,
          metric: metricColumn,
          dimension: dimensionColumn || null,
          aggregation: validAgg,
          results: rows,
        };
      } catch (err: any) {
        return {
          success: false,
          error: err?.message || String(err),
        };
      }
    },
    {
      name: "aggregateMetrics",
      description: "Aggregates numerical columns (SUM, AVG, MIN, MAX, COUNT) with optional grouping dimension.",
      schema: z.object({
        metricColumn: z.string().describe("Numerical column name to aggregate (e.g. sales, revenue, profit, units)."),
        dimensionColumn: z.string().optional().describe("Optional grouping column name (e.g. region, store, category)."),
        aggregationType: z.enum(["SUM", "AVG", "MIN", "MAX", "COUNT"]).describe("Explicit aggregation function for the requested business metric."),
        tableName: z.string().min(1).describe("Exact table name from the inspected project schema."),
        limit: z.number().int().min(1).max(100).optional().describe("Maximum rows to return when grouped."),
      }),
    }
  );

export const createComparePeriodsTool = (
  projectId: string,
  services: DataAnalysisToolServices
) =>
  tool(
    async ({
      metricColumn,
      timeColumn,
      currentPeriodFilter,
      previousPeriodFilter,
      tableName,
    }: {
      metricColumn: string;
      timeColumn: string;
      currentPeriodFilter: string;
      previousPeriodFilter: string;
      tableName: string;
    }) => {
      try {
        const project = await services.projectService.getById(projectId);
        if (!project) return { success: false, error: `Project '${projectId}' not found.` };

        const pWs = await services.projectService.getProjectWithWorkspace(projectId);
        const projectName = project.projectName || project.name;
        const workspaceName = pWs?.workspaceName || "Default_Workspace";
        const dbPath = services.duckDBService.getProjectDuckDbPath(projectName, workspaceName);

        const targetTable = tableName;
        if (!targetTable) return { success: false, error: "An inspected table name is required." };

        const cleanTable = `"${targetTable.replace(/"/g, '""')}"`;
        const cleanMetric = `"${metricColumn.replace(/"/g, '""')}"`;

        const sqlCurrent = `SELECT ROUND(SUM(${cleanMetric})::numeric, 2) AS current_total FROM ${cleanTable} WHERE ${currentPeriodFilter};`;
        const sqlPrev = `SELECT ROUND(SUM(${cleanMetric})::numeric, 2) AS prev_total FROM ${cleanTable} WHERE ${previousPeriodFilter};`;

        assertSafeReadOnlySql(sqlCurrent);
        assertSafeReadOnlySql(sqlPrev);

        const currentRes = await services.duckDBService.runQuery(dbPath, sqlCurrent);
        const prevRes = await services.duckDBService.runQuery(dbPath, sqlPrev);

        const currentTotal = currentRes[0]?.current_total;
        const previousTotal = prevRes[0]?.prev_total;
        if (currentTotal == null || previousTotal == null) return { success: false, error: "One or both periods contain no matching observations." };
        const currentVal = Number(currentTotal);
        const prevVal = Number(previousTotal);
        const absoluteChange = currentVal - prevVal;
        const percentageChange = prevVal !== 0 ? Number(((absoluteChange / prevVal) * 100).toFixed(2)) : null;

        return {
          success: true,
          metric: metricColumn,
          currentValue: currentVal,
          previousValue: prevVal,
          absoluteChange,
          percentageChange,
          trend: absoluteChange > 0 ? "up" : absoluteChange < 0 ? "down" : "neutral",
        };
      } catch (err: any) {
        return {
          success: false,
          error: err?.message || String(err),
        };
      }
    },
    {
      name: "comparePeriods",
      description: "Compares metric totals between two specified periods and calculates absolute and percentage change.",
      schema: z.object({
        metricColumn: z.string().describe("Target metric column name."),
        timeColumn: z.string().describe("Date or timestamp column name."),
        currentPeriodFilter: z.string().describe("SQL WHERE clause expression for the current period (e.g. date >= '2026-08-01' AND date <= '2026-08-31')."),
        previousPeriodFilter: z.string().describe("SQL WHERE clause expression for the previous period (e.g. date >= '2026-07-01' AND date <= '2026-07-31')."),
        tableName: z.string().min(1).describe("Exact table name from the inspected project schema."),
      }),
    }
  );
