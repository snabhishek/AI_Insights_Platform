import { PromptTemplate } from "@langchain/core/prompts";
import { AgentState } from "../../state";
import {
  TableMetaEntry,
  ExogenousScoutBatchResult,
  ExogenousSourceRecommendation,
} from "./state";

export const EXOGENOUS_INITIAL_BATCH_SIZE = 5;
export const EXOGENOUS_FOLLOW_UP_BATCH_SIZE = 5;
export const MAX_CONCURRENT_WORKERS = 5;

export const EXOGENOUS_BATCH_USER_PROMPT_TEMPLATE = PromptTemplate.fromTemplate(`## Batch Information (Worker {workerId}):
- Current Batch: {batchNumber} of {totalBatches}
- Tables in this batch: {batchTableNames}
{domainSection}
{promptSection}

## Table Schema Context:
{tableSchemaContext}

## Instructions:
1. Use the 'web_search' tool to scout relevant external datasets, APIs, macroeconomic series (e.g., FRED), weather APIs (e.g., Open-Meteo), calendar/holiday data, demographic data, or domain benchmarks for the tables in this batch.
2. Return valid JSON only adhering to the specified schema, detailing 'tableName', 'domain', 'summary', 'exogenousSources' (with sourceName, category, providerOrUrl, description, joinStrategy, featuresToExtract, expectedImpact, feasibility), 'featureOpportunities', and 'searchQueriesExecuted'.`);

/**
 * Extracts all relevant table column summaries and metadata from state
 */
export function extractTableMetadataMap(state: typeof AgentState.State): Map<string, TableMetaEntry> {
  const metadataMap = new Map<string, TableMetaEntry>();

  // 1. From schemaResolution
  const schemaSources = Array.isArray((state.schemaResolution as any)?.sources)
    ? (state.schemaResolution as any).sources
    : [state.schemaResolution];
  for (const src of schemaSources) {
    if (!src) continue;
    const domain = src.domain || src.domainKnowledge?.tier2;
    if (Array.isArray(src.mappings)) {
      for (const m of src.mappings) {
        const field = m.datasetField || "";
        if (field.includes(".")) {
          const [tbl, col] = field.split(".");
          const existing: TableMetaEntry = metadataMap.get(tbl) || { columns: [], domain };
          if (!existing.columns.some((c) => c.name === col)) {
            existing.columns.push({ name: col, type: m.targetTopic });
          }
          metadataMap.set(tbl, existing);
        }
      }
    }
  }

  // 2. From dataProfile
  const profileSources = Array.isArray((state.dataProfile as any)?.sources)
    ? (state.dataProfile as any).sources
    : [state.dataProfile];
  for (const src of profileSources) {
    if (!src || !Array.isArray(src.tables)) continue;
    for (const tbl of src.tables) {
      const name = tbl.tableName || tbl.name;
      if (!name) continue;
      const existing: TableMetaEntry = metadataMap.get(name) || { columns: [], domain: tbl.businessDomain };
      if (Array.isArray(tbl.contentProfile?.columns)) {
        for (const col of tbl.contentProfile.columns) {
          const colName = col.name;
          if (colName && !existing.columns.some((c) => c.name === colName)) {
            existing.columns.push({ name: colName, type: col.inferredType });
          }
        }
      }
      metadataMap.set(name, existing);
    }
  }

  // 3. From inspection
  const inspectionSources = Array.isArray((state.inspection as any)?.sources)
    ? (state.inspection as any).sources
    : [state.inspection];
  for (const src of inspectionSources) {
    if (!src || !Array.isArray(src.tables)) continue;
    for (const tbl of src.tables) {
      const name = tbl.tableName || tbl.name;
      if (!name) continue;
      const existing: TableMetaEntry = metadataMap.get(name) || { columns: [], domain: tbl.businessDomain || tbl.domain };
      if (Array.isArray(tbl.columns)) {
        for (const col of tbl.columns) {
          const colName = typeof col === "string" ? col : col.name || col.technicalName;
          const colType = typeof col === "object" ? col.dataType : "string";
          if (colName && !existing.columns.some((c) => c.name === colName)) {
            existing.columns.push({ name: colName, type: colType });
          }
        }
      }
      metadataMap.set(name, existing);
    }
  }

  return metadataMap;
}

/**
 * Creates default fallback recommendations for a list of table names
 */
export function createFallbackBatchResult(batchTableNames: string[], tableMetaMap: Map<string, TableMetaEntry>): ExogenousScoutBatchResult {
  return {
    status: "OK",
    summary: `Exogenous scout fallback generated for ${batchTableNames.length} tables`,
    tables: batchTableNames.map((tableName) => {
      const meta = tableMetaMap.get(tableName);
      const cols = meta?.columns || [];
      const hasDateCol = cols.some((c) => /date|time|timestamp|year|month|created|updated/i.test(c.name));
      const hasZipOrGeo = cols.some((c) => /zip|postal|city|state|country|lat|lon|address/i.test(c.name));

      const exogenousSources: ExogenousSourceRecommendation[] = [];

      if (hasDateCol) {
        exogenousSources.push({
          sourceName: "Public Holidays & Calendar Events",
          category: "calendar_events",
          providerOrUrl: "Public Holiday API / Calendar Engine",
          description: "Calendar effects, federal holidays, and trading day markers",
          joinStrategy: {
            datasetField: cols.find((c) => /date|time|created/i.test(c.name))?.name || "date",
            exogenousKey: "date",
            joinType: "temporal",
            frequency: "daily",
          },
          featuresToExtract: ["is_public_holiday", "days_to_next_holiday", "day_of_week_sin", "day_of_week_cos"],
          expectedImpact: "Captures cyclical calendar demand anomalies and seasonality",
          feasibility: "high",
        });

        exogenousSources.push({
          sourceName: "Federal Reserve Macroeconomic Indicators (FRED)",
          category: "macroeconomic",
          providerOrUrl: "FRED API",
          description: "Inflation rates (CPI), interest rates, and consumer sentiment indices",
          joinStrategy: {
            datasetField: cols.find((c) => /date|time|created/i.test(c.name))?.name || "date",
            exogenousKey: "date",
            joinType: "temporal",
            frequency: "monthly",
          },
          featuresToExtract: ["cpi_pct_change", "benchmark_interest_rate"],
          expectedImpact: "Normalizes purchasing power and financial trends over macro time horizons",
          feasibility: "high",
        });
      }

      if (hasZipOrGeo) {
        exogenousSources.push({
          sourceName: "Open-Meteo Weather Data",
          category: "weather",
          providerOrUrl: "Open-Meteo Historical Weather API",
          description: "Regional temperature anomalies, precipitation, and extreme weather events",
          joinStrategy: {
            datasetField: cols.find((c) => /zip|city|state|postal/i.test(c.name))?.name || "location",
            exogenousKey: "location",
            joinType: "geospatial",
            frequency: "daily",
          },
          featuresToExtract: ["mean_temperature_c", "precipitation_mm", "extreme_weather_flag"],
          expectedImpact: "Accounts for localized weather disruptions and seasonal climate factors",
          feasibility: "high",
        });
      }

      return {
        tableName,
        domain: meta?.domain || "General Business Domain",
        summary: `Standard exogenous indicators recommended for ${tableName}`,
        exogenousSources: exogenousSources.length > 0 ? exogenousSources : [
          {
            sourceName: "Domain Benchmark & Economic Indices",
            category: "industry_benchmark",
            providerOrUrl: "Public Economic & Benchmark Portals",
            description: "Sector-specific activity indicators and standard baseline metrics",
            joinStrategy: {
              datasetField: cols[0]?.name || "id",
              exogenousKey: "entity_id",
              joinType: "categorical_key",
              frequency: "monthly",
            },
            featuresToExtract: ["industry_index_trend", "macro_volatility_score"],
            expectedImpact: "Provides contextual benchmark baseline against industry trends",
            feasibility: "medium",
          },
        ],
        featureOpportunities: [
          "Rolling 7-day, 30-day, and 90-day moving averages on key metrics",
          "Interaction terms between internal amounts and exogenous indices",
        ],
      };
    }),
    searchQueriesExecuted: [],
  };
}
