import { SourceRegistryService } from "./services/sourceRegistry/sourceRegistry.service";

async function runFilterOptionsTests() {
  console.log("=== Starting Filter Options & SourceRegistry Tests ===");
  let passedCount = 0;
  let totalCount = 0;

  function assert(condition: boolean, testName: string) {
    totalCount++;
    if (condition) {
      console.log(`[PASS] Test ${totalCount}: ${testName}`);
      passedCount++;
    } else {
      console.error(`[FAIL] Test ${totalCount}: ${testName}`);
    }
  }

  // Mock connector repository and connection tester service
  const mockConnectorRepo: any = {
    getById: async (id: string) => {
      if (id === "test-source-1") {
        return {
          id: "test-source-1",
          name: "Test Sales Data",
          type: "csv",
          connectionConfig: { fileName: "sales_data.csv" },
        };
      }
      return undefined;
    },
  };

  const mockConnectionTester: any = {
    getSampleWithOffset: async (type: string, config: any, table: string, limit: number, offset: number) => {
      const allRows = [
        { category: "Heat Pumps", segment: "Residential", sku: "HP-100", region: "North America", date: "2026-01-15" },
        { category: "Heat Pumps", segment: "Commercial", sku: "HP-200", region: "North America", date: "2026-02-20" },
        { category: "AC Units", segment: "Residential", sku: "AC-500", region: "EMEA", date: "2026-03-10" },
        { category: "AC Units", segment: "Commercial", sku: "AC-600", region: "APAC", date: "2026-04-05" },
        { category: "Furnaces", segment: "Industrial", sku: "FN-900", region: "LATAM", date: "2026-05-12" },
      ];
      return { success: true, headers: Object.keys(allRows[0]), rows: allRows, totalRowCount: allRows.length };
    },
  };

  const registry = new SourceRegistryService(mockConnectorRepo, mockConnectionTester);

  // Test 1: Root-level field (zero parents) option retrieval
  try {
    const res1 = await registry.fetchFilterOptions({
      sourceId: "test-source-1",
      fieldId: "category",
      limit: 10,
    });
    assert(
      res1.success && res1.values.length === 3 && res1.values.includes("Heat Pumps") && res1.values.includes("AC Units"),
      "Root-level field (zero parents) fetches unfiltered options"
    );
  } catch (err: any) {
    assert(false, `Root-level field test threw error: ${err.message}`);
  }

  // Test 2: Multi-parent field filtering when parents are supplied
  try {
    const res2 = await registry.fetchFilterOptions({
      sourceId: "test-source-1",
      fieldId: "sku",
      parentFields: ["category", "segment"],
      parentParams: { category: "Heat Pumps", segment: "Commercial" },
      limit: 10,
    });
    assert(
      res2.success && res2.values.length === 1 && res2.values[0] === "HP-200" && !res2.isIndependentFallback,
      "Multi-parent field filters options correctly when parent values are supplied"
    );
  } catch (err: any) {
    assert(false, `Multi-parent field test threw error: ${err.message}`);
  }

  // Test 3: Fallback independent field options when parent fields have no values supplied
  try {
    const res3 = await registry.fetchFilterOptions({
      sourceId: "test-source-1",
      fieldId: "sku",
      parentFields: ["category", "segment"],
      parentParams: {}, // No parent values supplied
      limit: 10,
    });
    assert(
      res3.success && res3.values.length === 5 && res3.isIndependentFallback === true,
      "Fallback to independent field options when parent values are omitted (no 400 error)"
    );
  } catch (err: any) {
    assert(false, `Independent fallback test threw error: ${err.message}`);
  }

  // Test 4: Search term filtering & limit capping
  try {
    const res4 = await registry.fetchFilterOptions({
      sourceId: "test-source-1",
      fieldId: "sku",
      search: "HP",
      limit: 10,
    });
    assert(
      res4.success && res4.values.length === 2 && res4.values.every((v: any) => String(v).includes("HP")),
      "Search parameter filters choices with partial case-insensitive match"
    );
  } catch (err: any) {
    assert(false, `Search term test threw error: ${err.message}`);
  }

  // Test 5: date_range MIN/MAX bounds calculation
  try {
    const res5 = await registry.fetchFilterOptions({
      sourceId: "test-source-1",
      fieldId: "date",
      controlType: "date_range",
      limit: 10,
    });
    assert(
      res5.success && res5.dateRange?.min === "2026-01-15" && res5.dateRange?.max === "2026-05-12",
      "date_range controlType computes MIN and MAX date bounds"
    );
  } catch (err: any) {
    assert(false, `Date range bounds test threw error: ${err.message}`);
  }

  // Test 6: Empty result set handling for unmatched query
  try {
    const res6 = await registry.fetchFilterOptions({
      sourceId: "test-source-1",
      fieldId: "category",
      search: "NON_EXISTENT_QUERY_TERM",
      limit: 10,
    });
    assert(
      res6.success && res6.values.length === 0,
      "Empty result set returns clean success with empty values array"
    );
  } catch (err: any) {
    assert(false, `Empty result set test threw error: ${err.message}`);
  }

  // Test 7: Security validation of SQL identifiers
  try {
    let threwSecurityError = false;
    try {
      await registry.fetchFilterOptions({
        sourceId: "test-source-1",
        fieldId: "category'; DROP TABLE sales_data; --",
        limit: 10,
      });
    } catch {
      threwSecurityError = true;
    }
    assert(threwSecurityError, "Security validation rejects invalid SQL identifier with malicious characters");
  } catch (err: any) {
    assert(false, `Security validation test threw error: ${err.message}`);
  }

  console.log(`\n=== Test Results: ${passedCount}/${totalCount} Passed ===`);
  if (passedCount < totalCount) {
    process.exit(1);
  }
}

runFilterOptionsTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
