"use client";

import React, { useState, useEffect } from "react";
import { DataSource } from "../providers/AppContext";

interface DataPreviewGridProps {
  source: DataSource;
}

interface TableInfo {
  id: string;
  name: string;
  type: string;
  rows: number;
}

const BACKEND_BASE = "http://localhost:4000/api/connectors";

const API_PREVIEW_DATA = {
  status: "success",
  results_count: 3,
  data: [
    { id: 1, endpoint: "users", calls_per_minute: 340, error_rate: "0.12%" },
    { id: 2, endpoint: "checkout", calls_per_minute: 95, error_rate: "0.00%" },
    { id: 3, endpoint: "inventory", calls_per_minute: 150, error_rate: "0.45%" }
  ],
  metadata: {
    cached: true,
    execution_time_ms: 12,
    rate_limit_reset: "2026-07-06T18:00:00Z"
  }
};

export default function DataPreviewGrid({ source }: DataPreviewGridProps) {
  const [tablesList, setTablesList] = useState<TableInfo[]>([]);
  const [selectedTableId, setSelectedTableId] = useState<string>("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<any[]>([]);
  
  const [loadingSchema, setLoadingSchema] = useState(true);
  const [loadingData, setLoadingData] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const isFile = ["excel", "csv", "tsv"].includes(source.type);
  const isApi = source.type === "restapi";

  // 1. Fetch tables / schema list on mount or source change
  useEffect(() => {
    async function fetchSchema() {
      setLoadingSchema(true);
      setErrorMsg(null);
      try {
        const res = await fetch(`${BACKEND_BASE}/${source.id}/schema`);
        if (res.ok) {
          const payload = await res.json();
          if (payload.success) {
            setTablesList(payload.tables || []);
            if (payload.tables && payload.tables.length > 0) {
              setSelectedTableId(payload.tables[0].id);
            }
          } else {
            setErrorMsg(payload.message || "Failed to load schema list");
          }
        } else {
          setErrorMsg("Could not fetch schema list from backend API");
        }
      } catch (err: any) {
        setErrorMsg(err.message || "Network error loading schema");
      } finally {
        setLoadingSchema(false);
      }
    }
    fetchSchema();
  }, [source.id]);

  // 2. Fetch rows / preview data when selection changes
  useEffect(() => {
    if (!selectedTableId && !isFile && !isApi) return;

    async function fetchPreview() {
      setLoadingData(true);
      try {
        const url = isFile || isApi
          ? `${BACKEND_BASE}/${source.id}/preview`
          : `${BACKEND_BASE}/${source.id}/preview?table=${encodeURIComponent(selectedTableId)}`;

        const res = await fetch(url);
        if (res.ok) {
          const payload = await res.json();
          if (payload.success) {
            setHeaders(payload.headers || []);
            setRows(payload.rows || []);
          } else {
            setErrorMsg(payload.message || "Failed to load table preview");
          }
        }
      } catch (err: any) {
        console.error(err);
      } finally {
        setLoadingData(false);
      }
    }
    fetchPreview();
  }, [source.id, selectedTableId, isFile, isApi]);

  if (loadingSchema) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-3 text-sm text-primary">
        <svg className="animate-spin h-6 w-6" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25" />
          <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
        <span>Loading schema assets metadata...</span>
      </div>
    );
  }

  if (errorMsg && tablesList.length === 0) {
    return (
      <div className="rounded-lg bg-red-500/10 p-4 border border-red-500/20 text-xs font-semibold text-red-500 text-center">
        {errorMsg}
      </div>
    );
  }

  // 3. Render Excel / CSV / TSV Layout
  if (isFile) {
    const activeTable = tablesList[0];
    return (
      <div className="flex flex-col gap-4 h-full">
        <div className="flex items-center justify-between bg-surface-muted/60 border border-border/50 rounded-xl px-4 py-3 text-xs font-semibold text-muted-foreground">
          <div>
            File Name: <span className="text-foreground font-bold">{source.subtext}</span>
          </div>
          <div>
            Total Row Count: <span className="text-foreground font-bold">50,000 rows (Previewing top 5)</span>
          </div>
        </div>

        {loadingData ? (
          <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">Loading preview...</div>
        ) : (
          <div className="flex-1 overflow-auto border border-border/80 rounded-xl max-h-[350px] bg-surface-muted/20">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="bg-surface-muted sticky top-0 border-b border-border z-10">
                <tr>
                  {headers.map((h, i) => (
                    <th key={i} className="p-3 font-bold uppercase tracking-wider text-muted-foreground whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60 bg-surface">
                {rows.length > 0 ? (
                  rows.map((row, rIdx) => (
                    <tr key={rIdx} className="hover:bg-surface-muted/40 transition-colors">
                      {headers.map((h, cIdx) => (
                        <td key={cIdx} className="p-3 text-foreground font-medium whitespace-nowrap">
                          {row[h] !== undefined ? String(row[h]) : "—"}
                        </td>
                      ))}
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={headers.length || 1} className="p-8 text-center text-muted-foreground">
                      No rows found in file.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  // 4. Render REST API layout
  if (isApi) {
    return (
      <div className="flex flex-col gap-4 h-full">
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-surface-muted/50 p-2.5 rounded-xl border border-border/40 text-center">
            <span className="block text-[9px] font-bold text-muted-foreground uppercase">Response Type</span>
            <span className="text-xs font-bold text-green-500 mt-0.5 inline-block">JSON Payload</span>
          </div>
          <div className="bg-surface-muted/50 p-2.5 rounded-xl border border-border/40 text-center">
            <span className="block text-[9px] font-bold text-muted-foreground uppercase">Status</span>
            <span className="text-xs font-bold text-foreground mt-0.5 inline-block">200 OK</span>
          </div>
          <div className="bg-surface-muted/50 p-2.5 rounded-xl border border-border/40 text-center">
            <span className="block text-[9px] font-bold text-muted-foreground uppercase">API Size</span>
            <span className="text-xs font-bold text-foreground mt-0.5 inline-block">240 Bytes</span>
          </div>
        </div>

        <div className="border border-border/80 rounded-xl bg-[#0f172a] text-xs font-mono p-4 overflow-auto max-h-[250px]">
          <pre className="text-blue-400 select-all">
            {JSON.stringify(API_PREVIEW_DATA, null, 2)}
          </pre>
        </div>
      </div>
    );
  }

  // 5. Render SQL Database split layout
  const activeTableId = selectedTableId || (tablesList[0]?.id || "");

  return (
    <div className="grid grid-cols-1 md:grid-cols-12 gap-5 h-full items-stretch">
      {/* Tables sidebar list (4 columns width) */}
      <div className="md:col-span-4 border border-border/80 rounded-xl bg-surface-muted/40 p-3 flex flex-col gap-2 max-h-[350px] overflow-y-auto">
        <h5 className="font-bold text-muted-foreground uppercase text-[9px] tracking-wider px-1.5 mb-1.5">
          Catalogs Discovered ({tablesList.length})
        </h5>
        {tablesList.length > 0 ? (
          <div className="space-y-1">
            {tablesList.map((tbl) => {
              const isActive = activeTableId === tbl.id;
              return (
                <button
                  key={tbl.id}
                  onClick={() => setSelectedTableId(tbl.id)}
                  className={`w-full text-left p-2 rounded-lg text-xs transition-all flex items-center justify-between cursor-pointer ${
                    isActive
                      ? "bg-surface text-primary border border-border/50 font-bold shadow-sm"
                      : "text-foreground hover:bg-surface/50"
                  }`}
                >
                  <div className="flex items-center gap-2 overflow-hidden text-ellipsis">
                    <svg
                      className={`w-3.5 h-3.5 shrink-0 ${isActive ? "text-primary" : "text-muted-foreground"}`}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z"
                      />
                    </svg>
                    <span className="truncate">{tbl.name}</span>
                  </div>
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-surface-muted border border-border/20 text-muted-foreground font-mono shrink-0">
                    {tbl.rows} rows
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="py-6 text-center text-xs text-muted-foreground">No schema elements found.</div>
        )}
      </div>

      {/* Grid Display table (8 columns width) */}
      <div className="md:col-span-8 flex flex-col gap-3">
        <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground bg-surface-muted/40 p-2.5 rounded-lg border border-border/40">
          <span>
            Table: <span className="text-foreground font-bold">{activeTableId}</span>
          </span>
          <span className="font-mono text-[10px]">
            Previewing live rows
          </span>
        </div>

        {loadingData ? (
          <div className="flex-1 flex items-center justify-center border border-border/80 rounded-xl bg-surface-muted/5 py-12 text-xs text-muted-foreground">
            Querying target database...
          </div>
        ) : (
          <div className="flex-1 overflow-auto border border-border/80 rounded-xl bg-surface-muted/10 max-h-[300px]">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="bg-surface-muted sticky top-0 border-b border-border z-10">
                <tr>
                  {headers.map((h, idx) => (
                    <th key={idx} className="p-3 font-bold uppercase tracking-wider text-muted-foreground whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60 bg-surface">
                {rows.length > 0 ? (
                  rows.map((row, rIdx) => (
                    <tr key={rIdx} className="hover:bg-surface-muted/40 transition-colors">
                      {headers.map((h, cIdx) => {
                        const val = row[h];
                        const isStatus = val === "Active" || val === "Suspended" || val === "Inactive" || val === "Paid" || val === "Pending" || val === "Overdue" || val === "Draft" || val === "Success";
                        return (
                          <td key={cIdx} className="p-3 text-foreground font-medium whitespace-nowrap">
                            {isStatus ? (
                              <span
                                className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                  ["Active", "Paid", "Success"].includes(val)
                                    ? "bg-green-500/10 text-green-500"
                                    : ["Suspended", "Overdue"].includes(val)
                                    ? "bg-red-500/10 text-red-500"
                                    : "bg-gray-500/10 text-gray-500"
                                }`}
                              >
                                {val}
                              </span>
                            ) : (
                              val !== null && val !== undefined ? String(val) : "—"
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={headers.length || 1} className="p-8 text-center text-muted-foreground">
                      {activeTableId ? "No data rows returned from table." : "Select a table to preview data."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
