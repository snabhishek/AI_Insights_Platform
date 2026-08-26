import path from "path";
import { DuckDBService } from "../services/duckdb/duckdb.service";
import { LocalFileService } from "../services/file/file.service";

async function inspectDemandForecastingDb() {
  const fileService = new LocalFileService();
  const duckDBService = new DuckDBService(fileService);

  const projMaster = path.join(process.cwd(), "Projects", "Demand_Forecasting", "Demand_Forecasting.duckdb");
  const xlsDb = path.join(process.cwd(), "Projects", "Demand_Forecasting", "carrier_forecast_dataset_xls.duckdb");

  console.log("=== Inspecting Demand_Forecasting.duckdb ===");
  try {
    const tables = await duckDBService.runQuery(projMaster, "SHOW TABLES");
    console.log("Tables in Demand_Forecasting.duckdb:", tables);

    for (const t of tables) {
      const tableName = Object.values(t)[0] as string;
      const cols = await duckDBService.runQuery(projMaster, `DESCRIBE "${tableName}"`);
      console.log(`Columns in table "${tableName}":`, cols.map((c: any) => c.column_name));
      const sample = await duckDBService.runQuery(projMaster, `SELECT * FROM "${tableName}" LIMIT 3`);
      console.log(`Sample row in "${tableName}":`, sample);
    }
  } catch (err: any) {
    console.error("Error inspecting Demand_Forecasting.duckdb:", err.message);
  }

  console.log("\n=== Inspecting carrier_forecast_dataset_xls.duckdb ===");
  try {
    const tables = await duckDBService.runQuery(xlsDb, "SHOW TABLES");
    console.log("Tables in carrier_forecast_dataset_xls.duckdb:", tables);

    for (const t of tables) {
      const tableName = Object.values(t)[0] as string;
      const cols = await duckDBService.runQuery(xlsDb, `DESCRIBE "${tableName}"`);
      console.log(`Columns in table "${tableName}":`, cols.map((c: any) => c.column_name));
      const sample = await duckDBService.runQuery(xlsDb, `SELECT * FROM "${tableName}" LIMIT 3`);
      console.log(`Sample row in "${tableName}":`, sample);
    }
  } catch (err: any) {
    console.error("Error inspecting carrier_forecast_dataset_xls.duckdb:", err.message);
  }
}

inspectDemandForecastingDb().catch(console.error);
