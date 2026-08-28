import fs from "fs";
import path from "path";
import {
  ISourceRegistryService,
  SourceRegistryEntry,
  FilterOptionsQuery,
  FilterOptionsResult,
  BackingEngineType,
} from "./sourceRegistry.service.interface";
import { IConnectorRepository } from "../../repositories/connector.repository.interface";
import { IConnectionTesterService } from "../connector/connectionTester.service.interface";
import { IDuckDBService } from "../duckdb/duckdb.service.interface";
import { IProjectRepository } from "../../repositories/project.repository.interface";
import { ConnectorType } from "../../models/connector.types";
import { Project } from "../../models/project.types";

const IDENTIFIER_REGEX = /^[a-zA-Z0-9_\-\. ]+$/;

export class SourceRegistryService implements ISourceRegistryService {
  private inMemoryRegistry = new Map<string, SourceRegistryEntry>();
  private projectIngestionPromises = new Map<string, Promise<void>>();

  constructor(
    private connectorRepository: IConnectorRepository,
    private connectionTesterService: IConnectionTesterService,
    private duckDBService?: IDuckDBService,
    private projectRepository?: IProjectRepository
  ) {}

  private deriveBackingEngine(type: ConnectorType): BackingEngineType {
    if (["csv", "tsv", "excel", "restapi"].includes(type)) {
      return "duckdb";
    }
    if (type === "postgres") return "postgres";
    if (type === "mysql") return "mysql";
    if (type === "sqlserver") return "sqlserver";
    return "unknown";
  }

  private validateIdentifier(identifier: string, paramName: string): string {
    if (!identifier || typeof identifier !== "string" || !IDENTIFIER_REGEX.test(identifier.trim())) {
      throw new Error(`Security validation failed: Invalid SQL identifier "${identifier}" for ${paramName}`);
    }
    return identifier.trim();
  }

  /**
   * Helper to retrieve row value matching a requested column name flexibly
   * (case-insensitive, space/underscore-normalized, and stripping redundant entity prefixes).
   */
  private getRowValue(row: Record<string, any>, colName: string): any {
    if (!row || typeof row !== "object") return undefined;
    if (row[colName] !== undefined) return row[colName];

    const targetLower = colName.toLowerCase().trim();
    const targetNorm = targetLower.replace(/[^a-z0-9]/g, "_");

    // 1. Direct case-insensitive / normalized match
    for (const [k, v] of Object.entries(row)) {
      const kLower = k.toLowerCase().trim();
      if (kLower === targetLower) return v;
      if (kLower.replace(/[^a-z0-9]/g, "_") === targetNorm) return v;
    }

    // 2. Suffix match (e.g. "carrier_carrier_name" -> "carrier_name" or "carrier name")
    for (const [k, v] of Object.entries(row)) {
      const kNorm = k.toLowerCase().replace(/[^a-z0-9]/g, "_");
      if (targetNorm.endsWith(`_${kNorm}`) || kNorm.endsWith(`_${targetNorm}`)) {
        return v;
      }
    }

    return undefined;
  }

  async getSource(sourceId: string): Promise<SourceRegistryEntry | null> {
    if (!sourceId || typeof sourceId !== "string") return null;
    const cleanId = sourceId.trim();

    if (this.inMemoryRegistry.has(cleanId)) {
      return this.inMemoryRegistry.get(cleanId)!;
    }

    try {
      const connector = await this.connectorRepository.getById(cleanId);
      if (connector) {
        const backingEngine = this.deriveBackingEngine(connector.type);
        const safeFileName = connector.connectionConfig?.fileName
          ? connector.connectionConfig.fileName.replace(/[^a-zA-Z0-9_-]/g, "_")
          : undefined;

        const entry: SourceRegistryEntry = {
          sourceId: connector.id,
          name: connector.name,
          type: connector.type,
          workspaceId: connector.workspaceId,
          connectionConfig: connector.connectionConfig,
          backingEngine,
          details: {
            storagePath: safeFileName ? path.join(process.cwd(), "Projects", `${safeFileName}.duckdb`) : undefined,
            databaseName: connector.connectionConfig?.database,
            host: connector.connectionConfig?.host,
            port: connector.connectionConfig?.port ? Number(connector.connectionConfig.port) : undefined,
          },
          createdAt: connector.createdAt ? new Date(connector.createdAt) : new Date(),
        };

        this.inMemoryRegistry.set(cleanId, entry);
        return entry;
      }

      // If not found directly in connector repo, construct fallback entry
      const fallbackEntry: SourceRegistryEntry = {
        sourceId: cleanId,
        name: cleanId,
        type: "csv",
        connectionConfig: { fileName: cleanId },
        backingEngine: "duckdb",
        details: {},
        createdAt: new Date(),
      };
      return fallbackEntry;
    } catch (error) {
      console.warn(`[SourceRegistryService] Failed to resolve sourceId "${cleanId}":`, error);
      return null;
    }
  }

  async registerSource(sourceId: string, metadata: Partial<SourceRegistryEntry>): Promise<SourceRegistryEntry> {
    const existing = await this.getSource(sourceId);

    const updated: SourceRegistryEntry = {
      sourceId,
      name: metadata.name || existing?.name || `Source_${sourceId}`,
      type: metadata.type || existing?.type || "csv",
      workspaceId: metadata.workspaceId || existing?.workspaceId,
      connectionConfig: metadata.connectionConfig || existing?.connectionConfig || {},
      backingEngine: metadata.backingEngine || existing?.backingEngine || this.deriveBackingEngine(metadata.type || "csv"),
      details: {
        ...(existing?.details || {}),
        ...(metadata.details || {}),
      },
      createdAt: existing?.createdAt || new Date(),
    };

    this.inMemoryRegistry.set(sourceId, updated);
    return updated;
  }

  /**
   * Resolves the target Project record from project repository using projectId, projectName, or sourceId.
   */
  private async resolveProject(projectId?: string, projectName?: string, sourceId?: string): Promise<Project | undefined> {
    if (!this.projectRepository) return undefined;

    try {
      if (projectId) {
        const byId = await this.projectRepository.getById(projectId);
        if (byId) return byId;
      }

      const allProjects = await this.projectRepository.getAll();

      if (projectName) {
        const byName = allProjects.find((p) => p.name.toLowerCase() === projectName.toLowerCase().trim());
        if (byName) return byName;
      }

      if (projectId) {
        const byNameOrId = allProjects.find(
          (p) => p.id === projectId || p.name.toLowerCase() === projectId.toLowerCase().trim()
        );
        if (byNameOrId) return byNameOrId;
      }

      if (sourceId) {
        const bySource = allProjects.find(
          (p) => Array.isArray(p.dataSources) && p.dataSources.includes(sourceId)
        );
        if (bySource) return bySource;
      }
    } catch (e) {
      console.warn(`[SourceRegistryService] Error resolving project:`, e);
    }

    return undefined;
  }

  async fetchFilterOptions(query: FilterOptionsQuery): Promise<FilterOptionsResult> {
    const { sourceId, fieldId, tableName, projectId, projectName, parentParams, parentFields = [], search, controlType, limit = 50 } = query;

    // Security check identifiers against allowlist regex
    const cleanFieldId = this.validateIdentifier(fieldId, "fieldId");
    const targetTable = tableName
      ? this.validateIdentifier(tableName, "tableName")
      : undefined;

    const source = await this.getSource(sourceId);

    const resolvedTable = targetTable || source?.connectionConfig?.fileName || cleanFieldId;
    const cleanTable = this.validateIdentifier(resolvedTable, "resolvedTable");

    // Check parent parameter values
    let isIndependentFallback = false;
    const activeParentFilters: Array<{ col: string; val: unknown }> = [];

    if (Array.isArray(parentFields) && parentFields.length > 0) {
      for (const pField of parentFields) {
        const cleanPField = this.validateIdentifier(pField, "parentField");
        const val = parentParams?.[pField] ?? parentParams?.[cleanPField];
        if (val !== undefined && val !== null && String(val).trim() !== "") {
          activeParentFilters.push({ col: cleanPField, val });
        }
      }

      if (activeParentFilters.length === 0) {
        isIndependentFallback = true;
      }
    } else if (parentParams && typeof parentParams === "object") {
      for (const [pKey, pVal] of Object.entries(parentParams)) {
        if (pVal !== undefined && pVal !== null && String(pVal).trim() !== "") {
          const cleanPKey = this.validateIdentifier(pKey, "parentKey");
          activeParentFilters.push({ col: cleanPKey, val: pVal });
        }
      }
    }

    try {
      // 1. Direct DuckDB Query Pushdown for High-Performance File Sources
      if (this.duckDBService && (!source || ["csv", "tsv", "excel"].includes(source.type))) {
        try {
          const rawFile = targetTable || source?.connectionConfig?.fileName || cleanTable;

          // 1.1 Attempt to find exact or fuzzy column location across DuckDB databases
          const colLocation = await this.duckDBService.findColumnLocation(
            cleanFieldId,
            targetTable || source?.connectionConfig?.fileName
          );

          const dbPath = colLocation ? colLocation.dbPath : this.duckDBService.getDuckDbPath(rawFile);

          // Discover actual table name in DuckDB
          let actualTable = colLocation
            ? colLocation.tableName
            : path.basename(rawFile, path.extname(rawFile)).replace(/[^a-zA-Z0-9_-]/g, "_");
          let colNames: string[] = colLocation ? colLocation.colNames : [];

          if (!colNames || colNames.length === 0) {
            try {
              const tableList = await this.duckDBService.runQuery(dbPath, "SHOW TABLES");
              if (tableList && tableList.length > 0) {
                const availableTables = tableList.map((t: any) => Object.values(t)[0] as string);
                const found = availableTables.find(
                  (t) =>
                    t.toLowerCase() === actualTable.toLowerCase() ||
                    t.toLowerCase() === `${actualTable.toLowerCase()}.csv` ||
                    t.toLowerCase().replace(/[^a-z0-9]/g, "") === actualTable.toLowerCase().replace(/[^a-z0-9]/g, "")
                );
                if (found) {
                  actualTable = found;
                } else {
                  actualTable = availableTables[0];
                }
              }
            } catch {}

            // Inspect actual columns
            try {
              const cols = await this.duckDBService.runQuery(dbPath, `DESCRIBE "${actualTable.replace(/"/g, '""')}"`);
              colNames = (cols || []).map((c: any) => c.column_name);
            } catch {}
          }

          const findBestColumn = (target: string): string | null => {
            const clean = target.toLowerCase().replace(/[^a-z0-9]/g, "");
            const exact = colNames.find((c) => c.toLowerCase() === target.toLowerCase());
            if (exact) return exact;
            const norm = colNames.find((c) => c.toLowerCase().replace(/[^a-z0-9]/g, "") === clean);
            if (norm) return norm;
            const nameMatch = colNames.find((c) => {
              const cClean = c.toLowerCase().replace(/[^a-z0-9]/g, "");
              return cClean === `${clean}name` || cClean === `name${clean}`;
            });
            if (nameMatch) return nameMatch;
            const sub = colNames.find((c) => {
              const cClean = c.toLowerCase().replace(/[^a-z0-9]/g, "");
              return cClean.includes(clean) || clean.includes(cClean);
            });
            if (sub) return sub;
            return null;
          };

          const matchedCol = colLocation?.columnName || findBestColumn(cleanFieldId) || cleanFieldId;
          const safeCol = matchedCol.replace(/"/g, '""');
          const dateCols = colNames.filter((c) => /date|time|timestamp/i.test(c));
          const primaryDateCol = dateCols.find((c) => /order/i.test(c)) || dateCols[0] || "Order_Date";

          let valExpr = `"${safeCol}"`;

          const targetLower = cleanFieldId.toLowerCase();
          const isDirectMatch = findBestColumn(cleanFieldId) && !/year|quarter|month|week|day/i.test(cleanFieldId);
          if (!isDirectMatch && dateCols.length > 0) {
            if (targetLower.includes("year")) {
              valExpr = `CAST(EXTRACT(YEAR FROM "${primaryDateCol.replace(/"/g, '""')}") AS VARCHAR)`;
            } else if (targetLower.includes("quarter")) {
              valExpr = `'Q' || CAST(EXTRACT(QUARTER FROM "${primaryDateCol.replace(/"/g, '""')}") AS VARCHAR)`;
            } else if (targetLower.includes("month")) {
              valExpr = `strftime('%B', "${primaryDateCol.replace(/"/g, '""')}")`;
            }
          }

          // If a table containing the requested column was found, query it!
          if (matchingTable && matchedColumn) {
            const actualTable = matchingTable;
            const safeCol = matchedColumn.replace(/"/g, '""');

            // Handle date_range controlType
            if (controlType === "date_range") {
              const minMaxSql = `
                SELECT 
                  MIN(CAST("${safeCol}" AS VARCHAR)) AS min_val, 
                  MAX(CAST("${safeCol}" AS VARCHAR)) AS max_val,
                  COUNT(DISTINCT "${safeCol}") AS total_cnt
                FROM "${actualTable.replace(/"/g, '""')}"
                WHERE "${safeCol}" IS NOT NULL AND TRIM(CAST("${safeCol}" AS VARCHAR)) != ''
              `;
              const stats = await this.duckDBService.runQuery(dbPath, minMaxSql);
              if (stats && stats.length > 0) {
                return {
                  success: true,
                  sourceId,
                  fieldId: cleanFieldId,
                  values: [],
                  totalCount: Number(stats[0].total_cnt || 0),
                  dateRange: { min: stats[0].min_val || null, max: stats[0].max_val || null },
                  isIndependentFallback,
                };
              }
            }

            // Handle dropdown / searchable_dropdown
            let valExpr = `"${safeCol}"`;
            let filterSql = `WHERE ${valExpr} IS NOT NULL AND TRIM(CAST(${valExpr} AS VARCHAR)) != ''`;
            const params: any[] = [];

            // Apply parent parameter filters if present on this table
            if (activeParentFilters.length > 0) {
              for (const pf of activeParentFilters) {
                const matchedPCol = matchColumn(tableColNames, pf.col);
                if (matchedPCol) {
                  const safePCol = matchedPCol.replace(/"/g, '""');
                  filterSql += ` AND CAST("${safePCol}" AS VARCHAR) = ?`;
                  params.push(String(pf.val));
                }
              }
            }

            if (search && search.trim()) {
              filterSql += ` AND LOWER(CAST(${valExpr} AS VARCHAR)) LIKE ?`;
              params.push(`%${search.trim().toLowerCase()}%`);
            }

            const distinctSql = `
              SELECT DISTINCT ${valExpr} AS val
              FROM "${actualTable.replace(/"/g, '""')}"
              ${filterSql}
              ORDER BY val ASC
              LIMIT ${limit}
            `;

            const rows = await this.duckDBService.runQuery(dbPath, distinctSql, params);
            if (rows && rows.length > 0) {
              const values = rows.map((r: any) => r.val).filter((v: any) => v !== undefined && v !== null);
              return {
                success: true,
                sourceId,
                fieldId: cleanFieldId,
                values,
                totalCount: values.length,
                isIndependentFallback,
              };
            }
          }
        } catch (duckDbErr: any) {
          console.warn(`[SourceRegistryService] DuckDB query warning on ${dbPath} for "${cleanFieldId}":`, duckDbErr?.message || duckDbErr);
        }
      }
    }

          // Handle dropdown / searchable_dropdown
          let filterSql = `WHERE ${valExpr} IS NOT NULL AND TRIM(CAST(${valExpr} AS VARCHAR)) != ''`;
          const params: any[] = [];

          // Apply parent parameter filters if present on this table
          if (activeParentFilters.length > 0) {
            for (const pf of activeParentFilters) {
              const matchedPCol = findBestColumn(pf.col);
              if (matchedPCol) {
                const safePCol = matchedPCol.replace(/"/g, '""');
                filterSql += ` AND CAST("${safePCol}" AS VARCHAR) = ?`;
                params.push(String(pf.val));
              }
            }
          }

        let rows = sample.rows || [];

          const distinctSql = `
            SELECT DISTINCT ${valExpr} AS val
            FROM "${actualTable.replace(/"/g, '""')}"
            ${filterSql}
            ORDER BY val ASC
            LIMIT ${limit}
          `;

          const rows = await this.duckDBService.runQuery(dbPath, distinctSql, params);
          if (rows && rows.length > 0) {
            const values = rows.map((r: any) => r.val).filter((v: any) => v !== undefined && v !== null);
            return {
              success: true,
              sourceId,
              fieldId: cleanFieldId,
              values,
              totalCount: values.length,
              isIndependentFallback,
            };
          }
        } catch (duckDbErr: any) {
          console.warn(`[SourceRegistryService] DuckDB query warning for "${cleanFieldId}":`, duckDbErr?.message || duckDbErr);
        }
      }
    } catch (err: any) {
      console.warn(`[SourceRegistryService] Direct query pushdown failed for "${cleanFieldId}":`, err?.message || err);
    }

    // ─── 2. Source-Specific Fallback via ConnectionTester ────
    if (source && source.connectionConfig?.fileName) {
      try {
        const sample = await this.connectionTesterService.getSampleWithOffset(
          source.type,
          source.connectionConfig,
          cleanTable,
          limit * 20,
          0
        );

        let rows = sample.rows || [];

        // Apply parent filtering if present
        if (activeParentFilters.length > 0) {
          rows = rows.filter((row) =>
            activeParentFilters.every((pf) => {
              const rowVal = this.getRowValue(row, pf.col);
              return rowVal !== undefined && String(rowVal).toLowerCase() === String(pf.val).toLowerCase();
            })
          );
        }

        if (controlType === "date_range") {
          const dateValues = rows
            .map((r) => this.getRowValue(r, cleanFieldId))
            .filter((v) => v !== undefined && v !== null && String(v).trim() !== "")
            .map((v) => String(v));

          dateValues.sort();
          const min = dateValues.length > 0 ? dateValues[0] : null;
          const max = dateValues.length > 0 ? dateValues[dateValues.length - 1] : null;

          return {
            success: true,
            sourceId,
            fieldId: cleanFieldId,
            values: [],
            totalCount: dateValues.length,
            dateRange: { min, max },
            isIndependentFallback,
          };
        }

        // Apply case-insensitive search term matching if present
        if (search && typeof search === "string" && search.trim().length > 0) {
          const searchLower = search.trim().toLowerCase();
          rows = rows.filter((row) => {
            const valStr = String(this.getRowValue(row, cleanFieldId) ?? "").toLowerCase();
            return valStr.includes(searchLower);
          });
        }

        const distinctValues = Array.from(
          new Set(
            rows
              .map((r) => this.getRowValue(r, cleanFieldId))
              .filter((val) => val !== undefined && val !== null && String(val).trim() !== "")
          )
        ).slice(0, limit);

        return {
          success: true,
          sourceId,
          fieldId: cleanFieldId,
          values: distinctValues,
          totalCount: distinctValues.length,
          isIndependentFallback,
        };
      } catch (err: any) {
        console.warn(`[SourceRegistryService] Fallback error for "${cleanFieldId}":`, err?.message || err);
      }
    }

    return {
      success: true,
      sourceId,
      fieldId: cleanFieldId,
      values: [],
      totalCount: 0,
      isIndependentFallback,
    };
  }
}
