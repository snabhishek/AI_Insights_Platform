import { ConnectorType, ConnectionConfig } from "../../models/connector.types";
import { SampleResult } from "../connector/connectionTester.service.interface";

export interface ColumnLocationResult {
  dbPath: string;
  tableName: string;
  columnName: string;
  colNames: string[];
}

export interface ProjectSourceInput {
  name?: string;
  type: ConnectorType;
  config: ConnectionConfig;
}

export interface IDuckDBService {

  ingestFileSource(type: ConnectorType, config: ConnectionConfig, projectName?: string, workspaceName?: string, folderPath?: string): Promise<string>;

  ingestProjectSources(projectName: string, sources: ProjectSourceInput[], workspaceName?: string, folderPath?: string): Promise<string>;

  getSchema(type: ConnectorType, config: ConnectionConfig, projectName?: string, workspaceName?: string, folderPath?: string): Promise<{ success: boolean; type: string; tables: any[] }>;
  getPreview(type: ConnectorType, config: ConnectionConfig, tableName?: string, projectName?: string, workspaceName?: string, folderPath?: string): Promise<{ success: boolean; headers: string[]; rows: any[] }>;
  getRowCount(type: ConnectorType, config: ConnectionConfig, tableName: string, projectName?: string, workspaceName?: string, folderPath?: string): Promise<number>;
  getSampleWithOffset(type: ConnectorType, config: ConnectionConfig, tableName: string, limit: number, offset: number, projectName?: string, workspaceName?: string, folderPath?: string): Promise<SampleResult>;
  getRandomSample(type: ConnectorType, config: ConnectionConfig, tableName: string, limit: number, seed?: number, projectName?: string, workspaceName?: string, folderPath?: string): Promise<SampleResult>;
  getStratifiedSample(type: ConnectorType, config: ConnectionConfig, tableName: string, stratifyColumn: string, limitPerGroup: number, seed?: number, projectName?: string, workspaceName?: string, folderPath?: string): Promise<SampleResult>;
  applyCleaningOperations(type: ConnectorType, config: ConnectionConfig, tableName: string, operations: any[], projectName?: string, workspaceName?: string, folderPath?: string): Promise<{ results: any[] }>;

  getDuckDbPath(fileName: string, sheetName?: string, projectName?: string, workspaceName?: string, folderPath?: string): string;

  findColumnLocation(fieldId: string, preferredTable?: string): Promise<ColumnLocationResult | null>;

  deleteProjectFolder(projectName: string, workspaceName?: string, folderPath?: string): Promise<void>;

  runQuery<T = any>(dbPath: string, sql: string, params?: any[]): Promise<T[]>;

  runExec(dbPath: string, sql: string): Promise<void>;
}
