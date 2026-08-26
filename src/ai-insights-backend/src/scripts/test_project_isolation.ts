import fs from "fs";
import path from "path";
import { DuckDBService } from "../services/duckdb/duckdb.service";
import { LocalFileService } from "../services/file/file.service";
import { SourceRegistryService } from "../services/sourceRegistry/sourceRegistry.service";
import { ConnectionTesterService } from "../services/connector/connectionTester.service";

async function runProjectIsolationTest() {
  console.log("==================================================");
  console.log(" Cross-Project Query Strict Isolation Test Runner ");
  console.log("==================================================\n");

  const fileService = new LocalFileService();
  const duckDBService = new DuckDBService(fileService);
  const connectionTester = new ConnectionTesterService(fileService, duckDBService);

  const uploadsDir = path.join(process.cwd(), "uploads");
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

  // 1. Create Ecommerce CSV file
  const ecommerceCsv = path.join(uploadsDir, "test_ecommerce_products.csv");
  fs.writeFileSync(
    ecommerceCsv,
    "product_id,product_category_name,seller_state\n" +
    "p1,beleza_saude,SP\n" +
    "p2,informatica_acessorios,RJ\n"
  );

  // 2. Create Demand Forecasting CSV file
  const demandCsv = path.join(uploadsDir, "test_demand_forecasting.csv");
  fs.writeFileSync(
    demandCsv,
    "product_sku,product_category,energy_rating\n" +
    "HP-100,Heat Pumps,A+\n" +
    "AC-500,Air Conditioners,A++\n" +
    "FN-900,Furnaces,B\n"
  );

  const mockConnectors: Record<string, any> = {
    "conn-ecom": {
      id: "conn-ecom",
      name: "Ecommerce Data",
      type: "csv",
      connectionConfig: { fileName: "test_ecommerce_products.csv" },
    },
    "conn-demand": {
      id: "conn-demand",
      name: "Demand Forecasting Data",
      type: "csv",
      connectionConfig: { fileName: "test_demand_forecasting.csv" },
    },
  };

  const mockProjects: Record<string, any> = {
    "proj-ecom": {
      id: "proj-ecom",
      name: "Ecommerce",
      dataSources: ["conn-ecom"],
    },
    "proj-demand": {
      id: "proj-demand",
      name: "Demand Forecasting",
      dataSources: ["conn-demand"],
    },
  };

  const mockConnectorRepo: any = {
    getById: async (id: string) => mockConnectors[id] || null,
  };

  const mockProjectRepo: any = {
    getById: async (id: string) => mockProjects[id] || Object.values(mockProjects).find((p) => p.name === id),
    getAll: async () => Object.values(mockProjects),
  };

  const sourceRegistry = new SourceRegistryService(mockConnectorRepo, connectionTester, duckDBService, mockProjectRepo);

  // Ingest both projects into their respective project folders
  console.log("[Step 1] Ingesting Ecommerce project into Projects/Ecommerce/...");
  await duckDBService.ingestProjectSources("Ecommerce", [
    { type: "csv", config: { fileName: "test_ecommerce_products.csv" }, name: "products" },
  ]);

  console.log("[Step 2] Ingesting Demand Forecasting project into Projects/Demand_Forecasting/...");
  await duckDBService.ingestProjectSources("Demand Forecasting", [
    { type: "csv", config: { fileName: "test_demand_forecasting.csv" }, name: "demand" },
  ]);

  // Test 1: Query Demand Forecasting for "category" -> Must return ["Air Conditioners", "Furnaces", "Heat Pumps"]
  console.log("\n[Test 1] Querying category for Demand Forecasting project...");
  const demandCategoryResult = await sourceRegistry.fetchFilterOptions({
    sourceId: "conn-demand",
    projectId: "proj-demand",
    projectName: "Demand Forecasting",
    fieldId: "category",
  });
  console.log(" - Demand category result:", demandCategoryResult.values);
  if (
    !demandCategoryResult.success ||
    !demandCategoryResult.values.includes("Heat Pumps") ||
    demandCategoryResult.values.includes("beleza_saude")
  ) {
    throw new Error("Test 1 Failed: Demand Forecasting returned wrong or cross-project leaked categories!");
  }

  // Test 2: Query Ecommerce for "category" -> Must return ["beleza_saude", "informatica_acessorios"]
  console.log("\n[Test 2] Querying category for Ecommerce project...");
  const ecomCategoryResult = await sourceRegistry.fetchFilterOptions({
    sourceId: "conn-ecom",
    projectId: "proj-ecom",
    projectName: "Ecommerce",
    fieldId: "category",
  });
  console.log(" - Ecommerce category result:", ecomCategoryResult.values);
  if (
    !ecomCategoryResult.success ||
    !ecomCategoryResult.values.includes("beleza_saude") ||
    ecomCategoryResult.values.includes("Heat Pumps")
  ) {
    throw new Error("Test 2 Failed: Ecommerce returned wrong or cross-project leaked categories!");
  }

  // Test 3: Query field that ONLY exists in Ecommerce ("seller_state") while on Demand Forecasting project
  console.log("\n[Test 3] Querying 'seller_state' (Ecommerce column) while scoped to Demand Forecasting project...");
  const crossLeakResult = await sourceRegistry.fetchFilterOptions({
    sourceId: "conn-demand",
    projectId: "proj-demand",
    projectName: "Demand Forecasting",
    fieldId: "seller_state",
  });
  console.log(" - Cross-leak attempt result:", crossLeakResult.values);
  if (crossLeakResult.values.length > 0) {
    throw new Error("Test 3 Failed: Cross-project leakage detected! seller_state leaked into Demand Forecasting!");
  }

  // Clean up
  await duckDBService.deleteProjectFolder("Ecommerce");
  await duckDBService.deleteProjectFolder("Demand Forecasting");
  try { fs.unlinkSync(ecommerceCsv); } catch {}
  try { fs.unlinkSync(demandCsv); } catch {}

  console.log("\n=== ALL CROSS-PROJECT ISOLATION TESTS PASSED 100%! ===");
}

runProjectIsolationTest().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
