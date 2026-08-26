import { ConnectorType, ConnectionConfig } from "../../models/connector.types";
import { SampleResult } from "../connector/connectionTester.service.interface";

export interface IDuckDBService {
  ingestFileSource(type: ConnectorType, config: ConnectionConfig): Promise<void>;
  getSchema(type: ConnectorType, config: ConnectionConfig): Promise<{ success: boolean; type: string; tables: any[] }>;
  getPreview(type: ConnectorType, config: ConnectionConfig, tableName?: string): Promise<{ success: boolean; headers: string[]; rows: any[] }>;
  getRowCount(type: ConnectorType, config: ConnectionConfig, tableName: string): Promise<number>;
  getSampleWithOffset(type: ConnectorType, config: ConnectionConfig, tableName: string, limit: number, offset: number): Promise<SampleResult>;
  getRandomSample(type: ConnectorType, config: ConnectionConfig, tableName: string, limit: number, seed?: number): Promise<SampleResult>;
  getStratifiedSample(type: ConnectorType, config: ConnectionConfig, tableName: string, stratifyColumn: string, limitPerGroup: number, seed?: number): Promise<SampleResult>;
  applyCleaningOperations(type: ConnectorType, config: ConnectionConfig, tableName: string, operations: any[]): Promise<{ results: any[] }>;

  /** Resolve a fileName to its on-disk DuckDB storage path. */
  getDuckDbPath(fileName: string): string;

  /** Run a SQL query against a pooled connection for the given dbPath. */
  runQuery<T = any>(dbPath: string, sql: string, params?: any[]): Promise<T[]>;

  /** Run a SQL exec (DDL / DML with no result set) against a pooled connection. */
  runExec(dbPath: string, sql: string): Promise<void>;
}
