export interface IFileService {
  saveFile(fileName: string, fileContent: string): Promise<void>;
  deleteFile(fileName: string): Promise<void>;
  fileExists(fileName: string): boolean;
  getFilePath(fileName: string): string;
  readTextFile(fileName: string): string;
}
