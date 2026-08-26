import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { executePythonScript } from "../helpers/pythonExecutor";
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
  runTimestamp: string,
  services: any,
  connectorId: string[]
) =>
  tool(
    async ({ scriptName, code }: { scriptName: string; code: string }) => {
      try {
        const result = await executePythonScript(
          scriptName,
          code,
          projectId || "default",
          runTimestamp || "default",
          services,
          connectorId
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
      description: "Execute a Python script with --db-path/connection settings passed in args to perform feature engineering calculations.",
      schema: z.object({
        scriptName: z.string().describe("The filename of the Python script to write and execute (e.g., 'feature_creation.py')."),
        code: z.string().describe("The full content of the Python code to run."),
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
 * The canonical list of pipeline regions in order.
 * Used to validate region names and build the template.
 */
const PIPELINE_REGIONS = [
  "SHARED_IMPORTS",
  "FEATURE_CREATION",
  "FEATURE_TRANSFORMATION",
  "BUILD_DATASET",
  "DATA_VALIDATION",
  "FEATURE_EXTRACTION",
  "FEATURE_SELECTION",
  "FEATURE_VALIDATION",
] as const;

type PipelineRegion = typeof PIPELINE_REGIONS[number];

/**
 * Returns the start/end line indices (0-indexed, inclusive) of a named region within a script.
 * Returns null if the region markers are not found.
 */
function findRegionBounds(
  lines: string[],
  region: PipelineRegion
): { startLine: number; endLine: number } | null {
  const startMarker = `# -- REGION: ${region} START --`;
  const endMarker = `# -- REGION: ${region} END --`;
  const startLine = lines.findIndex((l) => l.trim() === startMarker);
  const endLine = lines.findIndex((l) => l.trim() === endMarker);
  if (startLine === -1 || endLine === -1 || endLine <= startLine) {
    return null;
  }
  return { startLine, endLine };
}

/**
 * Creates the canonical empty pipeline script template with all region markers
 * and the unified sequential runner at the bottom.
 */
export function makePipelineTemplate(scriptName: string): string {
  const regions = PIPELINE_REGIONS.map((region) =>
    [
      `# ${region.charAt(0) + region.slice(1).toLowerCase().replace(/_/g, " ")} region`,
      `# -- REGION: ${region} START --`,
      `# -- REGION: ${region} END --`,
      "",
    ].join("\n")
  );

  const runner = [
    "# Pipeline Runner - Executes all stages sequentially",
    "# -- PIPELINE_RUNNER START --",
    "if __name__ == '__main__':",
    "    import argparse",
    "    import os",
    "    import sys",
    "",
    "    parser = argparse.ArgumentParser(description='Feature engineering pipeline runner')",
    "    parser.add_argument('--db-path', type=str, required=True, help='Path to directory with CSV/data files')",
    "    parser.add_argument('--split', type=str, default='train', choices=['train', 'val', 'test'])",
    "    parser.add_argument('--out-dir', type=str, default=None, help='Directory to save/load transformers and outputs')",
    "    parser.add_argument('--output-path', type=str, default=None, help='Output path for final dataset (Parquet)')",
    "    parser.add_argument('--metadata-path', type=str, default=None, help='Path to save metadata YAML')",
    "    parser.add_argument('--features-path', type=str, default=None, help='Path to features parquet/CSV')",
    "    parser.add_argument('--report-path', type=str, default=None, help='Path to validation report JSON')",
    "    args, _ = parser.parse_known_args()",
    "    db_path = args.db_path",
    "    split = args.split",
    "    out_dir = args.out_dir or db_path",
    "    output_path = args.output_path or os.path.join(out_dir, 'dataset.parquet')",
    "    metadata_path = args.metadata_path or os.path.join(out_dir, 'metadata.yaml')",
    "    features_path = args.features_path or os.path.join(out_dir, 'order_features.parquet')",
    "    report_path = args.report_path or os.path.join(out_dir, 'feature_validation_report.json')",
    "",
    "    if 'main_feature_creation' in dir():",
    "        print('=== [1/7] Running Feature Creation ===')",
    "        main_feature_creation(['--db-path', db_path])",
    "",
    "    if 'main_feature_transformation' in dir():",
    "        print('=== [2/7] Running Feature Transformation ===')",
    "        main_feature_transformation(['--db-path', db_path, '--split', split, '--out-dir', out_dir])",
    "",
    "    if 'main_build_dataset' in dir():",
    "        print('=== [3/7] Running Build Dataset ===')",
    "        main_build_dataset(['--db-path', db_path, '--output-path', output_path, '--metadata-path', metadata_path])",
    "",
    "    if 'main_data_validation' in dir():",
    "        print('=== [4/7] Running Data Validation ===')",
    "        main_data_validation(['--db-path', db_path, '--output-path', os.path.join(out_dir, 'validation_report.json')])",
    "",
    "    if 'main_feature_extraction' in dir():",
    "        print('=== [5/7] Running Feature Extraction ===')",
    "        main_feature_extraction(['--db-path', db_path])",
    "",
    "    if 'main_feature_selection' in dir():",
    "        print('=== [6/7] Running Feature Selection ===')",
    "        main_feature_selection(['--db-path', db_path, '--features-path', output_path, '--output-path', os.path.join(out_dir, 'selected_features.parquet')])",
    "",
    "    if 'main_feature_validation' in dir():",
    "        print('=== [7/7] Running Feature Validation ===')",
    "        main_feature_validation(['--db-path', db_path, '--features-path', os.path.join(out_dir, 'selected_features.parquet'), '--output-path', os.path.join(out_dir, 'validated_features.parquet'), '--report-path', report_path])",
    "",
    "    print('=== Pipeline Execution Complete ===')",
    "# -- PIPELINE_RUNNER END --",
  ].join("\n");

  return [
    `# Aggregated feature engineering script: ${scriptName}`,
    "",
    ...regions,
    runner,
  ].join("\n");
}


