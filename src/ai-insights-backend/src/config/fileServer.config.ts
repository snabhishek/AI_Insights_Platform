import path from "path";
import fs from "fs";

export function sanitizeFolderName(name: string): string {
  if (!name) return "default";

  const sanitized = name
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/\s+/g, "_");
  return sanitized || "default";
}

export function getFileServerBasePath(): string {
  const envPath = process.env.FILE_SERVER_PATH || "./storage";
  return path.isAbsolute(envPath) ? envPath : path.resolve(process.cwd(), envPath);
}

export function getWorkspacesBasePath(): string {
  return path.join(getFileServerBasePath(), "workspaces");
}

export function getWorkspaceDir(workspaceName: string): string {
  const safeName = sanitizeFolderName(workspaceName || "Default_Workspace");
  return path.join(getWorkspacesBasePath(), safeName);
}

export function getWorkspaceDatasourcesBasePath(workspaceName: string = "Default_Workspace"): string {
  return path.join(getWorkspaceDir(workspaceName), "datasources");
}

export function getWorkspaceDatasourceDir(workspaceName: string, dataSourceName: string): string {
  const safeDs = sanitizeFolderName(dataSourceName);
  return path.join(getWorkspaceDatasourcesBasePath(workspaceName), safeDs);
}

export function getWorkspaceDatasourceFilePath(workspaceName: string, dataSourceName: string, fileName: string): string {
  return path.join(getWorkspaceDatasourceDir(workspaceName, dataSourceName), fileName);
}

export function getDatasourcesBasePath(workspaceName: string = "Default_Workspace"): string {
  return getWorkspaceDatasourcesBasePath(workspaceName);
}

export function getDatasourceDir(dataSourceName: string, workspaceName: string = "Default_Workspace"): string {
  return getWorkspaceDatasourceDir(workspaceName, dataSourceName);
}

export function getDatasourceFilePath(dataSourceName: string, fileName: string, workspaceName: string = "Default_Workspace"): string {
  return getWorkspaceDatasourceFilePath(workspaceName, dataSourceName, fileName);
}

export function computeDatasourceRelativePath(workspaceName: string, dataSourceName: string): string {
  const safeWs = sanitizeFolderName(workspaceName || "Default_Workspace");
  const safeDs = sanitizeFolderName(dataSourceName || "default_datasource");
  return path.posix.join("workspaces", safeWs, "datasources", safeDs);
}

export function computeProjectRelativePath(workspaceName: string, projectName: string): string {
  const safeWs = sanitizeFolderName(workspaceName || "Default_Workspace");
  const safeProj = sanitizeFolderName(projectName || "default_project");
  return path.posix.join("workspaces", safeWs, "projects", safeProj);
}

export function getProjectDir(workspaceName: string, projectName: string): string {
  const relPath = computeProjectRelativePath(workspaceName, projectName);
  return resolveStoragePath(relPath);
}

export function getLatestProjectTimestamp(workspaceName: string, projectName: string): string | undefined {
  try {
    const projectDir = getProjectDir(workspaceName, projectName);
    if (!fs.existsSync(projectDir)) return undefined;

    const entries = fs.readdirSync(projectDir, { withFileTypes: true });

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

export function computeProjectRunRelativePath(workspaceName: string, projectName: string, timestamp?: string): string {
  const effectiveTs = resolveProjectEffectiveTimestamp(workspaceName, projectName, timestamp) || timestamp || "default";
  const safeTs = effectiveTs;
  return path.posix.join(computeProjectRelativePath(workspaceName, projectName), safeTs);
}

export function getProjectRunDir(workspaceName: string, projectName: string, timestamp?: string): string {
  const projRel = computeProjectRunRelativePath(workspaceName, projectName, timestamp);
  return resolveStoragePath(projRel);
}

export function computeProjectSchemasRelativePath(workspaceName: string, projectName: string, timestamp?: string): string {
  return path.posix.join(computeProjectRunRelativePath(workspaceName, projectName, timestamp), "schemas");
}

export function getProjectSchemasDir(workspaceName: string, projectName: string, timestamp?: string): string {
  const schemasRel = computeProjectSchemasRelativePath(workspaceName, projectName, timestamp);
  return resolveStoragePath(schemasRel);
}

export function computeProjectPythonScriptRelativePath(workspaceName: string, projectName: string, timestamp?: string): string {
  return path.posix.join(computeProjectRunRelativePath(workspaceName, projectName, timestamp), "python_script");
}

export function getProjectPythonScriptDir(workspaceName: string, projectName: string, timestamp?: string): string {
  const projRel = computeProjectPythonScriptRelativePath(workspaceName, projectName, timestamp);
  return resolveStoragePath(projRel);
}

export function resolveStoragePath(relativePath: string): string {
  if (path.isAbsolute(relativePath)) {
    return relativePath;
  }
  return path.resolve(getFileServerBasePath(), relativePath);
}

export function ensureDirectoryExists(dirPath: string): string {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
  return dirPath;
}

export function ensureFileServerDirectories(): void {
  const base = getFileServerBasePath();
  ensureDirectoryExists(base);
  ensureDirectoryExists(getWorkspacesBasePath());

  const legacyRootDs = path.join(base, "datasources");
  if (fs.existsSync(legacyRootDs)) {
    try {
      const files = fs.readdirSync(legacyRootDs);
      if (files.length === 0) {
        fs.rmdirSync(legacyRootDs);
      }
    } catch {}
  }

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
