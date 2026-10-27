const { Client } = require("pg");

async function checkDb(port, label) {
  console.log(`\n=== Checking PostgreSQL on port ${port} (${label}) ===`);
  const client = new Client({
    host: "127.0.0.1",
    port,
    user: "postgres",
    password: "123456",
    database: "docspyre_app",
    connectionTimeoutMillis: 3000,
  });

  try {
    await client.connect();
    console.log(`Connected to port ${port} successfully!`);

    const ws = await client.query("SELECT * FROM workspaces");
    console.log(`Workspaces (${ws.rows.length}):`, ws.rows);

    const pr = await client.query("SELECT id, name, workspace_id FROM projects");
    console.log(`Projects (${pr.rows.length}):`, pr.rows);

    const cn = await client.query("SELECT id, name, workspace_id FROM connectors");
    console.log(`Connectors (${cn.rows.length}):`, cn.rows);

  } catch (err) {
    console.log(`Failed to query port ${port}:`, err.message);
  } finally {
    try { await client.end(); } catch (e) {}
  }
}

async function main() {
  await checkDb(5432, "Native Windows Service");
  await checkDb(22003, "Docker Container ai-insights-postgres");
}

main();
