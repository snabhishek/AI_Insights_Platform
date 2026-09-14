import fs from "fs";
import path from "path";
import { IFileService } from "./file.service.interface";
import {
  ensureDirectoryExists,
  ensureFileServerDirectories,
  getDatasourceDir,
  getDatasourceFilePath,
  getDatasourcesBasePath,
  getFileServerBasePath,
  getWorkspaceDatasourceDir,
  getWorkspaceDatasourceFilePath,
  getWorkspacesBasePath,
  resolveStoragePath,
  computeProjectRelativePath,
  sanitizeFolderName,
} from "../../config/fileServer.config";

export class LocalFileService implements IFileService {
  private legacyUploadDir = path.join(process.cwd(), "uploads");

  constructor() {
    ensureFileServerDirectories();
    if (!fs.existsSync(this.legacyUploadDir)) {
      fs.mkdirSync(this.legacyUploadDir, { recursive: true });
    }
  }

  async saveFile(fileName: string, fileContent: string, dataSourceName?: string, workspaceName?: string): Promise<string> {
    if (dataSourceName) {
      return this.saveDatasourceFile(dataSourceName, fileName, fileContent, workspaceName);
    }

    const filePath = this.getFilePath(fileName, undefined, workspaceName);
    const targetDir = path.dirname(filePath);
    ensureDirectoryExists(targetDir);

    let fileBuffer: Buffer;
    if (fileContent.includes(";base64,")) {
      const base64Data = fileContent.split(";base64,")[1];
      fileBuffer = Buffer.from(base64Data, "base64");
    } else {
      fileBuffer = Buffer.from(fileContent, "utf8");
    }

    fs.writeFileSync(filePath, fileBuffer);
    console.log(`[FileService] Persisted file: ${filePath}`);
    return filePath;
  }

  async saveDatasourceFile(dataSourceName: string, fileName: string, fileContent: string, workspaceName?: string): Promise<string> {
    const dsDir = workspaceName
      ? getWorkspaceDatasourceDir(workspaceName, dataSourceName)
      : getDatasourceDir(dataSourceName);
    ensureDirectoryExists(dsDir);

    const filePath = workspaceName
      ? getWorkspaceDatasourceFilePath(workspaceName, dataSourceName, fileName)
      : getDatasourceFilePath(dataSourceName, fileName);

    let fileBuffer: Buffer;
    if (fileContent.includes(";base64,")) {
      const base64Data = fileContent.split(";base64,")[1];
      fileBuffer = Buffer.from(base64Data, "base64");
    } else {
      fileBuffer = Buffer.from(fileContent, "utf8");
    }

    fs.writeFileSync(filePath, fileBuffer);
    console.log(`[FileService] Persisted datasource file to: ${filePath}`);
    return filePath;
  }

  async deleteDatasourceFile(dataSourceName: string, fileName: string, workspaceName?: string): Promise<void> {
    const filePath = this.getDatasourceFilePath(dataSourceName, fileName, workspaceName);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`[FileService] Cleaned up datasource file: ${filePath}`);
    }
  }

  async deleteDatasourceDir(dataSourceName: string, workspaceName?: string): Promise<void> {
    const dsDir = workspaceName
      ? getWorkspaceDatasourceDir(workspaceName, dataSourceName)
      : getDatasourceDir(dataSourceName);
    if (fs.existsSync(dsDir)) {
      fs.rmSync(dsDir, { recursive: true, force: true });
      console.log(`[FileService] Cleaned up datasource directory: ${dsDir}`);
    }
  }

  getDatasourceFilePath(dataSourceName: string, fileName: string, workspaceName?: string): string {
    // 1. If workspace is provided, check workspace-specific datasource directory first
    if (workspaceName) {
      const wsPath = getWorkspaceDatasourceFilePath(workspaceName, dataSourceName, fileName);
      if (fs.existsSync(wsPath)) return wsPath;
    }

    // 2. Search across all workspace datasource directories
    const workspacesBase = getWorkspacesBasePath();
    if (fs.existsSync(workspacesBase)) {
      try {
        const wsDirs = fs.readdirSync(workspacesBase, { withFileTypes: true }).filter((d) => d.isDirectory());
        for (const wsDir of wsDirs) {
          const cand = path.join(workspacesBase, wsDir.name, "datasources", sanitizeFolderName(dataSourceName), fileName);
          if (fs.existsSync(cand)) return cand;
        }
      } catch {}
    }

    // 3. Check global datasources directory
    const globalPath = getDatasourceFilePath(dataSourceName, fileName);
    if (fs.existsSync(globalPath)) return globalPath;

    // 4. Fallback to legacy uploads directory
    if (fs.existsSync(path.join(this.legacyUploadDir, fileName))) {
      return path.join(this.legacyUploadDir, fileName);
    }

    // Default target path
    return workspaceName
      ? getWorkspaceDatasourceFilePath(workspaceName, dataSourceName, fileName)
      : globalPath;
  }

  datasourceFileExists(dataSourceName: string, fileName: string, workspaceName?: string): boolean {
    const resolved = this.getDatasourceFilePath(dataSourceName, fileName, workspaceName);
    return fs.existsSync(resolved);
  }

  getProjectDirectory(folderPathOrProjectName: string, workspaceName?: string): string {
    if (folderPathOrProjectName.includes("/") || folderPathOrProjectName.includes("\\")) {
      const absPath = resolveStoragePath(folderPathOrProjectName);
      ensureDirectoryExists(absPath);
      return absPath;
    }
    const relative = computeProjectRelativePath(workspaceName || "Default_Workspace", folderPathOrProjectName);
    const absPath = resolveStoragePath(relative);
    ensureDirectoryExists(absPath);
    return absPath;
  }

  async deleteProjectDirectory(folderPathOrProjectName: string, workspaceName?: string): Promise<void> {
    const targetDir = this.getProjectDirectory(folderPathOrProjectName, workspaceName);
    if (fs.existsSync(targetDir)) {
      fs.rmSync(targetDir, { recursive: true, force: true });
      console.log(`[FileService] Removed project directory: ${targetDir}`);
    }
  }

  async deleteFile(fileName: string, dataSourceName?: string, workspaceName?: string): Promise<void> {
    if (dataSourceName) {
      await this.deleteDatasourceFile(dataSourceName, fileName, workspaceName);
      return;
    }
    const filePath = this.getFilePath(fileName, undefined, workspaceName);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`[FileService] Cleaned up file: ${filePath}`);
    }
  }

  fileExists(fileName: string, dataSourceName?: string, workspaceName?: string): boolean {
    if (dataSourceName) {
      return this.datasourceFileExists(dataSourceName, fileName, workspaceName);
    }
    const filePath = this.getFilePath(fileName, undefined, workspaceName);
    return fs.existsSync(filePath);
  }

  getFilePath(fileName: string, dataSourceName?: string, workspaceName?: string): string {
    if (dataSourceName) {
      return this.getDatasourceFilePath(dataSourceName, fileName, workspaceName);
    }

    if (path.isAbsolute(fileName) && fs.existsSync(fileName)) {
      return fileName;
    }

    // 1. Search inside workspace datasources if workspaceName provided
    if (workspaceName) {
      const wsDsBase = path.join(getWorkspacesBasePath(), sanitizeFolderName(workspaceName), "datasources");
      if (fs.existsSync(wsDsBase)) {
        const subDirs = fs.readdirSync(wsDsBase, { withFileTypes: true }).filter((d) => d.isDirectory());
        for (const subDir of subDirs) {
          const candidate = path.join(wsDsBase, subDir.name, fileName);
          if (fs.existsSync(candidate)) return candidate;
        }
      }
    }

    // 2. Search across all workspace datasource directories
    const workspacesBase = getWorkspacesBasePath();
    if (fs.existsSync(workspacesBase)) {
      try {
        const wsDirs = fs.readdirSync(workspacesBase, { withFileTypes: true }).filter((d) => d.isDirectory());
        for (const wsDir of wsDirs) {
          const wsDsBase = path.join(workspacesBase, wsDir.name, "datasources");
          if (fs.existsSync(wsDsBase)) {
            const subDirs = fs.readdirSync(wsDsBase, { withFileTypes: true }).filter((d) => d.isDirectory());
            for (const subDir of subDirs) {
              const candidate = path.join(wsDsBase, subDir.name, fileName);
              if (fs.existsSync(candidate)) return candidate;
            }
          }
        }
      } catch {}
    }

    // 3. Check legacy upload directory
    const legacyPath = path.join(this.legacyUploadDir, fileName);
    if (fs.existsSync(legacyPath)) {
      return legacyPath;
    }

    // 4. Default target path inside workspace
    return getWorkspaceDatasourceFilePath(workspaceName || "Default_Workspace", dataSourceName || "default", fileName);
  }

  readTextFile(fileName: string, dataSourceName?: string, workspaceName?: string): string {
    const filePath = this.getFilePath(fileName, dataSourceName, workspaceName);
    return fs.readFileSync(filePath, "utf8");
  }
}
