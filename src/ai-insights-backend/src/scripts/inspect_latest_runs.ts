import dotenv from "dotenv";
dotenv.config();
import { pool } from "../db";

async function main() {
  const client = await pool.connect();
  try {
    const projects = await client.query("SELECT id, name, status, created_at FROM projects ORDER BY created_at DESC LIMIT 5");
    console.log("PROJECTS:", JSON.stringify(projects.rows, null, 2));

    const runs = await client.query("SELECT id, project_id, status, created_at, (agent_state->>'status') as agent_status, (agent_state->>'summary') as agent_summary, (agent_state->>'stageStatuses') as stage_statuses FROM project_runs ORDER BY created_at DESC LIMIT 5");
    console.log("RUNS:", JSON.stringify(runs.rows, null, 2));
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(console.error);
