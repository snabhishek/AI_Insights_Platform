import * as path from "path";
import { getMcpFilesystemTools } from "../tools/filesystem/mcpFilesystemClient";

const REQUIRED_PROJECT_FILES = [
  "Dockerfile",
  "docker-compose.yml",
  "requirements.txt",
] as const;

function isMissingFileError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /not found|no such file|does not exist|enoent/i.test(message);
}

export async function checkProjectStructureAndDependencies(projectDirectory: string) {
  const tools = await getMcpFilesystemTools({
    allowedDirectories: [projectDirectory],
  });
  const fileInfoTool = tools.find((entry) => entry.name.endsWith("get_file_info"));
  if (!fileInfoTool) {
    throw new Error("The MCP filesystem server does not expose file metadata inspection.");
  }

  const missingFiles: string[] = [];
  for (const file of REQUIRED_PROJECT_FILES) {
    try {
      await fileInfoTool.invoke({ path: path.join(projectDirectory, file) });
    } catch (error) {
      if (!isMissingFileError(error)) {
        throw error;
      }
      missingFiles.push(file);
    }
  }

  const requirementsTool = tools.find((entry) => entry.name.endsWith("read_text_file"));
  if (!requirementsTool) {
    throw new Error("The MCP filesystem server does not expose text-file reading.");
  }

  let dependencyFileReadable = false;
  if (!missingFiles.includes("requirements.txt")) {
    const result = await requirementsTool.invoke({
      path: path.join(projectDirectory, "requirements.txt"),
    });
    const content = typeof result === "string" ? result : JSON.stringify(result);
    dependencyFileReadable = content.trim().length > 0;
  }

  return {
    valid: missingFiles.length === 0 && dependencyFileReadable,
    missingFiles,
    dependencyFileReadable,
  };
}
