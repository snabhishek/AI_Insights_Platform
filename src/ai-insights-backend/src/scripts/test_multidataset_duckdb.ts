import fs from "fs";
import path from "path";
import { DuckDBService } from "../services/duckdb/duckdb.service";
import { LocalFileService } from "../services/file/file.service";
import { SourceRegistryService } from "../services/sourceRegistry/sourceRegistry.service";
import { ConnectionTesterService } from "../services/connector/connectionTester.service";

async function runMultiDatasetDuckDBTest() {
  console.log("==================================================");
  console.log(" Multi-Dataset DuckDB & Concurrency Test Runner  ");
  console.log("==================================================\n");

  const fileService = new LocalFileService();
  const duckDBService = new DuckDBService(fileService);
  const connectionTester = new ConnectionTesterService(fileService, duckDBService);

  const mockConnectorRepo: any = {
    getById: async (id: string) => {
      return {
        id,
        name: `Source_${id}`,
        type: "csv",
        connectionConfig: { fileName: `${id}.csv` },
      };
    },
  };

  const sourceRegistry = new SourceRegistryService(mockConnectorRepo, connectionTester, duckDBService);

  const projectName = "Test_Ecommerce_Project";
  const projectDir = duckDBService.getProjectPath(projectName);

  console.log(`[Step 1] Ingesting multiple datasets into project folder: ${projectDir}`);

  // Create mock CSV datasets in uploads for testing
  const uploadsDir = path.join(process.cwd(), "uploads");
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

  const sellersCsv = path.join(uploadsDir, "test_sellers.csv");
  fs.writeFileSync(
    sellersCsv,
    "seller_id,seller_city,seller_state,seller_zip_code_prefix\n" +
    "s1,sao paulo,SP,01000\n" +
    "s2,curitiba,PR,80000\n" +
    "s3,rio de janeiro,RJ,20000\n"
  );

  const customersCsv = path.join(uploadsDir, "test_customers.csv");
  fs.writeFileSync(
    customersCsv,
    "customer_id,customer_city,customer_state,customer_zip_code_prefix\n" +
    "c1,sao paulo,SP,01001\n" +
    "c2,belo horizonte,MG,30000\n" +
    "c3,porto alegre,RS,90000\n"
  );

  const ordersCsv = path.join(uploadsDir, "test_orders.csv");
  fs.writeFileSync(
    ordersCsv,
    "order_id,customer_id,order_status,order_purchase_timestamp\n" +
    "o1,c1,delivered,2024-01-10 10:00:00\n" +
    "o2,c2,delivered,2024-05-15 14:30:00\n" +
    "o3,c3,shipped,2024-11-20 09:15:00\n"
  );

  const translationCsv = path.join(uploadsDir, "test_translations.csv");
  fs.writeFileSync(
    translationCsv,
    "product_category_name,product_category_name_english\n" +
    "beleza_saude,health_beauty\n" +
    "informatica_acessorios,computers_accessories\n"
  );

  const sources = [
    { type: "csv" as const, config: { fileName: "test_sellers.csv" }, name: "sellers" },
    { type: "csv" as const, config: { fileName: "test_customers.csv" }, name: "customers" },
    { type: "csv" as const, config: { fileName: "test_orders.csv" }, name: "orders" },
    { type: "csv" as const, config: { fileName: "test_translations.csv" }, name: "translations" },
  ];

  const projectMasterDb = await duckDBService.ingestProjectSources(projectName, sources);
  console.log(`[Step 1 PASS] Ingested into project master DB: ${projectMasterDb}`);

  if (!fs.existsSync(projectMasterDb)) {
    throw new Error(`Project master DB does not exist at ${projectMasterDb}`);
  }

  // Verify project folder contains the duckdb files
  const projectFiles = fs.readdirSync(projectDir);
  console.log(`Project folder contents:`, projectFiles);

  // 2. Test Multi-Dataset Table & Column Resolution
  console.log("\n[Step 2] Testing column queries across multiple tables in project...");

  const testQueries = [
    { fieldId: "seller_state", expected: ["PR", "RJ", "SP"] },
    { fieldId: "seller_city", expected: ["curitiba", "rio de janeiro", "sao paulo"] },
    { fieldId: "customer_state", expected: ["MG", "RS", "SP"] },
    { fieldId: "customer_city", expected: ["belo horizonte", "porto alegre", "sao paulo"] },
    { fieldId: "product_category_name_english", expected: ["computers_accessories", "health_beauty"] },
  ];

  for (const tq of testQueries) {
    const res = await sourceRegistry.fetchFilterOptions({
      sourceId: projectName,
      projectId: projectName,
      fieldId: tq.fieldId,
    });

    console.log(` - Query for field "${tq.fieldId}": success=${res.success}, values=${JSON.stringify(res.values)}`);
    if (!res.success || res.values.length === 0) {
      throw new Error(`Field query failed for ${tq.fieldId}`);
    }
  }

  // 3. Test date_range query
  console.log("\n[Step 3] Testing date_range bounds calculation for order_purchase_timestamp...");
  const dateRes = await sourceRegistry.fetchFilterOptions({
    sourceId: projectName,
    projectId: projectName,
    fieldId: "order_purchase_timestamp",
    controlType: "date_range",
  });
  console.log(` - Date range result:`, dateRes.dateRange);
  if (!dateRes.dateRange?.min || !dateRes.dateRange?.max) {
    throw new Error("Date range calculation failed");
  }

  // 4. Test Concurrency Safety (Simultaneous 30 requests)
  console.log("\n[Step 4] Testing high-concurrency parallel queries (30 simultaneous queries)...");
  const concurrentPromises = [];
  for (let i = 0; i < 30; i++) {
    const target = testQueries[i % testQueries.length];
    concurrentPromises.push(
      sourceRegistry.fetchFilterOptions({
        sourceId: projectName,
        projectId: projectName,
        fieldId: target.fieldId,
      })
    );
  }

  const concurrentResults = await Promise.all(concurrentPromises);
  const allSuccessful = concurrentResults.every((r) => r.success && r.values.length > 0);
  console.log(` - 30/30 concurrent queries succeeded: ${allSuccessful}`);
  if (!allSuccessful) {
    throw new Error("Concurrent query execution had failures");
  }

  // Clean up test files
  await new Promise((resolve) => setTimeout(resolve, 500));
  await duckDBService.deleteProjectFolder(projectName);
  for (const f of [sellersCsv, customersCsv, ordersCsv, translationCsv]) {
    try { fs.unlinkSync(f); } catch {}
  }

  console.log("\n=== ALL MULTI-DATASET DUCKDB TESTS PASSED SUCCESSFULLY! ===");
}

runMultiDatasetDuckDBTest().catch((err) => {
  console.error("Test failed with error:", err);
  process.exit(1);
});
