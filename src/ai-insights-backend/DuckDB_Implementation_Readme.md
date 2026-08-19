# DuckDB File-Based Data Source Integration

## Overview

This implementation upgrades the platform's handling of non-database, file-based data sources (CSV, TSV, Excel, and REST API endpoints).

Previously, file-based connectors parsed entire files directly into memory (Node.js V8 heap JavaScript arrays of objects) whenever schema inspection, row counting, sampling, pagination, previewing, or data cleaning was requested. For large datasets, this approach caused severe memory bloat and potential heap overflow crashes (`ERR_STRING_TOO_LONG` / out of memory errors).

With this update:
- **Every non-database data source is loaded into DuckDB storage as a table upon user connection.**
- **All subsequent operations (schema discovery, preview, row count, limit/offset pagination, random/stratified sampling, and data cleaning updates) execute high-performance SQL queries against DuckDB.**
- **Existing API contracts, route endpoints, controller responses, and workflow logic remain 100% unchanged.**

---

## Architecture & Workflow

```
[ User Connects File Source ] 
           │
           ▼
┌───────────────────────────┐
│     ConnectorService      │  --> Persists uploaded file
└─────────────┬─────────────┘
              │ 
              ▼
┌───────────────────────────┐
│       DuckDBService       │  --> Ingests file into DuckDB storage (.duckdb table)
└─────────────┬─────────────┘
              │
              ▼
┌───────────────────────────┐
│ ConnectionTesterService   │  --> Executes SQL queries for preview, schema, counts,
└───────────────────────────┘      sampling, and cleaning operations
```

---

## Technical Details

### 1. Ingestion Engine (`DuckDBService`)
- **CSV & TSV Files**: Ingested via DuckDB's native high-speed SQL loader (`read_csv_auto`), streaming data directly into disk-backed DuckDB database files (`uploads/duckdb/<sanitized_fileName>.duckdb`).
- **Excel Files (`.xlsx`, `.xls`)**: Sheets are parsed into DuckDB tables (`CREATE TABLE "<sheet_name>" AS SELECT ...`) without holding full arrays in JavaScript memory.
- **REST API Endpoints**: Endpoints are structured into DuckDB tables (`api_endpoint`) to provide a uniform query model.

### 2. SQL Query Execution
All file-based operations now leverage standard SQL:
- **Schema Discovery (`getSchema`)**: Queries DuckDB `information_schema.tables` and column definitions.
- **Data Preview (`getPreview`)**: `SELECT * FROM "table" LIMIT 5`
- **Row Count (`getRowCount`)**: `SELECT COUNT(*)::int as count FROM "table"`
- **Slice & Pagination (`getSampleWithOffset`)**: `SELECT * FROM "table" LIMIT limit OFFSET offset`
- **Random Sampling (`getRandomSample`)**: `SELECT * FROM "table" ORDER BY random() LIMIT limit`
- **Stratified Sampling (`getStratifiedSample`)**: Uses SQL window functions (`ROW_NUMBER() OVER (PARTITION BY "col" ORDER BY random())`) for accurate group-based sampling.
- **Data Cleaning (`applyCleaningOperations`)**: Runs standard SQL DDL/DML (`UPDATE`, `ALTER TABLE`, `DROP COLUMN`) directly against DuckDB tables, automatically exporting back to the source file if updated.

---

## Design Principles & Guarantees

1. **Zero Workflow Logic Change**: Controller responses, UI endpoints, and service interface contracts maintain identical JSON structures and method signatures.
2. **Dependency Injection**: `DuckDBService` is defined by the `IDuckDBService` interface and wired in the application composition root (`src/index.ts`).
3. **Memory Optimization**: Large CSV/TSV/Excel files are streamed into DuckDB without reading millions of lines into Node.js V8 JS heap memory.
