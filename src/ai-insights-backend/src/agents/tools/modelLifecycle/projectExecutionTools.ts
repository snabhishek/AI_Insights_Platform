import { tool } from "@langchain/core/tools";
import { z } from "zod";
import {
  buildProjectContainer,
  executeProject,
  listProjectServices,
  stopProjectContainer,
} from "../../ModelLifecycle/runtime/pythonExecutor";
import type { ProjectExecutionToolsOptions } from "../../ModelLifecycle/runtime/types";

export function createProjectExecutionTools(options: ProjectExecutionToolsOptions) {
  return [
    tool(
      async () => buildProjectContainer(options.projectDirectory, options.signal),
      {
        name: "build_project_container",
        description: "Build the active project using its authored container configuration and return raw process output.",
        schema: z.object({}),
      }
    ),
    tool(
      async () => listProjectServices(options.projectDirectory, options.signal),
      {
        name: "list_project_services",
        description: "Inspect the services available in the active project's authored container configuration.",
        schema: z.object({}),
      }
    ),
    tool(
      async ({ service, command }: { service: string; command: string[] }) =>
        executeProject({
          projectDirectory: options.projectDirectory,
          service,
          command,
          timeoutMs: options.timeoutMs,
          signal: options.signal,
        }),
      {
        name: "execute_project",
        description: "Execute an agent-selected command in an agent-authored project container and return raw stdout and stderr.",
        schema: z.object({
          service: z.string(),
          command: z.array(z.string()),
        }),
      }
    ),
    tool(
      async () => stopProjectContainer(options.projectDirectory, options.signal),
      {
        name: "stop_project_container",
        description: "Stop and clean up containers for the active project.",
        schema: z.object({}),
      }
    ),
  ];
}
