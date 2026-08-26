import fs from "fs";
import path from "path";
import { DuckDBService } from "../services/duckdb/duckdb.service";
import { LocalFileService } from "../services/file/file.service";
import { SourceRegistryService } from "../services/sourceRegistry/sourceRegistry.service";
import { ConnectionTesterService } from "../services/connector/connectionTester.service";

async function runConcurrencyRaceTest() {
  console.log("==========================================================");
  console.log(" Testing Concurrent Filter Query & Ingestion Race Defense ");
  console.log("==========================================================\n");

  const fileService = new LocalFileService();
  const duckDBService = new DuckDBService(fileService);
  const connectionTester = new ConnectionTesterService(fileService, duckDBService);

  const uploadsDir = path.join(process.cwd(), "uploads");
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

  const testCsv = path.join(uploadsDir, "test_race_forecast.csv");
  fs.writeFileSync(
    testCsv,
    "product_sku,category,customer,customer_region,energy_rating\n" +
    "HP-100,Heat Pumps,Customer A,North America,A+\n" +
    "AC-500,Air Conditioners,Customer B,EMEA,A++\n" +
    "FN-900,Furnaces,Customer C,APAC,B\n"
  );

  const mockConnectors: Record<string, any> = {
    "conn-race": {
      id: "conn-race",
      name: "Demand Forecasting Source",
      type: "csv",
      connectionConfig: { fileName: "test_race_forecast.csv" },
    },
  };

  const mockProjects: Record<string, any> = {
    "proj-race": {
      id: "proj-race",
      name: "Demand Forecasting Race Test",
      dataSources: ["conn-race"],
    },
  };

  const mockConnectorRepo: any = {
    getById: async (id: string) => mockConnectors[id] || null,
  };

  const mockProjectRepo: any = {
    getById: async (id: string) => mockProjects[id],
    getAll: async () => Object.values(mockProjects),
  };

  const sourceRegistry = new SourceRegistryService(mockConnectorRepo, connectionTester, duckDBService, mockProjectRepo);

  // Ensure project folder is clean before test (not yet ingested)
  await duckDBService.deleteProjectFolder("Demand Forecasting Race Test");

  const fields = ["category", "product_sku", "customer", "customer_region", "energy_rating"];
  console.log(`Firing 20 simultaneous filter option queries on un-ingested project...`);

  const promises: Promise<any>[] = [];
  for (let i = 0; i < 20; i++) {
    const fieldId = fields[i % fields.length];
    promises.push(
      sourceRegistry.fetchFilterOptions({
        sourceId: "conn-race",
        projectId: "proj-race",
        projectName: "Demand Forecasting Race Test",
        fieldId,
      })
    );
  }

  const results = await Promise.all(promises);
  console.log(`Received all 20 responses!`);

  let successCount = 0;
  for (let i = 0; i < results.length; i++) {
    const res = results[i];
    if (res.success && Array.isArray(res.values) && res.values.length > 0) {
      successCount++;
    } else {
      console.warn(`Query ${i} failed or returned empty:`, res);
    }
  }

  console.log(`Success rate: ${successCount}/20 (${(successCount / 20) * 100}%)`);

  if (successCount !== 20) {
    throw new Error(`Concurrency test failed! Expected 20/20 successes, got ${successCount}/20`);
  }

  // Cleanup
  await duckDBService.deleteProjectFolder("Demand Forecasting Race Test");
  try { fs.unlinkSync(testCsv); } catch {}

  console.log("\n=== CONCURRENT RACE CONDITION TEST PASSED 100%! ===");
}

runConcurrencyRaceTest().catch((err) => {
  console.error("Test failed with error:", err);
  process.exit(1);
});
