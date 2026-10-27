import type { ProjectExecutionRequest, ProjectExecutionResult } from "./types";
import { ModelLifecycleDockerRuntime } from "./dockerRuntime";

const runtime = new ModelLifecycleDockerRuntime();

export async function buildProjectContainer(
  projectDirectory: string,
  signal?: AbortSignal
): Promise<ProjectExecutionResult> {
  return runtime.build(projectDirectory, signal);
}

export async function listProjectServices(
  projectDirectory: string,
  signal?: AbortSignal
): Promise<ProjectExecutionResult> {
  return runtime.listServices(projectDirectory, signal);
}

export async function executeProject(
  request: ProjectExecutionRequest
): Promise<ProjectExecutionResult> {
  return runtime.run(request);
}

export async function stopProjectContainer(
  projectDirectory: string,
  signal?: AbortSignal
): Promise<ProjectExecutionResult> {
  return runtime.stop(projectDirectory, signal);
}
