import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { getMcpFilesystemTools } from "../filesystem/mcpFilesystemClient";

export async function createProjectInspectionTools(projectDirectory: string) {
  const filesystemTools = await getMcpFilesystemTools({
    allowedDirectories: [projectDirectory],
  });
  const listDirectoryTool = filesystemTools.find((entry) =>
    entry.name.endsWith("list_directory")
  );
  const getFileInfoTool = filesystemTools.find((entry) =>
    entry.name.endsWith("get_file_info")
  );

  if (!listDirectoryTool || !getFileInfoTool) {
    throw new Error("The configured MCP filesystem server does not expose required inspection tools.");
  }

  return [
    tool(
      async ({ path }: { path: string }) => listDirectoryTool.invoke({ path }),
      {
        name: "inspect_project_directory",
        description: "List a directory under the active project using the MCP filesystem server.",
        schema: z.object({ path: z.string() }),
      }
    ),
    tool(
      async ({ path }: { path: string }) => getFileInfoTool.invoke({ path }),
      {
        name: "inspect_project_file",
        description: "Read metadata about a file under the active project using the MCP filesystem server.",
        schema: z.object({ path: z.string() }),
      }
    ),
  ];
}
