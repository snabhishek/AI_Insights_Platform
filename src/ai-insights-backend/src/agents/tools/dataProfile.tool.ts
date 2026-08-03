import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { ConnectionTesterService } from "../../services/connector/connectionTester.service";
import { ConnectionConfig, ConnectorType } from "../../models/connector.types";

type ColumnProfile = {
  name: string;
  nullCount: number;
  nonNullCount: number;
  uniqueCount: number;
};

export const createDataProfileTool = (connectionTester: ConnectionTesterService) =>
  tool(
    async ({ connectorType, connectionConfig, tables }) => {
      const type = connectorType as ConnectorType;
      const config = connectionConfig as ConnectionConfig;
      const selectedTables = Array.isArray(tables) ? tables : [];
      const profileTables = [];
      let warningCount = 0;

      for (const tableName of selectedTables) {
        try {
          const preview = await connectionTester.getPreview(type, config, tableName);
          const headers = preview.headers || [];
          const rows = preview.rows || [];
          const columnProfiles: ColumnProfile[] = headers.map((header) => {
            let nullCount = 0;
            const values = new Set<string>();
            for (const row of rows) {
              const value = row?.[header];
              if (value === null || value === undefined || value === "") {
                nullCount += 1;
              } else {
                values.add(String(value));
              }
            }
            return {
              name: header,
              nullCount,
              nonNullCount: rows.length - nullCount,
              uniqueCount: values.size,
            };
          });

          const tableWarnings = columnProfiles.filter((col) => col.nullCount > rows.length / 2).length;
          warningCount += tableWarnings;

          profileTables.push({
            name: tableName,
            sampleSize: rows.length,
            columns: columnProfiles,
          });
        } catch (error) {
          warningCount += 1;
          profileTables.push({
            name: tableName,
            sampleSize: 0,
            columns: [],
            error: error instanceof Error ? error.message : "Preview failed",
          });
        }
      }

      return {
        selectedTables,
        profile: {
          sampleSize: 5,
          quality: warningCount > 0 ? "needs-review" : "ready",
          warnings: warningCount,
          tables: profileTables,
        },
      };
    },
    {
      name: "profileData",
      description: "Profile data health and sample quality for selected tables.",
      schema: z.object({
        connectorType: z.string().describe("Connector type"),
        connectionConfig: z.record(z.string(), z.any()).describe("Connection settings for the connector"),
        tables: z.array(z.string()).describe("Tables to profile"),
      }),
    }
  );
