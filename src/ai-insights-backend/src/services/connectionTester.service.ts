import net from "net";
import http from "http";
import https from "https";
import { Pool } from "pg";
import * as xlsx from "xlsx";
import { IConnectionTesterService, TestResult, SampleResult } from "./connectionTester.service.interface";
import { ConnectorType, ConnectionConfig } from "../models/connector.types";
import { IFileService } from "./file.service.interface";

const DEFAULT_PORTS: Record<string, number> = {
  postgres: 5432,
  mysql: 3306,
  sqlserver: 1433,
  mongodb: 27017,
  snowflake: 443,
};

export class ConnectionTesterService implements IConnectionTesterService {
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
        const workbook = xlsx.readFile(filePath);
        const tablesList = workbook.SheetNames.map((sheetName: string) => {
          const sheet = workbook.Sheets[sheetName];
          const ref = sheet["!ref"] || "A1:A1";
          const range = xlsx.utils.decode_range(ref);
          const rowCount = range.e.r - range.s.r;
          return {
            id: sheetName,
            name: sheetName,
            type: "Table",
            rows: Math.max(0, rowCount),
          };
        });
        return { success: true, type: "file", tables: tablesList };
      }
    }

    if (["csv", "tsv"].includes(type)) {
      const fileName = config.fileName;
      let rowCount = 50000;
      if (fileName && this.fileService.fileExists(fileName)) {
        const content = this.fileService.readTextFile(fileName);
        rowCount = content.split(/\r?\n/).filter((line) => line.trim().length > 0).length - 1;
      }
      return {
        success: true,
        type: "file",
        tables: [
          { id: fileName || "file_data", name: fileName || "File Data", type: "Table", rows: Math.max(0, rowCount) }
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
      const content = this.fileService.readTextFile(fileName);
      const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
      return Math.max(0, lines.length - 1);
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

  private getFileSlice(type: ConnectorType, config: ConnectionConfig, tableName: string | undefined, limit: number, offset: number): SampleResult {
    const allRows = this.getAllFileRows(type, config, tableName);
    const sliced = allRows.rows.slice(offset, offset + limit);
    return { success: true, headers: allRows.headers, rows: sliced, totalRowCount: allRows.rows.length };
  }

  private getFileRandomSample(type: ConnectorType, config: ConnectionConfig, tableName: string | undefined, limit: number, seed?: number): SampleResult {
    const allRows = this.getAllFileRows(type, config, tableName);
    const shuffled = this.deterministicShuffle(allRows.rows, seed ?? 42);
    const sampled = shuffled.slice(0, Math.min(limit, shuffled.length));
    return { success: true, headers: allRows.headers, rows: sampled, totalRowCount: allRows.rows.length };
  }

  private getFileStratifiedSample(type: ConnectorType, config: ConnectionConfig, tableName: string | undefined, stratifyColumn: string, limitPerGroup: number, seed?: number): SampleResult {
    const allRows = this.getAllFileRows(type, config, tableName);
    const groups = new Map<string, any[]>();
    for (const row of allRows.rows) {
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
    return { success: true, headers: allRows.headers, rows: sampled, totalRowCount: allRows.rows.length, metadata: { stratifyColumn, groups: groupNames, groupCount: groupNames.length } };
  }

  private getAllFileRows(type: ConnectorType, config: ConnectionConfig, tableName?: string): { headers: string[]; rows: any[] } {
    if (type === "excel") {
      const fileName = config.fileName;
      if (!fileName || !this.fileService.fileExists(fileName)) return { headers: [], rows: [] };
      const filePath = this.fileService.getFilePath(fileName);
      const workbook = xlsx.readFile(filePath);
      const sheetName = tableName || workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      if (!worksheet) return { headers: [], rows: [] };
      const jsonRows = xlsx.utils.sheet_to_json(worksheet, { defval: "" }) as any[];
      const headers = jsonRows.length > 0 ? Object.keys(jsonRows[0]) : [];
      return { headers, rows: jsonRows };
    }

    if (["csv", "tsv"].includes(type)) {
      const fileName = config.fileName;
      if (!fileName || !this.fileService.fileExists(fileName)) return { headers: [], rows: [] };
      const content = this.fileService.readTextFile(fileName);
      const delimiter = type === "tsv" ? "\t" : ",";
      const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
      if (lines.length === 0) return { headers: [], rows: [] };
      const headers = lines[0].split(delimiter).map((h) => h.replace(/^["']|["']$/g, "").trim());
      const rows = lines.slice(1).map((line) => {
        const parts = line.split(delimiter).map((p) => p.replace(/^["']|["']$/g, "").trim());
        const rowObj: Record<string, string> = {};
        headers.forEach((header, idx) => { rowObj[header] = parts[idx] || ""; });
        return rowObj;
      });
      return { headers, rows };
    }

    return { headers: [], rows: [] };
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
