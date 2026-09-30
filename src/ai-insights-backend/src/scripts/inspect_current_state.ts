import dotenv from "dotenv";
dotenv.config();
import { pool } from "../db";

async function main() {
  const client = await pool.connect();
  try {
    const tables = await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public'");
    console.log("TABLES:", tables.rows.map(t => t.table_name));
    const vRuns = await client.query("SELECT * FROM model_validation_runs ORDER BY created_at DESC LIMIT 2");
    console.log("VALIDATION RUNS:", JSON.stringify(vRuns.rows, null, 2));
    const vResults = await client.query("SELECT * FROM model_validation_results ORDER BY created_at DESC LIMIT 5");
    console.log("VALIDATION RESULTS:", JSON.stringify(vResults.rows, null, 2));
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(console.error);
