import { ConnectorType, ConnectionConfig } from "../../models/connector.types";

export interface TestResult {
  success: boolean;
  message: string;
  latencyMs: number;
}

export interface SampleResult {
  success: boolean;
  headers: string[];
  rows: any[];
  totalRowCount: number;
  metadata?: Record<string, unknown>;
}

export interface IConnectionTesterService {
  testConnection(type: ConnectorType, config: ConnectionConfig): Promise<TestResult>;
  healthCheck(type: ConnectorType, config: ConnectionConfig): Promise<TestResult>;
  getSchema(type: ConnectorType, config: ConnectionConfig): Promise<{ success: boolean; type: string; tables: any[] }>;
  getPreview(type: ConnectorType, config: ConnectionConfig, tableName?: string): Promise<{ success: boolean; headers: string[]; rows: any[] }>;
  getRowCount(type: ConnectorType, config: ConnectionConfig, tableName: string): Promise<number>;
  getSampleWithOffset(type: ConnectorType, config: ConnectionConfig, tableName: string, limit: number, offset: number): Promise<SampleResult>;
  getRandomSample(type: ConnectorType, config: ConnectionConfig, tableName: string, limit: number, seed?: number): Promise<SampleResult>;
  getStratifiedSample(type: ConnectorType, config: ConnectionConfig, tableName: string, stratifyColumn: string, limitPerGroup: number, seed?: number): Promise<SampleResult>;
  executeUpdate(type: ConnectorType, config: ConnectionConfig, tableName: string, updates: Array<{ column: string; value: unknown; whereColumn: string; whereValue: unknown }>): Promise<{ success: boolean; rowsAffected: number }>;
  applyCleaningOperations(type: ConnectorType, config: ConnectionConfig, tableName: string, operations: any[]): Promise<{ results: any[] }>;
}
