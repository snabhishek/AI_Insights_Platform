import fs from "fs";
import path from "path";
import { IFileService } from "./file.service.interface";

export class LocalFileService implements IFileService {
  private uploadDir = path.join(process.cwd(), "uploads");

  constructor() {
    if (!fs.existsSync(this.uploadDir)) {
      fs.mkdirSync(this.uploadDir, { recursive: true });
    }
  }

  async saveFile(fileName: string, fileContent: string): Promise<void> {
    const filePath = this.getFilePath(fileName);
    let fileBuffer: Buffer;

    if (fileContent.includes(";base64,")) {
      const base64Data = fileContent.split(";base64,")[1];
      fileBuffer = Buffer.from(base64Data, "base64");
    } else {
      fileBuffer = Buffer.from(fileContent, "utf8");
    }

    fs.writeFileSync(filePath, fileBuffer);
    console.log(`[FileService] Persisted file to local directory: ${filePath}`);
  }

  async deleteFile(fileName: string): Promise<void> {
    const filePath = this.getFilePath(fileName);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`[FileService] Cleaned up file from disk: ${filePath}`);
    }
  }

  fileExists(fileName: string): boolean {
    const filePath = this.getFilePath(fileName);
    return fs.existsSync(filePath);
  }

  getFilePath(fileName: string): string {
    return path.join(this.uploadDir, fileName);
  }

  readTextFile(fileName: string): string {
    const filePath = this.getFilePath(fileName);
    return fs.readFileSync(filePath, "utf8");
  }
}
