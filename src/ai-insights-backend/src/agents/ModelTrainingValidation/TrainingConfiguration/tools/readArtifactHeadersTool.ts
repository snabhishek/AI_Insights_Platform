import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import * as duckdb from "duckdb";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { IngestionServices } from "../../../state";
import { getPythonScriptDirectory } from "../../../tools/filesystem";
import { getProjectSchemasDir } from "../../../../config/fileServer.config";

export interface ArtifactHeaderInfo {
  artifactName: string;
  format: "parquet" | "csv" | "json" | "unknown";
  columnCount: number;
  columns: Array<{ name: string; type?: string }>;
  headerSample?: string[];
  rowCountEstimate?: number | null;
}

/**
 * Creates a tool to inspect the headers and column schemas of Parquet, CSV, or JSON
 * feature artifacts within the project run folder, strictly without reading full table contents.
 * All file descriptors and database connections are closed immediately in finally blocks.
 * File paths are never disclosed in the return output to preserve security and clean abstraction.
 */
export function createReadArtifactHeadersTool(services: IngestionServices, runTimestamp?: string) {
  return tool(
    async ({ artifactName }: { artifactName: string }) => {
      const runDir = getPythonScriptDirectory(services, runTimestamp);
      const safeBasename = path.basename(artifactName.trim());

      // Candidate search locations strictly within project scope
      const candidatePaths = [
        path.join(runDir, safeBasename),
        path.join(runDir, "schemas", safeBasename),
      ];

      // If projectService is available, also search run schema folder
      if (services.projectService && services.projectId) {
        try {
          const pWs = await services.projectService.getProjectWithWorkspace(services.projectId);
          if (pWs?.project) {
            const schemasDir = getProjectSchemasDir(pWs.workspaceName || "DefaultWorkspace", pWs.project.name, runTimestamp);
            candidatePaths.push(path.join(schemasDir, safeBasename));
            const globalSchemasDir = getProjectSchemasDir(pWs.workspaceName || "DefaultWorkspace", pWs.project.name);
            candidatePaths.push(path.join(globalSchemasDir, safeBasename));
          }
        } catch {}
      }

      const resolvedPath = candidatePaths.find((p) => fs.existsSync(p));
      if (!resolvedPath) {
        return JSON.stringify({
          error: `Artifact '${safeBasename}' was not found in the project run directory or schemas folder.`,
          searchedArtifact: safeBasename,
        });
      }

      const ext = path.extname(safeBasename).toLowerCase();

      try {
        if (ext === ".parquet") {
          return await inspectParquetHeaders(safeBasename, resolvedPath);
        } else if (ext === ".csv") {
          return await inspectCsvHeaders(safeBasename, resolvedPath);
        } else if (ext === ".json") {
          return await inspectJsonHeaders(safeBasename, resolvedPath);
        } else {
          return JSON.stringify({
            error: `Unsupported file format '${ext}' for artifact '${safeBasename}'. Supported: .parquet, .csv, .json`,
            artifactName: safeBasename,
          });
        }
      } catch (err: any) {
        return JSON.stringify({
          error: `Failed to read headers for '${safeBasename}': ${err?.message || err}`,
          artifactName: safeBasename,
        });
      }
    },
    {
      name: "read_artifact_headers",
      description: "Parses and returns only the headers, column names, and data types of a Parquet, CSV, or JSON artifact in the project folder without reading full data. Closes all connections immediately.",
      schema: z.object({
        artifactName: z.string().describe("The filename of the artifact (e.g. validated_features.parquet, dataset.csv, profiling_report.json, relationship_schema.json)"),
      }),
    }
  );
}

/**
 * Inspects Parquet schema using an ephemeral DuckDB in-memory instance.
 * Tears down connection and closes DB immediately.
 */
async function inspectParquetHeaders(artifactName: string, filePath: string): Promise<string> {
  let db: duckdb.Database | null = null;
  let conn: duckdb.Connection | null = null;

  try {
    db = new duckdb.Database(":memory:");
    conn = db.connect();

    const sanitizedPath = filePath.replace(/\\/g, "/");
    const query = `DESCRIBE SELECT * FROM read_parquet('${sanitizedPath}') LIMIT 0;`;

    const rows: any[] = await new Promise((resolve, reject) => {
      conn!.all(query, (err, res) => {
        if (err) reject(err);
        else resolve(res || []);
      });
    });

    const columns = rows.map((r: any) => ({
      name: String(r.column_name || r.name || r.Field || ""),
      type: String(r.column_type || r.type || r.Type || "unknown"),
    }));

    const result: ArtifactHeaderInfo = {
      artifactName,
      format: "parquet",
      columnCount: columns.length,
      columns,
      headerSample: columns.slice(0, 50).map((c) => c.name),
    };

    return JSON.stringify(result, null, 2);
  } finally {
    // Immediate teardown of database connection to avoid holding memory or file locks
    try {
      if (conn) conn.close();
    } catch {}
    try {
      if (db) db.close();
    } catch {}
  }
}

/**
 * Inspects CSV headers by reading strictly the first line with a streamed chunk.
 * Destroys stream immediately after first line.
 */
async function inspectCsvHeaders(artifactName: string, filePath: string): Promise<string> {
  let fileStream: fs.ReadStream | null = null;
  let rl: readline.Interface | null = null;

  try {
    fileStream = fs.createReadStream(filePath, { encoding: "utf-8", highWaterMark: 8192 });
    rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });

    let firstLine = "";
    for await (const line of rl) {
      if (line && line.trim().length > 0) {
        firstLine = line.trim();
        break;
      }
    }

    if (!firstLine) {
      return JSON.stringify({
        artifactName,
        format: "csv",
        columnCount: 0,
        columns: [],
      });
    }

    // Split headers handling potential quotes
    const rawCols = firstLine.split(",").map((c) => c.replace(/^["']|["']$/g, "").trim());
    const columns = rawCols.map((name) => ({ name, type: "unknown" }));

    const result: ArtifactHeaderInfo = {
      artifactName,
      format: "csv",
      columnCount: columns.length,
      columns,
      headerSample: columns.slice(0, 50).map((c) => c.name),
    };

    return JSON.stringify(result, null, 2);
  } finally {
    try {
      if (rl) rl.close();
    } catch {}
    try {
      if (fileStream) fileStream.destroy();
    } catch {}
  }
}

/**
 * Inspects JSON top-level structure or schema arrays without caching.
 */
async function inspectJsonHeaders(artifactName: string, filePath: string): Promise<string> {
  const content = await fs.promises.readFile(filePath, "utf-8");
  try {
    const parsed = JSON.parse(content);
    let columns: Array<{ name: string; type?: string }> = [];

    if (Array.isArray(parsed)) {
      if (parsed.length > 0 && typeof parsed[0] === "object" && parsed[0] !== null) {
        columns = Object.keys(parsed[0]).map((k) => ({ name: k }));
      }
    } else if (typeof parsed === "object" && parsed !== null) {
      if (Array.isArray(parsed.columns)) {
        columns = parsed.columns.map((c: any) => ({
          name: typeof c === "string" ? c : c.name || c.columnName || String(c),
          type: c.type || c.dataType || undefined,
        }));
      } else if (Array.isArray(parsed.tables)) {
        columns = parsed.tables.map((t: any) => ({
          name: t.name || t.tableName || "table",
          type: `table (${t.columns?.length || 0} cols)`,
        }));
      } else if (Array.isArray(parsed.nodes)) {
        columns = parsed.nodes.map((n: any) => ({
          name: n.name || n.id || "node",
          type: n.type || "entity",
        }));
      } else {
        columns = Object.keys(parsed).slice(0, 100).map((k) => ({ name: k }));
      }
    }

    const result: ArtifactHeaderInfo = {
      artifactName,
      format: "json",
      columnCount: columns.length,
      columns,
      headerSample: columns.slice(0, 50).map((c) => c.name),
    };

    return JSON.stringify(result, null, 2);
  } catch (err: any) {
    return JSON.stringify({
      error: `JSON parsing failed for ${artifactName}: ${err?.message || err}`,
      artifactName,
    });
  }
}
