import fs from "fs";
import path from "path";
import { exec, spawn } from "child_process";
import Docker from "dockerode";
import { IngestionServices } from "../../state";
import {
  ensureDirectoryExists,
  getFileServerBasePath,
  getLatestProjectTimestamp,
  getProjectPythonScriptDir,
  resolveProjectEffectiveTimestamp,
  sanitizeFolderName,
} from "../../../config/fileServer.config";

export interface ExecutionResult {
  success: boolean;
  stdout: string;
  stderr: string;
  logFilePath?: string;
}

/**
 * Generates a timestamp formatted as YYYYMMDD-HHmmss for the current time
 * when Docker execution and log writing begins.
 */
export function generateLogTimestamp(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const seconds = String(now.getSeconds()).padStart(2, "0");
  return `${year}${month}${day}-${hours}${minutes}${seconds}`;
}

const IMPORT_TO_PACKAGE: Record<string, string> = {
  sklearn: "scikit-learn",
  cv2: "opencv-python",
  PIL: "Pillow",
  yaml: "PyYAML",
  torch: "torch",
  transformers: "transformers",
  statsmodels: "statsmodels",
  lightgbm: "lightgbm",
  xgboost: "xgboost",
  catboost: "catboost",
  scipy: "scipy",
};

/**
 * Normalizes the list of required packages provided explicitly by the agent output.
 */
export function normalizeRequiredPackages(explicitPackages?: string[]): string[] {
  const packages = new Set<string>();

  if (Array.isArray(explicitPackages)) {
    for (const pkg of explicitPackages) {
      if (typeof pkg === "string" && pkg.trim().length > 0) {
        const cleanPkg = pkg.trim();
        const nameMatch = cleanPkg.match(/^([a-zA-Z0-9_-]+)/);
        if (nameMatch) {
          const rawName = nameMatch[1];
          const mapped = IMPORT_TO_PACKAGE[rawName];
          if (mapped) {
            packages.add(cleanPkg.replace(rawName, mapped));
            continue;
          }
        }
        packages.add(cleanPkg);
      }
    }
  }

  return Array.from(packages);
}

function getDockerClient(): Docker {
  if (process.platform === "win32") {
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
 * Runs a CLI process via spawn with live streaming to log file, maxBuffer and timeout handling.
 * By default, raw container logs are suppressed from console.log to keep the backend console clean.
 */
function executeProcess(
  command: string,
  options: {
    cwd: string;
    env?: NodeJS.ProcessEnv;
    timeoutMs?: number;
    onLog?: (line: string) => void;
    silentConsole?: boolean;
    logFilePath?: string;
  }
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const isWindows = process.platform === "win32";
    const shell = isWindows ? (process.env.ComSpec || "cmd.exe") : "/bin/sh";
    const shellFlag = isWindows ? "/d /s /c" : "-c";

    let stdoutData = "";
    let stderrData = "";
    const silentConsole = options.silentConsole !== false;

    const child = spawn(shell, [shellFlag, command], {
      cwd: options.cwd,
      env: { ...process.env, ...(options.env || {}) },
      windowsVerbatimArguments: isWindows,
    });

    let timeoutTimer: NodeJS.Timeout | undefined;
    if (options.timeoutMs) {
      timeoutTimer = setTimeout(() => {
        try {
          if (options.logFilePath) {
            fs.appendFileSync(
              options.logFilePath,
              `\n[Process Timeout] Timed out after ${options.timeoutMs}ms. Terminating process.\n`,
              "utf-8"
            );
          }
          child.kill("SIGTERM");
        } catch {}
      }, options.timeoutMs);
    }

    const processChunk = (chunk: Buffer | string, isErr = false) => {
      const text = chunk.toString();
      if (isErr) {
        stderrData += text;
      } else {
        stdoutData += text;
      }

      // Append raw stream directly into the dedicated log file
      if (options.logFilePath) {
        try {
          fs.appendFileSync(options.logFilePath, text, "utf-8");
        } catch {}
      }

      // Stream to backend console only if silentConsole is explicitly disabled
      if (!silentConsole) {
        const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
        for (const line of lines) {
          console.log(`[DockerExecutor] ${line}`);
        }
      }

      if (options.onLog) {
        const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
        for (const line of lines) {
          options.onLog(line);
        }
      }
    };

    child.stdout?.on("data", (chunk) => processChunk(chunk, false));
    child.stderr?.on("data", (chunk) => processChunk(chunk, true));

    child.on("close", (code) => {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      resolve({
        exitCode: code ?? 0,
        stdout: stdoutData,
        stderr: stderrData,
      });
    });

    child.on("error", (err) => {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (options.logFilePath) {
        try {
          fs.appendFileSync(options.logFilePath, `\n[Process Error] ${err.message}\n`, "utf-8");
        } catch {}
      }
      resolve({
        exitCode: 1,
        stdout: stdoutData,
        stderr: stderrData || err.message,
      });
    });
  });
}

/**
 * Track active docker compose project directories per run session.
 */
const activeComposeSessions = new Map<string, { composeDir: string; composeFile: string }>();

/**
 * Ensures requirements.txt exists and syncs any new required packages.
 */
export function ensureRequirementsTxt(
  targetDir: string,
  explicitPackages: string[] = []
): string {
  const reqPath = path.join(targetDir, "requirements.txt");
  const defaultPkgs = ["pandas", "numpy", "scikit-learn", "duckdb", "pyarrow", "pyyaml", "joblib", "lightgbm"];
  const allNeeded = normalizeRequiredPackages([...defaultPkgs, ...explicitPackages]);

  let existingPkgs: string[] = [];
  if (fs.existsSync(reqPath)) {
    const content = fs.readFileSync(reqPath, "utf-8");
    existingPkgs = content
      .split("\n")
      .map((l) => l.trim().split("#")[0].trim())
      .filter(Boolean)
      .map((pkg) => {
        const nameMatch = pkg.match(/^([a-zA-Z0-9_-]+)/);
        if (nameMatch) {
          const rawName = nameMatch[1];
          const mapped = IMPORT_TO_PACKAGE[rawName];
          if (mapped && mapped !== rawName) {
            return pkg.replace(rawName, mapped);
          }
        }
        return pkg;
      });
  }

  // De-duplicate based on canonical package names (preferring version-pinned ones if present)
  const pkgMap = new Map<string, string>();
  for (const pkg of [...allNeeded, ...existingPkgs]) {
    const nameMatch = pkg.match(/^([a-zA-Z0-9_-]+)/);
    const key = nameMatch ? nameMatch[1].toLowerCase() : pkg.toLowerCase();
    // If we already have a pinned package, keep it; otherwise set current
    if (!pkgMap.has(key) || pkg.includes("==") || pkg.includes(">=") || pkg.includes("<=")) {
      pkgMap.set(key, pkg);
    }
  }

  const merged = Array.from(pkgMap.values());
  fs.mkdirSync(targetDir, { recursive: true });
  fs.writeFileSync(reqPath, merged.join("\n") + "\n", "utf-8");
  return reqPath;
}

/**
 * Ensures Dockerfile exists in target directory.
 */
export function ensureDockerfile(targetDir: string): string {
  const dockerfilePath = path.join(targetDir, "Dockerfile");
  const dockerfileContent = [
    "FROM python:3.12-slim",
    "WORKDIR /workspace",
    "RUN apt-get update && apt-get install -y --no-install-recommends \\",
    "    build-essential \\",
    "    python3-dev \\",
    "    cmake \\",
    "    libgomp1 \\",
    "    && rm -rf /var/lib/apt/lists/*",
    "COPY requirements.txt /tmp/requirements.txt",
    "RUN pip install --no-cache-dir --disable-pip-version-check --default-timeout=120 --retries 3 --trusted-host pypi.org --trusted-host files.pythonhosted.org -r /tmp/requirements.txt",
    "",
  ].join("\n");

  if (!fs.existsSync(dockerfilePath)) {
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(dockerfilePath, dockerfileContent, "utf-8");
  } else {
    // If Dockerfile exists but lacks essential build dependencies, update it
    try {
      const existing = fs.readFileSync(dockerfilePath, "utf-8");
      if (!existing.includes("python3-dev") || !existing.includes("libgomp1")) {
        fs.writeFileSync(dockerfilePath, dockerfileContent, "utf-8");
      }
    } catch {}
  }
  return dockerfilePath;
}

/**
 * Ensures docker-compose.yml exists in target directory.
 */
export function ensureDockerCompose(
  targetDir: string,
  serviceName: string = "app",
  resourceLimits?: { cpus?: string; memory?: string; hasGpu?: boolean }
): string {
  const composeYml = path.join(targetDir, "docker-compose.yml");
  const composeYaml = path.join(targetDir, "docker-compose.yaml");

  if (fs.existsSync(composeYml)) return composeYml;
  if (fs.existsSync(composeYaml)) return composeYaml;

  const cpus = resourceLimits?.cpus || "2.0";
  const memory = resourceLimits?.memory || "4G";
  const gpuConfig = resourceLimits?.hasGpu
    ? [
        "        reservations:",
        "          devices:",
        "            - driver: cdi",
        "              count: all",
        "              capabilities: [gpu]",
      ].join("\n")
    : "";

  const content = [
    "services:",
    `  ${serviceName}:`,
    "    build:",
    "      context: .",
    "      dockerfile: Dockerfile",
    "      network: host",
    "    network_mode: host",
    "    volumes:",
    "      - \"${HOST_PROJECT_ROOT:-.}:/workspace\"",
    "    working_dir: /workspace",
    "    environment:",
    "      - PYTHONPATH=/workspace",
    "    deploy:",
    "      resources:",
    "        limits:",
    `          cpus: '${cpus}'`,
    `          memory: ${memory}`,
    ...(gpuConfig ? [gpuConfig] : []),
    "",
  ].join("\n");

  fs.mkdirSync(targetDir, { recursive: true });
  fs.writeFileSync(composeYml, content, "utf-8");
  return composeYml;
}

/**
 * Resolves the appropriate directory where docker-compose.yml, Dockerfile, and requirements.txt
 * are maintained for the execution of a Python script.
 */
function resolveExecutionDirectory(
  scriptPath: string,
  projectRootDir: string,
  effectiveTimestamp: string
): string {
  const scriptDir = path.dirname(scriptPath);
  const baseName = path.basename(scriptDir).toLowerCase();

  // 1. If script is in a specialized subfolder (e.g. <projectName>_model_training, <projectName>_model_validation, python_script)
  if (
    baseName.endsWith("_model_training") ||
    baseName.endsWith("_model_validation") ||
    baseName === "python_script" ||
    fs.existsSync(path.join(scriptDir, "docker-compose.yml")) ||
    fs.existsSync(path.join(scriptDir, "docker-compose.yaml")) ||
    fs.existsSync(path.join(scriptDir, "Dockerfile"))
  ) {
    return scriptDir;
  }

  // 2. Check run directory
  const runDir = path.join(projectRootDir, effectiveTimestamp);
  if (
    fs.existsSync(path.join(runDir, "docker-compose.yml")) ||
    fs.existsSync(path.join(runDir, "docker-compose.yaml"))
  ) {
    return runDir;
  }

  // 3. Default to script directory
  return scriptDir;
}

/**
 * Executes a Python script inside a Docker container managed exclusively via
 * docker-compose, Dockerfile, and requirements.txt.
 */
export async function executePythonScript(
  scriptName: string,
  code: string,
  projectId: string,
  runTimestamp: string,
  services: IngestionServices,
  connectorIdList?: string[],
  requiredPackages?: string[],
  extraArgs: string[] = [],
  resourceLimits?: { cpus?: string; memory?: string; hasGpu?: boolean }
): Promise<ExecutionResult> {
  let workspaceName = "Default_Workspace";
  let projectName = projectId || "default";

  if (services?.projectService && typeof services.projectService.getProjectWithWorkspace === "function" && projectId) {
    try {
      const pWs = await services.projectService.getProjectWithWorkspace(projectId);
      if (pWs) {
        workspaceName = pWs.workspaceName || workspaceName;
        projectName = pWs.project.name || projectName;
      }
    } catch (err: any) {
      console.log(err);
    }
  }

  // 1. Resolve project directory on host
  const projectRootDir = path.join(
    getFileServerBasePath(),
    "workspaces",
    sanitizeFolderName(workspaceName),
    "projects",
    sanitizeFolderName(projectName)
  );
  ensureDirectoryExists(projectRootDir);
  const normProjectDir = path.resolve(projectRootDir).replace(/\\/g, "/");

  // 2. Always resolve the latest timestamp folder for script execution
  const effectiveTimestamp =
    getLatestProjectTimestamp(workspaceName, projectName) ||
    (runTimestamp && runTimestamp !== "default" ? runTimestamp.trim() : undefined) ||
    resolveProjectEffectiveTimestamp(workspaceName, projectName, runTimestamp) ||
    runTimestamp ||
    "default";

  const baseDir = getProjectPythonScriptDir(workspaceName, projectName, effectiveTimestamp);
  ensureDirectoryExists(baseDir);

  // 3. Resolve script path (handles both nested project paths and standard python_script paths)
  let scriptPath: string;
  const isSubpath = scriptName.includes("/") || scriptName.includes("\\");
  if (isSubpath) {
    if (path.isAbsolute(scriptName)) {
      scriptPath = path.resolve(scriptName);
    } else if (scriptName.startsWith(effectiveTimestamp) || fs.existsSync(path.join(projectRootDir, scriptName))) {
      scriptPath = path.join(projectRootDir, scriptName);
    } else {
      const withTimestamp = path.join(projectRootDir, effectiveTimestamp, scriptName);
      if (fs.existsSync(withTimestamp) || !fs.existsSync(path.join(projectRootDir, scriptName))) {
        scriptPath = withTimestamp;
      } else {
        scriptPath = path.join(projectRootDir, scriptName);
      }
    }
    if (code && code.trim().length > 0) {
      ensureDirectoryExists(path.dirname(scriptPath));
      fs.writeFileSync(scriptPath, code, "utf-8");
    }
  } else {
    let effectiveScriptName = path.basename(scriptName);
    const ext = path.extname(effectiveScriptName) || ".py";
    const baseName = path.basename(effectiveScriptName, ext);
    if (!baseName.includes(effectiveTimestamp) && effectiveTimestamp !== "default") {
      effectiveScriptName = `${baseName}_${effectiveTimestamp}${ext}`;
    }
    scriptPath = path.join(baseDir, effectiveScriptName);
    if (code && code.trim().length > 0) {
      fs.writeFileSync(scriptPath, code, "utf-8");
    }
  }

  // 4. Compute relative script path from project root (/workspace in container)
  const relFromProjectRoot = path.relative(projectRootDir, scriptPath).replace(/\\/g, "/");
  const scriptDirRel = path.relative(projectRootDir, path.dirname(scriptPath)).replace(/\\/g, "/");
  const containerOutDir = scriptDirRel && scriptDirRel !== "." ? `/workspace/${scriptDirRel}`.replace(/\/+/g, "/") : "/workspace";

  // Formulate command line arguments for the datasource and output directory
  const args: string[] = [`--out-dir "${containerOutDir}"`];
  if (extraArgs && extraArgs.length > 0) {
    args.push(...extraArgs);
  }

  if (connectorIdList && connectorIdList.length > 0) {
    const primaryConnectorId = connectorIdList[0];
    const connector = await services.connectorService.getById(primaryConnectorId);
    if (connector) {
      const type = connector.type;
      const config = connector.connectionConfig;

      if (["excel", "csv", "tsv"].includes(type) && config.fileName) {
        const containerDbPath = `/workspace`;
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

  // Ensure Docker daemon is running
  const docker = getDockerClient();
  const isAvailable = await ensureDockerDaemon(docker);
  if (!isAvailable) {
    return {
      success: false,
      stdout: "",
      stderr: "Docker daemon is not running and could not be started automatically. Please ensure Docker Desktop is running.",
    };
  }

  // 5. Determine directory containing requirements.txt, Dockerfile, and docker-compose.yml
  const execDir = resolveExecutionDirectory(scriptPath, projectRootDir, effectiveTimestamp);
  ensureDirectoryExists(execDir);

  // Sync requirements.txt, Dockerfile, and docker-compose.yml
  ensureRequirementsTxt(execDir, requiredPackages);
  ensureDockerfile(execDir);
  const composeFile = ensureDockerCompose(execDir, "app", resourceLimits);
  const composeFileName = path.basename(composeFile);

  const sessionKey = `${projectId || "default"}__${effectiveTimestamp}`;
  activeComposeSessions.set(sessionKey, { composeDir: execDir, composeFile });

  const env = {
    HOST_PROJECT_ROOT: normProjectDir,
    PYTHONPATH: "/workspace",
  };

  console.info(`[DockerExecutor] Building and running via Docker Compose in [${execDir}] for script [${relFromProjectRoot}]`);

  // Ensure dedicated docker_logs directory inside execDir
  const dockerLogsDir = path.join(execDir, "docker_logs");
  ensureDirectoryExists(dockerLogsDir);

  // Generate log timestamp based purely on current timestamp when logs start to write
  const logTimestamp = generateLogTimestamp();
  let logFileName = `${logTimestamp}.txt`;
  let logFilePath = path.join(dockerLogsDir, logFileName);
  let duplicateIndex = 1;
  while (fs.existsSync(logFilePath)) {
    logFileName = `${logTimestamp}_${duplicateIndex}.txt`;
    logFilePath = path.join(dockerLogsDir, logFileName);
    duplicateIndex++;
  }

  // Initialize log file header
  const initLogHeader = [
    "=".repeat(80),
    `DOCKER CONTAINER EXECUTION LOG`,
    `Execution Start Time: ${new Date().toISOString()}`,
    `Execution Directory: ${execDir}`,
    `Script Relative Path: ${relFromProjectRoot}`,
    `Host Project Root: ${normProjectDir}`,
    `Arguments: ${args.join(" ")}`,
    "=".repeat(80),
    "",
  ].join("\n");
  fs.writeFileSync(logFilePath, initLogHeader, "utf-8");

  console.info(`[DockerExecutor] Docker container logs writing to: ${logFilePath}`);

  // Step 1: Build Docker Compose image
  const buildCmd = `docker compose -f "${composeFileName}" build`;
  fs.appendFileSync(
    logFilePath,
    [
      "-".repeat(80),
      `STEP 1: DOCKER COMPOSE BUILD`,
      `Command: ${buildCmd}`,
      `Time: ${new Date().toISOString()}`,
      "-".repeat(80),
      "",
    ].join("\n"),
    "utf-8"
  );

  const buildResult = await executeProcess(buildCmd, {
    cwd: execDir,
    env,
    timeoutMs: 300000, // 5 min build timeout
    silentConsole: true,
    logFilePath,
  });

  if (buildResult.exitCode !== 0) {
    fs.appendFileSync(
      logFilePath,
      [
        "",
        "-".repeat(80),
        `BUILD FAILED (exit code: ${buildResult.exitCode})`,
        `Time: ${new Date().toISOString()}`,
        "-".repeat(80),
        "",
      ].join("\n"),
      "utf-8"
    );
    console.error(`[DockerExecutor] Docker Compose build failed (exit code ${buildResult.exitCode}). Check logs: ${logFilePath}`);
    return {
      success: false,
      stdout: buildResult.stdout,
      stderr: `Docker Compose build error:\n${buildResult.stderr || buildResult.stdout}\n(Docker build logs saved to: ${logFilePath})`,
      logFilePath,
    };
  }

  fs.appendFileSync(
    logFilePath,
    [
      "",
      "-".repeat(80),
      `BUILD COMPLETED SUCCESSFULLY (exit code: 0)`,
      `Time: ${new Date().toISOString()}`,
      "-".repeat(80),
      "",
    ].join("\n"),
    "utf-8"
  );

  // Step 2: Run service via Docker Compose
  // Determine service name from compose file (default: app, or first service defined)
  let serviceName = "app";
  try {
    const composeContent = fs.readFileSync(composeFile, "utf-8");
    const serviceMatch = composeContent.match(/services:\s*\n\s*([a-zA-Z0-9_-]+):/);
    if (serviceMatch && serviceMatch[1]) {
      serviceName = serviceMatch[1];
    }
  } catch {}

  const runCmd = `docker compose -f "${composeFileName}" run --rm ${serviceName} python "${relFromProjectRoot}" ${args.join(" ")}`;
  fs.appendFileSync(
    logFilePath,
    [
      "-".repeat(80),
      `STEP 2: DOCKER COMPOSE RUN`,
      `Command: ${runCmd}`,
      `Time: ${new Date().toISOString()}`,
      "-".repeat(80),
      "",
    ].join("\n"),
    "utf-8"
  );

  const execResult = await executeProcess(runCmd, {
    cwd: execDir,
    env,
    timeoutMs: 600000, // 10 min execution timeout
    silentConsole: true,
    logFilePath,
  });

  fs.appendFileSync(
    logFilePath,
    [
      "",
      "=".repeat(80),
      `CONTAINER RUN FINISHED`,
      `Finished At: ${new Date().toISOString()}`,
      `Exit Code: ${execResult.exitCode}`,
      `Status: ${execResult.exitCode === 0 ? "SUCCESS" : "FAILED"}`,
      "=".repeat(80),
      "",
    ].join("\n"),
    "utf-8"
  );

  if (execResult.exitCode === 0) {
    console.info(`[DockerExecutor] Container execution completed successfully. Logs: ${logFilePath}`);
  } else {
    console.warn(`[DockerExecutor] Container execution exited with code ${execResult.exitCode}. Logs: ${logFilePath}`);
  }

  return {
    success: execResult.exitCode === 0,
    stdout: execResult.stdout,
    stderr: execResult.stderr,
    logFilePath,
  };
}

/**
 * Cleans up container resources and stops docker compose services for a specific run.
 */
export async function cleanupRunContainer(projectId: string, runTimestamp?: string): Promise<void> {
  const safeProj = projectId || "default";
  const sessionKey = `${safeProj}__${runTimestamp || "default"}`;

  const session = activeComposeSessions.get(sessionKey);
  if (session && fs.existsSync(session.composeFile)) {
    try {
      console.info(`[DockerExecutor] Tearing down Docker Compose in [${session.composeDir}]`);
      await executeProcess(
        `docker compose -f "${path.basename(session.composeFile)}" down --volumes --remove-orphans`,
        { cwd: session.composeDir, silentConsole: true }
      );
      activeComposeSessions.delete(sessionKey);
    } catch (err: any) {
      console.warn(`[DockerExecutor] Warning during compose down for [${sessionKey}]:`, err?.message || err);
    }
  }

  // Fallback cleanup across any session matching project
  for (const [key, sess] of activeComposeSessions.entries()) {
    if (key.startsWith(`${safeProj}__`)) {
      try {
        await executeProcess(
          `docker compose -f "${path.basename(sess.composeFile)}" down --volumes --remove-orphans`,
          { cwd: sess.composeDir, silentConsole: true }
        );
        activeComposeSessions.delete(key);
      } catch {}
    }
  }
}

/**
 * Cleans up all active compose sessions.
 */
export async function cleanupAllRunContainers(): Promise<void> {
  for (const [key, sess] of activeComposeSessions.entries()) {
    try {
      if (fs.existsSync(sess.composeFile)) {
        await executeProcess(
          `docker compose -f "${path.basename(sess.composeFile)}" down --volumes --remove-orphans`,
          { cwd: sess.composeDir, silentConsole: true }
        );
      }
    } catch {}
  }
  activeComposeSessions.clear();
}
