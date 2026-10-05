export interface ConnectionConfig {
  host?: string;
  port?: string;
  database?: string;
  username?: string;
  password?: string;
  account?: string;
  url?: string;
  method?: string;
  headers?: string;
  fileName?: string;
  fileContent?: string;
}

export type ConnectorType =
  | "postgres"
  | "mysql"
  | "sqlserver"
  | "snowflake"
  | "mongodb"
  | "excel"
  | "csv"
  | "tsv"
  | "restapi";

export type ConnectorStatus = "Connected" | "Disconnected" | "Syncing";
export type ConnectorHealth = "Healthy" | "Warning" | "Error";

export interface Connector {
  id: string;
  name: string;
  subtext: string;
  type: ConnectorType;
  status: ConnectorStatus;
  health: ConnectorHealth;
  lastSyncTime: string;
  lastSyncDate: string;
  createdAt: string;
  connectionConfig: ConnectionConfig;
  assets: {
    tables: number;
    views: number | null;
    pipelines: number;
  };
  workspaceId?: string;
}
