import * as fs from "fs/promises";
import * as fsSync from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import {
  getProjectDir,
  getProjectSchemasDir,
} from "../../../config/fileServer.config";
import { resolveProjectRunTimestamp } from "./schemaHelper";

export interface DatasetDateRangeResult {
  hasTemporalData: boolean;
  timeColumn?: string | null;
  minDate?: string | null;
  maxDate?: string | null;
  minYear?: number;
  maxYear?: number;
  minMonth?: number;
  maxMonth?: number;
  availableYears?: number[];
  datasetPath?: string | null;
}

export async function extractDatasetDateRange(
  workspaceName: string,
  projectName: string,
  timestamp?: string,
  agentState?: Record<string, any>
): Promise<DatasetDateRangeResult> {
  const effectiveTs = resolveProjectRunTimestamp(
    workspaceName,
    projectName,
    timestamp || agentState?.runTimestamp
  );

  const projectDir = getProjectDir(workspaceName, projectName);
  const runDir = path.join(projectDir, effectiveTs);

  let candidateTimeCol: string | null = null;
  const schemasDir = getProjectSchemasDir(workspaceName, projectName, effectiveTs);

  const contractCandidatePaths: string[] = [];
  if (fsSync.existsSync(schemasDir)) {
    try {
      const schemaFiles = fsSync.readdirSync(schemasDir);
      for (const f of schemaFiles) {
        if (f.includes("_training_job_contract_") && (f.endsWith(".yaml") || f.endsWith(".yml"))) {
          contractCandidatePaths.push(path.join(schemasDir, f));
        }
      }
    } catch {}
  }

  const directSchemasDir = path.join(projectDir, "schemas");
  if (fsSync.existsSync(directSchemasDir)) {
    try {
      const schemaFiles = fsSync.readdirSync(directSchemasDir);
      for (const f of schemaFiles) {
        if (f.includes("_training_job_contract_") && (f.endsWith(".yaml") || f.endsWith(".yml"))) {
          contractCandidatePaths.push(path.join(directSchemasDir, f));
        }
      }
    } catch {}
  }

  for (const cPath of contractCandidatePaths) {
    try {
      const raw = await fs.readFile(cPath, "utf-8");
      const parsed: any = yaml.load(raw) || {};
      const found =
        parsed?.split?.timecolumn ||
        parsed?.split?.time_column ||
        parsed?.data_splitting?.timecolumn ||
        parsed?.data_splitting?.time_column ||
        parsed?.timecolumn ||
        parsed?.time_column ||
        parsed?.model_selection?.prediction_grain?.timecolumn ||
        parsed?.model_selection?.prediction_grain?.time_column;
      if (found && typeof found === "string" && found.trim().length > 0) {
        candidateTimeCol = found.trim();
        break;
      }
    } catch {}
  }

  if (!candidateTimeCol && agentState) {
    const config = agentState.trainingConfiguration?.configuration || {};
    candidateTimeCol =
      config?.split?.timecolumn ||
      config?.split?.time_column ||
      config?.data_splitting?.timecolumn ||
      config?.data_splitting?.time_column ||
      config?.timecolumn ||
      config?.time_column ||
      agentState.featureArchitect?.timeColumn ||
      agentState.featureArchitect?.orchestrationDecision?.timeColumn ||
      agentState.schemaResolution?.timeColumn ||
      null;
  }

  const candidateDatasetPaths = [
    path.join(runDir, "python_scripts", "dataset.parquet"),
    path.join(runDir, "python_script", "dataset.parquet"),
    path.join(runDir, "dataset.parquet"),
    path.join(projectDir, "python_scripts", "dataset.parquet"),
    path.join(projectDir, "python_script", "dataset.parquet"),
    path.join(projectDir, "dataset.parquet"),
    path.join(runDir, "python_scripts", "feature_validation.parquet"),
    path.join(runDir, "python_script", "feature_validation.parquet"),
    path.join(runDir, "feature_validation.parquet"),
    path.join(runDir, "python_scripts", "feature_selection.parquet"),
    path.join(runDir, "python_script", "feature_selection.parquet"),
    path.join(runDir, "feature_selection.parquet"),
    path.join(runDir, "python_scripts", "feature_extraction.parquet"),
    path.join(runDir, "python_script", "feature_extraction.parquet"),
    path.join(runDir, "feature_extraction.parquet"),
    path.join(runDir, "python_scripts", "feature_transformation.parquet"),
    path.join(runDir, "python_script", "feature_transformation.parquet"),
    path.join(runDir, "feature_transformation.parquet"),
    path.join(runDir, "python_scripts", "feature_created.parquet"),
    path.join(runDir, "python_script", "feature_created.parquet"),
    path.join(runDir, "feature_created.parquet"),
    path.join(projectDir, "feature_validation.parquet"),
    path.join(projectDir, "python_scripts", "feature_validation.parquet"),
    path.join(projectDir, "python_script", "feature_validation.parquet"),
  ];

  let datasetPath: string | null = null;
  for (const cand of candidateDatasetPaths) {
    if (fsSync.existsSync(cand)) {
      datasetPath = cand;
      break;
    }
  }

  if (!datasetPath && fsSync.existsSync(projectDir)) {
    try {
      const subEntries = fsSync.readdirSync(projectDir, { withFileTypes: true });
      const tsDirs = subEntries
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .sort((a, b) => b.localeCompare(a));
      for (const ts of tsDirs) {
        const p1 = path.join(projectDir, ts, "python_scripts", "dataset.parquet");
        const p2 = path.join(projectDir, ts, "python_script", "dataset.parquet");
        const p3 = path.join(projectDir, ts, "dataset.parquet");
        if (fsSync.existsSync(p1)) { datasetPath = p1; break; }
        if (fsSync.existsSync(p2)) { datasetPath = p2; break; }
        if (fsSync.existsSync(p3)) { datasetPath = p3; break; }
      }
    } catch {}
  }

  let actualTimeColumn: string | null = null;
  let minDateStr: string | null = null;
  let maxDateStr: string | null = null;

  if (datasetPath) {
    try {

      const duckdbModule = require("duckdb");
      const db = new duckdbModule.Database(":memory:");
      const isParquet = datasetPath.endsWith(".parquet");
      const safePath = datasetPath.replace(/\\/g, "/");
      const readSql = isParquet ? `read_parquet('${safePath}')` : `read_csv_auto('${safePath}')`;

      const colRows: any[] = await new Promise((resolve) => {
        db.all(`DESCRIBE SELECT * FROM ${readSql} LIMIT 0`, (err: any, rows: any[]) => {
          if (err || !rows) resolve([]);
          else resolve(rows);
        });
      });

      const parquetCols = colRows.map((r: any) => ({
        name: r.column_name || r.Field || r.name,
        type: String(r.column_type || r.Type || "").toLowerCase(),
      }));

      if (candidateTimeCol) {
        const matched = parquetCols.find(
          (c) => c.name.toLowerCase() === candidateTimeCol?.toLowerCase()
        );
        if (matched) {
          actualTimeColumn = matched.name;
        }
      }

      if (!actualTimeColumn) {

        const priorityNameCol = parquetCols.find((c) => {
          const lower = c.name.toLowerCase();
          return lower === "order_date" || lower === "date" || lower === "timestamp" || lower === "datetime" || lower === "orderdate" || lower === "transaction_date";
        });
        if (priorityNameCol) {
          actualTimeColumn = priorityNameCol.name;
        }
      }

      if (!actualTimeColumn) {

        const dateTypeAndName = parquetCols.find(
          (c) => (c.type.includes("date") || c.type.includes("timestamp") || c.type.includes("time")) &&
                 c.name.toLowerCase().includes("date")
        );
        if (dateTypeAndName) {
          actualTimeColumn = dateTypeAndName.name;
        }
      }

      if (!actualTimeColumn) {

        const dateTypeCol = parquetCols.find(
          (c) => c.type.includes("date") || c.type.includes("timestamp")
        );
        if (dateTypeCol) {
          actualTimeColumn = dateTypeCol.name;
        }
      }

      if (!actualTimeColumn) {

        const nameCol = parquetCols.find(
          (c) => c.name.toLowerCase().includes("date") ||
                 c.name.toLowerCase().includes("time") ||
                 c.name.toLowerCase().includes("year_month")
        );
        if (nameCol) {
          actualTimeColumn = nameCol.name;
        }
      }

      if (actualTimeColumn) {
        const sanitizedCol = actualTimeColumn.replace(/"/g, '""');
        const rangeRows: any[] = await new Promise((resolve) => {
          db.all(
            `SELECT
              MIN(CAST("${sanitizedCol}" AS VARCHAR)) as min_raw,
              MAX(CAST("${sanitizedCol}" AS VARCHAR)) as max_raw,
              MIN(TRY_CAST("${sanitizedCol}" AS DATE)) as min_d,
              MAX(TRY_CAST("${sanitizedCol}" AS DATE)) as max_d
            FROM ${readSql}
            WHERE "${sanitizedCol}" IS NOT NULL`,
            (err: any, rows: any[]) => {
              if (err || !rows) resolve([]);
              else resolve(rows);
            }
          );
        });

        if (rangeRows.length > 0 && (rangeRows[0].min_d || rangeRows[0].min_raw)) {
          minDateStr = String(rangeRows[0].min_d || rangeRows[0].min_raw || "");
          maxDateStr = String(rangeRows[0].max_d || rangeRows[0].max_raw || "");
        }
      }
    } catch (duckErr) {
      console.warn(`[extractDatasetDateRange] DuckDB date range query warning:`, duckErr);
    }
  }

  if ((!minDateStr || !maxDateStr) && agentState?.dataProfile?.tables) {
    const tables = Array.isArray(agentState.dataProfile.tables)
      ? agentState.dataProfile.tables
      : Object.values(agentState.dataProfile.tables);

    for (const t of tables as any[]) {
      const dateCols = t?.statisticalProfile?.dateColumns || [];
      for (const dc of dateCols) {
        if (!actualTimeColumn || dc.name?.toLowerCase() === actualTimeColumn.toLowerCase()) {
          actualTimeColumn = dc.name;
          if (dc.minDate) minDateStr = String(dc.minDate);
          if (dc.maxDate) maxDateStr = String(dc.maxDate);
          break;
        }
      }
      if (minDateStr && maxDateStr) break;
    }
  }

  if (!minDateStr || !maxDateStr || !actualTimeColumn) {
    return {
      hasTemporalData: false,
      timeColumn: actualTimeColumn || candidateTimeCol || null,
      datasetPath,
    };
  }

  const parseDateValues = (str: string) => {
    const cleaned = str.split("T")[0].split(" ")[0].trim();
    const parts = cleaned.split(/[-/]/);
    if (parts.length === 3) {
      if (parts[0].length === 4) {

        return { year: parseInt(parts[0], 10), month: parseInt(parts[1], 10), day: parseInt(parts[2], 10) };
      } else if (parts[2].length === 4) {

        return { year: parseInt(parts[2], 10), month: parseInt(parts[1], 10), day: parseInt(parts[0], 10) };
      }
    }
    const d = new Date(str);
    if (!isNaN(d.getTime())) {
      return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
    }
    return null;
  };

  const minParsed = parseDateValues(minDateStr);
  const maxParsed = parseDateValues(maxDateStr);

  if (!minParsed || !maxParsed || isNaN(minParsed.year) || isNaN(maxParsed.year)) {
    return {
      hasTemporalData: false,
      timeColumn: actualTimeColumn,
      datasetPath,
    };
  }

  const minYear = Math.min(minParsed.year, maxParsed.year);
  const maxYear = Math.max(minParsed.year, maxParsed.year);
  const minMonth = minParsed.year <= maxParsed.year ? minParsed.month : maxParsed.month;
  const maxMonth = maxParsed.year >= minParsed.year ? maxParsed.month : minParsed.month;

  const availableYears: number[] = [];
  for (let y = minYear; y <= maxYear; y++) {
    availableYears.push(y);
  }

  const formattedMinDate = `${minYear}-${String(minMonth).padStart(2, "0")}-${String(minParsed.day || 1).padStart(2, "0")}`;
  const formattedMaxDate = `${maxYear}-${String(maxMonth).padStart(2, "0")}-${String(maxParsed.day || 28).padStart(2, "0")}`;

  return {
    hasTemporalData: true,
    timeColumn: actualTimeColumn,
    minDate: formattedMinDate,
    maxDate: formattedMaxDate,
    minYear,
    maxYear,
    minMonth,
    maxMonth,
    availableYears,
    datasetPath,
  };
}
