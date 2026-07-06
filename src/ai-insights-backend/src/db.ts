import { Pool } from "pg";
import dotenv from "dotenv";

dotenv.config();

const pool = new Pool({
  host: process.env.DB_HOST || "localhost",
  port: parseInt(process.env.DB_PORT || "5434", 10),
  database: process.env.DB_NAME || "docspyre_app",
  user: process.env.DB_USER || "postgres",
  password: process.env.DB_PASS || "",
});

export const query = (text: string, params?: any[]) => pool.query(text, params);

// ─── Table DDL setup on startup ────────────────────────────────────────────────
export async function initializeDatabase() {
  const ddlQuery = `
    CREATE TABLE IF NOT EXISTS connectors (
      id VARCHAR(50) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      subtext VARCHAR(255) NOT NULL,
      type VARCHAR(50) NOT NULL,
      status VARCHAR(50) NOT NULL,
      health VARCHAR(50) NOT NULL,
      last_sync_time VARCHAR(100) NOT NULL,
      last_sync_date VARCHAR(100) NOT NULL,
      created_at TIMESTAMP NOT NULL,
      connection_config JSONB NOT NULL,
      assets JSONB NOT NULL
    );
  `;

  try {
    await query(ddlQuery);
    console.log("[DB] PostgreSQL connectors table verified / created successfully.");
  } catch (err: any) {
    console.error("[DB] Critical: Database DDL initialization failed:", err.message || err);
  }
}
