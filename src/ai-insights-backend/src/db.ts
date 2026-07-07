import { Client } from "pg";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import dotenv from "dotenv";

dotenv.config();

export async function checkAndCreateDatabase() {
  const dbHost = process.env.DB_HOST || "localhost";
  const dbPort = parseInt(process.env.DB_PORT || "5434", 10);
  const dbUser = process.env.DB_USER || "postgres";
  const dbPass = process.env.DB_PASS || "";
  const dbName = process.env.DB_NAME || "docspyre_app";

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
    console.error("[DB] Critical: Drizzle programmatic migration failed:", err.message || err);
  }
}
