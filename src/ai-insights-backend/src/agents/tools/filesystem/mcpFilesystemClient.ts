import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import { DynamicStructuredTool } from "@langchain/core/tools";
import * as path from "path";
import * as fs from "fs";

export interface McpFilesystemOptions {
  projectId?: string;
  runTimestamp?: string;
  allowedDirectories?: string[];
}

/**
 * Resolves the sandbox run folder path for a given project and run timestamp.
 * Defaults to `uploads/projects/default/runs/default` if not specified.
 */
export function getSandboxDirectory(projectId?: string, runTimestamp?: string): string {
  const sandboxDir = path.resolve(
    process.cwd(),
    "uploads",
    "projects",
    projectId || "default",
    "runs",
    runTimestamp || "default"
  );
  if (!fs.existsSync(sandboxDir)) {
    fs.mkdirSync(sandboxDir, { recursive: true });
  }
  return sandboxDir;
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
 */
export function getMcpFilesystemClient(options: McpFilesystemOptions = {}): MultiServerMCPClient {
  const sandboxDir = getSandboxDirectory(options.projectId, options.runTimestamp);
  const uploadsDir = path.resolve(process.cwd(), "uploads");

  const directories = options.allowedDirectories && options.allowedDirectories.length > 0
    ? options.allowedDirectories
    : [sandboxDir, uploadsDir];

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
 * Retrieves all LangChain tools from the MCP filesystem server for the given sandbox options.
 */
export async function getMcpFilesystemTools(
  options: McpFilesystemOptions = {}
): Promise<DynamicStructuredTool[]> {
  const client = getMcpFilesystemClient(options);
  const tools = await client.getTools();
  return tools;
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
