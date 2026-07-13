import fs from "fs/promises";
import path from "path";
import os from "os";
import { v4 as uuidv4 } from "uuid";
import { Pool } from "pg";
import { Connector } from "../../models/connector.types";

export type ProfilingMode = "safe" | "balanced" | "deep";

export async function profileData(
  connector: Connector,
  schemaFilePath: string,
  mode: ProfilingMode = "safe"
): Promise<string> {
  const schemaData = JSON.parse(await fs.readFile(schemaFilePath, "utf-8"));
  const tempDir = os.tmpdir();
  const filePath = path.join(tempDir, `profiling_${connector.id}_${uuidv4()}.json`);

  let profilingData: any = {};

  if (connector.type === "postgres") {
    profilingData = await profilePostgresData(connector, schemaData, mode);
  } else {
    profilingData = { message: `Data profiling for ${connector.type} not fully implemented yet` };
  }

  await fs.writeFile(filePath, JSON.stringify(profilingData, null, 2), "utf-8");
  return filePath;
}

async function profilePostgresData(connector: Connector, schemaData: any, mode: ProfilingMode): Promise<any> {
  const config = connector.connectionConfig;
  const pool = new Pool({
    host: config.host,
    port: parseInt(config.port || "5432", 10),
    database: config.database,
    user: config.username,
    password: config.password,
    statement_timeout: 30000, // 30 seconds timeout
  });

  const results: any = {};

  try {
    for (const tableName of Object.keys(schemaData.tables || {})) {
      results[tableName] = {};
      
      // In Safe mode, we only grab very basic row counts or sampled data.
      // In Deep mode, we might do full scans (not recommended, but supported).
      const limitClause = mode === "deep" ? "" : "LIMIT 10000";

      // 1. Fetch a sample for LLM classification
      const sampleRes = await pool.query(`SELECT * FROM "${tableName}" ${limitClause}`);
      results[tableName].sample = sampleRes.rows.slice(0, 50); // Keep 50 rows for LLM

      // 2. Fetch basic numeric profiling if mode is at least balanced
      if (mode === "balanced" || mode === "deep") {
        for (const col of schemaData.tables[tableName]) {
          const colName = col.column_name;
          // Simple statistics using a subquery sample to prevent full table scans
          const statQuery = `
            SELECT 
              COUNT("${colName}") as non_null_count,
              COUNT(DISTINCT "${colName}") as distinct_count
            FROM (SELECT "${colName}" FROM "${tableName}" ${limitClause}) as subq
          `;
          try {
            const statRes = await pool.query(statQuery);
            results[tableName][colName] = statRes.rows[0];
          } catch (e: any) {
            results[tableName][colName] = { error: e.message };
          }
        }
      }
    }
    return results;
  } catch (error: any) {
    throw new Error(`Postgres profiling failed: ${error.message}`);
  } finally {
    await pool.end();
  }
}
