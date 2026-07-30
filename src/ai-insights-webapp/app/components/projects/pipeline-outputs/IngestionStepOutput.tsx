"use client";

import React, { useState } from "react";
import { Badge, DataTypeIcon, SectionHeader, DynamicTable } from "./utils";

interface IngestionStepOutputProps {
  inspectOutput: any;
}

export default function IngestionStepOutput({ inspectOutput }: IngestionStepOutputProps) {
  const [expandedTableKey, setExpandedTableKey] = useState<string | null>(null);

  const rawSources = inspectOutput?.sources;
  const sources = Array.isArray(rawSources)
    ? rawSources
    : inspectOutput?.tables
      ? [{ connectorName: "Ingested Database", tables: inspectOutput.tables }]
      : [];

  if (sources.length === 0) {
    return (
      <div className="p-6 text-center border border-dashed border-border bg-surface-muted/20 select-none">
        <span className="text-xl block mb-1">🔍</span>
        <p className="text-xs text-muted-foreground">No ingestion details found in payload.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 select-none">
      {sources.map((src: any, srcIdx: number) => {
        const srcName = src.connectorName || src.connectorId || `Data Connector #${srcIdx + 1}`;
        const schemaType = src.schemaType || "database";
        const tables = Array.isArray(src.tables) ? src.tables : [];

        return (
          <div key={srcIdx} className="space-y-4">
            {/* Connector Banner */}
            <div className="p-4 border border-border bg-surface-muted/30 flex items-center justify-between">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-500 block mb-0.5">Data Ingestion Source</span>
                <span className="text-sm font-extrabold text-foreground">{srcName}</span>
              </div>
              <div className="flex gap-2">
                <Badge variant="primary" className="capitalize">{schemaType}</Badge>
                <Badge variant="neutral">{tables.length} table{tables.length === 1 ? "" : "s"}</Badge>
              </div>
            </div>

            {/* Tables List */}
            <div className="space-y-4">
              {tables.map((table: any, tIdx: number) => {
                const tableName = table.name || table.tableName || `table_${tIdx}`;
                const columns = Array.isArray(table.columns) ? table.columns : [];
                const tableKey = `${srcIdx}-${tableName}`;
                const isExpanded = expandedTableKey === tableKey;

                // Extract table metadata
                const businessDomain = table.businessDomain;
                const domainConfidence = table.domainConfidence;
                const businessPurpose = table.businessPurpose;
                const summary = table.summary;
                const rels = table.relationships || { explicit: [], inferred: [] };
                const hasRels = (rels.explicit && rels.explicit.length > 0) || (rels.inferred && rels.inferred.length > 0);

                return (
                  <div key={tableKey} className="border border-border bg-surface/50 overflow-hidden shadow-soft transition-all">
                    {/* Table Header Button */}
                    <button
                      onClick={() => setExpandedTableKey(isExpanded ? null : tableKey)}
                      className="w-full text-left px-5 py-3.5 flex items-center justify-between hover:bg-surface-muted/40 transition-colors focus:outline-none cursor-pointer"
                    >
                      <div className="flex items-center gap-3">
                        <span className="w-7 h-7 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-500 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-900/40 flex items-center justify-center font-bold text-xs">
                          📊
                        </span>
                        <div>
                          <h4 className="text-xs font-bold text-foreground font-mono select-all">{tableName}</h4>
                          <div className="flex items-center gap-1.5 mt-0.5 select-none">
                            {businessDomain && <Badge variant="teal" className="text-[9px] py-0">{businessDomain}</Badge>}
                            <span className="text-[10px] text-muted-foreground font-medium">{columns.length} columns identified</span>
                          </div>
                        </div>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {isExpanded ? "Collapse ▲" : "Inspect ▼"}
                      </span>
                    </button>

                    {/* Table Details */}
                    {isExpanded && (
                      <div className="px-5 pb-5 pt-2 border-t border-border/40 space-y-5 select-text">
                        {/* Summary & Domain Purpose */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {summary && (
                            <div className="p-3 bg-surface-muted/40 border border-border/65 space-y-1">
                              <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">AI Table Summary</span>
                              <p className="text-xs text-foreground/90 leading-relaxed font-medium">{summary}</p>
                            </div>
                          )}
                          {(businessPurpose || businessDomain) && (
                            <div className="p-3 bg-surface-muted/40 border border-border/65 space-y-2">
                              <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground block">Business Domain & Purpose</span>
                              {businessPurpose && <p className="text-xs text-foreground/90 leading-relaxed font-medium">{businessPurpose}</p>}
                              {domainConfidence && (
                                <div className="flex items-center gap-1">
                                  <span className="text-[10px] text-muted-foreground font-medium">Domain Confidence:</span>
                                  <Badge variant={domainConfidence === "HIGH" ? "success" : domainConfidence === "MEDIUM" ? "warning" : "error"}>
                                    {domainConfidence}
                                  </Badge>
                                </div>
                              )}
                            </div>
                          )}
                        </div>

                        {/* Relationships */}
                        {hasRels && (
                          <div className="p-3 bg-indigo-500/[0.02] border border-indigo-500/10 space-y-2">
                            <span className="text-[9px] font-bold uppercase tracking-wider text-indigo-500 block">Relationships</span>
                            <div className="space-y-1 text-xs">
                              {rels.explicit && rels.explicit.map((r: any, rIdx: number) => (
                                <div key={rIdx} className="flex items-center gap-2 text-foreground font-medium">
                                  <span className="px-1.5 py-0.5 bg-emerald-50 dark:bg-emerald-950/20 text-emerald-600 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-900nt-bold text-[9px]">Explicit</span>
                                  <span>{r.from} ➔ {r.to}</span>
                                </div>
                              ))}
                              {rels.inferred && rels.inferred.map((r: any, rIdx: number) => (
                                <div key={rIdx} className="flex items-center gap-2 text-foreground font-medium">
                                  <span className="px-1.5 py-0.5 bg-purple-50 dark:bg-purple-950/20 text-purple-600 dark:text-purple-400 border border-purple-100 dark:border-purple-900nt-bold text-[9px]">Inferred</span>
                                  <span>{r.from} ➔ {r.to}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Columns Detail Inspector */}
                        <div className="space-y-2">
                          <SectionHeader title="Column Schema & Semantics" subtitle="Review discovered column meanings and confidence scores" />
                          <DynamicTable data={columns} />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
