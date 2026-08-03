import { ConnectionTesterService } from "../../services/connector/connectionTester.service";
import { ConnectorService } from "../../services/connector/connector.service";
import { ConnectionConfig, ConnectorType } from "../../models/connector.types";

type SampleRow = Record<string, unknown>;

export interface SamplingParams {
  connectorId?: string;
  connectorType?: string;
  connectionConfig?: Record<string, any>;
  tableName: string;
  sampleMethod?: "random" | "stratified" | "interval";
  sampleSize?: number;
  seed?: number;
  intervals?: number[];
  stratifyColumn?: string;
  relationships?: Array<{
    column: string;
    foreignTable: string;
    foreignColumn: string;
  }>;
  foreignKeyValues?: Record<string, string[]>;
  fetchAll?: boolean;
}

export async function fetchRowsOnDemand(
  connectionTester: ConnectionTesterService,
  connectorService: ConnectorService,
  defaultConnector: any,
  params: SamplingParams
): Promise<{ rows: SampleRow[]; totalRowCount: number; error?: string }> {
  const {
    connectorId,
    connectorType,
    connectionConfig,
    tableName,
    sampleMethod,
    sampleSize: inputSampleSize,
    seed = 42,
    intervals,
    stratifyColumn,
    relationships,
    foreignKeyValues,
    fetchAll,
  } = params;

  let resolvedType = connectorType as ConnectorType | undefined;
  let config = connectionConfig as ConnectionConfig | undefined;

  let connector: any;
  if (typeof connectorId === "string" && connectorId.trim().length > 0) {
    connector = await connectorService.getById(connectorId);
    if (!connector && defaultConnector && (defaultConnector.id === connectorId || defaultConnector.name === connectorId)) {
      connector = defaultConnector;
    }
    if (!connector) {
      try {
        const allConnectors = await connectorService.getAll();
        connector = allConnectors.find(
          (c) => c.id === connectorId || c.name === connectorId || c.name.toLowerCase() === connectorId.toLowerCase()
        );
      } catch {
        // Ignore error
      }
    }
  }

  if (!connector && defaultConnector) {
    connector = defaultConnector;
  }

  if (connector) {
    resolvedType = connector.type;
    config = connector.connectionConfig || {};
  }

  if (!resolvedType || !config) {
    return { rows: [], totalRowCount: 0, error: "Missing connector configuration" };
  }

  const type = resolvedType;
  const method = sampleMethod || "random";

  try {
    const totalRowCount = await connectionTester.getRowCount(type, config, tableName);

    let rows: SampleRow[] = [];
    const size = fetchAll ? totalRowCount : (typeof inputSampleSize === "number" && inputSampleSize > 0 ? inputSampleSize : 100);

    if (method === "interval") {
      const intervalPoints = Array.isArray(intervals) && intervals.length > 0
        ? intervals
        : [0, 25, 50, 75, 100];

      const perInterval = Math.max(1, Math.ceil(size / intervalPoints.length));
      const collectedRows: SampleRow[] = [];

      for (const percentile of intervalPoints) {
        const offset = Math.max(0, Math.floor((totalRowCount * Math.min(percentile, 99)) / 100));
        const result = await connectionTester.getSampleWithOffset(type, config, tableName, perInterval, offset);
        collectedRows.push(...result.rows);
      }

      const seen = new Set<string>();
      rows = collectedRows.filter((row) => {
        const key = JSON.stringify(row);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    } else if (method === "stratified") {
      // Stratified row count must be 40% of total row count
      const stratifiedSize = Math.max(1, Math.ceil(totalRowCount * 0.40));
      if (!stratifyColumn) {
        // Fallback to random with 40% size
        const result = await connectionTester.getRandomSample(type, config, tableName, stratifiedSize, seed);
        rows = result.rows;
      } else {
        const limitPerGroup = Math.max(1, Math.ceil(stratifiedSize / 10));
        const result = await connectionTester.getStratifiedSample(type, config, tableName, stratifyColumn, limitPerGroup, seed);
        rows = result.rows;
      }
    } else {
      const result = await connectionTester.getRandomSample(type, config, tableName, size, seed);
      rows = result.rows;
    }

    if (Array.isArray(relationships) && relationships.length > 0 && foreignKeyValues) {
      const fkMap = foreignKeyValues as Record<string, string[]>;
      for (const rel of relationships) {
        const relObj = rel as { column?: string; foreignTable?: string; foreignColumn?: string };
        const localCol = relObj.column;
        const foreignTable = relObj.foreignTable;
        if (!localCol || !foreignTable) continue;

        const allowedValues = fkMap[foreignTable];
        if (!Array.isArray(allowedValues) || allowedValues.length === 0) continue;

        const allowedSet = new Set(allowedValues.map((v) => String(v).toLowerCase().trim()));
        rows = rows.filter((row) => {
          const val = row[localCol];
          if (val === null || val === undefined) return true;
          return allowedSet.has(String(val).toLowerCase().trim());
        });
      }
    }

    const finalSize = method === "stratified" ? Math.max(1, Math.ceil(totalRowCount * 0.40)) : size;
    return {
      rows: rows.slice(0, finalSize),
      totalRowCount,
    };
  } catch (error) {
    return {
      rows: [],
      totalRowCount: 0,
      error: error instanceof Error ? error.message : "Sampling failed",
    };
  }
}
