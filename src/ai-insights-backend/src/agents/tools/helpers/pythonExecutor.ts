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
  getProjectDatasetDir,
  getProjectDatasourceDir,
  getProjectPythonScriptDir,
  getProjectRunDir,
  resolveProjectEffectiveTimestamp,
  sanitizeFolderName,
} from "../../../config/fileServer.config";

export interface ExecutionResult {
  success: boolean;
  stdout: string;
  stderr: string;
  logFilePath?: string;
  errors?: PythonExecutionErrorDiagnostic[];
  warnings?: PythonWarningDiagnostic[];
}

export interface PythonExecutionErrorDiagnostic {
  category: string;
  message: string;
  exitCode: number;
}

export interface PythonWarningDiagnostic {
  category: string;
  message: string;
  filename: string;
  lineno: number;
}

export interface PythonExecutionOptions {
  mountMode?: "project" | "feature_engineering" | "model_training" | "model_validation" | "dataset_only" | "python_script_only" | "chat_execution";
  serviceName?: string;
  projectRootDir?: string;
  effectiveTimestamp?: string;
  sessionId?: string;
  isolated?: boolean;
  writableRelativePath?: string;
  onLog?: (line: string) => void;
  signal?: AbortSignal;
  captureWarnings?: boolean;
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
    // Configure Docker Desktop to start anonymously (no UI popup)
    try {
      const appData = process.env.APPDATA;
      if (appData) {
        const settingsStorePath = path.join(appData, "Docker", "settings-store.json");
        if (fs.existsSync(settingsStorePath)) {
          const content = JSON.parse(fs.readFileSync(settingsStorePath, "utf8"));
          if (!content.openUIOnStartupDisabled) {
            content.openUIOnStartupDisabled = true;
            fs.writeFileSync(settingsStorePath, JSON.stringify(content, null, 2), "utf8");
          }
        }
      }
    } catch {
      // ignore
    }

    // Try starting via official Docker Desktop CLI in detached mode first
    try {
      exec("docker desktop start -d");
    } catch {
      // ignore
    }

    const possiblePaths = [
      "C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe",
      "C:\\Program Files (x86)\\Docker\\Docker\\Docker Desktop.exe",
      path.join(process.env.LOCALAPPDATA || "", "Programs\\Docker\\Docker\\Docker Desktop.exe"),
    ];

    const exePath = possiblePaths.find((p) => fs.existsSync(p));
    if (exePath) {
      console.info(`[DockerExecutor] Docker daemon not responding. Launching Docker Desktop anonymously from: ${exePath}`);
      try {
        exec(`powershell -NoProfile -Command "Start-Process -FilePath '${exePath}' -WindowStyle Hidden"`);
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
        } catch { }
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
        } catch { }
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
    "COPY . /workspace",
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
      } else if (!existing.includes("COPY . /workspace") && !existing.includes("COPY . .")) {
        fs.appendFileSync(dockerfilePath, "\nCOPY . /workspace\n", "utf-8");
      }
    } catch { }
  }
  return dockerfilePath;
}

export function ensureDockerCompose(
  targetDir: string,
  serviceName: string = "app",
  resourceLimits?: { cpus?: string; memory?: string; hasGpu?: boolean },
  options?: PythonExecutionOptions | { writableRelativePath: string },
  isolation?: { writableRelativePath: string }
): string {
  const effectiveIsolation =
    isolation ||
    (options && "writableRelativePath" in options && typeof options.writableRelativePath === "string"
      ? { writableRelativePath: options.writableRelativePath }
      : undefined);
  const composeYml = fs.existsSync(path.join(targetDir, "docker-compose.yaml"))
    ? path.join(targetDir, "docker-compose.yaml")
    : path.join(targetDir, "docker-compose.yml");

  if (fs.existsSync(composeYml)) {
    try {
      let existingContent = fs.readFileSync(composeYml, "utf-8");
      if (!existingContent.includes("tail -f /dev/null") && !existingContent.includes("command:")) {
        const lines = existingContent.split("\n");
        const serviceIdx = lines.findIndex((l) => l.trim().startsWith(`${serviceName}:`) || l.trim().startsWith("app:") || l.trim().startsWith("model-training:"));
        if (serviceIdx !== -1) {
          lines.splice(serviceIdx + 1, 0, "    command: tail -f /dev/null");
          existingContent = lines.join("\n");
          fs.writeFileSync(composeYml, existingContent, "utf-8");
        }
      }
      return composeYml;
    } catch { }
  }

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

  const baseName = path.basename(targetDir).toLowerCase();
  const mountMode = (options as PythonExecutionOptions)?.mountMode;
  const isChatExecution =
    mountMode === "chat_execution" ||
    Boolean(effectiveIsolation) ||
    Boolean((options as PythonExecutionOptions)?.isolated) ||
    baseName.includes("sparrow") ||
    baseName.includes("chat_execution");
  const isModelTraining = !isChatExecution && (mountMode === "model_training" || mountMode === "dataset_only" || baseName.endsWith("_model_training"));
  const isModelValidation = !isChatExecution && (mountMode === "model_validation" || baseName.endsWith("_model_validation"));

  let volumeMounts: string[];
  if (isChatExecution) {
    const rawPath = effectiveIsolation?.writableRelativePath || (options as PythonExecutionOptions)?.writableRelativePath || "";
    const execId =
      (options as PythonExecutionOptions)?.sessionId ||
      (rawPath ? path.basename(rawPath) : baseName !== "app" && baseName !== "docker" ? baseName : "${EXECUTION_ID}");
    volumeMounts = [
      "      - \"${HOST_RUN_DIR:-${HOST_PROJECT_ROOT}/${RUN_TIMESTAMP}}:/workspace/project:ro\"",
      "      - \"${HOST_DATASOURCE_DIR}:/workspace/datasource:ro\"",
      `      - \"\${HOST_EXECUTION_DIR}:/workspace/chat_execution/${execId}:rw\"`,
    ];
  } else if (isModelTraining) {
    volumeMounts = [
      "      - \"${HOST_MODEL_TRAINING_DIR}:/workspace/${PROJECT_NAME}_model_training\"",
      "      - \"${HOST_DATASET_DIR}:/workspace/dataset:ro\"",
    ];
  } else if (isModelValidation) {
    volumeMounts = [
      "      - \"${HOST_MODEL_VALIDATION_DIR}:/workspace/${PROJECT_NAME}_model_validation\"",
      "      - \"${HOST_DATASET_DIR}:/workspace/dataset:ro\"",
      "      - \"${HOST_MODEL_TRAINING_DIR}:/workspace/${PROJECT_NAME}_model_training:ro\"",
    ];
  } else {
    // Feature Engineering
    volumeMounts = [
      "      - \"${HOST_FEATURE_ENGINEERING_DIR}:/workspace/${PROJECT_NAME}_feature_engineering\"",
      "      - \"${HOST_DATASOURCE_DIR}:/workspace/datasource:ro\"",
      "      - \"${HOST_DATASET_DIR}:/workspace/dataset:rw\"",
    ];
  }

  const content = [
    "services:",
    `  ${serviceName}:`,
    "    build:",
    "      context: .",
    "      dockerfile: Dockerfile",
    "      network: host",
    isChatExecution ? "    network_mode: none" : "    network_mode: host",
    ...(isChatExecution ? ["    read_only: true", "    cap_drop: [ALL]", "    security_opt: [no-new-privileges:true]", "    tmpfs: [/tmp]"] : []),
    "    volumes:",
    ...volumeMounts,
    "    working_dir: /workspace",
    "    environment:",
    "      - PYTHONPATH=/workspace",
    "      - PYTHONDONTWRITEBYTECODE=1",
    "      - PYTHONUNBUFFERED=1",
    "    command: tail -f /dev/null",
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
  effectiveTimestamp: string,
  options?: PythonExecutionOptions
): string {
  const scriptDir = path.dirname(scriptPath);
  const baseName = path.basename(scriptDir).toLowerCase();

  if (
    options?.isolated ||
    options?.mountMode === "chat_execution" ||
    scriptDir.includes("sparrow") ||
    scriptDir.includes("chat_execution") ||
    baseName.endsWith("_feature_engineering") ||
    baseName.endsWith("_model_training") ||
    baseName.endsWith("_model_validation") ||
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
  options?: PythonExecutionOptions
): Promise<ExecutionResult> {
  options?.signal?.throwIfAborted();
  let workspaceName = "Default_Workspace";
  let projectName = projectId || "default";

  if (services?.projectService && typeof services.projectService.getProjectWithWorkspace === "function" && projectId) {
    try {
      const pWs = await services.projectService.getProjectWithWorkspace(projectId);
      if (pWs) {
        workspaceName = pWs.workspaceName || workspaceName;
        projectName = pWs.project.projectName!;
      }
    } catch (err: any) {
      console.log(err);
    }
  }

  const projectRootDir = options?.projectRootDir || path.join(
    getFileServerBasePath(),
    "workspaces",
    sanitizeFolderName(workspaceName),
    "projects",
    sanitizeFolderName(projectName)
  );
  ensureDirectoryExists(projectRootDir);
  const normProjectDir = path.resolve(projectRootDir).replace(/\\/g, "/");

  const effectiveTimestamp =
    options?.effectiveTimestamp ||
    getLatestProjectTimestamp(workspaceName, projectName) ||
    (runTimestamp && runTimestamp !== "default" ? runTimestamp.trim() : undefined) ||
    resolveProjectEffectiveTimestamp(workspaceName, projectName, runTimestamp) ||
    runTimestamp ||
    "default";

  const baseDir = options?.isolated ? path.dirname(path.resolve(scriptName)) : getProjectPythonScriptDir(workspaceName, projectName, effectiveTimestamp);
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
      if (options?.isolated) {
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
  if (options?.isolated && (relFromProjectRoot.startsWith("../") || path.isAbsolute(relFromProjectRoot))) throw new Error("Execution script must remain inside the project.");
  const scriptDirRel = path.relative(projectRootDir, path.dirname(scriptPath)).replace(/\\/g, "/");
  const containerOutDir = scriptDirRel && scriptDirRel !== "." ? `/workspace/${scriptDirRel}`.replace(/\/+/g, "/") : "/workspace";

  const safeProjectName = sanitizeFolderName(projectName);
  const datasourceDir = getProjectDatasourceDir(workspaceName, projectName);
  ensureDirectoryExists(datasourceDir);
  const normDatasourceDir = path.resolve(datasourceDir).replace(/\\/g, "/");

  const datasetDir = getProjectDatasetDir(workspaceName, projectName, effectiveTimestamp);
  ensureDirectoryExists(datasetDir);
  const normDatasetDir = path.resolve(datasetDir).replace(/\\/g, "/");

  const runDir = getProjectRunDir(workspaceName, projectName, effectiveTimestamp);
  const featureEngineeringDir = getProjectPythonScriptDir(workspaceName, projectName, effectiveTimestamp);
  ensureDirectoryExists(featureEngineeringDir);
  const normFeatureEngineeringDir = path.resolve(featureEngineeringDir).replace(/\\/g, "/");

  const execDir = resolveExecutionDirectory(scriptPath, projectRootDir, effectiveTimestamp, options);
  ensureDirectoryExists(execDir);

  const baseExecName = path.basename(execDir).toLowerCase();
  const mountMode = options?.mountMode;
  const isChatExecution =
    mountMode === "chat_execution" ||
    Boolean(options?.isolated) ||
    baseExecName.includes("sparrow") ||
    baseExecName.includes("chat_execution");
  const isModelTraining = !isChatExecution && (mountMode === "model_training" || mountMode === "dataset_only" || baseExecName.endsWith("_model_training"));
  const isModelValidation = !isChatExecution && (mountMode === "model_validation" || baseExecName.endsWith("_model_validation"));
  const isFeatureEngineering = !isChatExecution && (mountMode === "feature_engineering" || baseExecName.endsWith("_feature_engineering") || (!isModelTraining && !isModelValidation));

  const modelTrainingDir = path.join(runDir, `${safeProjectName}_model_training`);
  const normModelTrainingDir = path.resolve((isModelTraining && execDir) ? execDir : modelTrainingDir).replace(/\\/g, "/");

  const modelValidationDir = path.join(runDir, `${safeProjectName}_model_validation`);
  const normModelValidationDir = path.resolve((isModelValidation && execDir) ? execDir : modelValidationDir).replace(/\\/g, "/");

  const args: string[] = [];
  const hasOutDir = extraArgs.some((a) => a.startsWith("--out-dir"));
  if (!hasOutDir) {
    if (isChatExecution) {
      const execId = options?.sessionId || path.basename(path.dirname(scriptPath));
      args.push(`--out-dir "/workspace/chat_execution/${execId}"`);
    } else if (isFeatureEngineering) {
      args.push('--out-dir "/workspace/dataset"');
    } else if (isModelTraining) {
      args.push(`--out-dir "/workspace/${safeProjectName}_model_training"`);
    } else if (isModelValidation) {
      args.push(`--out-dir "/workspace/${safeProjectName}_model_validation"`);
    } else {
      args.push(`--out-dir "${containerOutDir}"`);
    }
  }

  if (isFeatureEngineering && !extraArgs.some((a) => a.startsWith("--db-path"))) {
    args.push('--db-path "/workspace/datasource"');
  }

  if (extraArgs && extraArgs.length > 0) {
    args.push(...extraArgs);
  }

  if (connectorIdList && connectorIdList.length > 0) {
    const primaryConnectorId = connectorIdList[0];
    const connector = await services.connectorService.getById(primaryConnectorId);
    if (connector) {
      const type = connector.type;
      const config = connector.connectionConfig;

      if (isFeatureEngineering && ["excel", "csv", "tsv", "parquet"].includes(type) && config.fileName) {
        if (!args.some((a) => a.startsWith("--db-path"))) {
          args.push(`--db-path "/workspace/datasource"`);
        }
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

  ensureRequirementsTxt(execDir, requiredPackages);
  ensureDockerfile(execDir);
  const composeFile = ensureDockerCompose(
    execDir,
    options?.serviceName || "app",
    resourceLimits,
    options,
    options?.isolated ? { writableRelativePath: scriptDirRel } : undefined
  );
  const composeFileName = path.basename(composeFile);

  const sessionKey = `${projectId || "default"}__${options?.sessionId || effectiveTimestamp}`;
  const composePrefix = options?.sessionId
    ? `docker compose -p "sparrow_${options.sessionId.replace(/[^a-zA-Z0-9_-]/g, "").toLowerCase()}"`
    : "docker compose";
  activeComposeSessions.set(sessionKey, { composeDir: execDir, composeFile, composePrefix });

  const normRunDir = path.resolve(runDir).replace(/\\/g, "/");
  const env: NodeJS.ProcessEnv = {
    HOST_PROJECT_ROOT: normProjectDir,
    HOST_RUN_DIR: normRunDir,
    HOST_DATASOURCE_DIR: normDatasourceDir,
    HOST_DATASET_DIR: normDatasetDir,
    HOST_FEATURE_ENGINEERING_DIR: normFeatureEngineeringDir,
    HOST_MODEL_TRAINING_DIR: normModelTrainingDir,
    HOST_MODEL_VALIDATION_DIR: normModelValidationDir,
    HOST_PYTHON_SCRIPT_DIR: normFeatureEngineeringDir,
    PROJECT_NAME: safeProjectName,
    RUN_TIMESTAMP: effectiveTimestamp,
    EXECUTION_ID: options?.sessionId || path.basename(execDir),
    PYTHONPATH: "/workspace",
    HOST_EXECUTION_DIR: path.resolve(execDir).replace(/\\/g, "/"),
  };

  console.info(`[DockerExecutor] Building and running via Docker Compose in [${execDir}] for script [${relFromProjectRoot}] (mountMode: ${options?.mountMode || (isChatExecution ? "chat_execution" : isFeatureEngineering ? "feature_engineering" : "project")})`);

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

  let scriptInContainer: string;
  if (isChatExecution) {
    const execId = options?.sessionId || path.basename(path.dirname(scriptPath));
    scriptInContainer = `chat_execution/${execId}/${path.basename(scriptPath)}`;
  } else if (isModelTraining) {
    scriptInContainer = `${path.basename(normModelTrainingDir)}/${path.basename(scriptPath)}`;
  } else if (isModelValidation) {
    scriptInContainer = `${path.basename(normModelValidationDir)}/${path.basename(scriptPath)}`;
  } else {
    scriptInContainer = `${path.basename(normFeatureEngineeringDir)}/${path.basename(scriptPath)}`;
  }

  const effectiveArgs = args;

  const initLogHeader = [
    "=".repeat(80),
    `DOCKER CONTAINER EXECUTION LOG`,
    `Execution Start Time: ${new Date().toISOString()}`,
    `Execution Directory: ${execDir}`,
    `Script Relative Path: ${relFromProjectRoot}`,
    `Script In Container: ${scriptInContainer}`,
    `Mount Mode: ${options?.mountMode || (isFeatureEngineering ? "feature_engineering" : "project")}`,
    `Host Project Root: ${normProjectDir}`,
    `Host Datasource Dir: ${normDatasourceDir}`,
    `Host Dataset Dir: ${normDatasetDir}`,
    `Host Feature Engineering Dir: ${normFeatureEngineeringDir}`,
    `Arguments: ${effectiveArgs.join(" ")}`,
    "=".repeat(80),
    "",
  ].join("\n");
  fs.writeFileSync(logFilePath, initLogHeader, "utf-8");

  console.info(`[DockerExecutor] Docker container logs writing to: ${logFilePath}`);

  let serviceName = options?.serviceName || "app";
  try {
    const composeContent = fs.readFileSync(composeFile, "utf-8");
    const serviceMatch = composeContent.match(/services:\s*\n\s*([a-zA-Z0-9_-]+):/);
    if (serviceMatch && serviceMatch[1]) {
      serviceName = serviceMatch[1];
    }
  } catch { }

  // Check if container is already running for persistent reuse
  const checkRunningCmd = `${composePrefix} -f "${composeFileName}" ps --status running -q ${serviceName}`;
  const psResult = await executeProcess(checkRunningCmd, {
    signal: options?.signal,
    cwd: execDir,
    env,
    silentConsole: true,
  });
  const runningContainerId = psResult.stdout ? psResult.stdout.trim() : "";
  const isContainerRunning = Boolean(psResult.exitCode === 0 && runningContainerId.length > 0);

  if (!isContainerRunning) {
    const upCmd = `${composePrefix} -f "${composeFileName}" up -d --build ${serviceName}`;
    fs.appendFileSync(
      logFilePath,
      [
        "-".repeat(80),
        `STEP 1: START PERSISTENT CONTAINER (docker compose up -d --build)`,
        `Command: ${upCmd}`,
        `Time: ${new Date().toISOString()}`,
        "-".repeat(80),
        "",
      ].join("\n"),
      "utf-8"
    );

    const upResult = await executeProcess(upCmd, {
      signal: options?.signal,
      onLog: options?.onLog,
      cwd: execDir,
      env,
      silentConsole: true,
      logFilePath,
    });

    if (upResult.exitCode !== 0) {
      fs.appendFileSync(
        logFilePath,
        [
          "",
          "-".repeat(80),
          `CONTAINER START FAILED (exit code: ${upResult.exitCode})`,
          `Time: ${new Date().toISOString()}`,
          "-".repeat(80),
          "",
        ].join("\n"),
        "utf-8"
      );
      console.error(`[DockerExecutor] Docker Compose up failed (exit code ${upResult.exitCode}). Check logs: ${logFilePath}`);
      return {
        success: false,
        stdout: upResult.stdout,
        stderr: `Docker Compose startup error:\n${upResult.stderr || upResult.stdout}\n(Docker logs saved to: ${logFilePath})`,
        logFilePath,
      };
    }

    fs.appendFileSync(
      logFilePath,
      [
        "",
        "-".repeat(80),
        `PERSISTENT CONTAINER STARTED SUCCESSFULLY (exit code: 0)`,
        `Time: ${new Date().toISOString()}`,
        "-".repeat(80),
        "",
      ].join("\n"),
      "utf-8"
    );
  } else {
    fs.appendFileSync(
      logFilePath,
      [
        "-".repeat(80),
        `STEP 1: REUSING EXISTING PERSISTENT CONTAINER`,
        `Container ID: ${runningContainerId}`,
        `Time: ${new Date().toISOString()}`,
        "-".repeat(80),
        "",
      ].join("\n"),
      "utf-8"
    );
    console.info(`[DockerExecutor] Reusing existing persistent container [${runningContainerId}] for service [${serviceName}]`);

    // If new packages were requested across iterations, dynamically install them into the running container
    if (requiredPackages && requiredPackages.length > 0 && !isChatExecution) {
      const installCmd = `${composePrefix} -f "${composeFileName}" exec -T ${serviceName} pip install --no-cache-dir ${requiredPackages.join(" ")}`;
      fs.appendFileSync(
        logFilePath,
        [
          "-".repeat(80),
          `DYNAMIC PACKAGE INSTALLATION IN RUNNING CONTAINER`,
          `Command: ${installCmd}`,
          `Packages: ${requiredPackages.join(", ")}`,
          `Time: ${new Date().toISOString()}`,
          "-".repeat(80),
          "",
        ].join("\n"),
        "utf-8"
      );
      await executeProcess(installCmd, {
        signal: options?.signal,
        onLog: options?.onLog,
        cwd: execDir,
        env,
        silentConsole: true,
        logFilePath,
      });
    }
  }

  const warningsPath = path.join(execDir, ".codex_python_warnings.json");
  let commandScript = scriptInContainer;
  let commandArgs = effectiveArgs;
  if (options?.captureWarnings) {
    // Run the generated entrypoint through Python's warning API so warning
    // records are separated from stderr and never mistaken for exceptions.
    const runnerName = ".codex_python_diagnostic_runner.py";
    const runnerPath = path.join(execDir, runnerName);
    const runnerSource = [
      "import json, runpy, sys, warnings",
      "from pathlib import Path",
      "target = sys.argv[1]",
      "diagnostics_path = Path(__file__).with_name('.codex_python_warnings.json')",
      "sys.argv = [target, *sys.argv[2:]]",
      "records = []",
      "try:",
      "    with warnings.catch_warnings(record=True) as records:",
      "        warnings.simplefilter('always')",
      "        runpy.run_path(target, run_name='__main__')",
      "finally:",
      "    captured = [{'category': w.category.__name__, 'message': str(w.message), 'filename': w.filename, 'lineno': w.lineno} for w in records]",
      "    diagnostics_path.write_text(json.dumps({'warnings': captured}, ensure_ascii=False), encoding='utf-8')",
    ].join("\n");
    fs.writeFileSync(runnerPath, runnerSource, "utf-8");
    if (fs.existsSync(warningsPath)) fs.unlinkSync(warningsPath);
    commandScript = `${path.posix.dirname(scriptInContainer)}/${runnerName}`;
    commandArgs = [scriptInContainer, ...effectiveArgs];
  }

  const execCmd = `${composePrefix} -f "${composeFileName}" exec -T ${serviceName} python -u "${commandScript}" ${commandArgs.join(" ")}`;
  fs.appendFileSync(
    logFilePath,
    [
      "-".repeat(80),
      `STEP 2: EXECUTE PYTHON SCRIPT INSIDE CONTAINER`,
      `Command: ${execCmd}`,
      `Time: ${new Date().toISOString()}`,
      "-".repeat(80),
      "",
    ].join("\n"),
    "utf-8"
  );

  const execResult = await executeProcess(execCmd, {
    signal: options?.signal,
    onLog: options?.onLog,
    cwd: execDir,
    env,
    silentConsole: true,
    logFilePath,
  });

  fs.appendFileSync(
    logFilePath,
    [
      "",
      "=".repeat(80),
      `CONTAINER EXECUTION FINISHED`,
      `Finished At: ${new Date().toISOString()}`,
      `Exit Code: ${execResult.exitCode}`,
      `Status: ${execResult.exitCode === 0 ? "SUCCESS" : "FAILED"}`,
      `Note: Container is persisted throughout process and retained on error.`,
      "=".repeat(80),
      "",
    ].join("\n"),
    "utf-8"
  );

  if (execResult.exitCode === 0) {
    console.info(`[DockerExecutor] Container execution completed successfully. Logs: ${logFilePath}`);
  } else {
    console.warn(`[DockerExecutor] Container execution exited with code ${execResult.exitCode}. Container preserved for inspection. Logs: ${logFilePath}`);
  }

  let warnings: PythonWarningDiagnostic[] = [];
  if (options?.captureWarnings && fs.existsSync(warningsPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(warningsPath, "utf-8"));
      if (Array.isArray(parsed?.warnings)) warnings = parsed.warnings;
    } catch (error) {
      console.warn("[DockerExecutor] Could not parse captured Python warnings:", error);
    }
  }

  return {
    success: execResult.exitCode === 0,
    stdout: execResult.stdout,
    stderr: execResult.stderr,
    logFilePath,
    errors: execResult.exitCode === 0
      ? []
      : [{
          category: "PythonProcessError",
          message: execResult.stderr || execResult.stdout || `Python process exited with code ${execResult.exitCode}.`,
          exitCode: execResult.exitCode ?? -1,
        }],
    warnings,
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
      } catch { }
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
    } catch { }
  }
  activeComposeSessions.clear();
}
