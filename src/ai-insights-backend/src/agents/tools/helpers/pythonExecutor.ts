import Docker from "dockerode";
import fs from "fs";
import path from "path";
import { IngestionServices } from "../../state";

export interface ExecutionResult {
  success: boolean;
  stdout: string;
  stderr: string;
}

const IMPORT_TO_PACKAGE: Record<string, string> = {
  sklearn: "scikit-learn",
  cv2: "opencv-python",
  PIL: "Pillow",
  yaml: "PyYAML",
  torch: "torch",
  transformers: "transformers",
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
 * Docker headers are 8 bytes: [1-byte stream type, 3-bytes padding, 4-bytes frame length].
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

  const duckDbDir = path.join(process.cwd(), "uploads", "duckdb");
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
        // For CSV-like connectors, the Python scripts expect a directory containing CSV files.
        // Mount the repo-level uploads directory into the container at /workspace/uploads and pass that path.
        const containerDbPath = `/workspace/uploads`;
        args.push(`--db-path "${containerDbPath}"`);
      } else if (type === "postgres") {
        // Pass connection details; omit a generic --db-type flag to avoid unrecognized-arg errors
        if (config.host) args.push(`--host "${config.host}"`);
        if (config.port) args.push(`--port "${config.port}"`);
        if (config.username) args.push(`--username "${config.username}"`);
        if (config.password) args.push(`--password "${config.password}"`);
        if (config.database) args.push(`--database "${config.database}"`);
      } else if (type === "mysql") {
        // Pass connection details; omit generic --db-type
        if (config.host) args.push(`--host "${config.host}"`);
        if (config.port) args.push(`--port "${config.port}"`);
        if (config.username) args.push(`--username "${config.username}"`);
        if (config.password) args.push(`--password "${config.password}"`);
        if (config.database) args.push(`--database "${config.database}"`);
      } else if (type === "restapi") {
        // Pass API URL; scripts can interpret this as needed
        if (config.url) args.push(`--url "${config.url}"`);
      }
    }
  }

  // Detect and resolve package dependencies
  const packagesToInstall = parseRequiredPackages(code);

  let scriptExecCmd = `python "${scriptName}" ${args.join(" ")}`;
  if (packagesToInstall.length > 0) {
    // Add flags to suppress root-user warning and pip version check noise when running as root inside container
    const pipFlags = "--no-cache-dir --disable-pip-version-check --root-user-action=ignore";
    scriptExecCmd = `pip install ${pipFlags} ${packagesToInstall.join(" ")} && ${scriptExecCmd}`;
  }

  const docker = new Docker();
  const imageName = "python:3.12-slim";

  try {
    // 1. Ensure image is pulled
    await ensureImage(docker, imageName);

    // 2. Use a stable container name per project so it can be reused
    const containerName = `ai-insights-feature-arch-executor-${projectId || "default"}`;

    // Try to find an existing container with this name
    const allContainers = await docker.listContainers({ all: true });
    let containerInfo = allContainers.find((c) => (c.Names || []).some((n) => n === `/${containerName}`));
    let container: Docker.Container;

    if (!containerInfo) {
      // Create persistent long-running container
      // cast to any then to Docker.Container to satisfy typings
      container = (await docker.createContainer({
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
          Memory: 2 * 1024 * 1024 * 1024, // 2GB limit
          NanoCpus: 2 * 1000000000, // 2 CPUs limit
        },
      }) as unknown) as Docker.Container;

      await container.start();
    } else {
      container = docker.getContainer(containerInfo.Id! as string);
      // Inspect existing container to see if it has the uploads bind; if not, remove and recreate
      try {
        const info = await container.inspect();
        const binds: string[] = (info.HostConfig && (info.HostConfig as any).Binds) || [];
        const expectedBind = `${normUploadsDir}:/workspace/uploads`;
        if (!binds.includes(expectedBind)) {
          try {
            // Stop and remove the old container so we can recreate with correct binds
            if (info.State && info.State.Running) {
              await container.stop({ t: 1 });
            }
            await container.remove();
            containerInfo = undefined as any;
          } catch (e) {
            // ignore removal errors and proceed to try exec; fall back to existing container
            console.warn("[DockerExecutor] Failed to replace existing container with updated binds", e);
          }
        }
      } catch (e) {
        // if inspect fails, proceed to use the container as-is
        console.warn("[DockerExecutor] Failed to inspect existing container", e);
      }

      if (!containerInfo) {
        // recreate container with proper binds
        container = (await docker.createContainer({
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
            Memory: 2 * 1024 * 1024 * 1024,
            NanoCpus: 2 * 1000000000,
          },
        }) as unknown) as Docker.Container;

        await container.start();
      } else {
        // Start container if it's not running
        if (containerInfo.State !== "running") {
          try {
            await container.start();
          } catch (e) {
            // ignore start errors and continue to try exec
          }
        }
      }
    }

    // 3. Execute the command inside the running container via exec
    const exec = await container.exec({
      Cmd: ["sh", "-c", scriptExecCmd],
      AttachStdout: true,
      AttachStderr: true,
      WorkingDir: "/workspace",
    });

    const stream = await exec.start({ hijack: true, stdin: false });

    // Collect output
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      stream.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
      stream.on("end", resolve);
      stream.on("error", reject);
    });

    const logsBuffer = Buffer.concat(chunks);
    const { stdout, stderr } = demuxDockerLogs(logsBuffer);

    // 4. Inspect exec exit code
    let exitCode = 0;
    try {
      const inspectRes = await exec.inspect();
      exitCode = inspectRes.ExitCode ?? 0;
    } catch (e) {
      // ignore
    }

    // Do NOT remove the container or volumes; keep persistent for future runs
    try {
      // stop the container to free resources but keep it available for reuse
      await container.stop({ t: 1 });
    } catch (e) {
      // ignore stop errors
    }

    return {
      success: exitCode === 0,
      stdout,
      stderr,
    };
  } catch (error) {
    console.error("[DockerExecutor] Failed running container", error);
    return {
      success: false,
      stdout: "",
      stderr: `Docker SDK execution error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
