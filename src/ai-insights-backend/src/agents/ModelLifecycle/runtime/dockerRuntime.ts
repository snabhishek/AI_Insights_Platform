import { spawn } from "child_process";
import * as path from "path";
import * as fs from "fs";
import type { ProjectExecutionRequest, ProjectExecutionResult } from "./types";

const COMPOSE_FILE = "docker-compose.yml";

function generateLogTimestamp(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const seconds = String(now.getSeconds()).padStart(2, "0");
  return `${year}${month}${day}-${hours}${minutes}${seconds}`;
}

function getDockerLogFilePath(cwd: string): string {
  const dockerLogsDir = path.join(cwd, "docker_logs");
  if (!fs.existsSync(dockerLogsDir)) {
    fs.mkdirSync(dockerLogsDir, { recursive: true });
  }
  const timestamp = generateLogTimestamp();
  let logFileName = `${timestamp}.txt`;
  let logFilePath = path.join(dockerLogsDir, logFileName);
  let duplicateIndex = 1;
  while (fs.existsSync(logFilePath)) {
    logFileName = `${timestamp}_${duplicateIndex}.txt`;
    logFilePath = path.join(dockerLogsDir, logFileName);
    duplicateIndex++;
  }
  return logFilePath;
}

function runDocker(
  args: string[],
  cwd: string,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<ProjectExecutionResult> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Project execution was cancelled before it started."));
      return;
    }

    let logFilePath: string | undefined;
    try {
      logFilePath = getDockerLogFilePath(cwd);
      const startTime = new Date().toISOString();
      const commandStr = `docker ${args.join(" ")}`;
      const initHeader = [
        "=".repeat(80),
        `DOCKER CONTAINER EXECUTION LOG`,
        `Start Time: ${startTime}`,
        `Working Directory: ${cwd}`,
        `Command: ${commandStr}`,
        "=".repeat(80),
        "",
      ].join("\n");
      fs.writeFileSync(logFilePath, initHeader, "utf-8");
    } catch (logErr) {
      console.warn("[ModelLifecycleDockerRuntime] Failed to initialize docker log file:", logErr);
    }

    const child = spawn("docker", args, {
      cwd,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timer: NodeJS.Timeout | undefined;

    const finish = (result: ProjectExecutionResult) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve(result);
    };
    const onAbort = () => {
      child.kill("SIGTERM");
    };

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (logFilePath) {
        try {
          fs.appendFileSync(logFilePath, chunk, "utf-8");
        } catch { }
      }
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
      if (logFilePath) {
        try {
          fs.appendFileSync(logFilePath, chunk, "utf-8");
        } catch { }
      }
    });
    child.once("error", (error) => {
      if (logFilePath) {
        try {
          fs.appendFileSync(logFilePath, `\nExecution Error: ${error?.message || String(error)}\n`, "utf-8");
        } catch { }
      }
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(error);
    });
    child.once("close", (exitCode, closeSignal) => {
      if (logFilePath) {
        const finishFooter = [
          "",
          "=".repeat(80),
          `CONTAINER EXECUTION FINISHED`,
          `Finished At: ${new Date().toISOString()}`,
          `Exit Code: ${exitCode}`,
          `Status: ${exitCode === 0 ? "SUCCESS" : "FAILED"}`,
          `Signal: ${closeSignal || "none"}`,
          "=".repeat(80),
          "",
        ].join("\n");
        try {
          fs.appendFileSync(logFilePath, finishFooter, "utf-8");
        } catch { }
      }
      finish({
        success: exitCode === 0,
        exitCode,
        stdout,
        stderr,
        signal: closeSignal || undefined,
        logFilePath,
      });
    });

    signal?.addEventListener("abort", onAbort, { once: true });
    timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
  });
}

function composeArgs(projectDirectory: string): string[] {
  return ["compose", "--file", path.join(projectDirectory, COMPOSE_FILE)];
}

export class ModelLifecycleDockerRuntime {
  public async build(projectDirectory: string, signal?: AbortSignal): Promise<ProjectExecutionResult> {
    return runDocker(
      [...composeArgs(projectDirectory), "build"],
      projectDirectory,
      30 * 60 * 1000,
      signal
    );
  }

  public async listServices(projectDirectory: string, signal?: AbortSignal): Promise<ProjectExecutionResult> {
    return runDocker(
      [...composeArgs(projectDirectory), "config", "--services"],
      projectDirectory,
      60_000,
      signal
    );
  }

  public async run(request: ProjectExecutionRequest): Promise<ProjectExecutionResult> {
    if (!request.service.trim()) {
      throw new Error("A project service must be selected by the lifecycle agent.");
    }
    return runDocker(
      [
        ...composeArgs(request.projectDirectory),
        "run",
        "--rm",
        request.service,
        ...request.command,
      ],
      request.projectDirectory,
      request.timeoutMs ?? 60 * 60 * 1000,
      request.signal
    );
  }

  public async stop(projectDirectory: string, signal?: AbortSignal): Promise<ProjectExecutionResult> {
    return runDocker(
      [...composeArgs(projectDirectory), "down", "--remove-orphans"],
      projectDirectory,
      60_000,
      signal
    );
  }
}
