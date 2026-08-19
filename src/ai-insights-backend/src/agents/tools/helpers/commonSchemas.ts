import { z } from "zod";

export const connectionConfigSchema = z.object({
  host: z.string().optional().describe("Database host or server name"),
  port: z.union([z.string(), z.number()]).optional().describe("Database port number"),
  database: z.string().optional().describe("Database or catalog name"),
  username: z.string().optional().describe("Database username"),
  password: z.string().optional().describe("Database password"),
  fileName: z.string().optional().describe("Data file name"),
  url: z.string().optional().describe("Connection URL"),
  account: z.string().optional().describe("Cloud account name"),
}).optional().describe("Fallback connection settings");

export const foreignKeyValuesSchema = z.array(z.object({
  parentTable: z.string().describe("Referenced parent table name"),
  allowedValues: z.array(z.string()).describe("Allowed foreign key values from parent table sample"),
})).optional().describe("List of allowed foreign key values per parent table for referential integrity filtering");

export function parseForeignKeyValues(foreignKeyValues: unknown): Record<string, string[]> {
  if (!foreignKeyValues) return {};
  if (Array.isArray(foreignKeyValues)) {
    const fkMap: Record<string, string[]> = {};
    for (const item of foreignKeyValues) {
      if (item && typeof item === "object" && typeof (item as any).parentTable === "string" && Array.isArray((item as any).allowedValues)) {
        fkMap[(item as any).parentTable] = (item as any).allowedValues;
      }
    }
    return fkMap;
  }
  if (typeof foreignKeyValues === "string") {
    try {
      const parsed = JSON.parse(foreignKeyValues);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, string[]>;
      }
    } catch {
      // Ignore
    }
  }
  if (typeof foreignKeyValues === "object") {
    return foreignKeyValues as Record<string, string[]>;
  }
  return {};
}

export function parseColumnTypes(columnTypes: unknown): Record<string, string> {
  if (!columnTypes) return {};
  if (Array.isArray(columnTypes)) {
    const typeMap: Record<string, string> = {};
    for (const item of columnTypes) {
      if (item && typeof item === "object" && typeof (item as any).columnName === "string" && typeof (item as any).inferredType === "string") {
        typeMap[(item as any).columnName] = (item as any).inferredType;
      }
    }
    return typeMap;
  }
  if (typeof columnTypes === "string") {
    try {
      const parsed = JSON.parse(columnTypes);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, string>;
      }
    } catch {
      // Ignore
    }
  }
  if (typeof columnTypes === "object") {
    return columnTypes as Record<string, string>;
  }
  return {};
}
