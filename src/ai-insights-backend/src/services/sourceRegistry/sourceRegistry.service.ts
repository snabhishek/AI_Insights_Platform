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
import { ConnectorType } from "../../models/connector.types";

const IDENTIFIER_REGEX = /^[a-zA-Z0-9_\-\. ]+$/;

export class SourceRegistryService implements ISourceRegistryService {
  private inMemoryRegistry = new Map<string, SourceRegistryEntry>();

  constructor(
    private connectorRepository: IConnectorRepository,
    private connectionTesterService: IConnectionTesterService,
    private duckDBService?: IDuckDBService
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
      if (!connector) return null;

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
          storagePath: safeFileName ? path.join(process.cwd(), "uploads", "duckdb", `${safeFileName}.duckdb`) : undefined,
          databaseName: connector.connectionConfig?.database,
          host: connector.connectionConfig?.host,
          port: connector.connectionConfig?.port ? Number(connector.connectionConfig.port) : undefined,
        },
        createdAt: connector.createdAt ? new Date(connector.createdAt) : new Date(),
      };

      this.inMemoryRegistry.set(cleanId, entry);
      return entry;
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

  async fetchFilterOptions(query: FilterOptionsQuery): Promise<FilterOptionsResult> {
    const { sourceId, fieldId, tableName, parentParams, parentFields = [], search, controlType, limit = 50 } = query;

    // Security check identifiers against allowlist regex
    const cleanFieldId = this.validateIdentifier(fieldId, "fieldId");
    const targetTable = tableName
      ? this.validateIdentifier(tableName, "tableName")
      : undefined;

    const source = await this.getSource(sourceId);

    if (!source) {
      return {
        success: false,
        sourceId,
        fieldId: cleanFieldId,
        values: [],
        totalCount: 0,
      };
    }

    const resolvedTable = targetTable || source.connectionConfig.fileName || cleanFieldId;
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

      // User instruction: "If no values for parent fields, Consider the subfield as Independent field"
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
      if (this.duckDBService && ["csv", "tsv", "excel"].includes(source.type)) {
        try {
          const rawFile = source.connectionConfig.fileName || cleanTable;
          const dbPath = this.duckDBService.getDuckDbPath(rawFile);
          
          // Discover actual table name in DuckDB
          let actualTable = path.basename(rawFile, path.extname(rawFile)).replace(/[^a-zA-Z0-9_-]/g, "_");
          try {
            const tableList = await this.duckDBService.runQuery(dbPath, "SHOW TABLES");
            if (tableList && tableList.length > 0) {
              const availableTables = tableList.map((t: any) => Object.values(t)[0] as string);
              const found = availableTables.find((t) => t.toLowerCase() === actualTable.toLowerCase());
              if (found) {
                actualTable = found;
              } else {
                actualTable = availableTables[0];
              }
            }
          } catch {}

          // Inspect actual columns
          const cols = await this.duckDBService.runQuery(dbPath, `DESCRIBE "${actualTable.replace(/"/g, '""')}"`);
          const colNames: string[] = (cols || []).map((c: any) => c.column_name);

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

          const dateCols = colNames.filter((c) => /date|time|timestamp/i.test(c));
          const primaryDateCol = dateCols.find((c) => /order/i.test(c)) || dateCols[0] || "Order_Date";

          let valExpr = `"${(findBestColumn(cleanFieldId) || cleanFieldId).replace(/"/g, '""')}"`;
          let isTemporalDerived = false;

          const targetLower = cleanFieldId.toLowerCase();
          if (!findBestColumn(cleanFieldId) && dateCols.length > 0) {
            if (targetLower.includes("year")) {
              valExpr = `CAST(EXTRACT(YEAR FROM "${primaryDateCol.replace(/"/g, '""')}") AS VARCHAR)`;
              isTemporalDerived = true;
            } else if (targetLower.includes("quarter")) {
              valExpr = `'Q' || CAST(EXTRACT(QUARTER FROM "${primaryDateCol.replace(/"/g, '""')}") AS VARCHAR)`;
              isTemporalDerived = true;
            } else if (targetLower.includes("month")) {
              valExpr = `strftime('%B', "${primaryDateCol.replace(/"/g, '""')}")`;
              isTemporalDerived = true;
            }
          }

          if (controlType === "date_range") {
            const dateCol = (findBestColumn(cleanFieldId) || primaryDateCol).replace(/"/g, '""');
            const minMaxSql = `
              SELECT 
                MIN(CAST("${dateCol}" AS VARCHAR)) AS min_val, 
                MAX(CAST("${dateCol}" AS VARCHAR)) AS max_val,
                COUNT(DISTINCT "${dateCol}") AS total_cnt
              FROM "${actualTable.replace(/"/g, '""')}"
              WHERE "${dateCol}" IS NOT NULL AND TRIM(CAST("${dateCol}" AS VARCHAR)) != ''
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

          let filterSql = `WHERE ${valExpr} IS NOT NULL AND TRIM(CAST(${valExpr} AS VARCHAR)) != ''`;
          const params: any[] = [];

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
        } catch (duckDbErr) {
          console.warn(`[SourceRegistryService] DuckDB direct query fallback for "${cleanFieldId}":`, duckDbErr);
        }
      }

      // 2. Universal Sample-Based Extraction Fallback
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

      // 2. Handling for dropdown and searchable_dropdown
      const sample = await this.connectionTesterService.getSampleWithOffset(
        source.type,
        source.connectionConfig,
        cleanTable,
        limit * 10,
        0
      );

      let rows = sample.rows || [];

      // Apply parent filtering if active
      if (activeParentFilters.length > 0) {
        rows = rows.filter((row) =>
          activeParentFilters.every((pf) => String(row[pf.col]).toLowerCase() === String(pf.val).toLowerCase())
        );
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
    } catch (error) {
      console.warn(`[SourceRegistryService] Error fetching filter options for field "${cleanFieldId}" in source "${sourceId}":`, error);
      return {
        success: false,
        sourceId,
        fieldId: cleanFieldId,
        values: [],
        totalCount: 0,
        isIndependentFallback,
      };
    }
  }
}
