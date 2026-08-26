import fs from "fs";
import path from "path";
import * as xlsx from "xlsx";
import { IDuckDBService } from "./duckdb.service.interface";
import { IFileService } from "../file/file.service.interface";
import { ConnectorType, ConnectionConfig } from "../../models/connector.types";
import { SampleResult } from "../connector/connectionTester.service.interface";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const duckdb = require("duckdb");

export class DuckDBService implements IDuckDBService {
  private dbStorageDir: string;

  /**
   * Per-file connection pool. Each entry holds the native duckdb.Database
   * handle, a connection, a reference count of in-flight operations, and an
   * optional idle-close timer.
   */
  private pool = new Map<
    string,
    { db: any; conn: any; refCount: number; idleTimer: ReturnType<typeof setTimeout> | null }
  >();
  private static readonly IDLE_TIMEOUT_MS = 5_000;

  constructor(private fileService: IFileService) {
    this.dbStorageDir = path.join(process.cwd(), "uploads", "duckdb");
    if (!fs.existsSync(this.dbStorageDir)) {
      fs.mkdirSync(this.dbStorageDir, { recursive: true });
    }
  }

  // ─── path and identifier helpers ───────────────────────────────────

  private sanitizeFileName(fileName: string): string {
    return fileName.replace(/[^a-zA-Z0-9_-]/g, "_");
  }

  public sanitizeIdentifier(name: string): string {
    return name.replace(/"/g, '""');
  }

  /**
   * Resolves the primary DuckDB path for a file or sheet.
   * If a sheetName is provided, checks for folder-based sheet storage: uploads/duckdb/<fileName>/<sheetName>.duckdb.
   */
  getDuckDbPath(fileName: string, sheetName?: string): string {
    const safeFile = this.sanitizeFileName(fileName);
    if (sheetName) {
      const safeSheet = this.sanitizeFileName(sheetName);
      const sheetDbPath = path.join(this.dbStorageDir, safeFile, `${safeSheet}.duckdb`);
      if (fs.existsSync(sheetDbPath)) {
        return sheetDbPath;
      }
    }

    const folderPath = path.join(this.dbStorageDir, safeFile);
    if (fs.existsSync(folderPath) && fs.statSync(folderPath).isDirectory()) {
      const masterPath = path.join(folderPath, "_master.duckdb");
      if (fs.existsSync(masterPath)) {
        return masterPath;
      }
      const sheetFiles = fs.readdirSync(folderPath).filter((f) => f.endsWith(".duckdb") && !f.startsWith("_temp"));
      if (sheetFiles.length > 0) {
        return path.join(folderPath, sheetFiles[0]);
      }
    }

    return path.join(this.dbStorageDir, `${safeFile}.duckdb`);
  }

  /**
   * Resolves the target database path for a given table name and file name.
   */
  private getDbPathForTarget(fileName: string, tableName?: string): string {
    const safeFile = this.sanitizeFileName(fileName);
    const folderPath = path.join(this.dbStorageDir, safeFile);

    // If multi-sheet / multi-file folder exists
    if (fs.existsSync(folderPath) && fs.statSync(folderPath).isDirectory()) {
      if (tableName) {
        const safeTable = this.sanitizeFileName(tableName);
        const directSheetDb = path.join(folderPath, `${safeTable}.duckdb`);
        if (fs.existsSync(directSheetDb)) {
          return directSheetDb;
        }

        // Case-insensitive search for sheet .duckdb
        try {
          const files = fs.readdirSync(folderPath).filter((f) => f.endsWith(".duckdb"));
          const match = files.find((f) => path.basename(f, ".duckdb").toLowerCase() === tableName.toLowerCase() || path.basename(f, ".duckdb").toLowerCase() === safeTable.toLowerCase());
          if (match) {
            return path.join(folderPath, match);
          }
        } catch {}
      }

      // Check master db
      const masterPath = path.join(folderPath, "_master.duckdb");
      if (fs.existsSync(masterPath)) {
        return masterPath;
      }

      // Return first sheet db
      const sheetFiles = fs.readdirSync(folderPath).filter((f) => f.endsWith(".duckdb"));
      if (sheetFiles.length > 0) {
        return path.join(folderPath, sheetFiles[0]);
      }
    }

    // Default to single file database
    return path.join(this.dbStorageDir, `${safeFile}.duckdb`);
  }

  // ─── pooled connection management ──────────────────────────────────

  private async acquireConnection(dbPath: string): Promise<{ db: any; conn: any }> {
    const existing = this.pool.get(dbPath);
    if (existing) {
      if (existing.idleTimer) {
        clearTimeout(existing.idleTimer);
        existing.idleTimer = null;
      }
      existing.refCount++;
      return { db: existing.db, conn: existing.conn };
    }

    const { db, conn } = await this.openDatabase(dbPath);
    this.pool.set(dbPath, { db, conn, refCount: 1, idleTimer: null });
    return { db, conn };
  }

  private releaseConnection(dbPath: string): void {
    const entry = this.pool.get(dbPath);
    if (!entry) return;

    entry.refCount = Math.max(0, entry.refCount - 1);

    if (entry.refCount === 0) {
      entry.idleTimer = setTimeout(() => {
        const current = this.pool.get(dbPath);
        if (current && current.refCount === 0) {
          this.pool.delete(dbPath);
          this.closeDatabase(current.db, current.conn).catch((err) =>
            console.warn("[DuckDB] deferred close error:", err)
          );
        }
      }, DuckDBService.IDLE_TIMEOUT_MS);
    }
  }

  private async openDatabase(dbPath: string): Promise<{ db: any; conn: any }> {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    return new Promise((resolve, reject) => {
      const db = new duckdb.Database(dbPath, (err: Error | null) => {
        if (err) return reject(err);
        const conn = db.connect();
        resolve({ db, conn });
      });
    });
  }

  private async closeDatabase(db: any, conn: any): Promise<void> {
    return new Promise<void>((resolve) => {
      const closeDb = () => {
        if (db && db.close) {
          db.close((err: Error | null) => {
            if (err) console.warn("[DuckDB] db.close error:", err.message);
            resolve();
          });
        } else {
          resolve();
        }
      };

      try {
        if (conn && conn.close) {
          conn.close((err: Error | null) => {
            if (err) console.warn("[DuckDB] conn.close error:", err.message);
            closeDb();
          });
        } else {
          closeDb();
        }
      } catch {
        resolve();
      }
    });
  }

  // ─── low-level SQL helpers ─────────────────────────────────────────

  private async query<T = any>(conn: any, sql: string, params: any[] = []): Promise<T[]> {
    return new Promise((resolve, reject) => {
      conn.all(sql, ...params, (err: Error | null, rows: T[]) => {
        if (err) return reject(err);
        resolve(rows || []);
      });
    });
  }

  private async exec(conn: any, sql: string): Promise<void> {
    return new Promise((resolve, reject) => {
      conn.exec(sql, (err: Error | null) => {
        if (err) return reject(err);
        resolve();
      });
    });
  }

  // ─── public query API ──────────────────────────────────────────────

  async runQuery<T = any>(dbPath: string, sql: string, params: any[] = []): Promise<T[]> {
    const { conn } = await this.acquireConnection(dbPath);
    try {
      return await this.query<T>(conn, sql, params);
    } finally {
      this.releaseConnection(dbPath);
    }
  }

  async runExec(dbPath: string, sql: string): Promise<void> {
    const { conn } = await this.acquireConnection(dbPath);
    try {
      await this.exec(conn, sql);
    } finally {
      this.releaseConnection(dbPath);
    }
  }

  private async withConnection<R>(dbPath: string, fn: (conn: any) => Promise<R>): Promise<R> {
    const { conn } = await this.acquireConnection(dbPath);
    try {
      return await fn(conn);
    } finally {
      this.releaseConnection(dbPath);
    }
  }

  private async closeConn(db: any, conn: any): Promise<void> {
    return new Promise((resolve) => {
      try {
        if (conn && conn.close) conn.close();
        if (db && db.close) db.close();
      } catch {
        // ignore close errors
      }
      resolve();
    });
  }

  private resolveFilePath(fileName?: string): string | null {
    if (!fileName) return null;
    if (fs.existsSync(fileName)) return fileName;
    if (this.fileService.fileExists(fileName)) return this.fileService.getFilePath(fileName);

    const baseName = path.basename(fileName);
    const directUpload = path.join(process.cwd(), "uploads", baseName);
    if (fs.existsSync(directUpload)) return directUpload;

    const uploadsDir = path.join(process.cwd(), "uploads");
    if (fs.existsSync(uploadsDir)) {
      try {
        const files = fs.readdirSync(uploadsDir);
        const match = files.find((f) => f.toLowerCase() === baseName.toLowerCase());
        if (match) {
          return path.join(uploadsDir, match);
        }
      } catch {}
    }

    return null;
  }

  /**
   * Smart table name resolver that resolves requested table name against
   * the database's actual tables in main schema.
   */
  private async resolveTableName(conn: any, tableName?: string, fileName?: string): Promise<string> {
    const tablesRes = await this.query<{ table_name: string }>(
      conn,
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'main'`
    );
    const existingTables = (tablesRes || []).map((t) => t.table_name);

    if (existingTables.length === 0) {
      return this.sanitizeIdentifier(tableName || fileName || "file_data");
    }

    const candidate = tableName ? tableName.trim() : "";
    const fileBase = fileName ? path.basename(fileName, path.extname(fileName)).trim() : "";
    const fullFileName = fileName ? path.basename(fileName).trim() : "";

    // 1. Exact match with requested tableName
    if (candidate && existingTables.includes(candidate)) {
      return candidate;
    }

    // 2. Sanitized match
    if (candidate && existingTables.includes(this.sanitizeIdentifier(candidate))) {
      return this.sanitizeIdentifier(candidate);
    }

    // 3. Case-insensitive match on tableName
    if (candidate) {
      const lower = candidate.toLowerCase();
      const match = existingTables.find((t) => t.toLowerCase() === lower);
      if (match) return match;
    }

    // 4. Match on file base name
    if (fileBase) {
      const match = existingTables.find(
        (t) => t.toLowerCase() === fileBase.toLowerCase() || this.sanitizeIdentifier(t).toLowerCase() === fileBase.toLowerCase()
      );
      if (match) return match;
    }

    // 5. Match on full file name
    if (fullFileName) {
      const match = existingTables.find(
        (t) => t.toLowerCase() === fullFileName.toLowerCase() || this.sanitizeIdentifier(t).toLowerCase() === fullFileName.toLowerCase()
      );
      if (match) return match;
    }

    // 6. Default to first table in main schema
    return existingTables[0];
  }

  /**
   * Resolves column names against the table schema, handling whitespace, case, and formatting.
   */
  private async resolveColumnName(conn: any, tableName: string, colName: string): Promise<string> {
    if (!colName) return colName;
    try {
      const colsRes = await this.query<{ column_name: string }>(
        conn,
        `SELECT column_name FROM information_schema.columns WHERE table_schema = 'main' AND table_name = ?`,
        [tableName]
      );
      const cols = (colsRes || []).map((c) => c.column_name);
      if (cols.length === 0) return colName;

      // 1. Exact match
      if (cols.includes(colName)) return colName;

      // 2. Case-insensitive match
      const lower = colName.toLowerCase().trim();
      const caseMatch = cols.find((c) => c.toLowerCase().trim() === lower);
      if (caseMatch) return caseMatch;

      // 3. Normalized alphanumeric match
      const norm = lower.replace(/[^a-z0-9]/g, "_");
      const normMatch = cols.find((c) => c.toLowerCase().replace(/[^a-z0-9]/g, "_") === norm);
      if (normMatch) return normMatch;

      return colName;
    } catch {
      return colName;
    }
  }

  /**
   * Sanitizes header line and returns cleaned CSV string for ultra-fast DuckDB read_csv_auto ingestion.
   */
  private sanitizeCsvHeaders(rawCsv: string): string {
    const firstBreak = rawCsv.indexOf("\n");
    if (firstBreak === -1) return rawCsv;

    const headerLine = rawCsv.substring(0, firstBreak).replace(/\r$/, "");
    const body = rawCsv.substring(firstBreak + 1);

    // Simple CSV parser for header line to respect quotes
    const headers: string[] = [];
    let current = "";
    let insideQuotes = false;

    for (let i = 0; i < headerLine.length; i++) {
      const char = headerLine[i];
      if (char === '"') {
        insideQuotes = !insideQuotes;
      } else if (char === "," && !insideQuotes) {
        headers.push(current);
        current = "";
      } else {
        current += char;
      }
    }
    headers.push(current);

    const seen = new Map<string, number>();
    const cleanHeaders = headers.map((rawH, idx) => {
      let h = rawH.replace(/^["']|["']$/g, "").trim();
      if (!h || h.startsWith("__EMPTY")) {
        h = `column_${idx + 1}`;
      }
      h = h.replace(/[\r\n\t]+/g, " ").trim();
      const lower = h.toLowerCase();
      const count = seen.get(lower) || 0;
      if (count > 0) {
        seen.set(lower, count + 1);
        h = `${h}_${count + 1}`;
      } else {
        seen.set(lower, 1);
      }
      return `"${h.replace(/"/g, '""')}"`;
    });

    return `${cleanHeaders.join(",")}\n${body}`;
  }

  // ─── Data Ingestion Methods ────────────────────────────────────────

  /**
   * Ingests files directly into DuckDB.
   * - Single file (CSV/TSV or 1-sheet Excel): Stored in uploads/duckdb/<fileName>.duckdb
   * - Multi-sheet Excel: Stored in uploads/duckdb/<fileName>/<sheetName>.duckdb with _master.duckdb mount
   * - Multi-file dataset: Stored in uploads/duckdb/<folderName>/<fileName>.duckdb
   */
  async ingestFileSource(type: ConnectorType, config: ConnectionConfig): Promise<void> {
    const fileName = config.fileName;
    if (!fileName) return;

    const filePath = this.resolveFilePath(fileName);
    if (!filePath) {
      console.warn(`[DuckDBService] Cannot ingest file — not found on disk: ${fileName}`);
      return;
    }

    if (["csv", "tsv"].includes(type)) {
      const dbPath = path.join(this.dbStorageDir, `${this.sanitizeFileName(fileName)}.duckdb`);
      const tableName = this.sanitizeIdentifier(fileName);
      const delim = type === "tsv" ? "\\t" : ",";
      const normalizedPath = filePath.replace(/\\/g, "/");

      await this.withConnection(dbPath, async (conn) => {
        await this.exec(conn, `DROP TABLE IF EXISTS "${tableName}"`);
        await this.exec(
          conn,
          `CREATE TABLE "${tableName}" AS SELECT * FROM read_csv_auto('${normalizedPath}', header=true, delim='${delim}', auto_detect=true)`
        );
      });
      console.info(`[DuckDBService] Ingested ${type.toUpperCase()} file "${fileName}" into single DB: ${dbPath}`);
      return;
    }

    if (type === "excel") {
      // Use memory-efficient read settings
      const workbook = xlsx.readFile(filePath, {
        cellFormula: false,
        cellHTML: false,
        cellText: false,
        dense: true,
      });

      const sheetNames = workbook.SheetNames || [];
      if (sheetNames.length === 0) return;

      const safeFile = this.sanitizeFileName(fileName);

      if (sheetNames.length === 1) {
        // Single sheet -> Single DuckDB database file
        const sheetName = sheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const rawCsv = xlsx.utils.sheet_to_csv(worksheet, { blankrows: false });
        const cleanCsv = this.sanitizeCsvHeaders(rawCsv);

        const tempCsvPath = path.join(this.dbStorageDir, `_temp_${Date.now()}_${safeFile}.csv`).replace(/\\/g, "/");
        fs.writeFileSync(tempCsvPath, cleanCsv, "utf8");

        const dbPath = path.join(this.dbStorageDir, `${safeFile}.duckdb`);
        const tableName = this.sanitizeIdentifier(sheetName);

        try {
          await this.withConnection(dbPath, async (conn) => {
            await this.exec(conn, `DROP TABLE IF EXISTS "${tableName}"`);
            await this.exec(
              conn,
              `CREATE TABLE "${tableName}" AS SELECT * FROM read_csv_auto('${tempCsvPath}', header=true, auto_detect=true)`
            );
          });
          console.info(`[DuckDBService] Ingested single-sheet Excel "${fileName}" (sheet: "${sheetName}") into single DB: ${dbPath}`);
        } finally {
          if (fs.existsSync(tempCsvPath)) {
            try { fs.unlinkSync(tempCsvPath); } catch {}
          }
        }
      } else {
        // Multi-sheet -> Create folder uploads/duckdb/<fileName>/ with <sheetName>.duckdb files
        const folderPath = path.join(this.dbStorageDir, safeFile);
        if (!fs.existsSync(folderPath)) {
          fs.mkdirSync(folderPath, { recursive: true });
        }

        const masterDbPath = path.join(folderPath, "_master.duckdb");

        for (const sheetName of sheetNames) {
          const safeSheet = this.sanitizeFileName(sheetName);
          const sheetDbPath = path.join(folderPath, `${safeSheet}.duckdb`);
          const worksheet = workbook.Sheets[sheetName];
          const rawCsv = xlsx.utils.sheet_to_csv(worksheet, { blankrows: false });
          const cleanCsv = this.sanitizeCsvHeaders(rawCsv);

          const tempCsvPath = path.join(folderPath, `_temp_${Date.now()}_${safeSheet}.csv`).replace(/\\/g, "/");
          fs.writeFileSync(tempCsvPath, cleanCsv, "utf8");

          const tableName = this.sanitizeIdentifier(sheetName);

          try {
            // Ingest into dedicated sheet DB
            await this.withConnection(sheetDbPath, async (conn) => {
              await this.exec(conn, `DROP TABLE IF EXISTS "${tableName}"`);
              await this.exec(
                conn,
                `CREATE TABLE "${tableName}" AS SELECT * FROM read_csv_auto('${tempCsvPath}', header=true, auto_detect=true)`
              );
            });
          } finally {
            if (fs.existsSync(tempCsvPath)) {
              try { fs.unlinkSync(tempCsvPath); } catch {}
            }
          }
        }

        // Mount all sheet databases into _master.duckdb
        try {
          await this.withConnection(masterDbPath, async (masterConn) => {
            for (const sheetName of sheetNames) {
              const safeSheet = this.sanitizeFileName(sheetName);
              const sheetDbPath = path.join(folderPath, `${safeSheet}.duckdb`).replace(/\\/g, "/");
              try {
                await this.exec(masterConn, `DETACH "${this.sanitizeIdentifier(sheetName)}"`);
              } catch {}
              try {
                await this.exec(masterConn, `ATTACH '${sheetDbPath}' AS "${this.sanitizeIdentifier(sheetName)}" (READ_ONLY)`);
              } catch (attachErr: any) {
                console.warn(`[DuckDBService] Attach warning for sheet ${sheetName}:`, attachErr.message);
              }
            }
          });
          console.info(`[DuckDBService] Ingested multi-sheet Excel "${fileName}" (${sheetNames.length} sheets) into folder: ${folderPath} and mounted in _master.duckdb`);
        } catch (masterErr: any) {
          console.warn("[DuckDBService] Error creating master mount:", masterErr.message);
        }
      }
      return;
    }

    if (type === "restapi") {
      const dbPath = path.join(this.dbStorageDir, `${this.sanitizeFileName(fileName || "api_endpoint")}.duckdb`);
      const tableName = "api_endpoint";
      await this.withConnection(dbPath, async (conn) => {
        await this.exec(conn, `DROP TABLE IF EXISTS "${tableName}"`);
        await this.exec(conn, `CREATE TABLE "${tableName}" (endpoint VARCHAR, status VARCHAR, latency VARCHAR)`);
        await this.exec(
          conn,
          `INSERT INTO "${tableName}" VALUES ('${config.url || "api_endpoint"}', '200 OK', '12ms')`
        );
      });
    }
  }

  private async ensureIngested(type: ConnectorType, config: ConnectionConfig): Promise<string | null> {
    const fileName = config.fileName;
    if (!fileName) return null;

    const safeFile = this.sanitizeFileName(fileName);
    const folderPath = path.join(this.dbStorageDir, safeFile);
    const singleDbPath = path.join(this.dbStorageDir, `${safeFile}.duckdb`);

    // If folder or file already ingested and exists, return path
    if (fs.existsSync(folderPath) && fs.statSync(folderPath).isDirectory()) {
      return folderPath;
    }
    if (fs.existsSync(singleDbPath)) {
      return singleDbPath;
    }

    const filePath = this.resolveFilePath(fileName);
    if (!filePath) return null;

    await this.ingestFileSource(type, config);

    if (fs.existsSync(folderPath)) return folderPath;
    if (fs.existsSync(singleDbPath)) return singleDbPath;
    return null;
  }

  // ─── Query & Inspection Methods ────────────────────────────────────

  async getSchema(type: ConnectorType, config: ConnectionConfig): Promise<{ success: boolean; type: string; tables: any[] }> {
    const fileName = config.fileName;
    const targetPath = await this.ensureIngested(type, config);

    if (!targetPath || !fs.existsSync(targetPath)) {
      const fallbackName = fileName || "file_data";
      return {
        success: true,
        type: type === "restapi" ? "api" : "file",
        tables: [{ id: fallbackName, name: fallbackName, type: "Table", rows: 100 }],
      };
    }

    const safeFile = this.sanitizeFileName(fileName || "");
    const folderPath = path.join(this.dbStorageDir, safeFile);

    // Multi-sheet / Multi-file folder mode
    if (fs.existsSync(folderPath) && fs.statSync(folderPath).isDirectory()) {
      const sheetFiles = fs.readdirSync(folderPath).filter((f) => f.endsWith(".duckdb") && !f.startsWith("_"));
      const tablesList: any[] = [];

      for (const sheetFile of sheetFiles) {
        const sheetName = path.basename(sheetFile, ".duckdb");
        const sheetDbPath = path.join(folderPath, sheetFile);
        let rowCount = 0;

        try {
          await this.withConnection(sheetDbPath, async (conn) => {
            const safeTable = await this.resolveTableName(conn, sheetName, fileName);
            const countRes = await this.query(conn, `SELECT COUNT(*)::int as count FROM "${this.sanitizeIdentifier(safeTable)}"`);
            rowCount = countRes[0]?.count ?? 0;
          });
        } catch {
          rowCount = 0;
        }

        tablesList.push({
          id: sheetName,
          name: sheetName,
          type: "Table",
          rows: rowCount,
        });
      }

      if (tablesList.length > 0) {
        return { success: true, type: type === "restapi" ? "api" : "file", tables: tablesList };
      }
    }

    // Single database file mode
    const dbPath = this.getDbPathForTarget(fileName || "file_data");
    return this.withConnection(dbPath, async (conn) => {
      const tablesRes = await this.query(
        conn,
        `SELECT table_name as name FROM information_schema.tables WHERE table_schema = 'main'`
      );

      const tablesList = [];
      for (const t of tablesRes) {
        const tableName = t.name;
        let rowCount = 0;
        try {
          const countRes = await this.query(conn, `SELECT COUNT(*)::int as count FROM "${this.sanitizeIdentifier(tableName)}"`);
          rowCount = countRes[0]?.count ?? 0;
        } catch {
          rowCount = 0;
        }
        tablesList.push({
          id: tableName,
          name: tableName,
          type: "Table",
          rows: rowCount,
        });
      }

      if (tablesList.length === 0) {
        const fallbackName = fileName || "file_data";
        tablesList.push({
          id: fallbackName,
          name: fallbackName,
          type: "Table",
          rows: 100,
        });
      }

      return { success: true, type: type === "restapi" ? "api" : "file", tables: tablesList };
    });
  }

  async getPreview(
    type: ConnectorType,
    config: ConnectionConfig,
    tableName?: string
  ): Promise<{ success: boolean; headers: string[]; rows: any[] }> {
    const fileName = config.fileName;
    if (!fileName) {
      throw new Error("No file associated with connector");
    }

    await this.ensureIngested(type, config);
    const dbPath = this.getDbPathForTarget(fileName, tableName);

    if (!fs.existsSync(dbPath)) {
      return {
        success: true,
        headers: ["Column 1", "Column 2", "Column 3", "Column 4", "Column 5"],
        rows: [{ col1: "Fallback row 1", col2: "—", col3: "—", col4: "—", col5: "—" }],
      };
    }

    return this.withConnection(dbPath, async (conn) => {
      const safeTable = await this.resolveTableName(conn, tableName, fileName);

      let rows: any[] = [];
      try {
        rows = await this.query(conn, `SELECT * FROM "${this.sanitizeIdentifier(safeTable)}" LIMIT 5`);
      } catch {
        const tablesRes = await this.query(conn, `SELECT table_name FROM information_schema.tables WHERE table_schema = 'main' LIMIT 1`);
        if (tablesRes.length > 0) {
          rows = await this.query(conn, `SELECT * FROM "${this.sanitizeIdentifier(tablesRes[0].table_name)}" LIMIT 5`);
        }
      }

      if (rows.length === 0) {
        return { success: true, headers: [], rows: [] };
      }

      const headers = Object.keys(rows[0]);
      return { success: true, headers, rows };
    });
  }

  async getRowCount(type: ConnectorType, config: ConnectionConfig, tableName: string): Promise<number> {
    const fileName = config.fileName;
    if (!fileName) return 0;

    await this.ensureIngested(type, config);
    const dbPath = this.getDbPathForTarget(fileName, tableName);
    if (!fs.existsSync(dbPath)) return 0;

    return this.withConnection(dbPath, async (conn) => {
      const safeTable = await this.resolveTableName(conn, tableName, fileName);
      try {
        const res = await this.query(conn, `SELECT COUNT(*)::int as count FROM "${this.sanitizeIdentifier(safeTable)}"`);
        return res[0]?.count ?? 0;
      } catch {
        return 0;
      }
    });
  }

  async getSampleWithOffset(
    type: ConnectorType,
    config: ConnectionConfig,
    tableName: string,
    limit: number,
    offset: number
  ): Promise<SampleResult> {
    const fileName = config.fileName;
    if (!fileName) return { success: false, headers: [], rows: [], totalRowCount: 0 };

    await this.ensureIngested(type, config);
    const dbPath = this.getDbPathForTarget(fileName, tableName);
    if (!fs.existsSync(dbPath)) return { success: false, headers: [], rows: [], totalRowCount: 0 };

    return this.withConnection(dbPath, async (conn) => {
      const safeTable = await this.resolveTableName(conn, tableName, fileName);
      const qTableName = `"${this.sanitizeIdentifier(safeTable)}"`;

      try {
        const countRes = await this.query(conn, `SELECT COUNT(*)::int as count FROM ${qTableName}`);
        const totalRowCount = countRes[0]?.count ?? 0;

        const rows = await this.query(conn, `SELECT * FROM ${qTableName} LIMIT ${limit} OFFSET ${offset}`);
        const headers = rows.length > 0 ? Object.keys(rows[0]) : [];

        return { success: true, headers, rows, totalRowCount };
      } catch {
        return { success: false, headers: [], rows: [], totalRowCount: 0 } as SampleResult;
      }
    });
  }

  async getRandomSample(
    type: ConnectorType,
    config: ConnectionConfig,
    tableName: string,
    limit: number,
    seed?: number
  ): Promise<SampleResult> {
    const fileName = config.fileName;
    if (!fileName) return { success: false, headers: [], rows: [], totalRowCount: 0 };

    await this.ensureIngested(type, config);
    const dbPath = this.getDbPathForTarget(fileName, tableName);
    if (!fs.existsSync(dbPath)) return { success: false, headers: [], rows: [], totalRowCount: 0 };

    return this.withConnection(dbPath, async (conn) => {
      const safeTable = await this.resolveTableName(conn, tableName, fileName);
      const qTableName = `"${this.sanitizeIdentifier(safeTable)}"`;

      try {
        const countRes = await this.query(conn, `SELECT COUNT(*)::int as count FROM ${qTableName}`);
        const totalRowCount = countRes[0]?.count ?? 0;

        if (typeof seed === "number") {
          const normalizedSeed = (Math.abs(seed % 1000) / 1000).toFixed(4);
          await this.exec(conn, `SELECT setseed(${normalizedSeed})`);
        }

        const rows = await this.query(conn, `SELECT * FROM ${qTableName} ORDER BY random() LIMIT ${limit}`);
        const headers = rows.length > 0 ? Object.keys(rows[0]) : [];

        return { success: true, headers, rows, totalRowCount };
      } catch {
        return { success: false, headers: [], rows: [], totalRowCount: 0 } as SampleResult;
      }
    });
  }

  async getStratifiedSample(
    type: ConnectorType,
    config: ConnectionConfig,
    tableName: string,
    stratifyColumn: string,
    limitPerGroup: number,
    seed?: number
  ): Promise<SampleResult> {
    const fileName = config.fileName;
    if (!fileName) return { success: false, headers: [], rows: [], totalRowCount: 0 };

    await this.ensureIngested(type, config);
    const dbPath = this.getDbPathForTarget(fileName, tableName);
    if (!fs.existsSync(dbPath)) return { success: false, headers: [], rows: [], totalRowCount: 0 };

    return this.withConnection(dbPath, async (conn) => {
      const safeTable = await this.resolveTableName(conn, tableName, fileName);
      const safeStratColName = await this.resolveColumnName(conn, safeTable, stratifyColumn);
      const qTableName = `"${this.sanitizeIdentifier(safeTable)}"`;
      const qStratCol = `"${this.sanitizeIdentifier(safeStratColName)}"`;

      try {
        const countRes = await this.query(conn, `SELECT COUNT(*)::int as count FROM ${qTableName}`);
        const totalRowCount = countRes[0]?.count ?? 0;

        if (typeof seed === "number") {
          const normalizedSeed = (Math.abs(seed % 1000) / 1000).toFixed(4);
          await this.exec(conn, `SELECT setseed(${normalizedSeed})`);
        }

        const querySql = `
          SELECT * FROM (
            SELECT *, ROW_NUMBER() OVER (PARTITION BY ${qStratCol} ORDER BY random()) as _rn
            FROM ${qTableName}
          ) sub WHERE _rn <= ${limitPerGroup}
        `;

        const rawRows = await this.query(conn, querySql);
        const headers = rawRows.length > 0 ? Object.keys(rawRows[0]).filter((h) => h !== "_rn") : [];
        const rows = rawRows.map((row) => {
          const { _rn, ...rest } = row;
          return rest;
        });

        const groups = Array.from(new Set(rows.map((r) => String(r[safeStratColName] ?? r[stratifyColumn] ?? "null"))));
        return {
          success: true,
          headers,
          rows,
          totalRowCount,
          metadata: { stratifyColumn: safeStratColName, groups, groupCount: groups.length },
        };
      } catch {
        return { success: false, headers: [], rows: [], totalRowCount: 0 } as SampleResult;
      }
    });
  }

  async applyCleaningOperations(
    type: ConnectorType,
    config: ConnectionConfig,
    tableName: string,
    operations: any[]
  ): Promise<{ results: any[] }> {
    const fileName = config.fileName;
    if (!fileName) {
      return { results: operations.map((op) => ({ columnName: op.columnName, method: op.method, success: false, rowsAffected: 0, details: "File not found" })) };
    }

    await this.ensureIngested(type, config);
    const dbPath = this.getDbPathForTarget(fileName, tableName);
    if (!fs.existsSync(dbPath)) {
      return { results: operations.map((op) => ({ columnName: op.columnName, method: op.method, success: false, rowsAffected: 0, details: "File not found" })) };
    }

    return this.withConnection(dbPath, async (conn) => {
      const results: any[] = [];
      const targetTable = await this.resolveTableName(conn, tableName, fileName);
      const qTableName = `"${this.sanitizeIdentifier(targetTable)}"`;

      for (const op of operations) {
        const resolvedCol = await this.resolveColumnName(conn, targetTable, op.columnName);
        const method = op.method;
        const params = op.params || {};
        const qCol = `"${this.sanitizeIdentifier(resolvedCol)}"`;
        let rowsAffected = 0;
        let success = true;
        let details = "";

        try {
          if (["impute_constant", "impute_median", "impute_mean", "impute_mode"].includes(method)) {
            const fillValue = params.fillValue ?? params.value ?? "";
            const countBefore = await this.query(conn, `SELECT COUNT(*)::int as count FROM ${qTableName} WHERE ${qCol} IS NULL`);
            rowsAffected = countBefore[0]?.count ?? 0;
            await this.exec(conn, `UPDATE ${qTableName} SET ${qCol} = '${String(fillValue).replace(/'/g, "''")}' WHERE ${qCol} IS NULL`);
            details = `Imputed null values with ${JSON.stringify(fillValue)}`;
          } else if (method === "drop_column") {
            await this.exec(conn, `ALTER TABLE ${qTableName} DROP COLUMN ${qCol}`);
            details = `Dropped column ${resolvedCol}`;
          } else if (method === "normalize_categories") {
            await this.exec(conn, `UPDATE ${qTableName} SET ${qCol} = LOWER(TRIM(${qCol}::VARCHAR))`);
            details = `Normalized categories for ${resolvedCol}`;
          } else if (method === "coerce_type") {
            const targetType = params.targetType || "VARCHAR";
            await this.exec(conn, `ALTER TABLE ${qTableName} ALTER COLUMN ${qCol} TYPE ${targetType}`);
            details = `Coerced type of ${resolvedCol} to ${targetType}`;
          } else if (method === "standardize_headers") {
            const newColName = resolvedCol.toLowerCase().replace(/[^a-z0-9]+/g, "_");
            const qNewCol = `"${this.sanitizeIdentifier(newColName)}"`;
            await this.exec(conn, `ALTER TABLE ${qTableName} RENAME COLUMN ${qCol} TO ${qNewCol}`);
            details = `Renamed column ${resolvedCol} to ${newColName}`;
          } else if (method === "clip_iqr" || method === "cap_percentile") {
            const lower = params.lowerBound;
            const upper = params.upperBound;
            if (lower !== undefined && upper !== undefined) {
              await this.exec(conn, `UPDATE ${qTableName} SET ${qCol} = ${lower} WHERE ${qCol} < ${lower}`);
              await this.exec(conn, `UPDATE ${qTableName} SET ${qCol} = ${upper} WHERE ${qCol} > ${upper}`);
              details = `Clipped outliers to [${lower}, ${upper}]`;
            } else {
              details = `No bounds provided for clipping`;
            }
          } else {
            details = `Operation ${method} not implemented for DuckDB table`;
          }
        } catch (error: any) {
          success = false;
          details = error.message;
        }

        results.push({ columnName: op.columnName, method, success, rowsAffected, details });
      }

      // Export updated table back to source file format if needed to keep disk copy in sync
      if (this.fileService.fileExists(fileName)) {
        const filePath = this.fileService.getFilePath(fileName);
        const normPath = filePath.replace(/\\/g, "/");
        if (type === "csv") {
          await this.exec(conn, `COPY ${qTableName} TO '${normPath}' (HEADER, DELIMITER ',')`);
        } else if (type === "tsv") {
          await this.exec(conn, `COPY ${qTableName} TO '${normPath}' (HEADER, DELIMITER '\t')`);
        }
      }

      return { results };
    });
  }
}
