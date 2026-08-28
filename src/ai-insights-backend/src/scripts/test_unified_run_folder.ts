import fs from "fs";
import path from "path";
import {
  ensureProjectRunFolder,
  saveModularResolvedSchemas,
  saveModularRelationshipSchema,
  saveModularFormSchema,
  createProjectSchemaFile,
  getPackagesDir,
  generateDateTimeStamp,
  sanitizeName,
} from "../agents/tools/helpers";

async function testUnifiedRunFolder() {
  console.log("==================================================");
  console.log(" Testing Unified Project Run Folder Schema Output ");
  console.log("==================================================\n");

  const workspaceName = "TestWorkspace";
  const projectName = "Order Analytics";
  const cleanWsName = sanitizeName(workspaceName);
  const cleanProjName = sanitizeName(projectName);
  const parentFolderName = `${cleanWsName}-${cleanProjName}`;
  const runSlug = cleanProjName.toLowerCase().replace(/[\s-]+/g, "-");

  const packagesDir = getPackagesDir();
  const parentProjectDir = path.resolve(packagesDir, "ProjectFiles", parentFolderName);

  // 1. Simulate Project Creation (creates domain schema in parent project dir)
  console.log("[Step 1] Creating project initial schema file...");
  await createProjectSchemaFile(workspaceName, {
    name: projectName,
    domain: "E-Commerce",
    subDomain: "Order Management",
    useCase: "Analyze customer orders and fulfillment trends",
  });

  // 2. Initiate Run: Generate single runTimestamp and ensure run folder
  const runTimestamp = generateDateTimeStamp();
  console.log(`\n[Step 2] Initiating run with timestamp: ${runTimestamp}`);
  const runSchemasDir = await ensureProjectRunFolder(workspaceName, projectName, runTimestamp);
  console.log(`Created unified run schemas directory: ${runSchemasDir}`);

  // 3. Save Data Ingestion schema with runTimestamp
  console.log("\n[Step 3] Saving Data Ingestion schema...");
  const diResult = await saveModularResolvedSchemas(
    workspaceName,
    projectName,
    {
      dataIngestionSchema: {
        version: "1.0",
        generatedAt: new Date().toISOString(),
        resolvedTables: ["orders", "customers"],
        fields: { General: [] },
      },
    },
    runTimestamp
  );
  console.log(`Saved DI schema to: ${diResult.dataIngestionPath}`);

  // 4. Save Relationship schema with runTimestamp
  console.log("\n[Step 4] Saving Relationship schema...");
  const relResult = await saveModularRelationshipSchema(
    workspaceName,
    projectName,
    {
      version: "1.0",
      nodes: [{ id: "orders", label: "Orders" }],
      relationships: [],
    },
    runTimestamp
  );
  console.log(`Saved Relationship schema to: ${relResult.relationshipSchemaPath}`);

  // 5. Save Form schema with runTimestamp
  console.log("\n[Step 5] Saving Form schema...");
  const formResult = await saveModularFormSchema(
    workspaceName,
    projectName,
    {
      version: "1.0",
      filterGroups: [{ groupName: "Order Info", fields: [] }],
    },
    runTimestamp
  );
  console.log(`Saved Form schema to: ${formResult.formSchemaPath}`);

  // 6. Verify that ALL schemas exist in the SAME run folder!
  const runFolderName = `${runSlug}-${runTimestamp}`;
  const expectedRunFolder = path.resolve(parentProjectDir, runFolderName, "Schemas");
  console.log(`\n[Step 6] Verifying all schemas in folder: ${expectedRunFolder}`);

  const filesInRunDir = fs.readdirSync(expectedRunFolder);
  console.log("Files inside unified run folder:", filesInRunDir);

  const hasDomain = filesInRunDir.some((f) => f.includes("_domain_") && f.endsWith(".yaml"));
  const hasDI = filesInRunDir.some((f) => f.includes("_data_ingestion_") && f.endsWith(".yaml"));
  const hasRel = filesInRunDir.some((f) => f.includes("_relationship_schema_") && f.endsWith(".yaml"));
  const hasForm = filesInRunDir.some((f) => f.includes("_form_schema_") && f.endsWith(".yaml"));

  if (!hasDomain || !hasDI || !hasRel || !hasForm) {
    throw new Error(
      `Unified run folder verification failed! hasDomain=${hasDomain}, hasDI=${hasDI}, hasRel=${hasRel}, hasForm=${hasForm}`
    );
  }

  // Verify only 1 run subfolder exists for this run timestamp
  const allSubEntries = fs.readdirSync(parentProjectDir);
  const matchingRunFolders = allSubEntries.filter((e) => e.startsWith(`${runSlug}-${runTimestamp}`));
  console.log(`Matching run folders in parent directory:`, matchingRunFolders);
  if (matchingRunFolders.length !== 1) {
    throw new Error(`Expected exactly 1 run folder, found ${matchingRunFolders.length}: ${matchingRunFolders.join(", ")}`);
  }

  // Cleanup test artifacts
  try {
    fs.rmSync(parentProjectDir, { recursive: true, force: true });
  } catch {}

  console.log("\n=== ALL UNIFIED RUN FOLDER TESTS PASSED! ===");
}

testUnifiedRunFolder().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
