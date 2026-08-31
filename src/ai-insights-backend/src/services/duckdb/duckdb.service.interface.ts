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
  /** Ingests a single file source into DuckDB (optionally within a project folder). */
  ingestFileSource(type: ConnectorType, config: ConnectionConfig, projectName?: string): Promise<string>;

  /** Ingests multiple data sources into a dedicated project directory and creates a unified project database. */
  ingestProjectSources(projectName: string, sources: ProjectSourceInput[]): Promise<string>;

  getSchema(type: ConnectorType, config: ConnectionConfig, projectName?: string): Promise<{ success: boolean; type: string; tables: any[] }>;
  getPreview(type: ConnectorType, config: ConnectionConfig, tableName?: string, projectName?: string): Promise<{ success: boolean; headers: string[]; rows: any[] }>;
  getRowCount(type: ConnectorType, config: ConnectionConfig, tableName: string, projectName?: string): Promise<number>;
  getSampleWithOffset(type: ConnectorType, config: ConnectionConfig, tableName: string, limit: number, offset: number, projectName?: string): Promise<SampleResult>;
  getRandomSample(type: ConnectorType, config: ConnectionConfig, tableName: string, limit: number, seed?: number, projectName?: string): Promise<SampleResult>;
  getStratifiedSample(type: ConnectorType, config: ConnectionConfig, tableName: string, stratifyColumn: string, limitPerGroup: number, seed?: number, projectName?: string): Promise<SampleResult>;
  applyCleaningOperations(type: ConnectorType, config: ConnectionConfig, tableName: string, operations: any[], projectName?: string): Promise<{ results: any[] }>;

  /** Resolve a fileName to its on-disk DuckDB storage path. */
  getDuckDbPath(fileName: string, sheetName?: string, projectName?: string): string;

  /** Resolve a column's location across all available DuckDB databases */
  findColumnLocation(fieldId: string, preferredTable?: string): Promise<ColumnLocationResult | null>;

  /** Deletes the project folder and cleans up pooled connection handles. */
  deleteProjectFolder(projectName: string): Promise<void>;

  /** Run a SQL query against a pooled database connection for the given dbPath. */
  runQuery<T = any>(dbPath: string, sql: string, params?: any[]): Promise<T[]>;

  /** Run a SQL exec (DDL / DML with no result set) against a pooled database connection. */
  runExec(dbPath: string, sql: string): Promise<void>;
}
