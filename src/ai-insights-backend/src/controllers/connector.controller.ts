import { Request, Response } from "express";
import { ConnectorService } from "../services/connector/connector.service";
import { IConnectionTesterService } from "../services/connector/connectionTester.service.interface";
import { ConnectorStatus, ConnectorHealth } from "../models/connector.types";

export class ConnectorController {
  constructor(
    private connectorService: ConnectorService,
    private connectionTester: IConnectionTesterService
  ) {}

  getAll = async (req: Request, res: Response): Promise<void> => {
    try {
      const workspaceId = (req.query.workspaceId as string) || undefined;
      const list = await this.connectorService.getAll(workspaceId);
      res.json(list);
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message || "Failed to list connectors" });
    }
  };

  testConnection = async (req: Request, res: Response): Promise<void> => {
    const { type, config } = req.body;

    if (!type) {
      res.status(400).json({ success: false, message: "Connector type is required" });
      return;
    }

    try {
      const result = await this.connectionTester.testConnection(type, config || {});
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message || "Internal test error" });
    }
  };

  add = async (req: Request, res: Response): Promise<void> => {
    const { name, type, subtext, config, workspaceId } = req.body;

    if (!name || !type || !subtext) {
      res.status(400).json({ success: false, message: "Missing required fields (name, type, subtext)" });
      return;
    }

    try {
      // Check for name & type duplicates in the same workspace
      const existing = await this.connectorService.getAll(workspaceId);
      const isDuplicate = existing.some(
        (c) => c.name.toLowerCase() === name.trim().toLowerCase() && c.type === type
      );
      if (isDuplicate) {
        res.status(409).json({
          success: false,
          message: `A data source with name "${name}" and type "${type}" already exists in this workspace.`
        });
        return;
      }

      // Perform one final connection validation before saving
      const test = await this.connectionTester.testConnection(type, config || {});
      if (!test.success) {
        res.status(400).json({ success: false, message: `Validation failed: ${test.message}` });
        return;
      }

      const newConnector = await this.connectorService.add(name, type, subtext, config || {}, workspaceId);
      res.status(201).json(newConnector);
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message || "Failed to add connector" });
    }
  };

  getSchema = async (req: Request, res: Response): Promise<void> => {
    const id = req.params.id as string;
    try {
      const connector = await this.connectorService.getById(id);
      if (!connector) {
        res.status(404).json({ success: false, message: "Connector not found" });
        return;
      }

      const schema = await this.connectionTester.getSchema(connector.type, connector.connectionConfig);
      res.json(schema);
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message || "Failed to query schema" });
    }
  };

  getPreview = async (req: Request, res: Response): Promise<void> => {
    const id = req.params.id as string;
    const tableName = req.query.table as string;

    try {
      const connector = await this.connectorService.getById(id);
      if (!connector) {
        res.status(404).json({ success: false, message: "Connector not found" });
        return;
      }

      const preview = await this.connectionTester.getPreview(connector.type, connector.connectionConfig, tableName);
      res.json(preview);
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message || "Failed to query preview" });
    }
  };

  sync = async (req: Request, res: Response): Promise<void> => {
    const id = req.params.id as string;
    try {
      const connector = await this.connectorService.getById(id);

      if (!connector) {
        res.status(404).json({ success: false, message: "Connector not found" });
        return;
      }

      // Set to syncing state
      await this.connectorService.updateStatus(id, "Syncing");

      // Simulate parsing tables/metadata in background
      setTimeout(async () => {
        try {
          // Re-run health validation
          const test = await this.connectionTester.healthCheck(connector.type, connector.connectionConfig);
          await this.connectorService.updateStatus(id, "Connected");
          await this.connectorService.updateHealth(id, test.success ? "Healthy" : "Warning");
        } catch (err) {
          await this.connectorService.updateStatus(id, "Connected");
          await this.connectorService.updateHealth(id, "Error");
        }
      }, 1500);

      res.json({ success: true, message: "Sync started" });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message || "Failed to sync" });
    }
  };

  disconnect = async (req: Request, res: Response): Promise<void> => {
    const id = req.params.id as string;
    try {
      const updated = await this.connectorService.updateStatus(id, "Disconnected");
      if (!updated) {
        res.status(404).json({ success: false, message: "Connector not found" });
        return;
      }
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message || "Failed to disconnect" });
    }
  };

  syncAll = async (req: Request, res: Response): Promise<void> => {
    try {
      const connectors = await this.connectorService.getAll();

      if (connectors.length === 0) {
        res.json({ success: true, message: "No connectors to sync" });
        return;
      }

      await this.connectorService.updateAllStatus("Syncing");

      setTimeout(async () => {
        await this.connectorService.completeAllSync();
      }, 2000);

      res.json({ success: true, message: "Syncing all connectors" });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message || "Failed to sync all" });
    }
  };

  getHealth = async (req: Request, res: Response): Promise<void> => {
    const id = req.params.id as string;
    try {
      const connector = await this.connectorService.getById(id);

      if (!connector) {
        res.status(404).json({ success: false, message: "Connector not found" });
        return;
      }

      const check = await this.connectionTester.healthCheck(connector.type, connector.connectionConfig);
      const healthState: ConnectorHealth = check.success ? "Healthy" : "Warning";

      await this.connectorService.updateHealth(id, healthState);
      res.json({
        success: check.success,
        health: healthState,
        message: check.message,
        latencyMs: check.latencyMs,
      });
    } catch (error: any) {
      await this.connectorService.updateHealth(id, "Error");
      res.status(500).json({ success: false, health: "Error", message: error.message });
    }
  };

  getById = async (req: Request, res: Response): Promise<void> => {
    const id = req.params.id as string;
    try {
      const connector = await this.connectorService.getById(id);
      if (!connector) {
        res.status(404).json({ success: false, message: "Connector not found" });
        return;
      }
      res.json(connector);
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message || "Failed to get connector" });
    }
  };

  delete = async (req: Request, res: Response): Promise<void> => {
    const id = req.params.id as string;
    try {
      const deleted = await this.connectorService.delete(id);
      if (!deleted) {
        res.status(404).json({ success: false, message: "Connector not found" });
        return;
      }
      res.json({ success: true, message: "Connector deleted successfully" });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message || "Failed to delete connector" });
    }
  };

  connect = async (req: Request, res: Response): Promise<void> => {
    const id = req.params.id as string;
    try {
      const updated = await this.connectorService.updateStatus(id, "Connected");
      if (!updated) {
        res.status(404).json({ success: false, message: "Connector not found" });
        return;
      }
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message || "Failed to connect" });
    }
  };

  update = async (req: Request, res: Response): Promise<void> => {
    const id = req.params.id as string;
    const { name, config } = req.body;

    if (!name) {
      res.status(400).json({ success: false, message: "Name is required" });
      return;
    }

    try {
      const connector = await this.connectorService.getById(id);
      if (!connector) {
        res.status(404).json({ success: false, message: "Connector not found" });
        return;
      }

      const mergedConfig = { ...connector.connectionConfig, ...config };
      const updated = await this.connectorService.updateConnectorConfig(id, name, mergedConfig);
      if (!updated) {
        res.status(500).json({ success: false, message: "Failed to update config" });
        return;
      }
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message || "Failed to update connector" });
    }
  };
}
