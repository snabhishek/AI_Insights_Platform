import fs from "fs";
import path from "path";
import { exec, execFile, spawn } from "child_process";
import Docker from "dockerode";
import { getFormattedTimestamp } from "../../../utils/logger";
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

async function isDockerRunning(docker: Docker): Promise<boolean> {
  try {
    await docker.ping();
    return true;
  } catch {
    return false;
  }
}

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

export function executeProcess(
  command: string,
  options: {
    cwd: string;
    env?: NodeJS.ProcessEnv;
    timeoutMs?: number;
    onLog?: (line: string) => void;
    silentConsole?: boolean;
    logFilePath?: string;
    signal?: AbortSignal;
  }
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    if (options.signal?.aborted) { resolve({ exitCode: 130, stdout: "", stderr: "Agent was stopped" }); return; }
    const isWindows = process.platform === "win32";
    const shell = isWindows ? (process.env.ComSpec || "cmd.exe") : "/bin/sh";
    const shellFlag = isWindows ? "/d /s /c" : "-c";

    let stdoutData = "";
    let stderrData = "";
    let timedOut = false;
    const pending = { stdout: "", stderr: "" };
    const silentConsole = options.silentConsole !== false;

    const child = spawn(shell, [shellFlag, command], {
      cwd: options.cwd,
      env: { ...process.env, ...(options.env || {}) },
      windowsVerbatimArguments: isWindows,
      windowsHide: true,
    });

    let timeoutTimer: NodeJS.Timeout | undefined;
    const terminate = () => {
      if (isWindows && child.pid) execFile("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true }, () => undefined);
      else child.kill("SIGTERM");
    };
    const onAbort = () => terminate();
    options.signal?.addEventListener("abort", onAbort, { once: true });
    if (options.signal?.aborted) onAbort();
    if (options.timeoutMs) {
      timeoutTimer = setTimeout(() => {
        timedOut = true;
        try {
          if (options.logFilePath) {
            fs.appendFileSync(
              options.logFilePath,
              `\n[Process Timeout] Timed out after ${options.timeoutMs}ms. Terminating process.\n`,
              "utf-8"
            );
          }
          terminate();
        } catch {}
      }, options.timeoutMs);
    }

    const emitLine = (line: string, isErr: boolean) => {
      const stamped = `[${getFormattedTimestamp()}] [${isErr ? "stderr" : "stdout"}] ${line}`;
      if (options.logFilePath) fs.appendFileSync(options.logFilePath, `${stamped}\n`, "utf-8");
      if (!silentConsole) console.log(`[DockerExecutor] ${line}`);
      options.onLog?.(stamped);
    };
    const processChunk = (chunk: Buffer | string, isErr = false) => {
      const text = chunk.toString();
      if (isErr) {
        stderrData += text;
      } else {
        stdoutData += text;
      }

      const channel = isErr ? "stderr" : "stdout";
      const lines = (pending[channel] + text).split(/\r?\n/);
      pending[channel] = lines.pop() || "";
      for (const line of lines) if (line.trim()) emitLine(line, isErr);
    };

    child.stdout?.on("data", (chunk) => processChunk(chunk, false));
    child.stderr?.on("data", (chunk) => processChunk(chunk, true));

    child.on("close", (code) => {
      options.signal?.removeEventListener("abort", onAbort);
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (pending.stdout) emitLine(pending.stdout, false);
      if (pending.stderr) emitLine(pending.stderr, true);
      resolve({
        exitCode: options.signal?.aborted ? 130 : timedOut ? 124 : code ?? 1,
        stdout: stdoutData,
        stderr: stderrData,
      });
    });

    child.on("error", (err) => {
      options.signal?.removeEventListener("abort", onAbort);
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

const activeComposeSessions = new Map<string, { composeDir: string; composeFile: string; composePrefix: string }>();

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

  const pkgMap = new Map<string, string>();
  for (const pkg of [...allNeeded, ...existingPkgs]) {
    const nameMatch = pkg.match(/^([a-zA-Z0-9_-]+)/);
    const key = nameMatch ? nameMatch[1].toLowerCase() : pkg.toLowerCase();

    if (!pkgMap.has(key) || pkg.includes("==") || pkg.includes(">=") || pkg.includes("<=")) {
      pkgMap.set(key, pkg);
    }
  }

  const merged = Array.from(pkgMap.values());
  fs.mkdirSync(targetDir, { recursive: true });
  fs.writeFileSync(reqPath, merged.join("\n") + "\n", "utf-8");
  return reqPath;
}

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

    try {
      const existing = fs.readFileSync(dockerfilePath, "utf-8");
      if (!existing.includes("python3-dev") || !existing.includes("libgomp1")) {
        fs.writeFileSync(dockerfilePath, dockerfileContent, "utf-8");
      }
    } catch {}
  }
  return dockerfilePath;
}

export function ensureDockerCompose(
  targetDir: string,
  serviceName: string = "app",
  resourceLimits?: { cpus?: string; memory?: string; hasGpu?: boolean },
  isolation?: { writableRelativePath: string }
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
    isolation ? "    network_mode: none" : "    network_mode: host",
    ...(isolation ? ["    read_only: true", "    cap_drop: [ALL]", "    security_opt: [no-new-privileges:true]", "    tmpfs: [/tmp]"] : []),
    "    volumes:",
    isolation ? "      - \"${HOST_PROJECT_ROOT:-.}:/workspace:ro\"" : "      - \"${HOST_PROJECT_ROOT:-.}:/workspace\"",
    ...(isolation ? [`      - \"\${HOST_EXECUTION_DIR}:/${path.posix.join("workspace", isolation.writableRelativePath)}:rw\"`] : []),
    "    working_dir: /workspace",
    "    environment:",
    "      - PYTHONPATH=/workspace",
    "      - PYTHONDONTWRITEBYTECODE=1",
    "      - PYTHONUNBUFFERED=1",
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

function resolveExecutionDirectory(
  scriptPath: string,
  projectRootDir: string,
  effectiveTimestamp: string
): string {
  const scriptDir = path.dirname(scriptPath);
  const baseName = path.basename(scriptDir).toLowerCase();

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

  const runDir = path.join(projectRootDir, effectiveTimestamp);
  if (
    fs.existsSync(path.join(runDir, "docker-compose.yml")) ||
    fs.existsSync(path.join(runDir, "docker-compose.yaml"))
  ) {
    return runDir;
  }

  return scriptDir;
}

export async function executePythonScript(
  scriptName: string,
  code: string,
  projectId: string,
  runTimestamp: string,
  services: IngestionServices,
  connectorIdList?: string[],
  requiredPackages?: string[],
  extraArgs: string[] = [],
  resourceLimits?: { cpus?: string; memory?: string; hasGpu?: boolean },
  executionOptions?: { projectRootDir: string; effectiveTimestamp: string; sessionId: string; onLog?: (line: string) => void; isolated: true; signal?: AbortSignal }
): Promise<ExecutionResult> {
  executionOptions?.signal?.throwIfAborted();
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

  const projectRootDir = executionOptions?.projectRootDir || path.join(
    getFileServerBasePath(),
    "workspaces",
    sanitizeFolderName(workspaceName),
    "projects",
    sanitizeFolderName(projectName)
  );
  ensureDirectoryExists(projectRootDir);
  const normProjectDir = path.resolve(projectRootDir).replace(/\\/g, "/");

  const effectiveTimestamp =
    executionOptions?.effectiveTimestamp ||
    getLatestProjectTimestamp(workspaceName, projectName) ||
    (runTimestamp && runTimestamp !== "default" ? runTimestamp.trim() : undefined) ||
    resolveProjectEffectiveTimestamp(workspaceName, projectName, runTimestamp) ||
    runTimestamp ||
    "default";

  const baseDir = executionOptions ? path.dirname(path.resolve(scriptName)) : getProjectPythonScriptDir(workspaceName, projectName, effectiveTimestamp);
  ensureDirectoryExists(baseDir);

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
      if (executionOptions) {
        const relative = path.relative(projectRootDir, scriptPath);
        if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Execution script must remain inside the project.");
      }
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

  const relFromProjectRoot = path.relative(projectRootDir, scriptPath).replace(/\\/g, "/");
  if (executionOptions && (relFromProjectRoot.startsWith("../") || path.isAbsolute(relFromProjectRoot))) throw new Error("Execution script must remain inside the project.");
  const scriptDirRel = path.relative(projectRootDir, path.dirname(scriptPath)).replace(/\\/g, "/");
  const containerOutDir = scriptDirRel && scriptDirRel !== "." ? `/workspace/${scriptDirRel}`.replace(/\/+/g, "/") : "/workspace";

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

  const docker = getDockerClient();
  const isAvailable = await ensureDockerDaemon(docker);
  if (!isAvailable) {
    return {
      success: false,
      stdout: "",
      stderr: "Docker daemon is not running and could not be started automatically. Please ensure Docker Desktop is running.",
    };
  }

  const execDir = resolveExecutionDirectory(scriptPath, projectRootDir, effectiveTimestamp);
  ensureDirectoryExists(execDir);

  ensureRequirementsTxt(execDir, requiredPackages);
  ensureDockerfile(execDir);
  const composeFile = ensureDockerCompose(execDir, "app", resourceLimits,
    executionOptions ? { writableRelativePath: scriptDirRel } : undefined);
  const composeFileName = path.basename(composeFile);

  const sessionKey = `${projectId || "default"}__${executionOptions?.sessionId || effectiveTimestamp}`;
  const composePrefix = executionOptions ? `docker compose -p "sparrow_${executionOptions.sessionId.replace(/[^a-zA-Z0-9_-]/g, "").toLowerCase()}"` : "docker compose";
  activeComposeSessions.set(sessionKey, { composeDir: execDir, composeFile, composePrefix });

  const env = {
    HOST_PROJECT_ROOT: normProjectDir,
    PYTHONPATH: "/workspace",
    HOST_EXECUTION_DIR: path.resolve(execDir).replace(/\\/g, "/"),
  };

  console.info(`[DockerExecutor] Building and running via Docker Compose in [${execDir}] for script [${relFromProjectRoot}]`);

  const dockerLogsDir = path.join(execDir, "docker_logs");
  ensureDirectoryExists(dockerLogsDir);

  const logTimestamp = generateLogTimestamp();
  let logFileName = `${logTimestamp}.txt`;
  let logFilePath = path.join(dockerLogsDir, logFileName);
  let duplicateIndex = 1;
  while (fs.existsSync(logFilePath)) {
    logFileName = `${logTimestamp}_${duplicateIndex}.txt`;
    logFilePath = path.join(dockerLogsDir, logFileName);
    duplicateIndex++;
  }

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

  const buildCmd = `${composePrefix} -f "${composeFileName}" build`;
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
    signal: executionOptions?.signal,
    onLog: executionOptions?.onLog,
    cwd: execDir,
    env,
    timeoutMs: 300000,
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

  let serviceName = "app";
  try {
    const composeContent = fs.readFileSync(composeFile, "utf-8");
    const serviceMatch = composeContent.match(/services:\s*\n\s*([a-zA-Z0-9_-]+):/);
    if (serviceMatch && serviceMatch[1]) {
      serviceName = serviceMatch[1];
    }
  } catch {}

  const runCmd = `${composePrefix} -f "${composeFileName}" run --rm ${serviceName} python -u "${relFromProjectRoot}" ${args.join(" ")}`;
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
    signal: executionOptions?.signal,
    onLog: executionOptions?.onLog,
    cwd: execDir,
    env,
    timeoutMs: 600000,
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

export async function cleanupRunContainer(projectId: string, runTimestamp?: string): Promise<void> {
  const safeProj = projectId || "default";
  const sessionKey = `${safeProj}__${runTimestamp || "default"}`;

  const session = activeComposeSessions.get(sessionKey);
  if (session && fs.existsSync(session.composeFile)) {
    try {
      console.info(`[DockerExecutor] Tearing down Docker Compose in [${session.composeDir}]`);
      await executeProcess(
        `${session.composePrefix} -f "${path.basename(session.composeFile)}" down --volumes --remove-orphans`,
        { cwd: session.composeDir, silentConsole: true }
      );
      activeComposeSessions.delete(sessionKey);
    } catch (err: any) {
      console.warn(`[DockerExecutor] Warning during compose down for [${sessionKey}]:`, err?.message || err);
    }
  }

  for (const [key, sess] of activeComposeSessions.entries()) {
    if (!runTimestamp && key.startsWith(`${safeProj}__`)) {
      try {
        await executeProcess(
          `${sess.composePrefix} -f "${path.basename(sess.composeFile)}" down --volumes --remove-orphans`,
          { cwd: sess.composeDir, silentConsole: true }
        );
        activeComposeSessions.delete(key);
      } catch {}
    }
  }
}

export async function cleanupAllRunContainers(): Promise<void> {
  for (const [key, sess] of activeComposeSessions.entries()) {
    try {
      if (fs.existsSync(sess.composeFile)) {
        await executeProcess(
          `${sess.composePrefix} -f "${path.basename(sess.composeFile)}" down --volumes --remove-orphans`,
          { cwd: sess.composeDir, silentConsole: true }
        );
      }
    } catch {}
  }
  activeComposeSessions.clear();
}
