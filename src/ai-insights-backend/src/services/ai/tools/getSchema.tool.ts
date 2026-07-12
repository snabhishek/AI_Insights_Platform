import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { ConnectionTesterService } from "../../connectionTester.service";
import { ConnectionConfig, ConnectorType } from "../../../models/connector.types";

export const createGetSchemaTool = (connectionTester: ConnectionTesterService) =>
  tool(
    async ({ connectorType, connectionConfig }) => {
      return connectionTester.getSchema(connectorType as ConnectorType, connectionConfig as ConnectionConfig);
    },
    {
      name: "getSchema",
      description: "Inspect a connector source and return the discovered schema metadata and tables.",
      schema: z.object({
        connectorType: z.string().describe("Connector type"),
        connectionConfig: z.object({}).passthrough().describe("Connection settings for the connector"),
      }),
    }
  );
