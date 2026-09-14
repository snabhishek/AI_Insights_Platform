export interface IFileService {
  saveFile(fileName: string, fileContent: string, dataSourceName?: string, workspaceName?: string): Promise<string>;
  saveDatasourceFile(dataSourceName: string, fileName: string, fileContent: string, workspaceName?: string): Promise<string>;
  deleteDatasourceFile(dataSourceName: string, fileName: string, workspaceName?: string): Promise<void>;
  deleteDatasourceDir(dataSourceName: string, workspaceName?: string): Promise<void>;
  getDatasourceFilePath(dataSourceName: string, fileName: string, workspaceName?: string): string;
  datasourceFileExists(dataSourceName: string, fileName: string, workspaceName?: string): boolean;
  getProjectDirectory(folderPathOrProjectName: string, workspaceName?: string): string;
  deleteProjectDirectory(folderPathOrProjectName: string, workspaceName?: string): Promise<void>;
  deleteFile(fileName: string, dataSourceName?: string, workspaceName?: string): Promise<void>;
  fileExists(fileName: string, dataSourceName?: string, workspaceName?: string): boolean;
  getFilePath(fileName: string, dataSourceName?: string, workspaceName?: string): string;
  readTextFile(fileName: string, dataSourceName?: string, workspaceName?: string): string;
}
