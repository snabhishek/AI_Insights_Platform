import { Connector, ConnectorStatus, ConnectorHealth, ConnectionConfig } from "../models/connector.types";

export interface IConnectorRepository {
  getAll(workspaceId?: string): Promise<Connector[]>;
  getById(id: string): Promise<Connector | undefined>;
  create(connector: Connector): Promise<Connector>;
  delete(id: string): Promise<boolean>;
  updateStatus(id: string, status: ConnectorStatus, lastSyncTime?: string, lastSyncDate?: string): Promise<Connector | undefined>;
  updateHealth(id: string, health: ConnectorHealth): Promise<Connector | undefined>;
  updateAllStatus(status: ConnectorStatus, lastSyncTime?: string, lastSyncDate?: string): Promise<void>;
  updateConnectorConfig(id: string, name: string, config: ConnectionConfig): Promise<Connector | undefined>;
}
