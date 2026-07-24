import { Client, Pool } from "pg";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import dotenv from "dotenv";

dotenv.config();

const dbHost = process.env.DB_HOST || "localhost";
const dbPort = parseInt(process.env.DB_PORT || "5434", 10);
const dbUser = process.env.DB_USER || "postgres";
const dbPass = process.env.DB_PASS || "";
const dbName = process.env.DB_NAME || "AIInsightsApp";

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
        use_case TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    // Add use_case column to existing projects table if it doesn't exist (migration)
    await query(`
      ALTER TABLE projects ADD COLUMN IF NOT EXISTS use_case TEXT;
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

    // Index optimizations for workspace scoping
    await query(`
      CREATE INDEX IF NOT EXISTS projects_workspace_id_idx ON projects (workspace_id);
    `);
    await query(`
      CREATE INDEX IF NOT EXISTS connectors_workspace_id_idx ON connectors (workspace_id);
    `);

    // 7. Seed 18 mock data sources if connectors table is empty
    const connCheck = await query("SELECT COUNT(*) FROM connectors");
    const count = parseInt(connCheck.rows[0].count, 10);
    if (count === 0) {
      console.log("[DB] Seeding 18 mock connectors for high-fidelity demonstration...");
      
      const seedConnectors = [
        {
          id: "conn-1",
          name: "PostgreSQL Production",
          subtext: "Database",
          type: "postgres",
          status: "Connected",
          health: "Healthy",
          last_sync_time: "10:14 AM",
          last_sync_date: "July 12, 2026",
          connection_config: JSON.stringify({ host: "127.0.0.1", port: "5432", database: "prod_db", username: "pg_user" }),
          assets: JSON.stringify({ tables: 42, views: 8, pipelines: 3 })
        },
        {
          id: "conn-2",
          name: "Snowflake Warehouse",
          subtext: "Data Warehouse",
          type: "snowflake",
          status: "Connected",
          health: "Healthy",
          last_sync_time: "09:30 AM",
          last_sync_date: "July 12, 2026",
          connection_config: JSON.stringify({ account: "cei_snowflake", warehouse: "analytics_wh" }),
          assets: JSON.stringify({ tables: 110, views: 24, pipelines: 5 })
        },
        {
          id: "conn-3",
          name: "BigQuery Analytics",
          subtext: "Data Warehouse",
          type: "snowflake",
          status: "Connected",
          health: "Healthy",
          last_sync_time: "11:05 AM",
          last_sync_date: "July 12, 2026",
          connection_config: JSON.stringify({ project_id: "google-bigquery-poc" }),
          assets: JSON.stringify({ tables: 85, views: 12, pipelines: 4 })
        },
        {
          id: "conn-4",
          name: "SQL Server - Finance",
          subtext: "Database",
          type: "sqlserver",
          status: "Connected",
          health: "Healthy",
          last_sync_time: "08:45 AM",
          last_sync_date: "July 12, 2026",
          connection_config: JSON.stringify({ host: "sql-finance.cei.internal", database: "finance_records" }),
          assets: JSON.stringify({ tables: 56, views: 5, pipelines: 2 })
        },
        {
          id: "conn-5",
          name: "S3 / Cloud Storage",
          subtext: "Cloud Storage",
          type: "excel",
          status: "Connected",
          health: "Healthy",
          last_sync_time: "07:15 AM",
          last_sync_date: "July 12, 2026",
          connection_config: JSON.stringify({ bucket: "cei-datalake-s3" }),
          assets: JSON.stringify({ tables: 14, views: null, pipelines: 1 })
        },
        {
          id: "conn-6",
          name: "REST API - Customer Service",
          subtext: "API",
          type: "restapi",
          status: "Connected",
          health: "Healthy",
          last_sync_time: "10:50 AM",
          last_sync_date: "July 12, 2026",
          connection_config: JSON.stringify({ url: "https://api.cei.com/v1/customers", method: "GET" }),
          assets: JSON.stringify({ tables: 8, views: null, pipelines: 2 })
        },
        {
          id: "conn-7",
          name: "MySQL Inventory",
          subtext: "Database",
          type: "mysql",
          status: "Connected",
          health: "Healthy",
          last_sync_time: "03:12 PM",
          last_sync_date: "July 11, 2026",
          connection_config: JSON.stringify({ host: "127.0.0.1", database: "inventory_db" }),
          assets: JSON.stringify({ tables: 18, views: 0, pipelines: 1 })
        },
        {
          id: "conn-8",
          name: "MongoDB Users",
          subtext: "Database",
          type: "mongodb",
          status: "Connected",
          health: "Healthy",
          last_sync_time: "01:22 PM",
          last_sync_date: "July 11, 2026",
          connection_config: JSON.stringify({ host: "localhost", database: "user_metadata" }),
          assets: JSON.stringify({ tables: 10, views: null, pipelines: 0 })
        },
        {
          id: "conn-9",
          name: "Excel Sales Data",
          subtext: "File",
          type: "excel",
          status: "Connected",
          health: "Healthy",
          last_sync_time: "11:30 AM",
          last_sync_date: "July 11, 2026",
          connection_config: JSON.stringify({ fileName: "sales_q2_2026.xlsx" }),
          assets: JSON.stringify({ tables: 3, views: null, pipelines: 1 })
        },
        {
          id: "conn-10",
          name: "CSV Analytics Log",
          subtext: "File",
          type: "csv",
          status: "Connected",
          health: "Warning",
          last_sync_time: "09:15 AM",
          last_sync_date: "July 11, 2026",
          connection_config: JSON.stringify({ fileName: "user_clicks.csv" }),
          assets: JSON.stringify({ tables: 1, views: null, pipelines: 2 })
        },
        {
          id: "conn-11",
          name: "TSV Product Catalog",
          subtext: "File",
          type: "tsv",
          status: "Disconnected",
          health: "Warning",
          last_sync_time: "08:00 AM",
          last_sync_date: "July 10, 2026",
          connection_config: JSON.stringify({ fileName: "products.tsv" }),
          assets: JSON.stringify({ tables: 1, views: null, pipelines: 1 })
        },
        {
          id: "conn-12",
          name: "REST API - Payments",
          subtext: "API",
          type: "restapi",
          status: "Connected",
          health: "Healthy",
          last_sync_time: "10:10 PM",
          last_sync_date: "July 11, 2026",
          connection_config: JSON.stringify({ url: "https://payments.cei.com/history" }),
          assets: JSON.stringify({ tables: 12, views: null, pipelines: 3 })
        },
        {
          id: "conn-13",
          name: "PostgreSQL Dev",
          subtext: "Database",
          type: "postgres",
          status: "Connected",
          health: "Healthy",
          last_sync_time: "04:30 PM",
          last_sync_date: "July 11, 2026",
          connection_config: JSON.stringify({ host: "dev-db-pg" }),
          assets: JSON.stringify({ tables: 28, views: 4, pipelines: 2 })
        },
        {
          id: "conn-14",
          name: "Snowflake Archive",
          subtext: "Data Warehouse",
          type: "snowflake",
          status: "Disconnected",
          health: "Error",
          last_sync_time: "02:00 PM",
          last_sync_date: "July 08, 2026",
          connection_config: JSON.stringify({ account: "cei_archive" }),
          assets: JSON.stringify({ tables: 200, views: 50, pipelines: 8 })
        },
        {
          id: "conn-15",
          name: "MySQL Log Store",
          subtext: "Database",
          type: "mysql",
          status: "Connected",
          health: "Healthy",
          last_sync_time: "11:55 PM",
          last_sync_date: "July 11, 2026",
          connection_config: JSON.stringify({ host: "logdb-prod" }),
          assets: JSON.stringify({ tables: 8, views: 0, pipelines: 1 })
        },
        {
          id: "conn-16",
          name: "MongoDB Sessions",
          subtext: "Database",
          type: "mongodb",
          status: "Connected",
          health: "Healthy",
          last_sync_time: "10:00 AM",
          last_sync_date: "July 12, 2026",
          connection_config: JSON.stringify({ database: "sessions" }),
          assets: JSON.stringify({ tables: 4, views: null, pipelines: 1 })
        },
        {
          id: "conn-17",
          name: "CSV HR Records",
          subtext: "File",
          type: "csv",
          status: "Connected",
          health: "Healthy",
          last_sync_time: "09:00 AM",
          last_sync_date: "July 09, 2026",
          connection_config: JSON.stringify({ fileName: "hr_salary.csv" }),
          assets: JSON.stringify({ tables: 2, views: null, pipelines: 1 })
        },
        {
          id: "conn-18",
          name: "SQL Server - HR",
          subtext: "Database",
          type: "sqlserver",
          status: "Connected",
          health: "Healthy",
          last_sync_time: "08:15 AM",
          last_sync_date: "July 12, 2026",
          connection_config: JSON.stringify({ database: "hr_sql" }),
          assets: JSON.stringify({ tables: 34, views: 3, pipelines: 2 })
        }
      ];

      for (const conn of seedConnectors) {
        await query(
          `INSERT INTO connectors (id, name, subtext, type, status, health, last_sync_time, last_sync_date, created_at, connection_config, assets, workspace_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), $9, $10, 'default')`,
          [conn.id, conn.name, conn.subtext, conn.type, conn.status, conn.health, conn.last_sync_time, conn.last_sync_date, conn.connection_config, conn.assets]
        );
      }
      console.log("[DB] Seeding mock connectors completed successfully.");
    }

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
    // await initializeDatabaseSchemas();
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

