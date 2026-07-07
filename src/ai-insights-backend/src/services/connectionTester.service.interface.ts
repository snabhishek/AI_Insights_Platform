import { ConnectorType, ConnectionConfig } from "../models/connector.types";

export interface TestResult {
  success: boolean;
  message: string;
  latencyMs: number;
}

export interface IConnectionTesterService {
  testConnection(type: ConnectorType, config: ConnectionConfig): Promise<TestResult>;
  healthCheck(type: ConnectorType, config: ConnectionConfig): Promise<TestResult>;
  getSchema(type: ConnectorType, config: ConnectionConfig): Promise<{ success: boolean; type: string; tables: any[] }>;
  getPreview(type: ConnectorType, config: ConnectionConfig, tableName?: string): Promise<{ success: boolean; headers: string[]; rows: any[] }>;
}
