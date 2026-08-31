"use client";

import React, { useState, useEffect } from "react";
import { Badge, DynamicTable } from "./utils";

interface ProfilingStepOutputProps {
  profileData: any;
  preprocess?: any;
}

type TabType = "quality" | "statistics";

export default function ProfilingStepOutput({ profileData }: ProfilingStepOutputProps) {
  const [activeTabs, setActiveTabs] = useState<Record<string, TabType>>({});
  const [selectedSourceIndex, setSelectedSourceIndex] = useState(0);
  const [selectedTableKey, setSelectedTableKey] = useState<string | null>(null);
  const [isSchemaOpen, setIsSchemaOpen] = useState(true);

  // 1. Build sources array similar to ingestion output
  const rawSources = profileData?.sources;
  const sources = Array.isArray(rawSources)
    ? rawSources
    : Array.isArray(profileData?.profile?.tables)
      ? [{ connectorName: "Profile Result", tables: profileData.profile.tables }]
      : [];

  if (sources.length === 0) {
    return (
      <div className="p-6 text-center border border-dashed border-border bg-surface-muted/20 select-none">
        <span className="text-xl block mb-1">📊</span>
        <p className="text-xs text-muted-foreground">No profiling results found in payload.</p>
      </div>
    );
  }

  const selectedSource = sources[selectedSourceIndex] || sources[0] || null;
  const tables = Array.isArray(selectedSource?.tables) ? selectedSource.tables : [];

  useEffect(() => {
    if (!sources[selectedSourceIndex] && sources.length > 0) {
      setSelectedSourceIndex(0);
      return;
    }

    if (tables.length > 0) {
      const firstTableName = tables[0].tableName || tables[0].name || `table_0`;
      setSelectedTableKey(`${selectedSourceIndex}-${firstTableName}`);
    } else {
      setSelectedTableKey(null);
    }
  }, [selectedSourceIndex, sources, tables.length]);

  useEffect(() => {
    setIsSchemaOpen(false);
  }, [selectedTableKey]);

  // Get active tab for a specific table
  const getActiveTab = (tableKey: string): TabType => {
    return activeTabs[tableKey] || "quality";
  };

  const setActiveTab = (tableKey: string, tab: TabType) => {
    setActiveTabs((prev) => ({ ...prev, [tableKey]: tab }));
  };

  const selectedTable = tables.find((table: any, tIdx: number) => {
    const tableName = table.tableName || table.name || `table_${tIdx}`;
    return `${selectedSourceIndex}-${tableName}` === selectedTableKey;
  });

  const srcName = selectedSource?.connectorName || selectedSource?.connectorId || `Profile Source #${selectedSourceIndex + 1}`;
  const tableCount = tables.length;

  return (
    <div className="space-y-8 select-none">
      <div className="p-4 border border-border bg-surface-muted/30">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-base font-bold text-foreground">{srcName}</span>
              <Badge variant="primary">{tableCount} {tableCount === 1 ? "table" : "tables"}</Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Comprehensive statistical and structural data profiling results
            </p>
          </div>

          {sources.length > 1 && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground font-medium">Source:</span>
              <div className="flex border border-border/80 bg-surface p-0.5 text-xs font-semibold">
                {sources.map((src: any, idx: number) => {
                  const name = src.connectorName || src.connectorId || `Source ${idx + 1}`;
                  return (
                    <button
                      key={idx}
                      onClick={() => setSelectedSourceIndex(idx)}
                      className={`px-3 py-1 cursor-pointer transition-colors ${
                        selectedSourceIndex === idx
                          ? "bg-surface-muted text-foreground font-bold shadow-xs"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 items-start">
        {/* Left Column: Sidebar / Table Selector */}
        <aside className="lg:col-span-1 space-y-4">
          <div className="border border-border/80 bg-surface p-3 space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-border/60">
              <span className="text-[11px] font-black uppercase tracking-wider text-muted-foreground">
                Profiled Tables
              </span>
              <span className="text-[10px] font-mono font-bold text-muted-foreground">
                {tables.length} Total
              </span>
            </div>

            <div className="space-y-1 max-h-[460px] overflow-y-auto pr-1">
              {tables.map((table: any, idx: number) => {
                const tableName = table.tableName || table.name || `Table ${idx + 1}`;
                const key = `${selectedSourceIndex}-${tableName}`;
                const isSelected = selectedTableKey === key;
                const rowCount = table.totalRowCount || 0;
                const columnCount = Array.isArray(table.columns) ? table.columns.length : 0;

                return (
                  <button
                    key={key}
                    onClick={() => setSelectedTableKey(key)}
                    className={`w-full text-left p-2.5 transition-all flex flex-col gap-1 cursor-pointer border ${
                      isSelected
                        ? "bg-foreground/5 border-foreground/30 text-foreground font-semibold shadow-xs"
                        : "border-transparent hover:bg-surface-muted/60 text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <div className="flex items-center justify-between w-full">
                      <span className="text-xs font-mono font-bold truncate max-w-[140px]">
                        {tableName}
                      </span>
                      {table.businessDomain && (
                        <span className="text-[9px] px-1 py-0.5 bg-surface-muted border border-border/60 text-muted-foreground font-medium truncate max-w-[70px]">
                          {table.businessDomain}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground font-mono">
                      <span>{rowCount.toLocaleString()} rows</span>
                      <span>•</span>
                      <span>{columnCount} cols</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </aside>

        {/* Right Column: Tabbed Table Details */}
        <section className="lg:col-span-3 space-y-6">
          {selectedTable ? (
            <div className="space-y-6">
              <div className="border border-border/80 bg-surface p-5 space-y-6">
                {(() => {
                  const table = selectedTable;
                  const tableName = table.tableName || table.name || "";
                  const totalRowCount = table.totalRowCount || 0;
                  const businessDomain = table.businessDomain;
                  const columns = table.contentProfile?.columns || table.columns || [];
                  const numericColumns = table.statisticalProfile?.numericColumns || [];
                  const sampling = table.sampling || null;

                  const tableKey = `${selectedSourceIndex}-${tableName}`;
                  const activeTab = getActiveTab(tableKey);

                  return (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <h4 className="text-xs font-black text-foreground font-mono select-all">{tableName}</h4>
                            {businessDomain && <Badge variant="teal">{businessDomain}</Badge>}
                            {totalRowCount > 0 && (
                              <Badge variant="neutral" className="font-mono">{totalRowCount.toLocaleString()} rows</Badge>
                            )}
                          </div>
                          {sampling && (
                            <p className="text-[10px] text-muted-foreground mt-1 select-none font-medium">
                              Sampled via <span className="font-bold font-mono">{sampling.stratifiedMethod || sampling.exploratoryMethod}</span> ({sampling.stratifiedSampleSize || sampling.exploratorySampleSize} rows)
                            </p>
                          )}
                        </div>

                        <div className="flex bg-surface-muted p-0.5 border border-border/80 text-[11px] font-bold select-none shrink-0 self-start md:self-auto">
                          <button
                            onClick={() => setActiveTab(tableKey, "quality")}
                            className={`px-3 py-1 cursor-pointer transition-colors ${
                              activeTab === "quality" ? "bg-surface text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                            }`}
                          >
                            Quality & Fields
                          </button>
                          <button
                            onClick={() => setActiveTab(tableKey, "statistics")}
                            className={`px-3 py-1 cursor-pointer transition-colors ${
                              activeTab === "statistics" ? "bg-surface text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                            }`}
                          >
                            Statistics
                          </button>
                        </div>
                      </div>

                      {activeTab === "quality" && (
                        <div className="space-y-4">
                          <DynamicTable data={columns} />
                        </div>
                      )}

                      {activeTab === "statistics" && (
                        <div className="space-y-4">
                          <DynamicTable data={numericColumns} />
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-border/60 bg-surface-muted/50 p-6 text-center text-xs text-muted-foreground">Select a table from the sidebar to view its details.</div>
          )}
        </section>
      </div>
    </div>
  );
}
