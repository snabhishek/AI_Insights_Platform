import { Client, Pool } from "pg";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import dotenv from "dotenv";

dotenv.config();

const dbHost = process.env.DB_HOST || "localhost";
const dbPort = parseInt(process.env.DB_PORT || "5434", 10);
const dbUser = process.env.DB_USER || "postgres";
const dbPass = process.env.DB_PASS || "";
const dbName = process.env.DB_NAME || "docspyre_app";

// Export single shared Pool instance and query function
export const pool = new Pool({
  host: dbHost,
  port: dbPort,
  database: dbName,
  user: dbUser,
  password: dbPass,
});

export const query = (text: string, params?: any[]) => pool.query(text, params);

export async function initializeDatabaseSchemas() {
  try {
    console.log("[DB] Initializing database tables and migrations...");
    
    // 1. Workspaces table
    await query(`
      CREATE TABLE IF NOT EXISTS workspaces (
        id VARCHAR(50) PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        is_default BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    // 2. Seed the default workspace if it doesn't exist
    await query(`
      INSERT INTO workspaces (id, name, is_default, created_at)
      VALUES ('default', 'Default Workspace', TRUE, NOW())
      ON CONFLICT (id) DO NOTHING;
    `);

    // 3. Projects table (scoped to workspace)
    await query(`
      CREATE TABLE IF NOT EXISTS projects (
        id VARCHAR(50) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        role VARCHAR(50) NOT NULL DEFAULT 'OWNER',
        data_sources TEXT[] NOT NULL DEFAULT '{}',
        initials VARCHAR(10) NOT NULL DEFAULT 'US',
        workspace_id VARCHAR(50) NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    // 4. Connectors table (with workspace scoping)
    await query(`
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
        assets JSONB NOT NULL,
        workspace_id VARCHAR(50) REFERENCES workspaces(id) ON DELETE CASCADE
      );
    `);

    // 5. Add workspace_id to existing connectors table if it doesn't exist (migration)
    await query(`
      ALTER TABLE connectors ADD COLUMN IF NOT EXISTS workspace_id VARCHAR(50) REFERENCES workspaces(id) ON DELETE CASCADE;
    `);

    // 6. Assign legacy connectors (without workspace_id) to the default workspace
    await query(`
      UPDATE connectors SET workspace_id = 'default' WHERE workspace_id IS NULL;
    `);

    console.log("[DB] Database tables initialization and migrations completed successfully.");
  } catch (err: any) {
    console.error("[DB] Failed to initialize database schemas:", err.message || err);
  }
}

export async function checkAndCreateDatabase() {
  // Connect to the default 'postgres' database
  const client = new Client({
    host: dbHost,
    port: dbPort,
    user: dbUser,
    password: dbPass,
    database: "postgres",
    connectionTimeoutMillis: 3000,
    statement_timeout: 3000,
  });

  try {
    await client.connect();

    // Check if the target database already exists
    const checkRes = await client.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [dbName]
    );

    if (checkRes.rows.length === 0) {
      console.log(`[DB] Database "${dbName}" does not exist. Creating database...`);
      // CREATE DATABASE must run outside of transactions and cannot accept bind parameters
      await client.query(`CREATE DATABASE "${dbName}"`);
      console.log(`[DB] Database "${dbName}" created successfully.`);
    } else {
      console.log(`[DB] Database "${dbName}" verified successfully.`);
    }

    // Now run schema creation queries and migrations
    await initializeDatabaseSchemas();
  } catch (err: any) {
    console.error("[DB] Database verification/creation guard failed:", err.message || err);
  } finally {
    try {
      await client.end();
    } catch (e) {}
  }
}

export async function runMigrations(db: NodePgDatabase<any>) {
  try {
    await migrate(db, { migrationsFolder: "./drizzle" });
    console.log("[DB] Drizzle schema migrations verified and applied successfully.");
  } catch (err: any) {
    // If migrations directory is missing/empty, suppress or log warning since we run schemas programmatically anyway
    console.warn("[DB] Note: Drizzle programmatic migration skipped or pending:", err.message || err);
  }
}

