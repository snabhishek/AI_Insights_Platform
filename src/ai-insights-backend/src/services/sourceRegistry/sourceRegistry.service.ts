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
import { ConnectorType } from "../../models/connector.types";

const IDENTIFIER_REGEX = /^[a-zA-Z0-9_\-\.]+$/;

export class SourceRegistryService implements ISourceRegistryService {
  private inMemoryRegistry = new Map<string, SourceRegistryEntry>();

  constructor(
    private connectorRepository: IConnectorRepository,
    private connectionTesterService: IConnectionTesterService
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
      // 1. Special handling for date_range controlType -> MIN/MAX query
      if (controlType === "date_range") {
        const sample = await this.connectionTesterService.getSampleWithOffset(
          source.type,
          source.connectionConfig,
          cleanTable,
          limit * 5,
          0
        );

        let rows = sample.rows || [];

        // Apply parent filtering if present
        if (activeParentFilters.length > 0) {
          rows = rows.filter((row) =>
            activeParentFilters.every((pf) => String(row[pf.col]).toLowerCase() === String(pf.val).toLowerCase())
          );
        }

        const dateValues = rows
          .map((r) => r[cleanFieldId])
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
          const valStr = String(row[cleanFieldId] ?? "").toLowerCase();
          return valStr.includes(searchLower);
        });
      }

      const distinctValues = Array.from(
        new Set(
          rows
            .map((r) => r[cleanFieldId])
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
