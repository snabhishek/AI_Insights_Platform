import { v4 as uuidv4 } from "uuid";
import fs from "fs";
import path from "path";
import { Pool } from "pg";
import { query } from "../db";

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface ConnectionConfig {
  host?: string;
  port?: string;
  database?: string;
  username?: string;
  password?: string;
  account?: string;    // snowflake
  url?: string;        // restapi
  method?: string;     // restapi
  headers?: string;    // restapi JSON
  fileName?: string;   // excel/csv/tsv
  fileContent?: string;
}

export type ConnectorType =
  | "postgres"
  | "mysql"
  | "sqlserver"
  | "snowflake"
  | "mongodb"
  | "excel"
  | "csv"
  | "tsv"
  | "restapi";

export type ConnectorStatus = "Connected" | "Disconnected" | "Syncing";
export type ConnectorHealth = "Healthy" | "Warning" | "Error";

export interface Connector {
  id: string;
  name: string;
  subtext: string;
  type: ConnectorType;
  status: ConnectorStatus;
  health: ConnectorHealth;
  lastSyncTime: string;
  lastSyncDate: string;
  createdAt: string;
  connectionConfig: ConnectionConfig;
  assets: {
    tables: number;
    views: number | null;
    pipelines: number;
  };
}

// Helper: Formats Date to readable string
function formatDate(date: Date): string {
  return date.toLocaleString("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

// Helper: Maps Postgres database row to Connector TypeScript interface
function mapRowToConnector(row: any): Connector {
  return {
    id: row.id,
    name: row.name,
    subtext: row.subtext,
    type: row.type as ConnectorType,
    status: row.status as ConnectorStatus,
    health: row.health as ConnectorHealth,
    lastSyncTime: row.last_sync_time,
    lastSyncDate: row.last_sync_date,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    connectionConfig: typeof row.connection_config === "string" 
      ? JSON.parse(row.connection_config) 
      : row.connection_config,
    assets: typeof row.assets === "string" 
      ? JSON.parse(row.assets) 
      : row.assets,
  };
}

// ─── Postgres Store CRUD Handlers ──────────────────────────────────────────────

export async function getAll(): Promise<Connector[]> {
  try {
    const res = await query("SELECT * FROM connectors ORDER BY created_at DESC");
    return res.rows.map(mapRowToConnector);
  } catch (err) {
    console.error("[PostgresStore] getAll failed:", err);
    return [];
  }
}

export async function getById(id: string): Promise<Connector | undefined> {
  try {
    const res = await query("SELECT * FROM connectors WHERE id = $1", [id]);
    if (res.rows.length === 0) return undefined;
    return mapRowToConnector(res.rows[0]);
  } catch (err) {
    console.error("[PostgresStore] getById failed:", err);
    return undefined;
  }
}

export async function add(
  name: string,
  type: ConnectorType,
  subtext: string,
  connectionConfig: ConnectionConfig
): Promise<Connector> {
  const now = new Date();

  let tables = 0;
  let views: number | null = null;
  let pipelines = 0;

  // File upload check:
  if (["excel", "csv", "tsv"].includes(type) && connectionConfig.fileName && connectionConfig.fileContent) {
    try {
      const uploadDir = path.join(process.cwd(), "uploads");
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }
      const filePath = path.join(uploadDir, connectionConfig.fileName);
      
      let fileBuffer: Buffer;
      if (connectionConfig.fileContent.includes(";base64,")) {
        const base64Data = connectionConfig.fileContent.split(";base64,")[1];
        fileBuffer = Buffer.from(base64Data, "base64");
      } else {
        fileBuffer = Buffer.from(connectionConfig.fileContent, "utf8");
      }

      fs.writeFileSync(filePath, fileBuffer);
      console.log(`[Upload] Persisted file to local directory: ${filePath}`);
    } catch (uploadErr: any) {
      console.error("[Upload] Failed to persist file:", uploadErr.message);
    }
  }

  // Database metadata check:
  if (type === "postgres" && connectionConfig.host && connectionConfig.database) {
    try {
      const targetPool = new Pool({
        host: connectionConfig.host,
        port: connectionConfig.port ? parseInt(connectionConfig.port, 10) : 5432,
        database: connectionConfig.database,
        user: connectionConfig.username || "postgres",
        password: connectionConfig.password || "",
      });
      const tableCheck = await targetPool.query(`
        SELECT count(*)::int as count 
        FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      `);
      const viewCheck = await targetPool.query(`
        SELECT count(*)::int as count 
        FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_type = 'VIEW'
      `);
      tables = tableCheck.rows[0]?.count ?? 0;
      views = viewCheck.rows[0]?.count ?? 0;
      pipelines = 0;
      await targetPool.end();
    } catch (dbErr: any) {
      console.warn("[PostgresStore] Failed to query live DB schema counts:", dbErr.message);
      tables = 0;
      views = 0;
      pipelines = 0;
    }
  } else if (type === "mysql" && connectionConfig.host && connectionConfig.database) {
    try {
      const mysql = require("mysql2/promise");
      const connection = await mysql.createConnection({
        host: connectionConfig.host,
        port: connectionConfig.port ? parseInt(connectionConfig.port, 10) : 3306,
        database: connectionConfig.database,
        user: connectionConfig.username || "root",
        password: connectionConfig.password || "",
      });
      const [tableRows] = await connection.query(`
        SELECT COUNT(*) as count 
        FROM information_schema.tables 
        WHERE table_schema = ? AND table_type = 'BASE TABLE'
      `, [connectionConfig.database]);
      const [viewRows] = await connection.query(`
        SELECT COUNT(*) as count 
        FROM information_schema.tables 
        WHERE table_schema = ? AND table_type = 'VIEW'
      `, [connectionConfig.database]);
      tables = (tableRows as any)[0]?.count ?? 0;
      views = (viewRows as any)[0]?.count ?? 0;
      pipelines = 0;
      await connection.end();
    } catch (dbErr: any) {
      console.warn("[PostgresStore] Failed to query live MySQL schema counts:", dbErr.message);
      tables = 0;
      views = 0;
      pipelines = 0;
    }
  } else if (type === "excel") {
    try {
      if (connectionConfig.fileName) {
        const uploadDir = path.join(process.cwd(), "uploads");
        const filePath = path.join(uploadDir, connectionConfig.fileName);
        if (fs.existsSync(filePath)) {
          const xlsx = require("xlsx");
          const workbook = xlsx.readFile(filePath);
          tables = workbook.SheetNames.length;
        } else {
          tables = 1;
        }
      } else {
        tables = 1;
      }
    } catch (excelErr) {
      tables = 1;
    }
    views = null;
    pipelines = 0;
  } else if (["csv", "tsv"].includes(type)) {
    tables = 1;
    views = null;
    pipelines = 0;
  } else if (type === "restapi") {
    tables = 0;
    views = null;
    pipelines = 1;
  } else {
    tables = 12;
    views = 2;
    pipelines = 0;
  }

  const id = uuidv4();
  const lastSyncTime = "Just now";
  const lastSyncDate = formatDate(now);
  const status = "Connected";
  const health = "Healthy";
  const assets = { tables, views, pipelines };

  // Erase fileContent before database save to prevent large rows
  const savedConfig = { ...connectionConfig };
  delete savedConfig.fileContent;

  try {
    await query(
      `INSERT INTO connectors 
       (id, name, subtext, type, status, health, last_sync_time, last_sync_date, created_at, connection_config, assets) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        id,
        name,
        subtext,
        type,
        status,
        health,
        lastSyncTime,
        lastSyncDate,
        now,
        JSON.stringify(savedConfig),
        JSON.stringify(assets),
      ]
    );

    return {
      id,
      name,
      subtext,
      type,
      status,
      health,
      lastSyncTime,
      lastSyncDate,
      createdAt: now.toISOString(),
      connectionConfig,
      assets,
    };
  } catch (err) {
    console.error("[PostgresStore] add failed:", err);
    throw err;
  }
}

export async function remove(id: string): Promise<boolean> {
  try {
    const connector = await getById(id);
    if (connector && ["excel", "csv", "tsv"].includes(connector.type)) {
      const fileName = connector.connectionConfig.fileName;
      if (fileName) {
        const filePath = path.join(process.cwd(), "uploads", fileName);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          console.log(`[Delete] Cleaned up uploaded file from disk: ${filePath}`);
        }
      }
    }
    const res = await query("DELETE FROM connectors WHERE id = $1", [id]);
    return (res.rowCount ?? 0) > 0;
  } catch (err) {
    console.error("[PostgresStore] remove failed:", err);
    return false;
  }
}

export async function updateStatus(id: string, status: ConnectorStatus): Promise<Connector | undefined> {
  const now = new Date();
  const lastSyncTime = "Just now";
  const lastSyncDate = formatDate(now);

  try {
    let res;
    if (status === "Connected") {
      res = await query(
        `UPDATE connectors 
         SET status = $2, last_sync_time = $3, last_sync_date = $4 
         WHERE id = $1 RETURNING *`,
        [id, status, lastSyncTime, lastSyncDate]
      );
    } else {
      res = await query(
        `UPDATE connectors SET status = $2 WHERE id = $1 RETURNING *`,
        [id, status]
      );
    }

    if (res.rows.length === 0) return undefined;
    return mapRowToConnector(res.rows[0]);
  } catch (err) {
    console.error("[PostgresStore] updateStatus failed:", err);
    return undefined;
  }
}

export async function updateHealth(id: string, health: ConnectorHealth): Promise<Connector | undefined> {
  try {
    const res = await query(
      `UPDATE connectors SET health = $2 WHERE id = $1 RETURNING *`,
      [id, health]
    );
    if (res.rows.length === 0) return undefined;
    return mapRowToConnector(res.rows[0]);
  } catch (err) {
    console.error("[PostgresStore] updateHealth failed:", err);
    return undefined;
  }
}

export async function updateAllStatus(status: ConnectorStatus): Promise<void> {
  const now = new Date();
  const lastSyncTime = "Just now";
  const lastSyncDate = formatDate(now);

  try {
    if (status === "Connected") {
      await query(
        `UPDATE connectors 
         SET status = $1, last_sync_time = $2, last_sync_date = $3`,
        [status, lastSyncTime, lastSyncDate]
      );
    } else {
      await query(`UPDATE connectors SET status = $1`, [status]);
    }
  } catch (err) {
    console.error("[PostgresStore] updateAllStatus failed:", err);
  }
}

export async function completeSync(id: string): Promise<Connector | undefined> {
  const now = new Date();
  const status = "Connected";
  const health = Math.random() > 0.85 ? "Warning" : "Healthy";
  const lastSyncTime = "Just now";
  const lastSyncDate = formatDate(now);

  try {
    const res = await query(
      `UPDATE connectors 
       SET status = $2, health = $3, last_sync_time = $4, last_sync_date = $5 
       WHERE id = $1 RETURNING *`,
      [id, status, health, lastSyncTime, lastSyncDate]
    );
    if (res.rows.length === 0) return undefined;
    return mapRowToConnector(res.rows[0]);
  } catch (err) {
    console.error("[PostgresStore] completeSync failed:", err);
    return undefined;
  }
}

export async function completeAllSync(): Promise<Connector[]> {
  const now = new Date();
  const status = "Connected";
  const lastSyncTime = "Just now";
  const lastSyncDate = formatDate(now);

  try {
    // Select all first to generate custom health metrics
    const all = await query("SELECT * FROM connectors");
    for (const row of all.rows) {
      const rowHealth = Math.random() > 0.9 ? "Warning" : "Healthy";
      await query(
        `UPDATE connectors 
         SET status = $2, health = $3, last_sync_time = $4, last_sync_date = $5 
         WHERE id = $1`,
        [row.id, status, rowHealth, lastSyncTime, lastSyncDate]
      );
    }
    return await getAll();
  } catch (err) {
    console.error("[PostgresStore] completeAllSync failed:", err);
    return [];
  }
}

export async function updateConnectorConfig(
  id: string,
  name: string,
  config: ConnectionConfig
): Promise<Connector | undefined> {
  try {
    const res = await query(
      `UPDATE connectors 
       SET name = $2, connection_config = $3 
       WHERE id = $1 RETURNING *`,
      [id, name, JSON.stringify(config)]
    );
    if (res.rows.length === 0) return undefined;
    return mapRowToConnector(res.rows[0]);
  } catch (err) {
    console.error("[PostgresStore] updateConnectorConfig failed:", err);
    return undefined;
  }
}
