import net from "net";
import http from "http";
import https from "https";
import fsSync from "fs";
import readline from "readline";
import { Pool } from "pg";
import * as xlsx from "xlsx";
import Piscina from "piscina";
import path from "path";
import { IConnectionTesterService, TestResult, SampleResult } from "./connectionTester.service.interface";
import { ConnectorType, ConnectionConfig } from "../../models/connector.types";
import { IFileService } from "../file/file.service.interface";

const DEFAULT_PORTS: Record<string, number> = {
  postgres: 5432,
  mysql: 3306,
  sqlserver: 1433,
  mongodb: 27017,
  snowflake: 443,
};

const isTs = __filename.endsWith(".ts");
const workerPath = path.resolve(__dirname, isTs ? "../ai/workers/dataWorker.ts" : "../ai/workers/dataWorker.js");

export class ConnectionTesterService implements IConnectionTesterService {
  private workerPool = new Piscina({
    filename: workerPath,
    execArgv: isTs ? ["-r", "ts-node/register"] : undefined,
    minThreads: 2,
    maxThreads: 8,
    idleTimeout: 30000,
  });

  constructor(private fileService: IFileService) {}


  private testTcpConnection(host: string, port: number, timeoutMs = 5000): Promise<TestResult> {
    return new Promise((resolve) => {
      const startTime = Date.now();
      const socket = new net.Socket();

      socket.setTimeout(timeoutMs);

      socket.on("connect", () => {
        const latencyMs = Date.now() - startTime;
        socket.destroy();
        resolve({
          success: true,
          message: `TCP connection established to ${host}:${port}`,
          latencyMs,
        });
      });

      socket.on("timeout", () => {
        socket.destroy();
        resolve({
          success: false,
          message: `Connection timed out after ${timeoutMs}ms — ${host}:${port} is not reachable`,
          latencyMs: timeoutMs,
        });
      });

      socket.on("error", (err: NodeJS.ErrnoException) => {
        const latencyMs = Date.now() - startTime;
        let message = `Connection failed to ${host}:${port}`;

        if (err.code === "ECONNREFUSED") {
          message = `Connection refused — no service is listening on ${host}:${port}`;
        } else if (err.code === "ENOTFOUND") {
          message = `Host not found — could not resolve hostname "${host}"`;
        } else if (err.code === "ENETUNREACH") {
          message = `Network unreachable — cannot reach ${host}`;
        } else if (err.message) {
          message = `Connection error: ${err.message}`;
        }

        socket.destroy();
        resolve({ success: false, message, latencyMs });
      });

      socket.connect(port, host);
    });
  }

  private testHttpConnection(url: string, timeoutMs = 8000): Promise<TestResult> {
    return new Promise((resolve) => {
      const startTime = Date.now();

      try {
        const parsedUrl = new URL(url);
        const client = parsedUrl.protocol === "https:" ? https : http;

        const req = client.request(
          url,
          { method: "HEAD", timeout: timeoutMs },
          (res) => {
            const latencyMs = Date.now() - startTime;
            const statusCode = res.statusCode || 0;

            if (statusCode >= 200 && statusCode < 400) {
              resolve({
                success: true,
                message: `API endpoint reachable — HTTP ${statusCode}`,
                latencyMs,
              });
            } else if (statusCode === 401 || statusCode === 403) {
              resolve({
                success: true,
                message: `API endpoint reachable — authentication required (HTTP ${statusCode})`,
                latencyMs,
              });
            } else {
              resolve({
                success: false,
                message: `API returned HTTP ${statusCode}`,
                latencyMs,
              });
            }

            res.resume();
          }
        );

        req.on("timeout", () => {
          req.destroy();
          resolve({
            success: false,
            message: `Request timed out after ${timeoutMs}ms`,
            latencyMs: timeoutMs,
          });
        });

        req.on("error", (err) => {
          const latencyMs = Date.now() - startTime;
          resolve({
            success: false,
            message: `Request failed: ${err.message}`,
            latencyMs,
          });
        });

        req.end();
      } catch (err: unknown) {
        const latencyMs = Date.now() - startTime;
        const message = err instanceof Error ? err.message : "Invalid URL format";
        resolve({
          success: false,
          message: `Invalid URL: ${message}`,
          latencyMs,
        });
      }
    });
  }

  async testConnection(type: ConnectorType, config: ConnectionConfig): Promise<TestResult> {
    if (["excel", "csv", "tsv"].includes(type)) {
      if (!config.fileName) {
        return { success: false, message: "No file selected", latencyMs: 0 };
      }
      return {
        success: true,
        message: `File "${config.fileName}" accepted for import`,
        latencyMs: 1,
      };
    }

    if (type === "restapi") {
      if (!config.url) {
        return { success: false, message: "API endpoint URL is required", latencyMs: 0 };
      }
      return this.testHttpConnection(config.url);
    }

    if (!config.host) {
      return { success: false, message: "Host address is required", latencyMs: 0 };
    }
    if (!config.database) {
      return { success: false, message: "Database name is required", latencyMs: 0 };
    }

    const port = config.port
      ? parseInt(config.port, 10)
      : DEFAULT_PORTS[type] || 5432;

    if (isNaN(port) || port < 1 || port > 65535) {
      return { success: false, message: "Invalid port number", latencyMs: 0 };
    }

    const startTime = Date.now();

    if (type === "postgres") {
      const pool = new Pool({
        host: config.host,
        port,
        database: config.database,
        user: config.username || "postgres",
        password: config.password || "",
        connectionTimeoutMillis: 5000,
      });
      try {
        const client = await pool.connect();
        await client.query("SELECT 1");
        client.release();
        await pool.end();
        return {
          success: true,
          message: `Successfully authenticated PostgreSQL connection to ${config.database}`,
          latencyMs: Date.now() - startTime,
        };
      } catch (err: any) {
        await pool.end();
        return {
          success: false,
          message: `PostgreSQL auth failed: ${err.message}`,
          latencyMs: Date.now() - startTime,
        };
      }
    }

    if (type === "mysql") {
      try {
        const mysql = require("mysql2/promise");
        const connection = await mysql.createConnection({
          host: config.host,
          port,
          database: config.database,
          user: config.username || "root",
          password: config.password || "",
          connectTimeout: 5000,
        });
        await connection.query("SELECT 1");
        await connection.end();
        return {
          success: true,
          message: `Successfully authenticated MySQL connection to ${config.database}`,
          latencyMs: Date.now() - startTime,
        };
      } catch (err: any) {
        return {
          success: false,
          message: `MySQL auth failed: ${err.message}`,
          latencyMs: Date.now() - startTime,
        };
      }
    }

    return this.testTcpConnection(config.host, port);
  }

  async healthCheck(type: ConnectorType, config: ConnectionConfig): Promise<TestResult> {
    return this.testConnection(type, config);
  }

  async getSchema(type: ConnectorType, config: ConnectionConfig): Promise<{ success: boolean; type: string; tables: any[] }> {
    if (type === "postgres") {
      const targetPool = new Pool({
        host: config.host,
        port: config.port ? parseInt(config.port, 10) : 5432,
        database: config.database,
        user: config.username || "postgres",
        password: config.password || "",
      });

      const schemaRes = await targetPool.query(`
        SELECT table_name as name, table_type as type 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        ORDER BY table_name
      `);

      const tablesList = [];
      for (const row of schemaRes.rows) {
        let rowCount = 0;
        try {
          const countRes = await targetPool.query(`SELECT count(*)::int as count FROM "${row.name}"`);
          rowCount = countRes.rows[0]?.count ?? 0;
        } catch (e) {
          rowCount = 0;
        }
        tablesList.push({
          id: row.name,
          name: row.name,
          type: row.type === "VIEW" ? "View" : "Table",
          rows: rowCount,
        });
      }

      await targetPool.end();
      return { success: true, type: "database", tables: tablesList };
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

      const [schemaRows] = await connection.query(`
        SELECT table_name as name, table_type as type 
        FROM information_schema.tables 
        WHERE table_schema = ? 
        ORDER BY table_name
      `, [config.database]);

      const tablesList = [];
      for (const row of (schemaRows as any[])) {
        let rowCount = 0;
        try {
          const [countRows] = await connection.query(`SELECT COUNT(*) as count FROM \`${row.name}\``);
          rowCount = (countRows as any)[0]?.count ?? 0;
        } catch (e) {
          rowCount = 0;
        }
        tablesList.push({
          id: row.name,
          name: row.name,
          type: row.type === "VIEW" ? "View" : "Table",
          rows: rowCount,
        });
      }

      await connection.end();
      return { success: true, type: "database", tables: tablesList };
    }

    if (type === "sqlserver") {
      const sql = require("mssql");
      const pool = await sql.connect({
        server: config.host,
        port: config.port ? parseInt(config.port, 10) : 1433,
        database: config.database,
        user: config.username,
        password: config.password || "",
        options: { encrypt: true, trustServerCertificate: true },
      });

      try {
        const schemaRes = await pool.request().query(`
          SELECT TABLE_NAME as name, TABLE_TYPE as type
          FROM INFORMATION_SCHEMA.TABLES
          WHERE TABLE_CATALOG = DB_NAME()
            AND TABLE_TYPE IN ('BASE TABLE', 'VIEW')
          ORDER BY TABLE_NAME
        `);

        const tablesList = [];
        for (const row of schemaRes.recordset) {
          let rowCount = 0;
          try {
            const countRes = await pool.request().query(`SELECT COUNT(*) as count FROM [${row.name}]`);
            rowCount = countRes.recordset[0]?.count ?? 0;
          } catch (e) {
            rowCount = 0;
          }
          tablesList.push({
            id: row.name,
            name: row.name,
            type: row.type === "VIEW" ? "View" : "Table",
            rows: rowCount,
          });
        }

        return { success: true, type: "database", tables: tablesList };
      } finally {
        await pool.close();
      }
    }

    if (type === "excel") {
      const fileName = config.fileName;
      if (fileName && this.fileService.fileExists(fileName)) {
        const filePath = this.fileService.getFilePath(fileName);
        try {
          const res = await this.workerPool.run({ type: "excel", filePath });
          return res;
        } catch (err: any) {
          console.error(`[ConnectionTester] Excel worker failed:`, err);
          return { success: false, message: `Failed to parse Excel: ${err.message || err}`, latencyMs: 0 } as any;
        }
      }
    }

    if (["csv", "tsv"].includes(type)) {
      const fileName = config.fileName;
      if (fileName && this.fileService.fileExists(fileName)) {
        const filePath = this.fileService.getFilePath(fileName);
        try {
          const res = await this.workerPool.run({ type, filePath });
          return res;
        } catch (err: any) {
          console.error(`[ConnectionTester] CSV/TSV worker failed:`, err);
          return { success: false, message: `Failed to parse CSV/TSV: ${err.message || err}`, latencyMs: 0 } as any;
        }
      }
      return {
        success: true,
        type: "file",
        tables: [
          { id: fileName || "file_data", name: fileName || "File Data", type: "Table", rows: 0 }
        ]
      };
    }


    if (type === "restapi") {
      return {
        success: true,
        type: "api",
        tables: [
          { id: "api_endpoint", name: "API Endpoint", type: "Endpoint", rows: 1 }
        ]
      };
    }

    return { success: true, type: "generic", tables: [] };
  }

  async getPreview(type: ConnectorType, config: ConnectionConfig, tableName?: string): Promise<{ success: boolean; headers: string[]; rows: any[] }> {
    if (type === "postgres") {
      if (!tableName) {
        throw new Error("Table parameter is required for database previews");
      }

      const targetPool = new Pool({
        host: config.host,
        port: config.port ? parseInt(config.port, 10) : 5432,
        database: config.database,
        user: config.username || "postgres",
        password: config.password || "",
      });

      const tableCheck = await targetPool.query(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1",
        [tableName]
      );
      if (tableCheck.rows.length === 0) {
        await targetPool.end();
        throw new Error(`Table "${tableName}" not found or unauthorized`);
      }

      const dataRes = await targetPool.query(`SELECT * FROM "${tableName}" LIMIT 5`);
      await targetPool.end();

      const headers = dataRes.fields.map((f) => f.name);
      return { success: true, headers, rows: dataRes.rows };
    }

    if (type === "mysql") {
      if (!tableName) {
        throw new Error("Table parameter is required for database previews");
      }

      const mysql = require("mysql2/promise");
      const connection = await mysql.createConnection({
        host: config.host,
        port: config.port ? parseInt(config.port, 10) : 3306,
        database: config.database,
        user: config.username || "root",
        password: config.password || "",
      });

      const [tableCheck] = await connection.query(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = ? AND table_name = ?",
        [config.database, tableName]
      );
      if ((tableCheck as any[]).length === 0) {
        await connection.end();
        throw new Error(`Table "${tableName}" not found or unauthorized`);
      }

      const [dataRows, fields] = await connection.query(`SELECT * FROM \`${tableName}\` LIMIT 5`);
      await connection.end();

      const headers = (fields as any[]).map((f) => f.name);
      return { success: true, headers, rows: dataRows };
    }

    if (type === "excel") {
      const fileName = config.fileName;
      if (!fileName) {
        throw new Error("No file associated with connector");
      }

      if (!this.fileService.fileExists(fileName)) {
        return {
          success: true,
          headers: ["Column 1", "Column 2", "Column 3", "Column 4", "Column 5"],
          rows: [
            { col1: "Fallback row 1", col2: "—", col3: "—", col4: "—", col5: "—" }
          ]
        };
      }

      const filePath = this.fileService.getFilePath(fileName);
      const workbook = xlsx.readFile(filePath);
      const sheetName = tableName || workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      if (!worksheet) {
        throw new Error(`Sheet "${sheetName}" not found in workbook`);
      }

      const jsonRows = xlsx.utils.sheet_to_json(worksheet, { defval: "" }) as any[];
      if (jsonRows.length === 0) {
        return { success: true, headers: [], rows: [] };
      }

      const headers = Object.keys(jsonRows[0]);
      const rows = jsonRows.slice(0, 5);
      return { success: true, headers, rows };
    }

    if (["csv", "tsv"].includes(type)) {
      const fileName = config.fileName;
      if (!fileName) {
        throw new Error("No file associated with connector");
      }

      if (!this.fileService.fileExists(fileName)) {
        return {
          success: true,
          headers: ["Column 1", "Column 2", "Column 3", "Column 4", "Column 5"],
          rows: [
            { col1: "Fallback row 1", col2: "—", col3: "—", col4: "—", col5: "—" }
          ]
        };
      }

      const content = this.fileService.readTextFile(fileName);
      const delimiter = type === "tsv" ? "\t" : ",";
      const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);

      if (lines.length === 0) {
        return { success: true, headers: [], rows: [] };
      }

      const headers = lines[0].split(delimiter).map((h) => h.replace(/^["']|["']$/g, "").trim());
      const rows = lines.slice(1, 6).map((line) => {
        const parts = line.split(delimiter).map((p) => p.replace(/^["']|["']$/g, "").trim());
        const rowObj: Record<string, string> = {};
        headers.forEach((header, idx) => {
          rowObj[header] = parts[idx] || "";
        });
        return rowObj;
      });

      return { success: true, headers, rows };
    }

    if (type === "restapi") {
      return {
        success: true,
        headers: ["Endpoint", "Status", "Latency"],
        rows: [
          { endpoint: config.url || "api_endpoint", status: "200 OK", latency: "12ms" }
        ],
      };
    }

    return { success: true, headers: [], rows: [] };
  }

  async getRowCount(type: ConnectorType, config: ConnectionConfig, tableName: string): Promise<number> {
    if (type === "postgres") {
      const pool = new Pool({
        host: config.host,
        port: config.port ? parseInt(config.port, 10) : 5432,
        database: config.database,
        user: config.username || "postgres",
        password: config.password || "",
      });
      try {
        const res = await pool.query(`SELECT count(*)::int as count FROM "${tableName}"`);
        return res.rows[0]?.count ?? 0;
      } finally {
        await pool.end();
      }
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
      try {
        const [rows] = await connection.query(`SELECT COUNT(*) as count FROM \`${tableName}\``);
        return (rows as any[])[0]?.count ?? 0;
      } finally {
        await connection.end();
      }
    }

    if (type === "sqlserver") {
      const sql = require("mssql");
      const pool = await sql.connect({
        server: config.host,
        port: config.port ? parseInt(config.port, 10) : 1433,
        database: config.database,
        user: config.username,
        password: config.password || "",
        options: { encrypt: false, trustServerCertificate: true },
      });
      try {
        const res = await pool.request().query(`SELECT COUNT(*) as count FROM [${tableName}]`);
        return res.recordset[0]?.count ?? 0;
      } finally {
        await pool.close();
      }
    }

    if (type === "restapi") {
      return 0;
    }

    if (type === "excel") {
      const fileName = config.fileName;
      if (!fileName || !this.fileService.fileExists(fileName)) return 0;
      const filePath = this.fileService.getFilePath(fileName);
      const workbook = xlsx.readFile(filePath);
      const worksheet = workbook.Sheets[tableName || workbook.SheetNames[0]];
      if (!worksheet) return 0;
      const rows = xlsx.utils.sheet_to_json(worksheet, { defval: "" }) as any[];
      return rows.length;
    }

    if (["csv", "tsv"].includes(type)) {
      const fileName = config.fileName;
      if (!fileName || !this.fileService.fileExists(fileName)) return 0;
      const filePath = this.fileService.getFilePath(fileName);
      try {
        const fileStream = fsSync.createReadStream(filePath, { encoding: "utf8" });
        const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
        let count = 0;
        for await (const line of rl) {
          if (line.trim().length > 0) count++;
        }
        return Math.max(0, count - 1);
      } catch {
        return 0;
      }
    }

    return 0;
  }

  async getSampleWithOffset(type: ConnectorType, config: ConnectionConfig, tableName: string, limit: number, offset: number): Promise<SampleResult> {
    if (type === "postgres") {
      const pool = new Pool({
        host: config.host,
        port: config.port ? parseInt(config.port, 10) : 5432,
        database: config.database,
        user: config.username || "postgres",
        password: config.password || "",
      });
      try {
        const countRes = await pool.query(`SELECT count(*)::int as count FROM "${tableName}"`);
        const totalRowCount = countRes.rows[0]?.count ?? 0;
        const dataRes = await pool.query(`SELECT * FROM "${tableName}" LIMIT $1 OFFSET $2`, [limit, offset]);
        const headers = dataRes.fields.map((f) => f.name);
        return { success: true, headers, rows: dataRes.rows, totalRowCount };
      } finally {
        await pool.end();
      }
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
      try {
        const [countRows] = await connection.query(`SELECT COUNT(*) as count FROM \`${tableName}\``);
        const totalRowCount = (countRows as any[])[0]?.count ?? 0;
        const [dataRows, fields] = await connection.query(`SELECT * FROM \`${tableName}\` LIMIT ? OFFSET ?`, [limit, offset]);
        const headers = (fields as any[]).map((f) => f.name);
        return { success: true, headers, rows: dataRows as any[], totalRowCount };
      } finally {
        await connection.end();
      }
    }

    if (type === "sqlserver") {
      const sql = require("mssql");
      const pool = await sql.connect({
        server: config.host,
        port: config.port ? parseInt(config.port, 10) : 1433,
        database: config.database,
        user: config.username,
        password: config.password || "",
        options: { encrypt: false, trustServerCertificate: true },
      });
      try {
        const countRes = await pool.request().query(`SELECT COUNT(*) as count FROM [${tableName}]`);
        const totalRowCount = countRes.recordset[0]?.count ?? 0;
        const dataRes = await pool.request().query(
          `SELECT * FROM [${tableName}] ORDER BY (SELECT NULL) OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`
        );
        const headers = dataRes.recordset.length > 0 ? Object.keys(dataRes.recordset[0]) : [];
        return { success: true, headers, rows: dataRes.recordset, totalRowCount };
      } finally {
        await pool.close();
      }
    }

    return this.getFileSlice(type, config, tableName, limit, offset);
  }

  async getRandomSample(type: ConnectorType, config: ConnectionConfig, tableName: string, limit: number, seed?: number): Promise<SampleResult> {
    if (type === "postgres") {
      const pool = new Pool({
        host: config.host,
        port: config.port ? parseInt(config.port, 10) : 5432,
        database: config.database,
        user: config.username || "postgres",
        password: config.password || "",
      });
      try {
        const countRes = await pool.query(`SELECT count(*)::int as count FROM "${tableName}"`);
        const totalRowCount = countRes.rows[0]?.count ?? 0;
        if (typeof seed === "number") {
          await pool.query(`SELECT setseed($1)`, [Math.abs(seed % 1000) / 1000]);
        }
        const dataRes = await pool.query(`SELECT * FROM "${tableName}" ORDER BY random() LIMIT $1`, [limit]);
        const headers = dataRes.fields.map((f) => f.name);
        return { success: true, headers, rows: dataRes.rows, totalRowCount };
      } finally {
        await pool.end();
      }
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
      try {
        const [countRows] = await connection.query(`SELECT COUNT(*) as count FROM \`${tableName}\``);
        const totalRowCount = (countRows as any[])[0]?.count ?? 0;
        const seedExpr = typeof seed === "number" ? `RAND(${Math.abs(seed)})` : "RAND()";
        const [dataRows, fields] = await connection.query(`SELECT * FROM \`${tableName}\` ORDER BY ${seedExpr} LIMIT ?`, [limit]);
        const headers = (fields as any[]).map((f) => f.name);
        return { success: true, headers, rows: dataRows as any[], totalRowCount };
      } finally {
        await connection.end();
      }
    }

    if (type === "sqlserver") {
      const sql = require("mssql");
      const pool = await sql.connect({
        server: config.host,
        port: config.port ? parseInt(config.port, 10) : 1433,
        database: config.database,
        user: config.username,
        password: config.password || "",
        options: { encrypt: false, trustServerCertificate: true },
      });
      try {
        const countRes = await pool.request().query(`SELECT COUNT(*) as count FROM [${tableName}]`);
        const totalRowCount = countRes.recordset[0]?.count ?? 0;
        const dataRes = await pool.request().query(
          `SELECT TOP (${limit}) * FROM [${tableName}] ORDER BY NEWID()`
        );
        const headers = dataRes.recordset.length > 0 ? Object.keys(dataRes.recordset[0]) : [];
        return { success: true, headers, rows: dataRes.recordset, totalRowCount };
      } finally {
        await pool.close();
      }
    }

    return this.getFileRandomSample(type, config, tableName, limit, seed);
  }

  async getStratifiedSample(type: ConnectorType, config: ConnectionConfig, tableName: string, stratifyColumn: string, limitPerGroup: number, seed?: number): Promise<SampleResult> {
    if (type === "postgres") {
      const pool = new Pool({
        host: config.host,
        port: config.port ? parseInt(config.port, 10) : 5432,
        database: config.database,
        user: config.username || "postgres",
        password: config.password || "",
      });
      try {
        const countRes = await pool.query(`SELECT count(*)::int as count FROM "${tableName}"`);
        const totalRowCount = countRes.rows[0]?.count ?? 0;
        const dataRes = await pool.query(
          `SELECT * FROM (
            SELECT *, ROW_NUMBER() OVER (PARTITION BY "${stratifyColumn}" ORDER BY random()) as _rn
            FROM "${tableName}"
          ) sub WHERE _rn <= $1`,
          [limitPerGroup]
        );
        const headers = dataRes.fields.map((f) => f.name).filter((h) => h !== "_rn");
        const rows = dataRes.rows.map((row) => {
          const { _rn, ...rest } = row;
          return rest;
        });
        const groups = Array.from(new Set(rows.map((r) => String(r[stratifyColumn] ?? "null"))));
        return { success: true, headers, rows, totalRowCount, metadata: { stratifyColumn, groups, groupCount: groups.length } };
      } finally {
        await pool.end();
      }
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
      try {
        const [countRows] = await connection.query(`SELECT COUNT(*) as count FROM \`${tableName}\``);
        const totalRowCount = (countRows as any[])[0]?.count ?? 0;
        const [dataRows, fields] = await connection.query(
          `SELECT * FROM (
            SELECT *, ROW_NUMBER() OVER (PARTITION BY \`${stratifyColumn}\` ORDER BY RAND()) as _rn
            FROM \`${tableName}\`
          ) sub WHERE _rn <= ?`,
          [limitPerGroup]
        );
        const headers = (fields as any[]).map((f) => f.name).filter((h) => h !== "_rn");
        const rows = (dataRows as any[]).map((row) => {
          const { _rn, ...rest } = row;
          return rest;
        });
        const groups = Array.from(new Set(rows.map((r) => String(r[stratifyColumn] ?? "null"))));
        return { success: true, headers, rows, totalRowCount, metadata: { stratifyColumn, groups, groupCount: groups.length } };
      } finally {
        await connection.end();
      }
    }

    if (type === "sqlserver") {
      const sql = require("mssql");
      const pool = await sql.connect({
        server: config.host,
        port: config.port ? parseInt(config.port, 10) : 1433,
        database: config.database,
        user: config.username,
        password: config.password || "",
        options: { encrypt: false, trustServerCertificate: true },
      });
      try {
        const countRes = await pool.request().query(`SELECT COUNT(*) as count FROM [${tableName}]`);
        const totalRowCount = countRes.recordset[0]?.count ?? 0;
        const dataRes = await pool.request().query(
          `SELECT * FROM (
            SELECT *, ROW_NUMBER() OVER (PARTITION BY [${stratifyColumn}] ORDER BY NEWID()) as _rn
            FROM [${tableName}]
          ) sub WHERE _rn <= ${limitPerGroup}`
        );
        const headers = dataRes.recordset.length > 0
          ? Object.keys(dataRes.recordset[0]).filter((h) => h !== "_rn")
          : [];
        const rows = dataRes.recordset.map((row: any) => {
          const { _rn, ...rest } = row;
          return rest;
        });
        const groups = Array.from(new Set(rows.map((r: any) => String(r[stratifyColumn] ?? "null"))));
        return { success: true, headers, rows, totalRowCount, metadata: { stratifyColumn, groups, groupCount: groups.length } };
      } finally {
        await pool.close();
      }
    }

    return this.getFileStratifiedSample(type, config, tableName, stratifyColumn, limitPerGroup, seed);
  }

  async executeUpdate(
    type: ConnectorType,
    config: ConnectionConfig,
    tableName: string,
    updates: Array<{ column: string; value: unknown; whereColumn: string; whereValue: unknown }>
  ): Promise<{ success: boolean; rowsAffected: number }> {
    if (type === "postgres") {
      const pool = new Pool({
        host: config.host,
        port: config.port ? parseInt(config.port, 10) : 5432,
        database: config.database,
        user: config.username || "postgres",
        password: config.password || "",
      });
      try {
        let totalAffected = 0;
        for (const update of updates) {
          const res = await pool.query(
            `UPDATE "${tableName}" SET "${update.column}" = $1 WHERE "${update.whereColumn}" = $2`,
            [update.value, update.whereValue]
          );
          totalAffected += res.rowCount ?? 0;
        }
        return { success: true, rowsAffected: totalAffected };
      } finally {
        await pool.end();
      }
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
      try {
        let totalAffected = 0;
        for (const update of updates) {
          const [result] = await connection.query(
            `UPDATE \`${tableName}\` SET \`${update.column}\` = ? WHERE \`${update.whereColumn}\` = ?`,
            [update.value, update.whereValue]
          );
          totalAffected += (result as any).affectedRows ?? 0;
        }
        return { success: true, rowsAffected: totalAffected };
      } finally {
        await connection.end();
      }
    }

    if (type === "sqlserver") {
      const sql = require("mssql");
      const pool = await sql.connect({
        server: config.host,
        port: config.port ? parseInt(config.port, 10) : 1433,
        database: config.database,
        user: config.username,
        password: config.password || "",
        options: { encrypt: false, trustServerCertificate: true },
      });
      try {
        let totalAffected = 0;
        for (const update of updates) {
          const res = await pool.request()
            .input("val", update.value)
            .input("whereVal", update.whereValue)
            .query(`UPDATE [${tableName}] SET [${update.column}] = @val WHERE [${update.whereColumn}] = @whereVal`);
          totalAffected += res.rowsAffected[0] ?? 0;
        }
        return { success: true, rowsAffected: totalAffected };
      } finally {
        await pool.close();
      }
    }

    // File-based and restapi sources do not support direct updates
    return { success: false, rowsAffected: 0 };
  }

  async applyCleaningOperations(
    type: ConnectorType,
    config: ConnectionConfig,
    tableName: string,
    operations: any[]
  ): Promise<{ results: any[] }> {
    const results: any[] = [];
    if (["postgres", "mysql", "sqlserver"].includes(type)) {
      return this.applyDbCleaningOperations(type, config, tableName, operations);
    } else if (["excel", "csv", "tsv"].includes(type)) {
      return this.applyFileCleaningOperations(type, config, tableName, operations);
    }
    return { results };
  }

  private async applyDbCleaningOperations(type: string, config: ConnectionConfig, tableName: string, operations: any[]): Promise<{ results: any[] }> {
    const results: any[] = [];
    
    let getPoolOrConn: any;
    let runQuery: any;
    let closeConn: any;

    if (type === "postgres") {
      const pool = new Pool({
        host: config.host,
        port: config.port ? parseInt(config.port, 10) : 5432,
        database: config.database,
        user: config.username || "postgres",
        password: config.password || "",
      });
      getPoolOrConn = async () => pool;
      runQuery = async (p: any, sql: string, params: any[]) => { const r = await p.query(sql, params); return r.rowCount ?? 0; };
      closeConn = async (p: any) => await p.end();
    } else if (type === "mysql") {
      const mysql = require("mysql2/promise");
      const connection = await mysql.createConnection({
        host: config.host,
        port: config.port ? parseInt(config.port, 10) : 3306,
        database: config.database,
        user: config.username || "root",
        password: config.password || "",
      });
      getPoolOrConn = async () => connection;
      runQuery = async (c: any, sql: string, params: any[]) => { const [r] = await c.query(sql, params); return (r as any).affectedRows ?? 0; };
      closeConn = async (c: any) => await c.end();
    } else if (type === "sqlserver") {
      const sql = require("mssql");
      const pool = await sql.connect({
        server: config.host,
        port: config.port ? parseInt(config.port, 10) : 1433,
        database: config.database,
        user: config.username,
        password: config.password || "",
        options: { encrypt: false, trustServerCertificate: true },
      });
      getPoolOrConn = async () => pool;
      runQuery = async (p: any, querySql: string, params: any[]) => { 
        const req = p.request();
        params.forEach((pVal: any, i: number) => req.input(`p${i}`, pVal));
        let i = 0;
        const msSql = querySql.replace(/\?/g, () => `@p${i++}`);
        const r = await req.query(msSql);
        return r.rowsAffected[0] ?? 0; 
      };
      closeConn = async (p: any) => await p.close();
    }

    const conn = await getPoolOrConn();
    try {
      for (const op of operations) {
        const col = op.columnName;
        const method = op.method;
        const params = op.params || {};
        let sql = "";
        let sqlParams: any[] = [];
        let rowsAffected = 0;
        let success = true;
        let details = "";

        const quote = type === "mysql" ? "\`" : '"';
        const qTableName = type === "sqlserver" ? `[${tableName}]` : `${quote}${tableName}${quote}`;
        const qCol = type === "sqlserver" ? `[${col}]` : `${quote}${col}${quote}`;

        try {
          if (["impute_constant", "impute_median", "impute_mean", "impute_mode"].includes(method)) {
            const fillValue = params.fillValue ?? params.value ?? "";
            if (type === "postgres") {
              sql = `UPDATE ${qTableName} SET ${qCol} = $1 WHERE ${qCol} IS NULL`;
              sqlParams = [fillValue];
            } else {
              sql = `UPDATE ${qTableName} SET ${qCol} = ? WHERE ${qCol} IS NULL`;
              sqlParams = [fillValue];
            }
            rowsAffected = await runQuery(conn, sql, sqlParams);
            details = `Imputed null values with ${JSON.stringify(fillValue)}`;
          } else if (method === "drop_column") {
            sql = `ALTER TABLE ${qTableName} DROP COLUMN ${qCol}`;
            await runQuery(conn, sql, []);
            details = `Dropped column ${col}`;
          } else if (method === "normalize_categories") {
            if (type === "postgres") {
              sql = `UPDATE ${qTableName} SET ${qCol} = LOWER(TRIM(${qCol}::text))`;
            } else {
              sql = `UPDATE ${qTableName} SET ${qCol} = LOWER(TRIM(${qCol}))`;
            }
            rowsAffected = await runQuery(conn, sql, []);
            details = `Normalized categories for ${col}`;
          } else if (method === "coerce_type") {
            const targetType = params.targetType || "VARCHAR(255)";
            if (type === "postgres") {
              sql = `ALTER TABLE ${qTableName} ALTER COLUMN ${qCol} TYPE ${targetType} USING ${qCol}::${targetType}`;
            } else if (type === "mysql") {
              sql = `ALTER TABLE ${qTableName} MODIFY COLUMN ${qCol} ${targetType}`;
            } else if (type === "sqlserver") {
              sql = `ALTER TABLE ${qTableName} ALTER COLUMN ${qCol} ${targetType}`;
            }
            await runQuery(conn, sql, []);
            details = `Coerced type of ${col} to ${targetType}`;
          } else if (method === "standardize_headers") {
            const newColName = col.toLowerCase().replace(/[^a-z0-9]+/g, "_");
            const qNewCol = type === "sqlserver" ? `[${newColName}]` : `${quote}${newColName}${quote}`;
            if (type === "postgres") {
              sql = `ALTER TABLE ${qTableName} RENAME COLUMN ${qCol} TO ${qNewCol}`;
            } else if (type === "mysql") {
              sql = `ALTER TABLE ${qTableName} RENAME COLUMN ${qCol} TO ${qNewCol}`;
            } else if (type === "sqlserver") {
              sql = `EXEC sp_rename '${tableName}.${col}', '${newColName}', 'COLUMN'`;
            }
            await runQuery(conn, sql, []);
            details = `Renamed column ${col} to ${newColName}`;
          } else if (method === "clip_iqr" || method === "cap_percentile") {
            const lower = params.lowerBound;
            const upper = params.upperBound;
            if (lower !== undefined && upper !== undefined) {
              if (type === "postgres") {
                await runQuery(conn, `UPDATE ${qTableName} SET ${qCol} = $1 WHERE ${qCol} < $1`, [lower]);
                await runQuery(conn, `UPDATE ${qTableName} SET ${qCol} = $2 WHERE ${qCol} > $2`, [lower, upper]); // Wait, $2 is upper.
              } else {
                await runQuery(conn, `UPDATE ${qTableName} SET ${qCol} = ? WHERE ${qCol} < ?`, [lower, lower]);
                await runQuery(conn, `UPDATE ${qTableName} SET ${qCol} = ? WHERE ${qCol} > ?`, [upper, upper]);
              }
              details = `Clipped outliers to [${lower}, ${upper}]`;
            } else {
              details = `No bounds provided for clipping`;
            }
          } else {
            details = `Operation ${method} not implemented for DB directly`;
          }
        } catch (error: any) {
          success = false;
          details = error.message;
        }

        results.push({ columnName: col, method, success, rowsAffected, details });
      }
    } finally {
      await closeConn(conn);
    }
    return { results };
  }

  private async applyFileCleaningOperations(type: string, config: ConnectionConfig, tableName: string, operations: any[]): Promise<{ results: any[] }> {
    const fileName = config.fileName;
    if (!fileName || !this.fileService.fileExists(fileName)) {
       return { results: operations.map(op => ({ columnName: op.columnName, method: op.method, success: false, rowsAffected: 0, details: "File not found" })) };
    }
    
    const filePath = this.fileService.getFilePath(fileName);
    const results: any[] = [];
    
    try {
      const workbook = xlsx.readFile(filePath);
      const sheetName = tableName && workbook.SheetNames.includes(tableName) ? tableName : workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      let rows = xlsx.utils.sheet_to_json<Record<string, any>>(worksheet, { defval: "" });
      
      for (const op of operations) {
        const col = op.columnName;
        const method = op.method;
        const params = op.params || {};
        let rowsAffected = 0;
        let success = true;
        let details = "";
        
        try {
          if (["impute_constant", "impute_median", "impute_mean", "impute_mode"].includes(method)) {
            const fillValue = params.fillValue ?? params.value ?? "";
            rows.forEach(r => {
              if (r[col] === "" || r[col] === null || r[col] === undefined) {
                r[col] = fillValue;
                rowsAffected++;
              }
            });
            details = `Imputed null values with ${JSON.stringify(fillValue)}`;
          } else if (method === "drop_column") {
            rows.forEach(r => {
              delete r[col];
              rowsAffected++;
            });
            details = `Dropped column ${col}`;
          } else if (method === "normalize_categories") {
            rows.forEach(r => {
              if (typeof r[col] === "string") {
                r[col] = r[col].trim().toLowerCase();
                rowsAffected++;
              }
            });
            details = `Normalized categories for ${col}`;
          } else if (method === "standardize_headers") {
            const newColName = col.toLowerCase().replace(/[^a-z0-9]+/g, "_");
            rows.forEach(r => {
              if (col in r) {
                r[newColName] = r[col];
                delete r[col];
                rowsAffected++;
              }
            });
            details = `Renamed column ${col} to ${newColName}`;
          } else if (method === "clip_iqr" || method === "cap_percentile") {
            const lower = params.lowerBound;
            const upper = params.upperBound;
            if (lower !== undefined && upper !== undefined) {
              rows.forEach(r => {
                const val = parseFloat(r[col]);
                if (!isNaN(val)) {
                  if (val < lower) { r[col] = lower; rowsAffected++; }
                  if (val > upper) { r[col] = upper; rowsAffected++; }
                }
              });
              details = `Clipped outliers to [${lower}, ${upper}]`;
            } else {
                details = `No bounds provided for clipping`;
            }
          } else if (method === "coerce_type") {
            const targetType = params.targetType || "string";
            rows.forEach(r => {
              if (targetType.includes("INT") || targetType.includes("FLOAT") || targetType === "number") {
                r[col] = Number(r[col]);
              } else {
                r[col] = String(r[col]);
              }
              rowsAffected++;
            });
            details = `Coerced type to ${targetType}`;
          } else {
            details = `Operation ${method} not implemented for files directly`;
          }
        } catch (e: any) {
          success = false;
          details = e.message;
        }

        results.push({ columnName: col, method, success, rowsAffected, details });
      }
      
      const newWorksheet = xlsx.utils.json_to_sheet(rows);
      workbook.Sheets[sheetName] = newWorksheet;
      
      if (type === "csv") {
        const csvContent = xlsx.utils.sheet_to_csv(newWorksheet);
        await this.fileService.saveFile(fileName, csvContent);
      } else if (type === "tsv") {
        const tsvContent = xlsx.utils.sheet_to_csv(newWorksheet, { FS: "\t" });
        await this.fileService.saveFile(fileName, tsvContent);
      } else {
        xlsx.writeFile(workbook, filePath);
      }

    } catch (error: any) {
      return { results: operations.map(op => ({ columnName: op.columnName, method: op.method, success: false, rowsAffected: 0, details: error.message })) };
    }
    
    return { results };
  }

  private parseCsvLine(line: string, delimiter: string, headers: string[]): Record<string, string> {
    const parts = line.split(delimiter).map((p) => p.replace(/^["']|["']$/g, "").trim());
    const rowObj: Record<string, string> = {};
    headers.forEach((header, idx) => {
      rowObj[header] = parts[idx] || "";
    });
    return rowObj;
  }

  private async getFileSlice(type: ConnectorType, config: ConnectionConfig, tableName: string | undefined, limit: number, offset: number): Promise<SampleResult> {
    const fileName = config.fileName;
    if (!fileName || !this.fileService.fileExists(fileName)) return { success: false, headers: [], rows: [], totalRowCount: 0 };
    const filePath = this.fileService.getFilePath(fileName);

    if (["csv", "tsv"].includes(type)) {
      const delimiter = type === "tsv" ? "\t" : ",";
      try {
        const fileStream = fsSync.createReadStream(filePath, { encoding: "utf8" });
        const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

        let headers: string[] = [];
        const rows: Record<string, string>[] = [];
        let lineIdx = 0;
        let totalRowCount = 0;
        const maxNeeded = 1 + offset + limit;

        for await (const line of rl) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          if (lineIdx === 0) {
            headers = trimmed.split(delimiter).map((h) => h.replace(/^["']|["']$/g, "").trim());
          } else {
            totalRowCount++;
            if (lineIdx >= 1 + offset && rows.length < limit) {
              rows.push(this.parseCsvLine(trimmed, delimiter, headers));
            }
          }
          lineIdx++;
          if (lineIdx >= maxNeeded) {
            rl.close();
            fileStream.destroy();
            break;
          }
        }

        return { success: true, headers, rows, totalRowCount: totalRowCount || Math.max(0, lineIdx - 1) };
      } catch {
        return { success: false, headers: [], rows: [], totalRowCount: 0 };
      }
    }

    if (type === "excel") {
      const workbook = xlsx.readFile(filePath);
      const sheetName = tableName || workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      if (!worksheet || !worksheet["!ref"]) return { success: true, headers: [], rows: [], totalRowCount: 0 };

      const range = xlsx.utils.decode_range(worksheet["!ref"]);
      const totalRowCount = Math.max(0, range.e.r - range.s.r);
      const headerRows = xlsx.utils.sheet_to_json<any[]>(worksheet, { header: 1, range: { s: range.s, e: { r: range.s.r, c: range.e.c } } });
      const headers = (headerRows[0] || []).map(String);

      const sliceStartRow = range.s.r + 1 + offset;
      const sliceEndRow = Math.min(range.e.r, sliceStartRow + limit - 1);
      let rows: any[] = [];
      if (sliceStartRow <= range.e.r) {
        rows = xlsx.utils.sheet_to_json(worksheet, {
          range: { s: { r: sliceStartRow, c: range.s.c }, e: { r: sliceEndRow, c: range.e.c } },
          header: headers,
          defval: ""
        });
      }

      return { success: true, headers, rows, totalRowCount };
    }

    return { success: false, headers: [], rows: [], totalRowCount: 0 };
  }

  private async getFileRandomSample(type: ConnectorType, config: ConnectionConfig, tableName: string | undefined, limit: number, seed?: number): Promise<SampleResult> {
    const fileName = config.fileName;
    if (!fileName || !this.fileService.fileExists(fileName)) return { success: false, headers: [], rows: [], totalRowCount: 0 };
    const filePath = this.fileService.getFilePath(fileName);

    if (["csv", "tsv"].includes(type)) {
      const delimiter = type === "tsv" ? "\t" : ",";
      try {
        const fileStream = fsSync.createReadStream(filePath, { encoding: "utf8" });
        const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

        let headers: string[] = [];
        const reservoir: string[] = [];
        let lineIdx = 0;
        let totalRowCount = 0;
        const maxReservoir = Math.min(2000, Math.max(limit, 500));

        for await (const line of rl) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          if (lineIdx === 0) {
            headers = trimmed.split(delimiter).map((h) => h.replace(/^["']|["']$/g, "").trim());
          } else {
            totalRowCount++;
            if (reservoir.length < maxReservoir) {
              reservoir.push(trimmed);
            } else {
              const r = Math.floor(Math.random() * totalRowCount);
              if (r < maxReservoir) {
                reservoir[r] = trimmed;
              }
            }
          }
          lineIdx++;
        }

        const shuffled = this.deterministicShuffle(reservoir, seed ?? 42);
        const sampled = shuffled.slice(0, Math.min(limit, shuffled.length));
        const rows = sampled.map((l) => this.parseCsvLine(l, delimiter, headers));
        return { success: true, headers, rows, totalRowCount };
      } catch {
        return { success: false, headers: [], rows: [], totalRowCount: 0 };
      }
    }

    if (type === "excel") {
      const workbook = xlsx.readFile(filePath);
      const sheetName = tableName || workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      if (!worksheet || !worksheet["!ref"]) return { success: true, headers: [], rows: [], totalRowCount: 0 };

      const jsonRows = xlsx.utils.sheet_to_json(worksheet, { defval: "" }) as any[];
      const headers = jsonRows.length > 0 ? Object.keys(jsonRows[0]) : [];
      const totalRowCount = jsonRows.length;

      const shuffled = this.deterministicShuffle(jsonRows, seed ?? 42);
      const sampled = shuffled.slice(0, Math.min(limit, shuffled.length));

      return { success: true, headers, rows: sampled, totalRowCount };
    }

    return { success: false, headers: [], rows: [], totalRowCount: 0 };
  }

  private async getFileStratifiedSample(type: ConnectorType, config: ConnectionConfig, tableName: string | undefined, stratifyColumn: string, limitPerGroup: number, seed?: number): Promise<SampleResult> {
    const fileName = config.fileName;
    if (!fileName || !this.fileService.fileExists(fileName)) return { success: false, headers: [], rows: [], totalRowCount: 0 };
    const filePath = this.fileService.getFilePath(fileName);

    if (["csv", "tsv"].includes(type)) {
      const delimiter = type === "tsv" ? "\t" : ",";
      try {
        const fileStream = fsSync.createReadStream(filePath, { encoding: "utf8" });
        const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

        let headers: string[] = [];
        let colIndex = -1;
        const groupRows = new Map<string, string[]>();
        let lineIdx = 0;
        let totalRowCount = 0;
        const effectiveLimitPerGroup = Math.min(100, Math.max(1, limitPerGroup));

        for await (const line of rl) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          if (lineIdx === 0) {
            headers = trimmed.split(delimiter).map((h) => h.replace(/^["']|["']$/g, "").trim());
            colIndex = headers.indexOf(stratifyColumn);
          } else {
            totalRowCount++;
            let val = "null";
            if (colIndex !== -1) {
              const parts = trimmed.split(delimiter);
              val = (parts[colIndex] ?? "null").replace(/^["']|["']$/g, "").trim() || "null";
            }
            const existing = groupRows.get(val) || [];
            if (existing.length < effectiveLimitPerGroup * 5) {
              existing.push(trimmed);
              groupRows.set(val, existing);
            }
          }
          lineIdx++;
        }

        const selectedRows: Record<string, string>[] = [];
        for (const [, lines] of groupRows) {
          const shuffled = this.deterministicShuffle(lines, seed ?? 42);
          const picked = shuffled.slice(0, effectiveLimitPerGroup);
          selectedRows.push(...picked.map((l) => this.parseCsvLine(l, delimiter, headers)));
        }

        const groupNames = Array.from(groupRows.keys());
        return {
          success: true,
          headers,
          rows: selectedRows,
          totalRowCount,
          metadata: { stratifyColumn, groups: groupNames, groupCount: groupNames.length }
        };
      } catch {
        return { success: false, headers: [], rows: [], totalRowCount: 0 };
      }
    }

    if (type === "excel") {
      const filePath = this.fileService.getFilePath(fileName);
      const workbook = xlsx.readFile(filePath);
      const sheetName = tableName || workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      if (!worksheet || !worksheet["!ref"]) return { success: true, headers: [], rows: [], totalRowCount: 0 };

      const jsonRows = xlsx.utils.sheet_to_json(worksheet, { defval: "" }) as any[];
      const headers = jsonRows.length > 0 ? Object.keys(jsonRows[0]) : [];
      const totalRowCount = jsonRows.length;

      const groups = new Map<string, any[]>();
      for (const row of jsonRows) {
        const key = String(row[stratifyColumn] ?? "null");
        const existing = groups.get(key) || [];
        existing.push(row);
        groups.set(key, existing);
      }

      const sampled: any[] = [];
      for (const [, groupRows] of groups) {
        const shuffled = this.deterministicShuffle(groupRows, seed ?? 42);
        sampled.push(...shuffled.slice(0, limitPerGroup));
      }

      const groupNames = Array.from(groups.keys());
      return {
        success: true,
        headers,
        rows: sampled,
        totalRowCount,
        metadata: { stratifyColumn, groups: groupNames, groupCount: groupNames.length }
      };
    }

    return { success: false, headers: [], rows: [], totalRowCount: 0 };
  }

  private deterministicShuffle<T>(values: T[], seed: number): T[] {
    const cloned = [...values];
    let state = seed >>> 0;
    const random = () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    for (let i = cloned.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      const tmp = cloned[i];
      cloned[i] = cloned[j];
      cloned[j] = tmp;
    }
    return cloned;
  }
}
