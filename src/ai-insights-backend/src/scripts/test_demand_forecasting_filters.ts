import path from "path";
import { DuckDBService } from "../services/duckdb/duckdb.service";
import { LocalFileService } from "../services/file/file.service";
import { SourceRegistryService } from "../services/sourceRegistry/sourceRegistry.service";
import { ConnectionTesterService } from "../services/connector/connectionTester.service";

async function testDemandForecastingFilters() {
  console.log("==========================================================");
  console.log(" Testing Demand Forecasting Filter Options Generation ");
  console.log("==========================================================\n");

  const fileService = new LocalFileService();
  const duckDBService = new DuckDBService(fileService);
  const connectionTester = new ConnectionTesterService(fileService, duckDBService);

  // Clean out previous Demand Forecasting folder
  await duckDBService.deleteProjectFolder("Demand Forecasting");

  const mockConnectors: Record<string, any> = {
    "conn-demand-excel": {
      id: "c7d122c0-fb63-4384-9467-30ff3c895f0f",
      name: "carrier_forecast_dataset.xls",
      type: "excel",
      connectionConfig: { fileName: "carrier_forecast_dataset.xls" },
    },
  };

  const mockProjects: Record<string, any> = {
    "Demand Forecasting": {
      id: "proj-demand-123",
      name: "Demand Forecasting",
      dataSources: ["c7d122c0-fb63-4384-9467-30ff3c895f0f"],
    },
  };

  const mockConnectorRepo: any = {
    getById: async (id: string) => mockConnectors["conn-demand-excel"],
  };

  const mockProjectRepo: any = {
    getById: async (id: string) => mockProjects["Demand Forecasting"],
    getAll: async () => [mockProjects["Demand Forecasting"]],
  };

  const sourceRegistry = new SourceRegistryService(mockConnectorRepo, connectionTester, duckDBService, mockProjectRepo);

  console.log("[Step 1] Ingesting & Querying 'category' (Product Category)...");
  const categoryResult = await sourceRegistry.fetchFilterOptions({
    sourceId: "c7d122c0-fb63-4384-9467-30ff3c895f0f",
    projectId: "proj-demand-123",
    projectName: "Demand Forecasting",
    fieldId: "category",
  });
  console.log("Category Result values:", categoryResult.values);

  console.log("\n[Step 2] Querying 'customer_region' (Customer Region)...");
  const regionResult = await sourceRegistry.fetchFilterOptions({
    sourceId: "c7d122c0-fb63-4384-9467-30ff3c895f0f",
    projectId: "proj-demand-123",
    projectName: "Demand Forecasting",
    fieldId: "customer_region",
  });
  console.log("Customer Region Result values:", regionResult.values);

  console.log("\n[Step 3] Querying 'customer_country' (Customer Country) with parent filter Region='Asia_Pacific'...");
  const countryResult = await sourceRegistry.fetchFilterOptions({
    sourceId: "c7d122c0-fb63-4384-9467-30ff3c895f0f",
    projectId: "proj-demand-123",
    projectName: "Demand Forecasting",
    fieldId: "customer_country",
    parentParams: { customer_region: "Asia_Pacific" },
    parentFields: ["customer_region"],
  });
  console.log("Customer Country Result values:", countryResult.values);

  console.log("\n[Step 4] Querying 'energy_efficiency_rating'...");
  const ratingResult = await sourceRegistry.fetchFilterOptions({
    sourceId: "c7d122c0-fb63-4384-9467-30ff3c895f0f",
    projectId: "proj-demand-123",
    projectName: "Demand Forecasting",
    fieldId: "energy_efficiency_rating",
  });
  console.log("Energy Rating Result values:", ratingResult.values);

  console.log("\n[Step 5] Querying 'product' (Product name/description)...");
  const productResult = await sourceRegistry.fetchFilterOptions({
    sourceId: "c7d122c0-fb63-4384-9467-30ff3c895f0f",
    projectId: "proj-demand-123",
    projectName: "Demand Forecasting",
    fieldId: "product",
  });
  console.log("Product Result values (sample 5):", productResult.values.slice(0, 5));

  if (categoryResult.values.length === 0 || regionResult.values.length === 0) {
    throw new Error("Validation failed: Filter values are empty!");
  }

  console.log("\n=== ALL DEMAND FORECASTING FILTER TESTS PASSED! ===");
}

testDemandForecastingFilters().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
