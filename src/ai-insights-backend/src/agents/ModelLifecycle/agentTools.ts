import { getMcpFilesystemTools } from "../tools/filesystem/mcpFilesystemClient";
import { createProjectExecutionTools } from "../tools/modelLifecycle/projectExecutionTools";
import { createProjectInspectionTools } from "../tools/modelLifecycle/projectInspectionTools";
import { createLifecycleSubagentTool } from "../tools/modelLifecycle/statelessSubagentTool";
import { extractUrlContentTool, webSearchTool } from "../tools/search";
import { getModel } from "../utils/agentUtils";

export async function createLifecycleAgentTools(
  projectDirectory: string,
  signal?: AbortSignal,
  additionalProjectDirectories: string[] = []
): Promise<unknown[]> {
  const filesystemTools = await getMcpFilesystemTools({
    allowedDirectories: [projectDirectory, ...additionalProjectDirectories],
  });
  const inspectionTools = await createProjectInspectionTools(projectDirectory);
  const executionTools = createProjectExecutionTools({
    projectDirectory,
    signal,
  });
  const model = getModel();
  if (!model) {
    throw new Error("No active language model is configured for model lifecycle agents.");
  }

  return [
    ...filesystemTools,
    ...inspectionTools,
    ...executionTools,
    webSearchTool,
    extractUrlContentTool,
    createLifecycleSubagentTool(model),
  ];
}
