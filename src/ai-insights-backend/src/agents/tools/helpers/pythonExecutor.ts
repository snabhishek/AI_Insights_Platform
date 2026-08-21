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

  const normRunDir = path.resolve(baseDir).replace(/\\/g, "/");
  const normDuckDbDir = path.resolve(duckDbDir).replace(/\\/g, "/");

  // Formulate command line arguments for the datasource
  const args: string[] = [];

  if (connectorIdList && connectorIdList.length > 0) {
    const primaryConnectorId = connectorIdList[0];
    const connector = await services.connectorService.getById(primaryConnectorId);
    if (connector) {
      const type = connector.type;
      const config = connector.connectionConfig;

      if (["excel", "csv", "tsv"].includes(type) && config.fileName) {
        const safeName = config.fileName.replace(/[^a-zA-Z0-9_-]/g, "_");
        const containerDbPath = `/workspace/duckdb/${safeName}.duckdb`;
        args.push(`--db-type duckdb`);
        args.push(`--db-path "${containerDbPath}"`);
      } else if (type === "postgres") {
        args.push(`--db-type postgresql`);
        if (config.host) args.push(`--host "${config.host}"`);
        if (config.port) args.push(`--port "${config.port}"`);
        if (config.username) args.push(`--username "${config.username}"`);
        if (config.password) args.push(`--password "${config.password}"`);
        if (config.database) args.push(`--database "${config.database}"`);
      } else if (type === "mysql") {
        args.push(`--db-type mysql`);
        if (config.host) args.push(`--host "${config.host}"`);
        if (config.port) args.push(`--port "${config.port}"`);
        if (config.username) args.push(`--username "${config.username}"`);
        if (config.password) args.push(`--password "${config.password}"`);
        if (config.database) args.push(`--database "${config.database}"`);
      } else if (type === "restapi") {
        args.push(`--db-type api`);
        if (config.url) args.push(`--url "${config.url}"`);
      }
    }
  }

  // Detect and resolve package dependencies
  const packagesToInstall = parseRequiredPackages(code);

  let scriptExecCmd = `python "${scriptName}" ${args.join(" ")}`;
  if (packagesToInstall.length > 0) {
    scriptExecCmd = `pip install --no-cache-dir ${packagesToInstall.join(" ")} && ${scriptExecCmd}`;
  }

  const docker = new Docker();
  const imageName = "python:3.12-slim";

  try {
    // 1. Ensure image is pulled
    await ensureImage(docker, imageName);

    // 2. Create container
    const container = await docker.createContainer({
      Image: imageName,
      Cmd: ["sh", "-c", scriptExecCmd],
      WorkingDir: "/workspace",
      HostConfig: {
        Binds: [
          `${normRunDir}:/workspace`,
          `${normDuckDbDir}:/workspace/duckdb`,
        ],
        Memory: 2 * 1024 * 1024 * 1024, // 2GB limit
        NanoCpus: 2 * 1000000000, // 2 CPUs limit
      },
    });

    // 3. Start container
    await container.start();

    // 4. Wait for execution to finish
    const waitResult = await container.wait();
    const exitCode = waitResult.StatusCode;

    // 5. Read stream logs
    const logsBuffer = (await container.logs({
      stdout: true,
      stderr: true,
    })) as Buffer;

    // Demultiplex logs
    const { stdout, stderr } = demuxDockerLogs(logsBuffer);

    // 6. Cleanup container
    await container.remove();

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
