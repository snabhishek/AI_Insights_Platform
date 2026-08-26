import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import { drizzle } from "drizzle-orm/node-postgres";
import { pool } from "../db";
import * as connectorsSchema from "../db/connectors";
import * as agentJobsSchema from "../db/agentJobs";
import * as agentThinkingSchema from "../db/agentThinking";
import { PostgresConnectorRepository } from "../repositories/connector.repository";
import { ConnectionTesterService } from "../services/connector/connectionTester.service";
import { DuckDBService } from "../services/duckdb/duckdb.service";
import { LocalFileService } from "../services/file/file.service";
import { SourceRegistryService } from "../services/sourceRegistry/sourceRegistry.service";

dotenv.config();

async function testFilterOptions() {
  console.log("==================================================");
  console.log(" Filter Options Diagnostics & Testing Runner ");
  console.log("==================================================\n");

  const db = drizzle(pool, { schema: { ...connectorsSchema, ...agentJobsSchema, ...agentThinkingSchema } });
  const fileService = new LocalFileService();
  const duckDBService = new DuckDBService(fileService);
  const connectionTester = new ConnectionTesterService(fileService, duckDBService);
  const connectorRepo = new PostgresConnectorRepository(db);
  const sourceRegistry = new SourceRegistryService(connectorRepo, connectionTester, duckDBService);

  // 1. Check existing connectors in DB
  const connectors = await connectorRepo.getAll();
  console.log(`Found ${connectors.length} connectors in database:`);
  for (const c of connectors) {
    console.log(` - ID: [${c.id}], Name: "${c.name}", Type: "${c.type}", Config:`, c.connectionConfig);
  }

  // 1.1 Inspect DuckDB tables and columns
  const dbPath = duckDBService.getDuckDbPath(connectors[0]?.connectionConfig?.fileName || "carrier_forecast_dataset");
  console.log(`\nInspecting DuckDB at: ${dbPath}`);
  try {
    const tables = await duckDBService.runQuery(dbPath, "SHOW TABLES");
    console.log("Tables in DuckDB:", tables);
    for (const t of tables || []) {
      const tName = Object.values(t)[0] as string;
      const cols = await duckDBService.runQuery(dbPath, `DESCRIBE "${tName}"`);
      console.log(`Columns in table "${tName}":`, cols.map((c: any) => `${c.column_name} (${c.column_type})`));
    }
  } catch (err: any) {
    console.error("DuckDB inspect error:", err.message);
  }

  // 2. Load agent_state_last_run.json to get the form builder fields
  const jsonPath = path.resolve(__dirname, "../../logs/agent_state_last_run.json");
  let formBuilderSchema: any = null;
  if (fs.existsSync(jsonPath)) {
    const raw = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
    formBuilderSchema = raw.stageOutputs?.hierarchyMapper?.formBuilder || raw.formBuilder || raw.hierarchyMapper?.formBuilder;
  }

  const primarySourceId = connectors[0]?.id || "default_source";
  console.log(`\nTesting filter option extraction against sourceId: [${primarySourceId}]`);

  // Let's test smart column resolution
  const tables = await duckDBService.runQuery(dbPath, "SHOW TABLES");
  const actualTableName = Object.values(tables[0])[0] as string;
  const cols = await duckDBService.runQuery(dbPath, `DESCRIBE "${actualTableName}"`);
  const colNames: string[] = cols.map((c: any) => c.column_name);

  function findBestColumn(fieldId: string, availableCols: string[]): string | null {
    const clean = fieldId.toLowerCase().replace(/[^a-z0-9]/g, "");
    // 1. Exact match case-insensitive
    const exact = availableCols.find((c) => c.toLowerCase() === fieldId.toLowerCase());
    if (exact) return exact;
    // 2. Normalized match (remove underscores)
    const norm = availableCols.find((c) => c.toLowerCase().replace(/[^a-z0-9]/g, "") === clean);
    if (norm) return norm;
    // 3. Prefix / suffix / Name match (e.g. product -> Product_Name, customer -> Customer_Name)
    const nameMatch = availableCols.find((c) => c.toLowerCase().replace(/[^a-z0-9]/g, "") === `${clean}name` || c.toLowerCase().replace(/[^a-z0-9]/g, "") === `name${clean}`);
    if (nameMatch) return nameMatch;
    // 4. Substring match
    const sub = availableCols.find((c) => c.toLowerCase().replace(/[^a-z0-9]/g, "").includes(clean) || clean.includes(c.toLowerCase().replace(/[^a-z0-9]/g, "")));
    if (sub) return sub;
    return null;
  }

  const testFields = [
    "category",
    "energy_efficiency_rating",
    "product",
    "customer_region",
    "customer_country",
    "segment",
    "customer",
    "order_region",
    "order_country",
    "promotion_type",
    "order_year",
    "order_quarter",
    "order_month",
    "supplier_region",
    "supplier_type",
  ];

  console.log("\n--- Testing sourceRegistry.fetchFilterOptions() API ---");
  for (const fieldId of testFields) {
    try {
      const res = await sourceRegistry.fetchFilterOptions({
        sourceId: primarySourceId,
        fieldId,
        limit: 10,
      });
      console.log(`fetchFilterOptions [${fieldId}]: success=${res.success}, count=${res.totalCount}, values=`, res.values);
    } catch (err: any) {
      console.error(`fetchFilterOptions [${fieldId}] ERROR:`, err.message);
    }
  }

  console.log("\n==================================================");
  console.log(" Diagnostics Complete ");
  console.log("==================================================");
  await pool.end();
}

testFilterOptions().catch((err) => {
  console.error("Fatal test error:", err);
  process.exit(1);
});
