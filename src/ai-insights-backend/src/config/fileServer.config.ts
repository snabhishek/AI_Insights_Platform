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
 * Computes the relative path for a project's python_script folder, e.g. "workspaces/Default_Workspace/projects/Demand_Forecasting/python_script"
 */
export function computeProjectPythonScriptRelativePath(workspaceName: string, projectName: string): string {
  return path.posix.join(computeProjectRelativePath(workspaceName, projectName), "python_script");
}

/**
 * Returns the absolute directory for a project's python_script folder.
 */
export function getProjectPythonScriptDir(workspaceName: string, projectName: string): string {
  const projRel = computeProjectPythonScriptRelativePath(workspaceName, projectName);
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
 * Bootstraps the file server root and core subdirectories.
 * NOTE: Datasources are workspace-scoped and created under workspaces/{workspace_name}/datasources.
 */
export function ensureFileServerDirectories(): void {
  const base = getFileServerBasePath();
  ensureDirectoryExists(base);
  ensureDirectoryExists(getWorkspacesBasePath());
  ensureDirectoryExists(path.join(base, "packages"));

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
