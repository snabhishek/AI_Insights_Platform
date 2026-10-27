import * as fs from "fs/promises";
import * as fsSync from "fs";
import * as path from "path";
import {
  getProjectDir,
  getProjectRunDir,
  resolveStoragePath,
} from "../../../config/fileServer.config";
import { cleanupRunContainer } from "./pythonExecutor";
import { TrackedAgentKey } from "../../pipelineNames";
import { mapRetryStepToInterruptNode } from "../../utils/agentUtils";

const RETRY_NODE_ORDER: TrackedAgentKey[] = [
  "inspect",
  "profileData",
  "resolveSchema",
  "hierarchyMapperNode",
  "featureArchitectNode",
  "featureValidatorNode",
  "exogenous",
  "modelSelectionNode",
  "trainingConfigurationNode",
  "preFlightNode",
  "modelTrainingCodeNode",
  "modelTrainingExecutionNode",
];

export interface RetryCleanupOptions {
  projectId?: string;
  workspaceName?: string;
  projectName?: string;
  folderPath?: string;
  runTimestamp?: string;
  targetStep: string;
}

async function safeDelete(targetPath: string, deletedItems: string[]): Promise<void> {
  try {
    if (fsSync.existsSync(targetPath)) {
      const stat = await fs.stat(targetPath);
      if (stat.isDirectory()) {
        await fs.rm(targetPath, { recursive: true, force: true });
      } else {
        await fs.unlink(targetPath);
      }
      deletedItems.push(targetPath);
    }
  } catch (err: any) {
    console.warn(`[RetryCleanup] Failed to delete path ${targetPath}:`, err?.message || err);
  }
}

async function scanAndDeleteFiles(
  dirPath: string,
  predicate: (fileName: string) => boolean,
  deletedItems: string[]
): Promise<void> {
  if (!fsSync.existsSync(dirPath)) return;
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (predicate(entry.name)) {
        const fullPath = path.join(dirPath, entry.name);
        await safeDelete(fullPath, deletedItems);
      }
    }
  } catch (err: any) {
    console.warn(`[RetryCleanup] Failed to scan directory ${dirPath}:`, err?.message || err);
  }
}

export async function deleteStepAndSuccessorFiles(
  options: RetryCleanupOptions
): Promise<{ deletedItems: string[] }> {
  const deletedItems: string[] = [];

  const rawStep = options.targetStep;
  const targetNode = mapRetryStepToInterruptNode(rawStep) as TrackedAgentKey | undefined;
  if (!targetNode || !RETRY_NODE_ORDER.includes(targetNode)) {
    console.warn(`[RetryCleanup] Unknown retry step "${rawStep}", skipping file cleanup.`);
    return { deletedItems };
  }

  const targetIndex = RETRY_NODE_ORDER.indexOf(targetNode);
  const affectedNodes = new Set<TrackedAgentKey>(RETRY_NODE_ORDER.slice(targetIndex));

  console.info(
    `[RetryCleanup] Initiating file cleanup for retry of "${targetNode}" and successors: [${Array.from(affectedNodes).join(", ")}]`
  );

  const workspaceName = options.workspaceName || "Default_Workspace";
  const projectName = options.projectName;

  if (!projectName) {
    console.warn(`[RetryCleanup] No projectName provided, skipping file cleanup.`);
    return { deletedItems };
  }

  const baseProjectDir = getProjectDir(workspaceName, projectName);
  const customProjectDir = options.folderPath ? resolveStoragePath(options.folderPath) : undefined;

  const projectDirs = new Set<string>();
  if (fsSync.existsSync(baseProjectDir)) {
    projectDirs.add(baseProjectDir);
  }
  if (customProjectDir && fsSync.existsSync(customProjectDir)) {
    projectDirs.add(customProjectDir);
  }

  const runDirs = new Set<string>();
  for (const pDir of projectDirs) {
    if (options.runTimestamp) {
      const explicitRunDir = path.join(pDir, options.runTimestamp);
      if (fsSync.existsSync(explicitRunDir)) {
        runDirs.add(explicitRunDir);
      }
    }
    try {
      const entries = fsSync.readdirSync(pDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (entry.name.match(/^\d{8}[-_]\d{6}/) || entry.name.match(/^\d{10,}$/)) {
            runDirs.add(path.join(pDir, entry.name));
          }
        }
      }
    } catch (err: any) {
      console.warn(`[RetryCleanup] Error scanning directories in ${pDir}:`, err?.message || err);
    }
  }

  const schemasDirs = new Set<string>();
  const pythonScriptDirs = new Set<string>();
  const datasetDirs = new Set<string>();

  for (const pDir of projectDirs) {
    const sDir = path.join(pDir, "schemas");
    if (fsSync.existsSync(sDir)) schemasDirs.add(sDir);
    const pyDir = path.join(pDir, "python_script");
    if (fsSync.existsSync(pyDir)) pythonScriptDirs.add(pyDir);
    const dsDir = path.join(pDir, "dataset");
    if (fsSync.existsSync(dsDir)) datasetDirs.add(dsDir);
  }
  for (const rDir of runDirs) {
    const sDir = path.join(rDir, "schemas");
    if (fsSync.existsSync(sDir)) schemasDirs.add(sDir);
    const pyDir = path.join(rDir, "python_script");
    if (fsSync.existsSync(pyDir)) pythonScriptDirs.add(pyDir);
    const dsDir = path.join(rDir, "dataset");
    if (fsSync.existsSync(dsDir)) datasetDirs.add(dsDir);
    if (fsSync.existsSync(rDir)) {
      try {
        const sub = fsSync.readdirSync(rDir, { withFileTypes: true });
        for (const entry of sub) {
          if (entry.isDirectory() && entry.name.endsWith("_feature_engineering")) {
            pythonScriptDirs.add(path.join(rDir, entry.name));
          }
        }
      } catch {}
    }
  }

  if (affectedNodes.has("featureArchitectNode") || affectedNodes.has("modelTrainingCodeNode")) {
    if (options.projectId) {
      try {
        await cleanupRunContainer(options.projectId, options.runTimestamp);
      } catch (err: any) {
        console.warn(`[RetryCleanup] Error cleaning up run container:`, err?.message || err);
      }
    }
  }

  if (affectedNodes.has("inspect")) {
    console.info(`[RetryCleanup] Retrying from "inspect" — resetting generated project artifacts while preserving datasource files.`);

    for (const rDir of runDirs) {
      await safeDelete(rDir, deletedItems);
    }
    for (const sDir of schemasDirs) {
      await safeDelete(sDir, deletedItems);
    }
    for (const pyDir of pythonScriptDirs) {
      await safeDelete(pyDir, deletedItems);
    }
    return { deletedItems };
  }

  const shouldCleanProfile = affectedNodes.has("profileData");
  const shouldCleanResolveSchema = affectedNodes.has("resolveSchema");
  const shouldCleanHierarchy = affectedNodes.has("hierarchyMapperNode");
  const shouldCleanFeatureEngineering =
    affectedNodes.has("featureArchitectNode") || affectedNodes.has("featureValidatorNode");
  const shouldCleanExogenous = affectedNodes.has("exogenous");
  const shouldCleanModelSelection = affectedNodes.has("modelSelectionNode");
  const shouldCleanTrainingConfig = affectedNodes.has("trainingConfigurationNode");
  const shouldCleanPreFlight = affectedNodes.has("preFlightNode");
  const shouldCleanModelTraining =
    affectedNodes.has("modelTrainingCodeNode") ||
    affectedNodes.has("modelTrainingExecutionNode");

  for (const sDir of schemasDirs) {
    await scanAndDeleteFiles(
      sDir,
      (fileName) => {
        const lower = fileName.toLowerCase();

        if (shouldCleanProfile && (lower.includes("profiling_report") || lower.includes("profiling"))) {
          return true;
        }

        if (
          shouldCleanResolveSchema &&
          (lower.includes("data_ingestion") || lower.includes("domain_schema") || lower.includes("project_schema"))
        ) {
          return true;
        }

        if (
          shouldCleanHierarchy &&
          (lower.includes("relationship_schema") || lower.includes("form_schema"))
        ) {
          return true;
        }

        if (shouldCleanExogenous && lower.includes("exogenous")) {
          return true;
        }

        if (
          (shouldCleanModelSelection || shouldCleanTrainingConfig) &&
          (lower.includes("training_job_contract") || lower.includes("contract") || lower.includes("model_selection") || lower.includes("training_config"))
        ) {
          return true;
        }

        return false;
      },
      deletedItems
    );
  }

  if (shouldCleanFeatureEngineering) {
    for (const dsDir of datasetDirs) {
      console.info(`[RetryCleanup] Feature Engineering is affected: removing all files in dataset dir ${dsDir}`);
      try {
        const entries = await fs.readdir(dsDir, { withFileTypes: true });
        for (const entry of entries) {
          await safeDelete(path.join(dsDir, entry.name), deletedItems);
        }
      } catch (err: any) {
        console.warn(`[RetryCleanup] Failed to empty dataset directory ${dsDir}:`, err?.message || err);
      }
    }
  }

  for (const pyDir of pythonScriptDirs) {
    if (shouldCleanFeatureEngineering) {
      console.info(`[RetryCleanup] Feature Engineering is affected: removing all files in ${pyDir}`);
      try {
        const entries = await fs.readdir(pyDir, { withFileTypes: true });
        for (const entry of entries) {
          await safeDelete(path.join(pyDir, entry.name), deletedItems);
        }
      } catch (err: any) {
        console.warn(`[RetryCleanup] Failed to empty python_script directory ${pyDir}:`, err?.message || err);
      }
    } else {
      await scanAndDeleteFiles(
        pyDir,
        (fileName) => {
          const lower = fileName.toLowerCase();

          if (shouldCleanExogenous && lower.includes("exogenous")) {
            return true;
          }

          if (
            (shouldCleanModelSelection || shouldCleanTrainingConfig) &&
            (lower.includes("model_selection") || lower.includes("training_config") || lower.includes("contract"))
          ) {
            return true;
          }

          if (shouldCleanPreFlight && lower.startsWith("preflight")) {
            return true;
          }

          if (shouldCleanModelTraining) {
            if (
              lower.startsWith("train") ||
              lower.startsWith("model_training") ||
              lower.startsWith("run_training") ||
              lower.includes("validation_report") ||
              lower.includes("validation_results") ||
              lower.includes("predictions") ||
              lower.includes("metrics") ||
              lower.endsWith(".pkl") ||
              lower.endsWith(".joblib") ||
              lower.endsWith(".pt") ||
              lower.endsWith(".pth") ||
              lower.endsWith(".onnx") ||
              lower.endsWith(".bin") ||
              lower.endsWith(".h5") ||
              lower === "models" ||
              lower === "validation"
            ) {
              return true;
            }
          }

          return false;
        },
        deletedItems
      );
    }
  }

  // Clean root files and subdirectories directly in runDirs and projectDirs
  for (const dir of [...runDirs, ...projectDirs]) {
    if (shouldCleanModelTraining) {
      try {
        const entries = fsSync.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const lower = entry.name.toLowerCase();
          if (
            entry.isDirectory() &&
            (lower.endsWith("_model_training") ||
              lower.endsWith("_model_validation") ||
              lower.includes("model_training") ||
              lower.includes("model_validation") ||
              lower === "models" ||
              lower === "validation" ||
              lower.startsWith("val-"))
          ) {
            await safeDelete(path.join(dir, entry.name), deletedItems);
          }
        }
      } catch (dirErr: any) {
        console.warn(`[RetryCleanup] Failed checking subdirectories in ${dir}:`, dirErr?.message || dirErr);
      }
    }

    // Scan loose files in run root (e.g. preflight reports, model training reports, validation reports)
    await scanAndDeleteFiles(
      dir,
      (fileName) => {
        const lower = fileName.toLowerCase();

        if (shouldCleanPreFlight && lower.startsWith("preflight")) {
          return true;
        }

        if (
          (shouldCleanModelSelection || shouldCleanTrainingConfig) &&
          (lower.includes("training_job_contract") || lower.includes("contract.yaml") || lower.includes("training_config"))
        ) {
          return true;
        }

        if (shouldCleanModelTraining) {
          if (
            lower.startsWith("model_training_report") ||
            lower.startsWith("model_validation_report") ||
            lower.includes("validation_report") ||
            lower.includes("predictions") ||
            lower.includes("metrics") ||
            lower.endsWith(".pkl") ||
            lower.endsWith(".joblib") ||
            lower.endsWith(".pt")
          ) {
            return true;
          }
        }

        return false;
      },
      deletedItems
    );
  }

  console.info(
    `[RetryCleanup] Completed cleanup for retry step "${targetNode}". Deleted ${deletedItems.length} items.`
  );

  return { deletedItems };
}
