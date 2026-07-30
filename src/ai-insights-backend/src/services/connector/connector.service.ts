import { v4 as uuidv4 } from "uuid";
import { IConnectorRepository } from "../repositories/connector.repository.interface";
import { IFileService } from "./file.service.interface";
import { IConnectionTesterService } from "./connectionTester.service.interface";
import { Connector, ConnectorType, ConnectorStatus, ConnectorHealth, ConnectionConfig } from "../models/connector.types";

export class ConnectorService {
  constructor(
    private repository: IConnectorRepository,
    private fileService: IFileService,
    private connectionTester: IConnectionTesterService
  ) {}

  private formatDate(date: Date): string {
    return date.toLocaleString("en-US", {
      month: "short",
      day: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  }

  async getAll(workspaceId?: string): Promise<Connector[]> {
    return this.repository.getAll(workspaceId);
  }

  async getById(id: string): Promise<Connector | undefined> {
    return this.repository.getById(id);
  }

  async add(
    name: string,
    type: ConnectorType,
    subtext: string,
    connectionConfig: ConnectionConfig,
    workspaceId?: string
  ): Promise<Connector> {
    const now = new Date();

    let tables = 0;
    let views: number | null = null;
    let pipelines = 0;

    // 1. File upload check:
    if (["excel", "csv", "tsv"].includes(type) && connectionConfig.fileName && connectionConfig.fileContent) {
      await this.fileService.saveFile(connectionConfig.fileName, connectionConfig.fileContent);
    }

    // 2. Database metadata check:
    if (type === "postgres" && connectionConfig.host && connectionConfig.database) {
      try {
        const schema = await this.connectionTester.getSchema(type, connectionConfig);
        if (schema.success) {
          tables = schema.tables.filter((t: any) => t.type === "Table").length;
          views = schema.tables.filter((t: any) => t.type === "View").length;
        }
      } catch (dbErr: any) {
        console.warn("[ConnectorService] Failed to query live DB schema counts:", dbErr.message);
      }
    } else if (type === "mysql" && connectionConfig.host && connectionConfig.database) {
      try {
        const schema = await this.connectionTester.getSchema(type, connectionConfig);
        if (schema.success) {
          tables = schema.tables.filter((t: any) => t.type === "Table").length;
          views = schema.tables.filter((t: any) => t.type === "View").length;
        }
      } catch (dbErr: any) {
        console.warn("[ConnectorService] Failed to query live MySQL schema counts:", dbErr.message);
      }
    } else if (type === "excel") {
      try {
        if (connectionConfig.fileName) {
          if (this.fileService.fileExists(connectionConfig.fileName)) {
            const schema = await this.connectionTester.getSchema(type, connectionConfig);
            tables = schema.tables.length;
          } else {
            tables = 1;
          }
        } else {
          tables = 1;
        }
      } catch (excelErr) {
        tables = 1;
      }
      views = null;
      pipelines = 0;
    } else if (["csv", "tsv"].includes(type)) {
      tables = 1;
      views = null;
      pipelines = 0;
    } else if (type === "restapi") {
      tables = 0;
      views = null;
      pipelines = 1;
    } else {
      tables = 12;
      views = 2;
      pipelines = 0;
    }

    const id = uuidv4();
    const lastSyncTime = "Just now";
    const lastSyncDate = this.formatDate(now);
    const status = "Connected";
    const health = "Healthy";
    const assets = { tables, views, pipelines };

    // Erase fileContent before database save to prevent large rows
    const savedConfig = { ...connectionConfig };
    delete savedConfig.fileContent;

    const newConnector: Connector = {
      id,
      name,
      subtext,
      type,
      status,
      health,
      lastSyncTime,
      lastSyncDate,
      createdAt: now.toISOString(),
      connectionConfig: savedConfig,
      assets,
      workspaceId: workspaceId || "default",
    };

    return this.repository.create(newConnector);
  }

  async delete(id: string): Promise<boolean> {
    const connector = await this.repository.getById(id);
    if (connector && ["excel", "csv", "tsv"].includes(connector.type)) {
      const fileName = connector.connectionConfig.fileName;
      if (fileName) {
        await this.fileService.deleteFile(fileName);
      }
    }
    return this.repository.delete(id);
  }

  async updateStatus(id: string, status: ConnectorStatus): Promise<Connector | undefined> {
    const now = new Date();
    const lastSyncTime = "Just now";
    const lastSyncDate = this.formatDate(now);
    return this.repository.updateStatus(id, status, lastSyncTime, lastSyncDate);
  }

  async updateHealth(id: string, health: ConnectorHealth): Promise<Connector | undefined> {
    return this.repository.updateHealth(id, health);
  }

  async updateAllStatus(status: ConnectorStatus): Promise<void> {
    const now = new Date();
    const lastSyncTime = "Just now";
    const lastSyncDate = this.formatDate(now);
    return this.repository.updateAllStatus(status, lastSyncTime, lastSyncDate);
  }

  async completeSync(id: string): Promise<Connector | undefined> {
    const now = new Date();
    const status = "Connected";
    const health = Math.random() > 0.85 ? "Warning" : "Healthy";
    const lastSyncTime = "Just now";
    const lastSyncDate = this.formatDate(now);

    const updated = await this.repository.updateStatus(id, status, lastSyncTime, lastSyncDate);
    if (!updated) return undefined;
    return this.repository.updateHealth(id, health);
  }

  async completeAllSync(): Promise<Connector[]> {
    const now = new Date();
    const status = "Connected";
    const lastSyncTime = "Just now";
    const lastSyncDate = this.formatDate(now);

    const all = await this.repository.getAll();
    for (const connector of all) {
      const rowHealth = Math.random() > 0.9 ? "Warning" : "Healthy";
      await this.repository.updateStatus(connector.id, status, lastSyncTime, lastSyncDate);
      await this.repository.updateHealth(connector.id, rowHealth);
    }
    return this.repository.getAll();
  }

  async updateConnectorConfig(id: string, name: string, config: ConnectionConfig): Promise<Connector | undefined> {
    return this.repository.updateConnectorConfig(id, name, config);
  }
}
