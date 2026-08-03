"use client";

import React, { useEffect, useState } from "react";
import { Badge, DataTypeIcon, SectionHeader, DynamicTable } from "./utils";

interface IngestionStepOutputProps {
  inspectOutput: any;
}

export default function IngestionStepOutput({ inspectOutput }: IngestionStepOutputProps) {
  const [selectedSourceIndex, setSelectedSourceIndex] = useState(0);
  const [selectedTableKey, setSelectedTableKey] = useState<string | null>(null);
  const [isSchemaOpen, setIsSchemaOpen] = useState(true);

  const rawSources = inspectOutput?.sources;
  const sources = Array.isArray(rawSources)
    ? rawSources
    : inspectOutput?.tables
      ? [{ connectorName: "Ingested Database", tables: inspectOutput.tables }]
      : [];

  const selectedSource = sources[selectedSourceIndex] || sources[0] || null;
  const tables = Array.isArray(selectedSource?.tables) ? selectedSource.tables : [];

  useEffect(() => {
    if (!sources[selectedSourceIndex] && sources.length > 0) {
      setSelectedSourceIndex(0);
      return;
    }

    if (tables.length > 0) {
      const firstTableName = tables[0].name || tables[0].tableName || "table_0";
      setSelectedTableKey(`${selectedSourceIndex}-${firstTableName}`);
    } else {
      setSelectedTableKey(null);
    }
  }, [selectedSourceIndex, sources, tables.length]);

  useEffect(() => {
    setIsSchemaOpen(false);
  }, [selectedTableKey]);

  if (sources.length === 0) {
    return (
      <div className="p-6 text-center border border-dashed border-border bg-surface-muted/20 select-none">
        <span className="text-xl block mb-1">🔍</span>
        <p className="text-xs text-muted-foreground">No ingestion details found in payload.</p>
      </div>
    );
  }

  const srcName = selectedSource?.connectorName || selectedSource?.connectorId || `Data Connector #${selectedSourceIndex + 1}`;
  const schemaType = selectedSource?.schemaType || "database";
  const tableCount = tables.length;

  const selectedTable = tables.find((table: any, tIdx: number) => {
    const tableName = table.name || table.tableName || `table_${tIdx}`;
    return `${selectedSourceIndex}-${tableName}` === selectedTableKey;
  });

  const selectedTableName = selectedTable?.name || selectedTable?.tableName || null;

  return (
    <div className="space-y-6 select-none">
      <div className="p-4 border border-border bg-surface-muted/30">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-500 block mb-0.5">Data Ingestion Source</span>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              {sources.length > 1 ? (
                <label className="flex flex-col gap-1 text-sm font-medium text-foreground">
                  <span className="text-xs uppercase text-muted-foreground tracking-wide">Select source</span>
                  <select
                    value={selectedSourceIndex}
                    onChange={(event) => setSelectedSourceIndex(Number(event.target.value))}
                    className="rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-indigo-500 focus:ring-indigo-500"
                  >
                    {sources.map((src: any, srcIdx: number) => {
                      const name = src.connectorName || src.connectorId || `Data Connector #${srcIdx + 1}`;
                      return (
                        <option key={srcIdx} value={srcIdx}>
                          {name}
                        </option>
                      );
                    })}
                  </select>
                </label>
              ) : (
                <span className="text-sm font-extrabold text-foreground">{srcName}</span>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-2 mt-3 md:mt-0">
            <Badge variant="primary" className="capitalize">{schemaType}</Badge>
            <Badge variant="neutral">{tableCount} table{tableCount === 1 ? "" : "s"}</Badge>
          </div>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-[200px_1px_minmax(0,1fr)]">
        <aside className="space-y-4 bg-surface/60">
          <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Tables</div>
          {tables.length === 0 ? (
            <div className="rounded-md border border-dashed border-border/60 bg-surface-muted/50 p-4 text-xs text-muted-foreground">
              No tables available for this source.
            </div>
          ) : (
            <div className="space-y-2">
              {tables.map((table: any, tIdx: number) => {
                const tableName = table.name || table.tableName || `table_${tIdx}`;
                const tableKey = `${selectedSourceIndex}-${tableName}`;
                const isSelected = tableKey === selectedTableKey;

                return (
                  <button
                    key={tableKey}
                    type="button"
                    onClick={() => setSelectedTableKey(tableKey)}
                    className={`w-full rounded-lg border px-4 py-3 text-left transition ${isSelected ? "border-indigo-500 bg-indigo-500/10" : "border-border bg-surface/50 hover:border-indigo-300 hover:bg-surface-muted/60"}`}
                  >
                    <div className="text-xs font-semibold text-foreground">{tableName}</div>
                    <div className="mt-1 text-[10px] text-muted-foreground">
                      {Array.isArray(table.columns) ? table.columns.length : 0} columns
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </aside>
        <div className="border border-border"></div>
        <section className="bg-surface/60">
          {selectedTable ? (
            <div className="space-y-5">
              {/* <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Table details</div>
                  <h3 className="mt-2 text-sm font-extrabold text-foreground">{selectedTableName}</h3>
                </div>
                <span className="rounded-full border border-border px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {Array.isArray(selectedTable.columns) ? selectedTable.columns.length : 0} columns
                </span>
              </div> */}

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {selectedTable.summary && (
                  <div className="rounded-lg border border-border/70 bg-surface-muted/40 p-4">
                    <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">AI Table Summary</span>
                    <p className="mt-2 text-xs leading-relaxed text-foreground/90">{selectedTable.summary}</p>
                  </div>
                )}

                {(selectedTable.businessPurpose || selectedTable.businessDomain || selectedTable.domainConfidence) && (
                  <div className="rounded-lg border border-border/70 bg-surface-muted/40 p-4 space-y-3">
                    <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground block">Business Domain & Purpose</span>
                    {selectedTable.businessPurpose && <p className="text-xs leading-relaxed text-foreground/90">{selectedTable.businessPurpose}</p>}
                    {selectedTable.businessDomain && <Badge variant="teal" className="text-[9px] py-0">{selectedTable.businessDomain}</Badge>}
                    {selectedTable.domainConfidence && (
                      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                        <span className="font-medium">Domain Confidence:</span>
                        <Badge variant={selectedTable.domainConfidence === "HIGH" ? "success" : selectedTable.domainConfidence === "MEDIUM" ? "warning" : "error"}>
                          {selectedTable.domainConfidence}
                        </Badge>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {((selectedTable.relationships?.explicit?.length ?? 0) > 0 || (selectedTable.relationships?.inferred?.length ?? 0) > 0) && (
                <div className="rounded-lg border border-indigo-500/10 bg-indigo-500/[0.02] p-4 space-y-3">
                  <span className="text-[9px] font-bold uppercase tracking-wider text-indigo-500 block">Relationships</span>
                  <div className="space-y-2 text-xs">
                    {(selectedTable.relationships?.explicit ?? []).map((r: any, rIdx: number) => (
                      <div key={`explicit-${rIdx}`} className="flex items-center gap-2 text-foreground font-medium">
                        <span className="rounded px-2 py-0.5 bg-emerald-50 text-emerald-600 border border-emerald-100 text-[9px]">Explicit</span>
                        <span>{r.from} ➔ {r.to}</span>
                      </div>
                    ))}
                    {(selectedTable.relationships?.inferred ?? []).map((r: any, rIdx: number) => (
                      <div key={`inferred-${rIdx}`} className="flex items-center gap-2 text-foreground font-medium">
                        <span className="rounded px-2 py-0.5 bg-purple-50 text-purple-600 border border-purple-100 text-[9px]">Inferred</span>
                        <span>{r.from} ➔ {r.to}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => setIsSchemaOpen((prev) => !prev)}
                  className="flex w-full items-center justify-between text-left text-sm font-semibold text-foreground"
                >
                  <div>
                    <SectionHeader title="Column Schema & Semantics" subtitle="Review discovered column meanings and confidence scores" />
                  </div>
                  <span className="text-[10px] text-muted-foreground">
                    {isSchemaOpen ? "Hide details ▲" : "Show details ▼"}
                  </span>
                </button>
                {isSchemaOpen && (
                  <DynamicTable data={Array.isArray(selectedTable.columns) ? selectedTable.columns : []} />
                )}
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-border/60 bg-surface-muted/50 p-6 text-center text-xs text-muted-foreground">
              Select a table from the sidebar to view its details.
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
