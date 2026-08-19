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
}
