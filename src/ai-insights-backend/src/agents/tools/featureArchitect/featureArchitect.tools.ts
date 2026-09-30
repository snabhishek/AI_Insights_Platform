import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { executePythonScript, ensureRequirementsTxt, ensureDockerfile, ensureDockerCompose } from "../helpers/pythonExecutor";
import * as path from "path";
import * as fs from "fs";

/**
 * Tool to read all table names from the batchedTables state.
 */
export const createGetTableNamesTool = (batchedTables: Array<{ tableName: string }>) =>
  tool(
    async () => {
      const tableNames = (batchedTables || []).map((t) => t.tableName).filter(Boolean);
      return {
        success: true,
        tableNames,
      };
    },
    {
      name: "getTableNames",
      description: "Read the list of table names currently selected/batched for feature engineering.",
      schema: z.object({}),
    }
  );

/**
 * Tool to aggregate and retrieve schema columns, constraints, relationships,
 * and profiling statistics for a specific table.
 */
export const createGetTableColumnsAndProfileTool = (
  inspectorState: Record<string, any>,
  dataProfileState: Record<string, any>
) =>
  tool(
    async ({ tableName }: { tableName: string }) => {
      if (!tableName) {
        return {
          success: false,
          error: "Table name is required.",
        };
      }

      // 1. Extract schema schema/inspection details
      const sources = Array.isArray(inspectorState?.sources) ? inspectorState.sources : [];
      let tableSchema: any = null;
      for (const source of sources) {
        const tables = Array.isArray(source?.tables) ? source.tables : [];
        tableSchema = tables.find(
          (t: any) => (t.tableName || t.name || "").toLowerCase() === tableName.toLowerCase()
        );
        if (tableSchema) break;
      }

      // 2. Extract profile details
      const profileTables = Array.isArray(dataProfileState?.tables) ? dataProfileState.tables : [];
      const tableProfile = profileTables.find(
        (t: any) => (t.tableName || "").toLowerCase() === tableName.toLowerCase()
      );

      if (!tableSchema && !tableProfile) {
        return {
          success: false,
          error: `Table "${tableName}" was not found in inspection or profiling metadata.`,
        };
      }

      return {
        success: true,
        tableName,
        columns: tableSchema?.columns || [],
        constraints: tableSchema?.constraints || [],
        relations: tableSchema?.relations || [],
        profiling: {
          contentProfile: tableProfile?.contentProfile || null,
          completenessProfile: tableProfile?.completenessProfile || null,
          statisticalProfile: tableProfile?.statisticalProfile || null,
        },
      };
    },
    {
      name: "getTableColumnsAndProfile",
      description: "Read columns, data types, primary/foreign keys, and profiling data (null ratios, statistics) for a specific table.",
      schema: z.object({
        tableName: z.string().describe("The name of the table to retrieve detailed information for."),
      }),
    }
  );

/**
 * Tool to run a Python script in a sandboxed container environment.
 */
export const createRunPythonScriptTool = (
  projectId: string,
  workspaceName: string,
  runTimestamp: string,
  services: any,
  connectorId: string[]
) =>
  tool(
    async ({ scriptName, code, requiredPackages }: { scriptName: string; code: string; requiredPackages?: string[] }) => {
      try {
        const result = await executePythonScript(
          scriptName,
          code,
          projectId || "default",
          runTimestamp || "default",
          services,
          connectorId,
          requiredPackages
        );
        return {
          success: result.success,
          stdout: result.stdout,
          stderr: result.stderr,
        };
      } catch (error) {
        return {
          success: false,
          stdout: "",
          stderr: error instanceof Error ? error.message : String(error),
        };
      }
    },
    {
      name: "runPythonScript",
      description: "Execute a Python script with --db-path/connection settings passed in args to perform feature engineering calculations via Docker Compose.",
      schema: z.object({
        scriptName: z.string().describe("The filename of the Python script to write and execute (e.g., 'feature_creation.py')."),
        code: z.string().describe("The full content of the Python code to run."),
        requiredPackages: z.array(z.string()).optional().describe("List of pip packages required to execute the Python script (e.g., ['pandas', 'scikit-learn', 'duckdb'])."),
      }),
    }
  );

/**
 * Tool to retrieve split boundaries, entity keys, time columns, and leakage definitions.
 */
export const createGetSplitBoundariesTool = (
  orchestrationDecision: Record<string, any>,
  dataProfileState?: Record<string, any>
) =>
  tool(
    async () => {
      return {
        success: true,
        problemType: orchestrationDecision?.problemType || "classification",
        targetColumn: orchestrationDecision?.targetColumn || "",
        predictionEntity: orchestrationDecision?.predictionEntity || "",
        timeColumn: orchestrationDecision?.timeColumn || null,
        leakageColumns: orchestrationDecision?.leakageColumns || [],
        splits: {
          trainRatio: 0.7,
          valRatio: 0.15,
          testRatio: 0.15,
        },
      };
    },
    {
      name: "getSplitBoundaries",
      description: "Get dataset split boundaries, prediction entity, time column, and known leakage column definitions.",
      schema: z.object({}),
    }
  );

/**
 * Ensures that the Feature Engineering directory contains requirements.txt,
 * Dockerfile, and docker-compose.yml.
 */
export function ensureFeatureEngineeringEnvironment(
  targetDir: string,
  requiredPackages?: string[]
): void {
  ensureRequirementsTxt(targetDir, requiredPackages);
  ensureDockerfile(targetDir);
  ensureDockerCompose(targetDir, "feature-engineering");
}

