import Docker from "dockerode";
import fs from "fs";
import path from "path";
import { exec } from "child_process";
import { IngestionServices } from "../../state";

export interface ExecutionResult {
  success: boolean;
  stdout: string;
  stderr: string;
}

interface ContainerSession {
  container: Docker.Container;
  name: string;
  projectId: string;
  runTimestamp: string;
  installedPackages: Set<string>;
  createdAt: number;
}

const activeRunContainers = new Map<string, ContainerSession>();

const IMPORT_TO_PACKAGE: Record<string, string> = {
  sklearn: "scikit-learn",
  cv2: "opencv-python",
  PIL: "Pillow",
  yaml: "PyYAML",
  torch: "torch",
  transformers: "transformers",
  statsmodels: "statsmodels",
};

const ALLOWLIST = new Set([
  "numpy",
  "pandas",
  "scipy",
  "scikit-learn",
  "matplotlib",
  "seaborn",
  "opencv-python",
  "pillow",
  "torch",
  "torchvision",
  "transformers",
  "datasets",
  "xgboost",
  "lightgbm",
  "duckdb",
  "pyyaml",
  "scikit-image",
  "statsmodels",
]);

/**
 * Parses Python code to find import statements and returns mapped package names from allowlist.
 */
export function parseRequiredPackages(code: string): string[] {
  const packages = new Set<string>();
  const lines = code.split("\n");
  const importRegex = /^\s*(?:import|from)\s+([a-zA-Z0-9_]+)/;

  for (const line of lines) {
    const match = line.match(importRegex);
    if (match) {
      const moduleName = match[1];
      const pipName = IMPORT_TO_PACKAGE[moduleName] || moduleName;
      const lowerPipName = pipName.toLowerCase();

      if (ALLOWLIST.has(lowerPipName)) {
        packages.add(pipName);
      }
    }
  }

  return Array.from(packages);
}

/**
 * Helper to demux Docker's multiplexed stream buffer into stdout and stderr.
 */
function demuxDockerLogs(buffer: Buffer): { stdout: string; stderr: string } {
  let stdout = "";
  let stderr = "";
  let offset = 0;

  while (offset < buffer.length) {
    if (offset + 8 > buffer.length) break;
    const type = buffer.readUInt8(offset);
    const length = buffer.readUInt32BE(offset + 4);
    offset += 8;

    if (offset + length > buffer.length) break;
    const content = buffer.toString("utf8", offset, offset + length);
    offset += length;

    if (type === 1) {
      stdout += content;
    } else if (type === 2) {
      stderr += content;
    }
  }

  return { stdout, stderr };
}

/**
 * Creates a platform-aware Docker instance.
 * On Windows, connects to the Docker Desktop named pipe '//./pipe/docker_engine'.
 */
export function getDockerClient(): Docker {
  if (process.env.DOCKER_HOST) {
    return new Docker();
  }
  if (process.platform === "win32") {
    const winPipes = ["//./pipe/docker_engine", "//./pipe/docker_desktop_engine"];
    for (const pipe of winPipes) {
      if (fs.existsSync(pipe)) {
        return new Docker({ socketPath: pipe });
      }
    }
    return new Docker({ socketPath: "//./pipe/docker_engine" });
  }
  return new Docker({ socketPath: "/var/run/docker.sock" });
}

/**
 * Checks if Docker daemon is responsive.
 */
async function isDockerRunning(docker: Docker): Promise<boolean> {
  try {
    await docker.ping();
    return true;
  } catch {
    return false;
  }
}

/**
 * Automatically launches Docker Desktop if not currently running and waits for it to be ready.
 */
async function ensureDockerDaemon(docker: Docker): Promise<boolean> {
  if (await isDockerRunning(docker)) {
    return true;
  }

  if (process.platform === "win32") {
    const possiblePaths = [
      "C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe",
      "C:\\Program Files (x86)\\Docker\\Docker\\Docker Desktop.exe",
      path.join(process.env.LOCALAPPDATA || "", "Programs\\Docker\\Docker\\Docker Desktop.exe"),
    ];

    const exePath = possiblePaths.find((p) => fs.existsSync(p));
    if (exePath) {
      console.info(`[DockerExecutor] Docker daemon not responding. Launching Docker Desktop from: ${exePath}`);
      try {
        exec(`start "" "${exePath}"`);
      } catch (e: any) {
        console.warn(`[DockerExecutor] Failed to launch Docker Desktop:`, e.message);
      }

      // Poll for up to 30 seconds for Docker daemon to become responsive
      const start = Date.now();
      while (Date.now() - start < 30000) {
        await new Promise((r) => setTimeout(r, 2000));
        if (await isDockerRunning(docker)) {
          console.info("[DockerExecutor] Docker Desktop is now running and responsive!");
          return true;
        }
      }
    }
  }

  return false;
}

/**
 * Cleans up any stale orphaned containers from prior runs.
 */
async function cleanupStaleContainers(docker: Docker): Promise<void> {
  try {
    const activeNames = new Set(Array.from(activeRunContainers.values()).map((s) => s.name));
    const allContainers = await docker.listContainers({ all: true });
    for (const c of allContainers) {
      const matchName = (c.Names || []).find(
        (name) =>
          (name.includes("ai-insights-exec-") || name.includes("ai-insights-feature-arch-executor-")) &&
          !activeNames.has(name.replace(/^\//, ""))
      );
      if (matchName) {
        try {
          const cont = docker.getContainer(c.Id);
          if (c.State === "running") {
            await cont.stop({ t: 1 });
          }
          await cont.remove({ force: true });
          console.info(`[DockerExecutor] Cleaned up leftover container: ${c.Names?.[0] || c.Id}`);
        } catch (_) {}
      }
    }
  } catch (err: any) {
    console.warn("[DockerExecutor] Failed to list containers for stale cleanup:", err.message);
  }
}

/**
 * Pulls the specified Docker image if it is not already available locally.
 */
async function ensureImage(docker: Docker, image: string): Promise<void> {
  const images = await docker.listImages();
  const hasImage = images.some((img) => img.RepoTags?.includes(image));
  if (!hasImage) {
    await new Promise<void>((resolve, reject) => {
      docker.pull(image, {}, (err, stream) => {
        if (err) return reject(err);
        if (!stream) return reject(new Error("Pull stream was undefined"));
        docker.modem.followProgress(stream, (progressErr) => {
          if (progressErr) return reject(progressErr);
          resolve();
        });
      });
    });
  }
}

/**
 * Executes a Python script inside a managed Docker container session.
 * Reuses the existing container across Feature Architect workers, Program Rectifier, and Feature Validator,
 * and preserves installed Python packages and environment state.
 */
export async function executePythonScript(
  scriptName: string,
  code: string,
  projectId: string,
  runTimestamp: string,
  services: IngestionServices,
  connectorIdList?: string[]
): Promise<ExecutionResult> {
  const baseDir = path.join(
    process.cwd(),
    "uploads",
    "projects",
    projectId || "default",
    "runs",
    runTimestamp || "default"
  );
  if (!fs.existsSync(baseDir)) {
    fs.mkdirSync(baseDir, { recursive: true });
  }

  const scriptPath = path.join(baseDir, scriptName);
  fs.writeFileSync(scriptPath, code, "utf-8");

  const duckDbDir = path.join(process.cwd(), "Projects");
  if (!fs.existsSync(duckDbDir)) {
    fs.mkdirSync(duckDbDir, { recursive: true });
  }

  const uploadsDir = path.join(process.cwd(), "uploads");
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

  const normRunDir = path.resolve(baseDir).replace(/\\/g, "/");
  const normDuckDbDir = path.resolve(duckDbDir).replace(/\\/g, "/");
  const normUploadsDir = path.resolve(uploadsDir).replace(/\\/g, "/");

  // Formulate command line arguments for the datasource
  const args: string[] = [];

  if (connectorIdList && connectorIdList.length > 0) {
    const primaryConnectorId = connectorIdList[0];
    const connector = await services.connectorService.getById(primaryConnectorId);
    if (connector) {
      const type = connector.type;
      const config = connector.connectionConfig;

      if (["excel", "csv", "tsv"].includes(type) && config.fileName) {
        const containerDbPath = `/workspace/uploads`;
        args.push(`--db-path "${containerDbPath}"`);
      } else if (type === "postgres") {
        if (config.host) args.push(`--host "${config.host}"`);
        if (config.port) args.push(`--port "${config.port}"`);
        if (config.username) args.push(`--username "${config.username}"`);
        if (config.password) args.push(`--password "${config.password}"`);
        if (config.database) args.push(`--database "${config.database}"`);
      } else if (type === "mysql") {
        if (config.host) args.push(`--host "${config.host}"`);
        if (config.port) args.push(`--port "${config.port}"`);
        if (config.username) args.push(`--username "${config.username}"`);
        if (config.password) args.push(`--password "${config.password}"`);
        if (config.database) args.push(`--database "${config.database}"`);
      } else if (type === "restapi") {
        if (config.url) args.push(`--url "${config.url}"`);
      }
    }
  }

  const docker = getDockerClient();
  const isAvailable = await ensureDockerDaemon(docker);
  if (!isAvailable) {
    return {
      success: false,
      stdout: "",
      stderr: "Docker daemon is not running and could not be started automatically. Please ensure Docker Desktop is running.",
    };
  }

  const sessionKey = `${projectId || "default"}__${runTimestamp || "default"}`;
  let session = activeRunContainers.get(sessionKey);

  // Check if existing session container is still alive and running
  if (session) {
    try {
      const inspect = await session.container.inspect();
      if (!inspect?.State?.Running) {
        activeRunContainers.delete(sessionKey);
        session = undefined;
      }
    } catch {
      activeRunContainers.delete(sessionKey);
      session = undefined;
    }
  }

  const imageName = "python:3.12-slim";

  // Create container if not already running for this run session
  if (!session) {
    await cleanupStaleContainers(docker);
    await ensureImage(docker, imageName);

    const safeProj = (projectId || "default").replace(/[^a-zA-Z0-9_-]/g, "_");
    const containerName = `ai-insights-exec-${safeProj}-${Date.now().toString(36)}`;

    console.info(`[DockerExecutor] Creating container session [${containerName}] for run [${runTimestamp}]`);
    const container = (await docker.createContainer({
      name: containerName,
      Image: imageName,
      Cmd: ["sh", "-c", "sleep infinity"],
      WorkingDir: "/workspace",
      HostConfig: {
        Binds: [
          `${normRunDir}:/workspace`,
          `${normDuckDbDir}:/workspace/duckdb`,
          `${normUploadsDir}:/workspace/uploads`,
        ],
        Memory: 2 * 1024 * 1024 * 1024, // 2GB memory limit
        NanoCpus: 2 * 1000000000, // 2 CPU cores limit
        AutoRemove: false,
      },
    }) as unknown) as Docker.Container;

    await container.start();
    session = {
      container,
      name: containerName,
      projectId: projectId || "default",
      runTimestamp: runTimestamp || "default",
      installedPackages: new Set<string>(),
      createdAt: Date.now(),
    };
    activeRunContainers.set(sessionKey, session);
  } else {
    console.info(`[DockerExecutor] Reusing existing container session [${session.name}] for run [${runTimestamp}]`);
  }

  // Detect and install required packages that haven't been installed yet
  const requiredPackages = parseRequiredPackages(code);
  const packagesToInstall = requiredPackages.filter((pkg) => !session!.installedPackages.has(pkg));

  let scriptExecCmd = `python "${scriptName}" ${args.join(" ")}`;
  if (packagesToInstall.length > 0) {
    const pipFlags = "--no-cache-dir --disable-pip-version-check --root-user-action=ignore";
    scriptExecCmd = `pip install ${pipFlags} ${packagesToInstall.join(" ")} && ${scriptExecCmd}`;
    for (const pkg of packagesToInstall) {
      session.installedPackages.add(pkg);
    }
  }

  try {
    console.info(`[DockerExecutor] Running script [${scriptName}] inside container [${session.name}]`);
    const execInstance = await session.container.exec({
      Cmd: ["sh", "-c", scriptExecCmd],
      AttachStdout: true,
      AttachStderr: true,
      WorkingDir: "/workspace",
    });

    const stream = await execInstance.start({ hijack: true, stdin: false });

    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      stream.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
      stream.on("end", resolve);
      stream.on("error", reject);
    });

    const logsBuffer = Buffer.concat(chunks);
    const { stdout, stderr } = demuxDockerLogs(logsBuffer);

    let exitCode = 0;
    try {
      const inspectRes = await execInstance.inspect();
      exitCode = inspectRes.ExitCode ?? 0;
    } catch (_) {}

    return {
      success: exitCode === 0,
      stdout,
      stderr,
    };
  } catch (error) {
    console.error(`[DockerExecutor] Execution failed in container [${session.name}]`, error);
    return {
      success: false,
      stdout: "",
      stderr: `Docker execution error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Explicitly cleans up and deletes the container session for a specific run when the stage completes.
 */
export async function cleanupRunContainer(projectId: string, runTimestamp: string): Promise<void> {
  const sessionKey = `${projectId || "default"}__${runTimestamp || "default"}`;
  const session = activeRunContainers.get(sessionKey);

  if (session) {
    try {
      console.info(`[DockerExecutor] Cleaning up container session [${session.name}] for project [${projectId}]`);
      await session.container.stop({ t: 1 }).catch(() => {});
      await session.container.remove({ force: true }).catch(() => {});
      activeRunContainers.delete(sessionKey);
      console.info(`[DockerExecutor] Successfully deleted container [${session.name}]`);
    } catch (err: any) {
      console.warn(`[DockerExecutor] Error removing container [${session.name}]:`, err.message);
    }
  }
}

/**
 * Cleans up all active container sessions.
 */
export async function cleanupAllRunContainers(): Promise<void> {
  for (const [key, session] of activeRunContainers.entries()) {
    try {
      await session.container.stop({ t: 1 }).catch(() => {});
      await session.container.remove({ force: true }).catch(() => {});
      console.info(`[DockerExecutor] Cleaned up container [${session.name}]`);
    } catch (_) {}
  }
  activeRunContainers.clear();
}
