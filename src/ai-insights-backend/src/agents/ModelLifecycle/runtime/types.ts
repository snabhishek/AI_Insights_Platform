export interface ProjectExecutionRequest {
  projectDirectory: string;
  service: string;
  command: string[];
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface ProjectExecutionResult {
  success: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  signal?: string;
  logFilePath?: string;
}

export interface ProjectExecutionToolsOptions {
  projectDirectory: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}
