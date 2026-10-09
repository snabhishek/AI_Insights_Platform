import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import { DynamicStructuredTool } from "@langchain/core/tools";
import * as path from "path";
import * as fs from "fs";
import {
  computeProjectRelativePath,
  ensureDirectoryExists,
  getFileServerBasePath,
  getLatestProjectTimestamp,
  getProjectDir,
  getWorkspacesBasePath,
  resolveStoragePath,
  sanitizeFolderName,
} from "../../../config/fileServer.config";

export interface McpFilesystemOptions {
  projectId?: string;
  projectName?: string;
  workspaceName?: string;
  folderPath?: string;
  runTimestamp?: string;
  allowedDirectories?: string[];
}

function toBaseProjectDir(dirPath: string): string {
  const norm = dirPath.replace(/\\/g, "/").replace(/\/+$/, "");
  if (norm.endsWith("/python_script") || norm.endsWith("/python script")) {
    const parent = norm.substring(0, norm.lastIndexOf("/"));
    return ensureDirectoryExists(path.resolve(parent));
  }
  return ensureDirectoryExists(path.resolve(dirPath));
}

interface ProjectMeta {
  projectName: string;
  workspaceName?: string;
  folderPath?: string;
}

const projectMetadataCache = new Map<string, ProjectMeta>();

export function registerProjectMetadata(projectId: string, meta: ProjectMeta): void {
  if (projectId && meta) {
    projectMetadataCache.set(projectId, meta);
  }
}

export function getProjectDirectory(
  optionsOrProjectId?: string | McpFilesystemOptions,
  runTimestamp?: string
): string {
  let projectId: string | undefined;
  let projectName: string | undefined;
  let workspaceName: string | undefined;
  let folderPath: string | undefined;

  if (typeof optionsOrProjectId === "string") {
    projectId = optionsOrProjectId;
  } else if (optionsOrProjectId && typeof optionsOrProjectId === "object") {
    projectId = optionsOrProjectId.projectId;
    projectName = optionsOrProjectId.projectName;
    workspaceName = optionsOrProjectId.workspaceName;
    folderPath = optionsOrProjectId.folderPath;
  }

  if (folderPath) {
    const absPath = resolveStoragePath(folderPath);
    return toBaseProjectDir(absPath);
  }

  if (projectId && (!projectName || !folderPath)) {
    const cached = projectMetadataCache.get(projectId);
    if (cached) {
      if (cached.folderPath) {
        return toBaseProjectDir(resolveStoragePath(cached.folderPath));
      }
      if (cached.projectName) {
        projectName = cached.projectName;
        workspaceName = cached.workspaceName || workspaceName;
      }
    }
  }

  if (projectName) {
    if (workspaceName) {
      return getProjectDir(workspaceName, projectName);
    }
    const safeProj = sanitizeFolderName(projectName);
    const workspacesBase = getWorkspacesBasePath();

    if (fs.existsSync(workspacesBase)) {
      try {
        const wsDirs = fs.readdirSync(workspacesBase, { withFileTypes: true }).filter((d) => d.isDirectory());
        for (const wsDir of wsDirs) {
          const cand = path.join(workspacesBase, wsDir.name, "projects", safeProj);
          if (fs.existsSync(cand)) return toBaseProjectDir(cand);
        }
      } catch {}
    }

    const relative = computeProjectRelativePath(workspaceName || "Default_Workspace", projectName);
    const absPath = resolveStoragePath(relative);
    return toBaseProjectDir(absPath);
  }

  if (projectId) {
    const workspacesBase = getWorkspacesBasePath();

    if (fs.existsSync(workspacesBase)) {
      try {
        const wsDirs = fs.readdirSync(workspacesBase, { withFileTypes: true }).filter((d) => d.isDirectory());
        for (const wsDir of wsDirs) {
          const projBase = path.join(workspacesBase, wsDir.name, "projects");
          if (fs.existsSync(projBase)) {
            const projDirs = fs.readdirSync(projBase, { withFileTypes: true }).filter((d) => d.isDirectory());
            const direct = projDirs.find((d) => d.name === sanitizeFolderName(projectId!));
            if (direct) {
              return toBaseProjectDir(path.join(projBase, direct.name));
            }
          }
        }
      } catch {}
    }

    const legacyPath = path.resolve(
      process.cwd(),
      "uploads",
      "projects",
      projectId,
      "runs",
      runTimestamp || "default"
    );
    if (fs.existsSync(legacyPath)) return legacyPath;
  }

  const defaultRelative = computeProjectRelativePath(workspaceName || "Default_Workspace", "default");
  const defaultAbs = resolveStoragePath(defaultRelative);
  return toBaseProjectDir(defaultAbs);
}

export function getPythonScriptDirectory(
  optionsOrProjectId?: string | McpFilesystemOptions,
  runTimestamp?: string
): string {
  let effectiveTs = runTimestamp;
  let workspaceName: string | undefined;
  let projectName: string | undefined;

  if (optionsOrProjectId && typeof optionsOrProjectId === "object") {
    effectiveTs = optionsOrProjectId.runTimestamp || effectiveTs;
    workspaceName = optionsOrProjectId.workspaceName;
    projectName = optionsOrProjectId.projectName;
  }

  const projectDir = getProjectDirectory(optionsOrProjectId, runTimestamp);

  if (!effectiveTs && workspaceName && projectName) {
    effectiveTs = getLatestProjectTimestamp(workspaceName, projectName);
  } else if (!effectiveTs) {
    try {
      if (fs.existsSync(projectDir)) {
        const entries = fs.readdirSync(projectDir, { withFileTypes: true });
        const timestampDirs = entries
          .filter((d) => d.isDirectory() && (d.name.match(/^\d{8}[-_]\d{6}/) || d.name.match(/^\d{10,}$/)))
          .map((d) => d.name)
          .sort((a, b) => b.localeCompare(a));
        if (timestampDirs.length > 0) {
          effectiveTs = timestampDirs[0];
        }
      }
    } catch {}
  }

  if (effectiveTs && effectiveTs !== "default") {
    return ensureDirectoryExists(path.join(projectDir, effectiveTs, "python_script"));
  }

  return ensureDirectoryExists(path.join(projectDir, "python_script"));
}

export function getSandboxDirectory(
  optionsOrProjectId?: string | McpFilesystemOptions,
  runTimestamp?: string
): string {
  return getPythonScriptDirectory(optionsOrProjectId, runTimestamp);
}

export function resolveMcpServerFilesystemPath(): string {
  const possiblePaths = [
    path.resolve(process.cwd(), "node_modules", "@modelcontextprotocol", "server-filesystem", "dist", "index.js"),
    path.resolve(__dirname, "..", "..", "..", "..", "node_modules", "@modelcontextprotocol", "server-filesystem", "dist", "index.js"),
  ];

  for (const candidate of possiblePaths) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  try {
    return require.resolve("@modelcontextprotocol/server-filesystem/dist/index.js");
  } catch {
    throw new Error(
      "Could not resolve @modelcontextprotocol/server-filesystem entrypoint. Ensure the package is installed in node_modules."
    );
  }
}

const clientCache = new Map<string, MultiServerMCPClient>();

export function getMcpFilesystemClient(options: McpFilesystemOptions = {}): MultiServerMCPClient {
  const projectDir = getProjectDirectory(options);

  const directories = options.allowedDirectories && options.allowedDirectories.length > 0
    ? options.allowedDirectories
    : [projectDir];

  const normalizedDirs = directories.map((dir) => {
    const resolved = path.resolve(dir);
    if (!fs.existsSync(resolved)) {
      fs.mkdirSync(resolved, { recursive: true });
    }
    return resolved;
  });

  const cacheKey = normalizedDirs.sort().join("::");
  if (clientCache.has(cacheKey)) {
    return clientCache.get(cacheKey)!;
  }

  const serverScript = resolveMcpServerFilesystemPath();

  const client = new MultiServerMCPClient({
    mcpServers: {
      filesystem: {
        transport: "stdio",
        command: process.execPath,
        args: [path.resolve(__dirname, "../../../../scripts/mcp-filesystem-runner.cjs"), serverScript, ...normalizedDirs],
      },
    },
  });

  clientCache.set(cacheKey, client);
  return client;
}

export async function getMcpFilesystemTools(
  options: McpFilesystemOptions = {}
): Promise<DynamicStructuredTool[]> {
  const client = getMcpFilesystemClient(options);
  const tools = await client.getTools();
  return tools;
}

export async function closeMcpClientForDirectory(dirPath: string): Promise<void> {
  const normalized = path.resolve(dirPath);
  for (const [key, client] of clientCache.entries()) {
    if (key.includes(normalized)) {
      try {
        await client.close();
      } catch (err) {
        console.warn(`[McpFilesystemClient] Error closing client for ${key}:`, err);
      }
      clientCache.delete(key);
    }
  }
}

export async function closeAllMcpClients(): Promise<void> {
  for (const [key, client] of clientCache.entries()) {
    try {
      await client.close();
    } catch (err) {
      console.warn(`[McpFilesystemClient] Error closing client for ${key}:`, err);
    }
  }
  clientCache.clear();
}
