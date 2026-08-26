import { ConnectorType, ConnectionConfig } from "../../models/connector.types";

export type BackingEngineType = "duckdb" | "postgres" | "mysql" | "sqlserver" | "unknown";

export interface SourceRegistryEntry {
  sourceId: string;
  name: string;
  type: ConnectorType;
  workspaceId?: string;
  connectionConfig: ConnectionConfig;
  backingEngine: BackingEngineType;
  details: {
    storagePath?: string;   // e.g. uploads/duckdb/<fileName>.duckdb for DuckDB
    databaseName?: string;
    host?: string;
    port?: number;
  };
  createdAt?: Date;
}

export interface FilterOptionsQuery {
  sourceId: string;
  fieldId: string;
  tableName?: string;
  projectId?: string;
  projectName?: string;
  parentParams?: Record<string, unknown>;
  parentFields?: string[];
  search?: string;
  controlType?: string;
  limit?: number;
}

export interface FilterOptionsResult {
  success: boolean;
  sourceId: string;
  fieldId: string;
  values: unknown[];
  totalCount: number;
  dateRange?: {
    min: string | null;
    max: string | null;
  };
  isIndependentFallback?: boolean;
}

export interface ISourceRegistryService {
  getSource(sourceId: string): Promise<SourceRegistryEntry | null>;
  registerSource(sourceId: string, metadata: Partial<SourceRegistryEntry>): Promise<SourceRegistryEntry>;
  fetchFilterOptions(query: FilterOptionsQuery): Promise<FilterOptionsResult>;
}
