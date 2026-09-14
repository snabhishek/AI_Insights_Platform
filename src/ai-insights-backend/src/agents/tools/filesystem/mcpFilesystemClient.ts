import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import { DynamicStructuredTool } from "@langchain/core/tools";
import * as path from "path";
import * as fs from "fs";
import {
  computeProjectRelativePath,
  ensureDirectoryExists,
  getFileServerBasePath,
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

/**
 * Helper to strip any trailing python_script subfolder and return the base project directory.
 */
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

/**
 * Registers project metadata so that any component passing only a projectId string
 * can resolve to the correct project name and folder path.
 */
export function registerProjectMetadata(projectId: string, meta: ProjectMeta): void {
  if (projectId && meta) {
    projectMetadataCache.set(projectId, meta);
  }
}

/**
 * Resolves the designated base project directory path.
 * Resolves to `<FILE_SERVER_PATH>/workspaces/<workspace>/projects/<projectName>`.
 */
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

  // 1. If explicit relative folderPath was provided (from DB)
  if (folderPath) {
    const absPath = resolveStoragePath(folderPath);
    return toBaseProjectDir(absPath);
  }

  // 2. Check metadata cache if projectId is provided
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

  // 3. If projectName is provided
  if (projectName) {
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

  // 4. If only projectId is provided without projectName
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

    // Check legacy uploads/projects/<projectId>/runs/<runTimestamp>
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

  // 5. Default project directory
  const defaultRelative = computeProjectRelativePath(workspaceName || "Default_Workspace", "default");
  const defaultAbs = resolveStoragePath(defaultRelative);
  return toBaseProjectDir(defaultAbs);
}

/**
 * Resolves the designated project python_script directory path.
 * Resolves to `<FILE_SERVER_PATH>/workspaces/<workspace>/projects/<projectName>/python_script`.
 */
export function getPythonScriptDirectory(
  optionsOrProjectId?: string | McpFilesystemOptions,
  runTimestamp?: string
): string {
  const projectDir = getProjectDirectory(optionsOrProjectId, runTimestamp);
  return ensureDirectoryExists(path.join(projectDir, "python_script"));
}

/**
 * Resolves the designated project sandbox directory path.
 * Retained for backwards compatibility; points to the python_script directory.
 */
export function getSandboxDirectory(
  optionsOrProjectId?: string | McpFilesystemOptions,
  runTimestamp?: string
): string {
  return getPythonScriptDirectory(optionsOrProjectId, runTimestamp);
}

/**
 * Resolves the entrypoint script for @modelcontextprotocol/server-filesystem.
 */
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

/**
 * Cache for active MultiServerMCPClient instances keyed by allowed directory list.
 */
const clientCache = new Map<string, MultiServerMCPClient>();

/**
 * Creates or retrieves an existing MultiServerMCPClient instance configured with allowed directories.
 * Strictly scopes filesystem access to the project root directory.
 */
export function getMcpFilesystemClient(options: McpFilesystemOptions = {}): MultiServerMCPClient {
  const projectDir = getProjectDirectory(options);

  // Strictly isolate MCP filesystem server to the project folder
  const directories = options.allowedDirectories && options.allowedDirectories.length > 0
    ? options.allowedDirectories
    : [projectDir];

  // Ensure all directories exist and are normalized
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
        args: [serverScript, ...normalizedDirs],
      },
    },
  });

  clientCache.set(cacheKey, client);
  return client;
}

/**
 * Retrieves all LangChain tools from the MCP filesystem server for the given project options.
 */
export async function getMcpFilesystemTools(
  options: McpFilesystemOptions = {}
): Promise<DynamicStructuredTool[]> {
  const client = getMcpFilesystemClient(options);
  const tools = await client.getTools();
  return tools;
}

/**
 * Closes an MCP client for a specific directory.
 */
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

/**
 * Closes all cached MCP clients.
 */
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
