import fs from "fs";
import path from "path";
import { LocalFileService } from "../services/file/file.service";
import { DuckDBService } from "../services/duckdb/duckdb.service";
import {
  computeProjectRelativePath,
  ensureFileServerDirectories,
  getDatasourceFilePath,
  getDatasourcesBasePath,
  getFileServerBasePath,
  getWorkspacesBasePath,
  resolveStoragePath,
  sanitizeFolderName,
} from "../config/fileServer.config";
import { getProjectDirectory, getPythonScriptDirectory, getMcpFilesystemTools, closeAllMcpClients } from "../agents/tools/filesystem/mcpFilesystemClient";

async function runFileServerArchitectureTest() {
  console.log("==================================================================");
  console.log(" FILE_SERVER_PATH & Multi-Workspace Architecture Verification ");
  console.log("==================================================================\n");

  // 1. Verify Configuration & Directory Initializer
  ensureFileServerDirectories();
  const fileServerBase = getFileServerBasePath();
  console.log(`[Config] Base Storage Path: ${fileServerBase}`);
  console.log(`[Config] Datasources Base: ${getDatasourcesBasePath()}`);
  console.log(`[Config] Workspaces Base: ${getWorkspacesBasePath()}`);

  if (!fs.existsSync(getDatasourcesBasePath())) throw new Error("Datasources base directory missing");
  if (!fs.existsSync(getWorkspacesBasePath())) throw new Error("Workspaces base directory missing");
  console.log("✓ Core storage directories verified.\n");

  // 2. Verify Workspace-Scoped Datasource File Saving & Isolation
  const fileService = new LocalFileService();
  const workspaceA = "Global Retail Workspace";
  const dsNameA = "Retail Orders 2026";
  const fileNameA = "orders_q1.csv";
  const csvContentA = "order_id,amount,status\n101,250.00,completed\n102,120.50,shipped\n103,99.99,processing";

  const savedPathA = await fileService.saveDatasourceFile(dsNameA, fileNameA, csvContentA, workspaceA);
  console.log(`[Workspace Datasource A] Saved file to: ${savedPathA}`);
  if (!fs.existsSync(savedPathA)) throw new Error("Workspace A datasource file was not created on disk");

  const expectedPathA = path.join(fileServerBase, "workspaces", sanitizeFolderName(workspaceA), "datasources", sanitizeFolderName(dsNameA), fileNameA);
  if (path.resolve(savedPathA) !== path.resolve(expectedPathA)) {
    throw new Error(`Saved path mismatch: expected ${expectedPathA}, got ${savedPathA}`);
  }

  // Workspace B with same file name but different content
  const workspaceB = "Enterprise EMEA Workspace";
  const dsNameB = "Retail Orders 2026";
  const fileNameB = "orders_q1.csv";
  const csvContentB = "order_id,amount,currency\n901,1500.00,EUR\n902,3200.00,EUR";

  const savedPathB = await fileService.saveDatasourceFile(dsNameB, fileNameB, csvContentB, workspaceB);
  console.log(`[Workspace Datasource B] Saved file to: ${savedPathB}`);
  if (!fs.existsSync(savedPathB)) throw new Error("Workspace B datasource file was not created on disk");

  const retrievedA = fileService.readTextFile(fileNameA, dsNameA, workspaceA);
  const retrievedB = fileService.readTextFile(fileNameB, dsNameB, workspaceB);
  if (!retrievedA.includes("101,250.00,completed") || retrievedA.includes("EUR")) {
    throw new Error("Workspace A datasource content polluted by Workspace B");
  }
  if (!retrievedB.includes("901,1500.00,EUR") || retrievedB.includes("completed")) {
    throw new Error("Workspace B datasource content polluted by Workspace A");
  }
  console.log("✓ Workspace-scoped datasource files saved, isolated, and retrieved accurately across distinct workspaces.\n");

  // 3. Verify Multi-Workspace Project Path Computation & Creation
  const projectName = "Order Analytics & Demand Planning";
  const relativeFolderPath = computeProjectRelativePath(workspaceA, projectName);
  const absoluteProjectPath = resolveStoragePath(relativeFolderPath);
  fileService.getProjectDirectory(relativeFolderPath);

  console.log(`[Workspace/Project] Relative Folder Path (stored in DB): ${relativeFolderPath}`);
  console.log(`[Workspace/Project] Absolute Project Directory: ${absoluteProjectPath}`);

  if (!fs.existsSync(absoluteProjectPath)) throw new Error("Project designated folder was not created");
  console.log("✓ Project designated folder created under multi-workspace hierarchy.\n");

  // 4. Verify DuckDB Ingestion into Project-Scoped Folder
  const duckdbService = new DuckDBService(fileService);
  const masterDbPath = await duckdbService.ingestProjectSources(
    projectName,
    [
      {
        name: dsNameA,
        type: "csv",
        config: { fileName: fileNameA },
      },
    ],
    workspaceA,
    relativeFolderPath
  );

  console.log(`[DuckDB] Master project database created at: ${masterDbPath}`);
  if (!fs.existsSync(masterDbPath)) throw new Error("Project DuckDB master file was not created on disk");

  const tables = await duckdbService.runQuery(masterDbPath, "SHOW TABLES");
  console.log(`[DuckDB] Tables in project database:`, tables);
  if (tables.length === 0) throw new Error("No tables found in ingested project database");

  const sampleRows = await duckdbService.runQuery(masterDbPath, `SELECT * FROM "orders_q1" LIMIT 2`);
  console.log(`[DuckDB] Sample rows from project table:`, sampleRows);
  if (sampleRows.length !== 2) throw new Error("Unexpected row count from DuckDB sample query");
  console.log("✓ DuckDB ingestion and queries verified inside project folder.\n");

  // 5. Verify Project Folder Directory and Python Script Subfolder
  const projectDir = getProjectDirectory({
    projectName,
    workspaceName: workspaceA,
    folderPath: relativeFolderPath,
  });

  const pythonScriptDir = getPythonScriptDirectory({
    projectName,
    workspaceName: workspaceA,
    folderPath: relativeFolderPath,
  });

  console.log(`[Project Dir] Project Root Path: ${projectDir}`);
  console.log(`[Python Script Dir] Python Script Path: ${pythonScriptDir}`);

  if (path.resolve(projectDir) !== path.resolve(absoluteProjectPath)) {
    throw new Error(`Project dir (${projectDir}) does not match expected project path (${absoluteProjectPath})`);
  }

  const expectedPythonScriptDir = path.join(absoluteProjectPath, "python_script");
  if (path.resolve(pythonScriptDir) !== path.resolve(expectedPythonScriptDir)) {
    throw new Error(`Python script dir (${pythonScriptDir}) does not match expected (${expectedPythonScriptDir})`);
  }

  // 6. Verify MCP Filesystem Server Scoped to Project Folder
  const tools = await getMcpFilesystemTools({
    projectName,
    workspaceName: workspaceA,
    folderPath: relativeFolderPath,
  });

  const toolNames = tools.map((t) => t.name);
  console.log(`[MCP Filesystem] Available LangChain Tools from MCP (Project-Scoped):`, toolNames);
  if (toolNames.length === 0) throw new Error("No MCP filesystem tools retrieved");

  await closeAllMcpClients();
  console.log("✓ MCP Filesystem server scoped to project folder and lifecycle closed.\n");

  console.log("==================================================================");
  console.log(" ALL FILE SERVER ARCHITECTURE VERIFICATIONS PASSED SUCCESSFULLY! ");
  console.log("==================================================================");
}

runFileServerArchitectureTest().catch((err) => {
  console.error("Test failed with error:", err);
  process.exit(1);
});
