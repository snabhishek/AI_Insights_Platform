import fs from "fs/promises";
import path from "path";
import os from "os";
import { v4 as uuidv4 } from "uuid";
import { Connector } from "../../models/connector.types";
import { Pool } from "pg";

export async function extractSchema(connector: Connector): Promise<string> {
  const tempDir = os.tmpdir();
  const filePath = path.join(tempDir, `schema_${connector.id}_${uuidv4()}.json`);

  let schemaData: any = {};

  if (connector.type === "postgres") {
    schemaData = await extractPostgresSchema(connector);
  } else {
    // Mock extraction for other types
    schemaData = { message: `Schema extraction for ${connector.type} not fully implemented yet`, tables: [] };
  }

  await fs.writeFile(filePath, JSON.stringify(schemaData, null, 2), "utf-8");
  return filePath;
}

async function extractPostgresSchema(connector: Connector): Promise<any> {
  const config = connector.connectionConfig;
  const pool = new Pool({
    host: config.host,
    port: parseInt(config.port || "5432", 10),
    database: config.database,
    user: config.username,
    password: config.password,
  });

  try {
    const res = await pool.query(`
      SELECT table_name, column_name, data_type 
      FROM information_schema.columns 
      WHERE table_schema = 'public'
    `);
    
    // Group by table
    const tables: Record<string, any[]> = {};
    for (const row of res.rows) {
      if (!tables[row.table_name]) {
        tables[row.table_name] = [];
      }
      tables[row.table_name].push({ column_name: row.column_name, data_type: row.data_type });
    }
    return { tables };
  } catch (error: any) {
    throw new Error(`Postgres extraction failed: ${error.message}`);
  } finally {
    await pool.end();
  }
}
