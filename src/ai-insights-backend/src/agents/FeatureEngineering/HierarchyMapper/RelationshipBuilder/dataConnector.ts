import { IDuckDBService } from "../../../../services/duckdb/duckdb.service.interface";
import { ConnectorType, ConnectionConfig } from "../../../../models/connector.types";

export interface DependencyStatsResult {
  purity: number; // 0.0 to 1.0
  sampleSize: number;
  sourceType: string;
}

export interface IGenericDataConnector {
  getDependencyStats(parentField: string, childField: string, tableName?: string): Promise<DependencyStatsResult>;
  getValueSet(field: string, limit: number, tableName?: string): Promise<string[]>;
  getFieldCardinality(field: string, tableName?: string): Promise<number>;
  getRowCount(tableName?: string): Promise<number>;
}


export class GenericDataConnector implements IGenericDataConnector {
  constructor(
    private connectorType: ConnectorType,
    private connectionConfig: ConnectionConfig,
    private duckDBService?: IDuckDBService,
    private defaultTableName: string = "default_table"
  ) {}

  private resolveTableName(tableName?: string): string {
    const raw = tableName || (this.connectionConfig as any).tableName || (this.connectionConfig as any).fileName || this.defaultTableName;
    return raw.replace(/[^a-zA-Z0-9_-]/g, "_");
  }

  private sanitizeId(name: string): string {
    return name.replace(/"/g, '""');
  }

  /**
   * Ensures file / API data sources are ingested into local query engine (DuckDB) once.
   */
  private async ensureSourceIngested(): Promise<void> {
    if (this.duckDBService && ["csv", "tsv", "excel", "json"].includes(this.connectorType)) {
      try {
        await this.duckDBService.ingestFileSource(this.connectorType, this.connectionConfig);
      } catch (err) {
        console.warn(`[GenericDataConnector] Failed to ingest source into DuckDB:`, err);
      }
    }
  }

  /**
   * Calculates functional dependency purity (0 to 1) and sample size
   * for a parent_field -> child_field mapping using aggregated SQL.
   */
  async getDependencyStats(parentField: string, childField: string, tableName?: string): Promise<DependencyStatsResult> {
    await this.ensureSourceIngested();
    const table = this.resolveTableName(tableName);
    const safeParent = this.sanitizeId(parentField);
    const safeChild = this.sanitizeId(childField);

    // Default fallback values if query fails
    let purity = 1.0;
    let sampleSize = 0;

    try {
      if (this.duckDBService) {
        // Run aggregation query via DuckDB for file/API/DB sources
        const dbPath = (this.duckDBService as any).getDuckDbPath
          ? (this.duckDBService as any).getDuckDbPath(this.connectionConfig.fileName || table)
          : null;

        if (dbPath && (this.duckDBService as any).getDbConnection) {
          const { db, conn } = await (this.duckDBService as any).getDbConnection(dbPath);
          try {
            const sql = `
              WITH ParentChildFreq AS (
                SELECT 
                  "${safeParent}" AS p_val,
                  "${safeChild}" AS c_val,
                  COUNT(*) AS freq
                FROM "${table}"
                WHERE "${safeParent}" IS NOT NULL AND "${safeChild}" IS NOT NULL
                GROUP BY "${safeParent}", "${safeChild}"
              ),
              ParentMaxFreq AS (
                SELECT
                  p_val,
                  MAX(freq) AS max_freq,
                  SUM(freq) AS parent_total
                FROM ParentChildFreq
                GROUP BY p_val
              )
              SELECT
                COALESCE(SUM(max_freq), 0) AS max_matching_rows,
                COALESCE(SUM(parent_total), 0) AS total_rows
              FROM ParentMaxFreq
            `;
            const rows = await (this.duckDBService as any).query(conn, sql);
            if (rows && rows.length > 0) {
              const maxMatching = Number(rows[0].max_matching_rows || 0);
              const total = Number(rows[0].total_rows || 0);
              sampleSize = total;
              purity = total > 0 ? Number((maxMatching / total).toFixed(4)) : 1.0;
            }
          } finally {
            await (this.duckDBService as any).closeConn(db, conn);
          }
        }
      }
    } catch (error) {
      console.warn(`[GenericDataConnector] getDependencyStats query error for ${parentField} -> ${childField}:`, error);
    }

    return {
      purity,
      sampleSize,
      sourceType: this.connectorType,
    };
  }

  /**
   * Returns up to `limit` distinct values of a field.
   */
  async getValueSet(field: string, limit: number = 20, tableName?: string): Promise<string[]> {
    await this.ensureSourceIngested();
    const table = this.resolveTableName(tableName);
    const safeField = this.sanitizeId(field);

    try {
      if (this.duckDBService) {
        const dbPath = (this.duckDBService as any).getDuckDbPath
          ? (this.duckDBService as any).getDuckDbPath(this.connectionConfig.fileName || table)
          : null;

        if (dbPath && (this.duckDBService as any).getDbConnection) {
          const { db, conn } = await (this.duckDBService as any).getDbConnection(dbPath);
          try {
            const sql = `
              SELECT DISTINCT "${safeField}" AS val
              FROM "${table}"
              WHERE "${safeField}" IS NOT NULL
              LIMIT ${limit}
            `;
            const rows = await (this.duckDBService as any).query(conn, sql);
            return rows.map((r: any) => String(r.val)).filter(Boolean);
          } finally {
            await (this.duckDBService as any).closeConn(db, conn);
          }
        }
      }
    } catch (error) {
      console.warn(`[GenericDataConnector] getValueSet query error for ${field}:`, error);
    }

    return [];
  }

  /**
   * Returns distinct value count for a field.
   */
  async getFieldCardinality(field: string, tableName?: string): Promise<number> {
    await this.ensureSourceIngested();
    const table = this.resolveTableName(tableName);
    const safeField = this.sanitizeId(field);

    try {
      if (this.duckDBService) {
        const dbPath = (this.duckDBService as any).getDuckDbPath
          ? (this.duckDBService as any).getDuckDbPath(this.connectionConfig.fileName || table)
          : null;

        if (dbPath && (this.duckDBService as any).getDbConnection) {
          const { db, conn } = await (this.duckDBService as any).getDbConnection(dbPath);
          try {
            const sql = `
              SELECT COUNT(DISTINCT "${safeField}") AS cnt
              FROM "${table}"
              WHERE "${safeField}" IS NOT NULL
            `;
            const rows = await (this.duckDBService as any).query(conn, sql);
            if (rows && rows.length > 0) {
              return Number(rows[0].cnt || 0);
            }
          } finally {
            await (this.duckDBService as any).closeConn(db, conn);
          }
        }
      }
    } catch (error) {
      console.warn(`[GenericDataConnector] getFieldCardinality error for ${field}:`, error);
    }

    return 0;
  }

  /**
   * Returns total row count.
   */
  async getRowCount(tableName?: string): Promise<number> {
    await this.ensureSourceIngested();
    const table = this.resolveTableName(tableName);

    try {
      if (this.duckDBService) {
        return await this.duckDBService.getRowCount(this.connectorType, this.connectionConfig, table);
      }
    } catch (error) {
      console.warn(`[GenericDataConnector] getRowCount error:`, error);
    }

    return 0;
  }
}
