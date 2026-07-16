import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { ConnectionTesterService } from "../../connectionTester.service";
import { ConnectorService } from "../../connector.service";
import { ConnectionConfig, ConnectorType } from "../../../models/connector.types";

export const createGetSchemaTool = (connectionTester: ConnectionTesterService, connectorService: ConnectorService) =>
  tool(
    async ({ connectorId, connectorType, connectionConfig }) => {
      if (typeof connectorId === "string" && connectorId.trim().length > 0) {
        const connector = await connectorService.getById(connectorId);
        if (!connector) {
          return { success: false, type: "unknown", tables: [], notes: "Connector not found." };
        }

        return connectionTester.getSchema(connector.type as ConnectorType, connector.connectionConfig as ConnectionConfig);
      }

      return connectionTester.getSchema(connectorType as ConnectorType, connectionConfig as ConnectionConfig);
    },
    {
      name: "getSchema",
      description: "Inspect a connector source and return the discovered schema metadata and tables.",
      schema: z.object({
        connectorId: z.string().describe("Connector ID used to resolve the stored connection settings"),
        connectorType: z.string().optional().describe("Connector type fallback when connectorId is unavailable"),
        connectionConfig: z.object({}).passthrough().optional().describe("Fallback connection settings when connectorId is unavailable"),
      }),
    }
  );
