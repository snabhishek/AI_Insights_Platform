import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { Pool } from "pg";
import * as xlsx from "xlsx";
import { IFileService } from "../../services/file.service.interface";
import { ConnectorService } from "../../services/connector.service";
import { ConnectionConfig, ConnectorType } from "../../models/connector.types";

type ColumnInfo = {
  name: string;
  dataType: string;
  nullable: boolean;
};

type ConstraintInfo = {
  name: string;
  type: string;
  columns: string[];
};

type RelationInfo = {
  column: string;
  foreignTable: string;
  foreignColumn: string;
  constraintName?: string;
};

export const createInspectTool = (
  fileService: IFileService,
  connectorService: ConnectorService,
  defaultConnector?: any
) =>
  tool(
    async ({ connectorId, connectorType, connectionConfig, tableNames, maxTables, maxColumns }) => {
      let resolvedType = connectorType as ConnectorType | undefined;
      let config: ConnectionConfig | undefined;

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
      } else {
        resolvedType = connectorType as ConnectorType | undefined;
        config = connectionConfig as ConnectionConfig | undefined;
      }

      if (!resolvedType || !config) {
        return {
          connectorId: typeof connectorId === "string" ? connectorId : undefined,
          connectorType: resolvedType || connectorType || "unknown",
          schemaType: "unknown",
          tableCount: 0,
          tables: [],
          notes: "Connector configuration could not be resolved.",
        };
      }

      const type = resolvedType;
      const selectedTables = Array.isArray(tableNames) ? tableNames.filter((name) => typeof name === "string" && name.trim().length > 0) : [];
      const tableLimit = typeof maxTables === "number" && maxTables > 0 ? Math.floor(maxTables) : 50;
      const columnLimit = typeof maxColumns === "number" && maxColumns > 0 ? Math.floor(maxColumns) : 200;

      if (type === "postgres") {
        const pool = new Pool({
          host: config.host,
          port: config.port ? parseInt(config.port, 10) : 5432,
          database: config.database,
          user: config.username || "postgres",
          password: config.password || "",
        });
        const listOnly = selectedTables.length === 0;
        const totalCountRes = await pool.query(
          `SELECT count(*)::int as count
           FROM information_schema.tables
           WHERE table_schema = 'public'`
        );
        const totalTables = totalCountRes.rows[0]?.count ?? 0;
        const tableRows = await pool.query(
          `SELECT table_name, table_type
           FROM information_schema.tables
           WHERE table_schema = 'public'
           ${listOnly ? "" : "AND table_name = ANY($1)"}
           ORDER BY table_name
           ${listOnly ? "LIMIT $1" : ""}`,
          listOnly ? [tableLimit] : [selectedTables]
        );
        if (listOnly) {
          await pool.end();
          return {
            connectorType: type,
            schemaType: "database",
            tableCount: totalTables,
            tablesListed: tableRows.rows.length,
            hasMore: totalTables > tableRows.rows.length,
            tables: tableRows.rows.map((row) => ({ name: row.table_name, type: row.table_type })),
          };
        }

        const columnRows = await pool.query(
          `SELECT table_name, column_name, data_type, is_nullable
           FROM information_schema.columns
           WHERE table_schema = 'public'
             AND table_name = ANY($1)
           ORDER BY table_name, ordinal_position`,
          [selectedTables]
        );

        const constraintRows = await pool.query(
          `SELECT tc.table_name,
                  tc.constraint_name,
                  tc.constraint_type,
                  kcu.column_name
           FROM information_schema.table_constraints tc
           LEFT JOIN information_schema.key_column_usage kcu
             ON tc.constraint_name = kcu.constraint_name
            AND tc.table_schema = kcu.table_schema
           WHERE tc.table_schema = 'public'
             AND tc.table_name = ANY($1)
           ORDER BY tc.table_name, tc.constraint_name`,
          [selectedTables]
        );

        const relationRows = await pool.query(
          `SELECT tc.table_name,
                  kcu.column_name,
                  ccu.table_name AS foreign_table_name,
                  ccu.column_name AS foreign_column_name,
                  tc.constraint_name
           FROM information_schema.table_constraints tc
           JOIN information_schema.key_column_usage kcu
             ON tc.constraint_name = kcu.constraint_name
            AND tc.table_schema = kcu.table_schema
           JOIN information_schema.constraint_column_usage ccu
             ON ccu.constraint_name = tc.constraint_name
            AND ccu.table_schema = tc.table_schema
           WHERE tc.constraint_type = 'FOREIGN KEY'
            AND tc.table_schema = 'public'
            AND tc.table_name = ANY($1)
           ORDER BY tc.table_name, tc.constraint_name`,
          [selectedTables]
        );

        const tableMap = new Map<string, { name: string; type: string; columns: ColumnInfo[]; constraints: ConstraintInfo[]; relations: RelationInfo[] }>();
        for (const row of tableRows.rows) {
          tableMap.set(row.table_name, {
            name: row.table_name,
            type: row.table_type,
            columns: [],
            constraints: [],
            relations: [],
          });
        }

        for (const row of columnRows.rows) {
          const target = tableMap.get(row.table_name);
          if (target) {
            target.columns.push({
              name: row.column_name,
              dataType: row.data_type,
              nullable: row.is_nullable === "YES",
            });
          }
        }

        const constraintMap = new Map<string, ConstraintInfo>();
        for (const row of constraintRows.rows) {
          const key = `${row.table_name}:${row.constraint_name}`;
          if (!constraintMap.has(key)) {
            constraintMap.set(key, {
              name: row.constraint_name,
              type: row.constraint_type,
              columns: [],
            });
          }
          if (row.column_name) {
            constraintMap.get(key)!.columns.push(row.column_name);
          }
        }
        for (const [key, constraint] of constraintMap.entries()) {
          const tableName = key.split(":")[0];
          const target = tableMap.get(tableName);
          if (target) {
            target.constraints.push(constraint);
          }
        }

        for (const row of relationRows.rows) {
          const target = tableMap.get(row.table_name);
          if (target) {
            target.relations.push({
              column: row.column_name,
              foreignTable: row.foreign_table_name,
              foreignColumn: row.foreign_column_name,
              constraintName: row.constraint_name,
            });
          }
        }

        for (const table of tableMap.values()) {
          if (table.columns.length > columnLimit) {
            table.columns = table.columns.slice(0, columnLimit);
            (table as any).columnsTruncated = true;
          }
        }

        await pool.end();

        return {
          connectorType: type,
          schemaType: "database",
          tableCount: totalTables,
          tables: Array.from(tableMap.values()),
        };
      }

      if (type === "mysql") {
        const mysql = require("mysql2/promise");
        const connection = await mysql.createConnection({
          host: config.host,
          port: config.port ? parseInt(config.port, 10) : 3306,
          database: config.database,
          user: config.username || "root",
          password: config.password || "",
        });

        const listOnly = selectedTables.length === 0;
        const [totalRows] = await connection.query(
          `SELECT COUNT(*) as count
           FROM information_schema.tables
           WHERE table_schema = ?`,
          [config.database]
        );
        const totalTables = (totalRows as any[])[0]?.count ?? 0;
        const [tableRows] = await connection.query(
          `SELECT table_name, table_type
           FROM information_schema.tables
           WHERE table_schema = ?
           ${listOnly ? "" : "AND table_name IN (?)"}
           ORDER BY table_name
           ${listOnly ? "LIMIT ?" : ""}`,
          listOnly ? [config.database, tableLimit] : [config.database, selectedTables]
        );
        if (listOnly) {
          await connection.end();
          return {
            connectorType: type,
            schemaType: "database",
            tableCount: totalTables,
            tablesListed: (tableRows as any[]).length,
            hasMore: totalTables > (tableRows as any[]).length,
            tables: (tableRows as any[]).map((row) => ({ name: row.table_name, type: row.table_type })),
          };
        }

        const [columnRows] = await connection.query(
          `SELECT table_name, column_name, data_type, is_nullable
           FROM information_schema.columns
           WHERE table_schema = ?
             AND table_name IN (?)
           ORDER BY table_name, ordinal_position`,
          [config.database, selectedTables]
        );

        const [constraintRows] = await connection.query(
          `SELECT tc.table_name,
                  tc.constraint_name,
                  tc.constraint_type,
                  kcu.column_name
           FROM information_schema.table_constraints tc
           LEFT JOIN information_schema.key_column_usage kcu
             ON tc.constraint_name = kcu.constraint_name
            AND tc.table_schema = kcu.table_schema
           WHERE tc.table_schema = ?
             AND tc.table_name IN (?)
           ORDER BY tc.table_name, tc.constraint_name`,
          [config.database, selectedTables]
        );

        const [relationRows] = await connection.query(
          `SELECT table_name,
                  column_name,
                  referenced_table_name,
                  referenced_column_name,
                  constraint_name
           FROM information_schema.key_column_usage
           WHERE table_schema = ?
             AND table_name IN (?)
             AND referenced_table_name IS NOT NULL
           ORDER BY table_name, constraint_name`,
          [config.database, selectedTables]
        );

        const tableMap = new Map<string, { name: string; type: string; columns: ColumnInfo[]; constraints: ConstraintInfo[]; relations: RelationInfo[] }>();
        for (const row of tableRows as any[]) {
          tableMap.set(row.table_name, {
            name: row.table_name,
            type: row.table_type,
            columns: [],
            constraints: [],
            relations: [],
          });
        }

        for (const row of columnRows as any[]) {
          const target = tableMap.get(row.table_name);
          if (target) {
            target.columns.push({
              name: row.column_name,
              dataType: row.data_type,
              nullable: row.is_nullable === "YES",
            });
          }
        }

        const constraintMap = new Map<string, ConstraintInfo>();
        for (const row of constraintRows as any[]) {
          const key = `${row.table_name}:${row.constraint_name}`;
          if (!constraintMap.has(key)) {
            constraintMap.set(key, {
              name: row.constraint_name,
              type: row.constraint_type,
              columns: [],
            });
          }
          if (row.column_name) {
            constraintMap.get(key)!.columns.push(row.column_name);
          }
        }
        for (const [key, constraint] of constraintMap.entries()) {
          const tableName = key.split(":")[0];
          const target = tableMap.get(tableName);
          if (target) {
            target.constraints.push(constraint);
          }
        }

        for (const row of relationRows as any[]) {
          const target = tableMap.get(row.table_name);
          if (target) {
            target.relations.push({
              column: row.column_name,
              foreignTable: row.referenced_table_name,
              foreignColumn: row.referenced_column_name,
              constraintName: row.constraint_name,
            });
          }
        }

        for (const table of tableMap.values()) {
          if (table.columns.length > columnLimit) {
            table.columns = table.columns.slice(0, columnLimit);
            (table as any).columnsTruncated = true;
          }
        }

        await connection.end();

        return {
          connectorType: type,
          schemaType: "database",
          tableCount: totalTables,
          tables: Array.from(tableMap.values()),
        };
      }

      if (type === "excel") {
        const fileName = config.fileName;
        if (!fileName || !fileService.fileExists(fileName)) {
          return {
            connectorType: type,
            schemaType: "file",
            tableCount: 0,
            tables: [],
            notes: "Excel file not found.",
          };
        }
        const filePath = fileService.getFilePath(fileName);
        const workbook = xlsx.readFile(filePath);
        const tables = workbook.SheetNames.map((sheetName: string) => {
          const worksheet = workbook.Sheets[sheetName];
          const rows = xlsx.utils.sheet_to_json(worksheet, { header: 1 }) as Array<Array<any>>;
          const headers = rows[0] || [];
          return {
            name: sheetName,
            type: "Sheet",
            columns: headers.map((header) => ({
              name: String(header || "column"),
              dataType: "string",
              nullable: true,
            })),
            constraints: [],
            relations: [],
          };
        });
        return {
          connectorType: type,
          schemaType: "file",
          tableCount: tables.length,
          tables,
        };
      }

      if (type === "csv" || type === "tsv") {
        const fileName = config.fileName;
        if (!fileName || !fileService.fileExists(fileName)) {
          return {
            connectorType: type,
            schemaType: "file",
            tableCount: 0,
            tables: [],
            notes: "Delimited file not found.",
          };
        }
        const content = fileService.readTextFile(fileName);
        const delimiter = type === "tsv" ? "\t" : ",";
        const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
        const headers = lines.length > 0 ? lines[0].split(delimiter).map((h) => h.replace(/^[\"']|[\"']$/g, "").trim()) : [];
        return {
          connectorType: type,
          schemaType: "file",
          tableCount: 1,
          tables: [
            {
              name: fileName,
              type: "Table",
              columns: headers.map((header) => ({
                name: header || "column",
                dataType: "string",
                nullable: true,
              })),
              constraints: [],
              relations: [],
            },
          ],
        };
      }

      if (type === "sqlserver") {
        return {
          connectorType: type,
          schemaType: "database",
          tableCount: 0,
          tables: [],
          notes: "SQL Server inspection requires a driver (e.g., mssql/tedious) not yet configured.",
        };
      }

      return {
        connectorType: type,
        schemaType: "unknown",
        tableCount: 0,
        tables: [],
        notes: "Unsupported connector for inspection.",
      };
    },
    {
      name: "inspectDataSource",
      description: "Inspect a connector source and return table fields, data types, constraints, and relationships.",
      schema: z.object({
        connectorId: z.string().describe("Connector ID used to resolve the stored connection settings"),
        connectorType: z.string().optional().describe("Connector type fallback when connectorId is unavailable"),
        connectionConfig: z.object({}).passthrough().optional().describe("Fallback connection settings when connectorId is unavailable"),
        tableNames: z.array(z.string()).optional().describe("Specific tables to inspect for column/constraint details"),
        maxTables: z.number().optional().describe("Maximum tables to list when tableNames is not provided"),
        maxColumns: z.number().optional().describe("Maximum columns per table in detailed inspection"),
      }),
    }
  );
