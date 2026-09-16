import path from "path";
import fs from "fs";

/**
 * Sanitizes a folder or file component name by replacing spaces and illegal filesystem characters.
 */
export function sanitizeFolderName(name: string): string {
  if (!name) return "default";
  // Replace characters not safe for Windows / Linux directories
  const sanitized = name
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/\s+/g, "_");
  return sanitized || "default";
}

/**
 * Returns the resolved absolute base path for the file server.
 */
export function getFileServerBasePath(): string {
  const envPath = process.env.FILE_SERVER_PATH || "./storage";
  return path.isAbsolute(envPath) ? envPath : path.resolve(process.cwd(), envPath);
}

/**
 * Returns the absolute base directory for workspaces.
 */
export function getWorkspacesBasePath(): string {
  return path.join(getFileServerBasePath(), "workspaces");
}

/**
 * Returns the absolute directory for a specific workspace.
 */
export function getWorkspaceDir(workspaceName: string): string {
  const safeName = sanitizeFolderName(workspaceName || "Default_Workspace");
  return path.join(getWorkspacesBasePath(), safeName);
}

/**
 * Returns the absolute base directory for all datasources within a workspace.
 */
export function getWorkspaceDatasourcesBasePath(workspaceName: string = "Default_Workspace"): string {
  return path.join(getWorkspaceDir(workspaceName), "datasources");
}

/**
 * Returns the absolute directory for a specific datasource inside a workspace.
 */
export function getWorkspaceDatasourceDir(workspaceName: string, dataSourceName: string): string {
  const safeDs = sanitizeFolderName(dataSourceName);
  return path.join(getWorkspaceDatasourcesBasePath(workspaceName), safeDs);
}

/**
 * Returns the absolute path for a specific file inside a workspace's datasource directory.
 */
export function getWorkspaceDatasourceFilePath(workspaceName: string, dataSourceName: string, fileName: string): string {
  return path.join(getWorkspaceDatasourceDir(workspaceName, dataSourceName), fileName);
}

/**
 * Backwards compatibility helper: resolves datasource base path inside workspace.
 */
export function getDatasourcesBasePath(workspaceName: string = "Default_Workspace"): string {
  return getWorkspaceDatasourcesBasePath(workspaceName);
}

/**
 * Backwards compatibility helper: resolves datasource directory inside workspace.
 */
export function getDatasourceDir(dataSourceName: string, workspaceName: string = "Default_Workspace"): string {
  return getWorkspaceDatasourceDir(workspaceName, dataSourceName);
}

/**
 * Backwards compatibility helper: resolves datasource file path inside workspace.
 */
export function getDatasourceFilePath(dataSourceName: string, fileName: string, workspaceName: string = "Default_Workspace"): string {
  return getWorkspaceDatasourceFilePath(workspaceName, dataSourceName, fileName);
}

/**
 * Computes the relative storage path for a workspace datasource folder, e.g. "workspaces/Default_Workspace/datasources/Retail_Orders"
 */
export function computeDatasourceRelativePath(workspaceName: string, dataSourceName: string): string {
  const safeWs = sanitizeFolderName(workspaceName || "Default_Workspace");
  const safeDs = sanitizeFolderName(dataSourceName || "default_datasource");
  return path.posix.join("workspaces", safeWs, "datasources", safeDs);
}

/**
 * Computes the relative path for a project folder, e.g. "workspaces/Default_Workspace/projects/Demand_Forecasting"
 */
export function computeProjectRelativePath(workspaceName: string, projectName: string): string {
  const safeWs = sanitizeFolderName(workspaceName || "Default_Workspace");
  const safeProj = sanitizeFolderName(projectName || "default_project");
  return path.posix.join("workspaces", safeWs, "projects", safeProj);
}

/**
 * Returns the absolute directory for a project folder.
 */
export function getProjectDir(workspaceName: string, projectName: string): string {
  const relPath = computeProjectRelativePath(workspaceName, projectName);
  return resolveStoragePath(relPath);
}

/**
 * Scans the project directory on disk and returns the latest timestamp folder, if one exists.
 */
export function getLatestProjectTimestamp(workspaceName: string, projectName: string): string | undefined {
  try {
    const projectDir = getProjectDir(workspaceName, projectName);
    if (!fs.existsSync(projectDir)) return undefined;

    const entries = fs.readdirSync(projectDir, { withFileTypes: true });
    // Filter directories that match timestamp patterns (e.g., 20260916_110034 or 20260916-110034 or numeric timestamps)
    const timestampDirs = entries
      .filter((d) => d.isDirectory() && (d.name.match(/^\d{8}[-_]\d{6}/) || d.name.match(/^\d{10,}$/)))
      .map((d) => d.name)
      .sort((a, b) => b.localeCompare(a));

    if (timestampDirs.length > 0) {
      return timestampDirs[0];
    }
  } catch (err) {
    console.warn(`[getLatestProjectTimestamp] Warning scanning project directory for ${projectName}:`, err);
  }
  return undefined;
}

/**
 * Resolves the effective run timestamp for a project:
 * Uses explicit timestamp if provided; otherwise scans for the latest timestamp folder on disk.
 */
export function resolveProjectEffectiveTimestamp(
  workspaceName: string,
  projectName: string,
  explicitTimestamp?: string
): string | undefined {
  if (explicitTimestamp && explicitTimestamp.trim().length > 0) {
    return explicitTimestamp.trim();
  }
  return getLatestProjectTimestamp(workspaceName, projectName);
}

/**
 * Computes the relative path for a project's timestamped run folder, e.g. "workspaces/Default_Workspace/projects/Demand_Forecasting/20260916_110034"
 */
export function computeProjectRunRelativePath(workspaceName: string, projectName: string, timestamp?: string): string {
  const effectiveTs = resolveProjectEffectiveTimestamp(workspaceName, projectName, timestamp) || timestamp || "default";
  const safeTs = sanitizeFolderName(effectiveTs);
  return path.posix.join(computeProjectRelativePath(workspaceName, projectName), safeTs);
}

/**
 * Returns the absolute directory for a project's timestamped run folder.
 */
export function getProjectRunDir(workspaceName: string, projectName: string, timestamp?: string): string {
  const projRel = computeProjectRunRelativePath(workspaceName, projectName, timestamp);
  return resolveStoragePath(projRel);
}

/**
 * Computes the relative path for a project's schemas folder inside its timestamped run folder,
 * e.g. "workspaces/Default_Workspace/projects/Demand_Forecasting/20260916_110034/schemas"
 */
export function computeProjectSchemasRelativePath(workspaceName: string, projectName: string, timestamp?: string): string {
  return path.posix.join(computeProjectRunRelativePath(workspaceName, projectName, timestamp), "schemas");
}

/**
 * Returns the absolute directory for a project's schemas folder.
 */
export function getProjectSchemasDir(workspaceName: string, projectName: string, timestamp?: string): string {
  const schemasRel = computeProjectSchemasRelativePath(workspaceName, projectName, timestamp);
  return resolveStoragePath(schemasRel);
}

/**
 * Computes the relative path for a project's python_script folder inside its timestamped run folder,
 * e.g. "workspaces/Default_Workspace/projects/Demand_Forecasting/20260916_110034/python_script"
 */
export function computeProjectPythonScriptRelativePath(workspaceName: string, projectName: string, timestamp?: string): string {
  return path.posix.join(computeProjectRunRelativePath(workspaceName, projectName, timestamp), "python_script");
}

/**
 * Returns the absolute directory for a project's python_script folder.
 */
export function getProjectPythonScriptDir(workspaceName: string, projectName: string, timestamp?: string): string {
  const projRel = computeProjectPythonScriptRelativePath(workspaceName, projectName, timestamp);
  return resolveStoragePath(projRel);
}

/**
 * Resolves a relative storage path (e.g. from the DB) to an absolute system path.
 */
export function resolveStoragePath(relativePath: string): string {
  if (path.isAbsolute(relativePath)) {
    return relativePath;
  }
  return path.resolve(getFileServerBasePath(), relativePath);
}

/**
 * Ensures that a directory exists, creating all parent directories if necessary.
 */
export function ensureDirectoryExists(dirPath: string): string {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
  return dirPath;
}

/**
 * Bootstraps the file server root and workspaces directory.
 */
export function ensureFileServerDirectories(): void {
  const base = getFileServerBasePath();
  ensureDirectoryExists(base);
  ensureDirectoryExists(getWorkspacesBasePath());

  // Clean up legacy root datasources directory if it exists and is empty
  const legacyRootDs = path.join(base, "datasources");
  if (fs.existsSync(legacyRootDs)) {
    try {
      const files = fs.readdirSync(legacyRootDs);
      if (files.length === 0) {
        fs.rmdirSync(legacyRootDs);
      }
    } catch {}
  }

  // Clean up any empty legacy proj-* folders created directly under workspaces/*/projects
  const workspacesBase = getWorkspacesBasePath();
  if (fs.existsSync(workspacesBase)) {
    try {
      const wsDirs = fs.readdirSync(workspacesBase, { withFileTypes: true }).filter((d) => d.isDirectory());
      for (const ws of wsDirs) {
        const projBase = path.join(workspacesBase, ws.name, "projects");
        if (fs.existsSync(projBase)) {
          const pDirs = fs.readdirSync(projBase, { withFileTypes: true }).filter((d) => d.isDirectory() && d.name.startsWith("proj-"));
          for (const pd of pDirs) {
            const target = path.join(projBase, pd.name);
            try {
              const sub = fs.readdirSync(target);
              if (sub.length === 0 || (sub.length === 1 && sub[0] === "python_script" && fs.readdirSync(path.join(target, "python_script")).length === 0)) {
                fs.rmSync(target, { recursive: true, force: true });
              }
            } catch {}
          }
        }
      }
    } catch {}
  }
}
