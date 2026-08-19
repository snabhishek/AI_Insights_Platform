import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { ConnectionTesterService } from "../../../services/connector/connectionTester.service";
import { ConnectorService } from "../../../services/connector/connector.service";
import { ConnectionConfig, ConnectorType } from "../../../models/connector.types";
import { connectionConfigSchema } from "../helpers/commonSchemas";

export const createGetSchemaTool = (
  connectionTester: ConnectionTesterService,
  connectorService: ConnectorService,
  defaultConnector?: any
) =>
  tool(
    async ({ connectorId, connectorType, connectionConfig }) => {
      let resolvedType = connectorType as ConnectorType | undefined;
      let config = connectionConfig as ConnectionConfig | undefined;

      let connector: any;
      if (typeof connectorId === "string" && connectorId.trim().length > 0) {
        connector = await connectorService.getById(connectorId);
        if (!connector && defaultConnector && (defaultConnector.id === connectorId || defaultConnector.name === connectorId)) {
          connector = defaultConnector;
        }
        if (!connector) {
          try {
            const allConnectors = await connectorService.getAll();
            connector = allConnectors.find(
              (c) => c.id === connectorId || c.name === connectorId || c.name.toLowerCase() === connectorId.toLowerCase()
            );
          } catch {
            // Ignore error
          }
        }
      }

      if (!connector && defaultConnector) {
        connector = defaultConnector;
      }

      if (connector) {
        resolvedType = connector.type;
        config = connector.connectionConfig || {};
      }

      if (!resolvedType || !config) {
        return { success: false, type: "unknown", tables: [], notes: "Missing connector configuration." };
      }

      return connectionTester.getSchema(resolvedType, config);
    },
    {
      name: "getSchema",
      description: "Inspect a connector source and return the discovered schema metadata and tables.",
      schema: z.object({
        connectorId: z.string().describe("Connector ID used to resolve the stored connection settings"),
        connectorType: z.string().optional().describe("Connector type fallback when connectorId is unavailable"),
        connectionConfig: connectionConfigSchema,
      }),
    }
  );
