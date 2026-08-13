"use client";

import React, { useState } from "react";
import { Badge, SectionHeader } from "./utils";

interface Recommendation {
  variableName?: string;
  name?: string;
  category?: string;
  predictivePower?: "HIGH" | "MEDIUM" | "LOW" | string;
  rationale?: string;
  sourceUrl?: string;
  sourceType?: string;
  granularity?: string;
}

interface TableExogenous {
  tableName?: string;
  name?: string;
  summary?: string;
  recommendations?: Recommendation[];
}

interface ExogenousScoutOutputProps {
  exogenousScout: any;
}

export default function ExogenousScoutStepOutput({ exogenousScout }: ExogenousScoutOutputProps) {
  const [selectedTableIndex, setSelectedTableIndex] = useState(0);

  const payload = exogenousScout?.exogenousScout || exogenousScout;
  const tables: TableExogenous[] = Array.isArray(payload?.tables)
    ? payload.tables
    : Array.isArray(payload)
      ? payload
      : [];

  const searchQueries: string[] = Array.isArray(payload?.searchQueriesExecuted)
    ? payload.searchQueriesExecuted
    : [];

  const summaryText = typeof payload?.summary === "string"
    ? payload.summary
    : "Exogenous data scout agent executed successfully.";

  if (tables.length === 0) {
    return (
      <div className="p-6 text-center border border-dashed border-border bg-surface-muted/20 select-none">
        <span className="text-xl block mb-1">🌐</span>
        <p className="text-xs text-muted-foreground">No exogenous data scout findings in payload.</p>
      </div>
    );
  }

  const selectedTable = tables[selectedTableIndex] || tables[0];
  const recommendations = Array.isArray(selectedTable?.recommendations) ? selectedTable.recommendations : [];

  const getPowerVariant = (power?: string) => {
    const norm = (power || "").toUpperCase();
    if (norm === "HIGH") return "success";
    if (norm === "MEDIUM") return "warning";
    if (norm === "LOW") return "primary";
    return "neutral";
  };

  return (
    <div className="space-y-6 select-none">
      {/* Execution Success Banner */}
      <div className="p-4 bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-100 dark:border-indigo-900/60 text-xs text-indigo-900 dark:text-indigo-300 flex items-start gap-3 shadow-sm font-semibold select-none rounded-lg">
        <span className="text-base leading-none">🌐</span>
        <div>
          <strong className="block text-indigo-950 dark:text-indigo-300 font-extrabold text-sm">
            Exogenous Scout Analysis Completed
          </strong>
          <p className="text-indigo-700/90 dark:text-indigo-300/80 mt-0.5 font-normal">
            {summaryText}
          </p>
        </div>
      </div>

      {/* Executed Search Queries Pill Bar */}
      {searchQueries.length > 0 && (
        <div className="p-4 border border-border bg-surface/50 rounded-lg space-y-2 select-text">
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block">
            Web & Signal Queries Executed ({searchQueries.length})
          </span>
          <div className="flex flex-wrap gap-1.5">
            {searchQueries.map((q, idx) => (
              <span
                key={idx}
                className="px-2.5 py-1 bg-surface-muted border border-border text-[11px] font-mono font-medium text-foreground rounded-md"
              >
                🔍 {q}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Tables & Recommendations Detail Panel */}
      <div className="space-y-4">
        {/* Table Selector */}
        {tables.length > 1 && (
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-muted-foreground uppercase">Target Table:</span>
            <select
              value={selectedTableIndex}
              onChange={(e) => setSelectedTableIndex(Number(e.target.value))}
              className="rounded-md border border-border bg-background px-3 py-1.5 text-xs font-bold text-foreground focus:border-indigo-500 focus:ring-indigo-500"
            >
              {tables.map((t, idx) => (
                <option key={idx} value={idx}>
                  {t.tableName || t.name || `Table #${idx + 1}`}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="border border-border bg-surface/60 p-5 space-y-5 rounded-lg select-text">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-border/40 pb-3 gap-2">
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-500 block mb-0.5">
                Internal Table
              </span>
              <h3 className="text-sm font-black text-foreground">
                {selectedTable.tableName || selectedTable.name || "Default Table"}
              </h3>
            </div>
            <Badge variant="purple">
              {recommendations.length} Exogenous Candidate{recommendations.length === 1 ? "" : "s"}
            </Badge>
          </div>

          {selectedTable.summary && (
            <div className="p-3.5 bg-surface-muted/40 border border-border/60 rounded-md text-xs text-foreground/90 leading-relaxed font-normal">
              <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground block mb-1">
                Domain Analysis Summary
              </span>
              {selectedTable.summary}
            </div>
          )}

          {/* Recommendations Cards List */}
          <div className="space-y-3">
            <SectionHeader
              title="Recommended Exogenous Variables"
              subtitle="Ranked external datasets and signals discovered via live agent search"
              badgeText={`${recommendations.length} Signals`}
            />

            {recommendations.length === 0 ? (
              <div className="p-4 border border-dashed border-border text-center text-xs text-muted-foreground">
                No external signals recommended for this table.
              </div>
            ) : (
              <div className="grid gap-3">
                {recommendations.map((rec, rIdx) => {
                  const varName = rec.variableName || rec.name || `Variable #${rIdx + 1}`;
                  const category = rec.category || "External Signal";
                  const power = rec.predictivePower || "MEDIUM";
                  const rationale = rec.rationale || "No rationale provided";
                  const sourceType = rec.sourceType || "API / Web Dataset";
                  const granularity = rec.granularity || "Periodic";
                  const url = rec.sourceUrl;

                  return (
                    <div
                      key={rIdx}
                      className="p-4 border border-border/80 bg-background/80 hover:border-indigo-500/50 transition-all rounded-lg space-y-2.5 shadow-sm"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/30 pb-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-extrabold text-foreground">{varName}</span>
                          <span className="px-2 py-0.5 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20 text-[10px] font-bold rounded">
                            {category}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-muted-foreground uppercase font-semibold">Predictive Power:</span>
                          <Badge variant={getPowerVariant(power)}>{power}</Badge>
                        </div>
                      </div>

                      <p className="text-xs text-foreground/85 leading-relaxed font-normal">{rationale}</p>

                      <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-[11px] text-muted-foreground">
                        <div className="flex items-center gap-3 flex-wrap">
                          <span>
                            <strong>Source Type:</strong> {sourceType}
                          </span>
                          <span>
                            <strong>Granularity:</strong> {granularity}
                          </span>
                        </div>
                        {url && (
                          <a
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-500 dark:text-indigo-400 hover:underline"
                          >
                            <span>View Data Source</span>
                            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5">
                              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                              <polyline points="15 3 21 3 21 9" />
                              <line x1="10" y1="14" x2="21" y2="3" />
                            </svg>
                          </a>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
