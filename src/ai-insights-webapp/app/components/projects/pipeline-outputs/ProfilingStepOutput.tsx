"use client";

import React, { useState } from "react";
import { Badge, MiniBarChart, StatCard, SectionHeader, DataTypeIcon, DynamicTable } from "./utils";

interface ProfilingStepOutputProps {
  profileData: any;
  preprocess: any;
}

type TabType = "quality" | "statistics" | "preprocessing";

export default function ProfilingStepOutput({ profileData, preprocess }: ProfilingStepOutputProps) {
  const [activeTabs, setActiveTabs] = useState<Record<string, TabType>>({});

  // 1. Extract Profile Tables
  const profileTables = Array.isArray(profileData?.profile?.tables)
    ? profileData.profile.tables
    : Array.isArray(profileData?.sources)
      ? profileData.sources.flatMap((s: any) => s.tables || [])
      : [];

  // 2. Extract Preprocessing Plans
  const preprocessSources = Array.isArray(preprocess?.sources) 
    ? preprocess.sources 
    : Array.isArray(preprocess?.preprocessingPlan?.tables)
      ? [{ preprocessingPlan: preprocess }]
      : [];

  const oldPreSteps = Array.isArray(preprocess?.steps) ? preprocess.steps : [];
  const oldPreNotes = preprocess?.notes || "";

  if (profileTables.length === 0 && oldPreSteps.length === 0 && !oldPreNotes) {
    return (
      <div className="p-6 text-center border border-dashed border-border bg-surface-muted/20 select-none">
        <span className="text-xl block mb-1">📊</span>
        <p className="text-xs text-muted-foreground">No profiling or preprocessing results found in payload.</p>
      </div>
    );
  }

  // Get active tab for a specific table
  const getActiveTab = (tableKey: string): TabType => {
    return activeTabs[tableKey] || "quality";
  };

  const setActiveTab = (tableKey: string, tab: TabType) => {
    setActiveTabs((prev) => ({ ...prev, [tableKey]: tab }));
  };

  // Find preprocessing details for a specific table
  const findPreprocessTable = (tableName: string) => {
    for (const src of preprocessSources) {
      const pTables = src.preprocessingPlan?.tables || [];
      const matched = pTables.find((pt: any) => pt.tableName === tableName);
      if (matched) return { matched, summary: src.summary };
    }
    return null;
  };

  return (
    <div className="space-y-8 select-none">
      {profileTables.map((table: any, tIdx: number) => {
        const tableName = table.tableName || table.name || `Table Profile #${tIdx + 1}`;
        const totalRowCount = table.totalRowCount || 0;
        const businessDomain = table.businessDomain;
        const columns = table.contentProfile?.columns || table.columns || [];
        const numericColumns = table.statisticalProfile?.numericColumns || [];
        const sampling = table.sampling || null;
        
        // Find matching preprocess table
        const prepDetails = findPreprocessTable(tableName);
        const prepTable = prepDetails?.matched;
        const prepSummary = prepDetails?.summary;
        const actionsApplied = prepTable?.actionsApplied || [];

        const tableKey = `${tIdx}-${tableName}`;
        const activeTab = getActiveTab(tableKey);

        return (
          <div key={tableKey} className="border border-border bg-surface/50 overflow-hidden shadow-soft flex flex-col">
            {/* Header Area */}
            <div className="px-5 py-4 bg-surface-muted/30 border-b border-border flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h4 className="text-xs font-black text-foreground font-mono select-all">{tableName}</h4>
                  {businessDomain && <Badge variant="teal">{businessDomain}</Badge>}
                  {totalRowCount > 0 && (
                    <Badge variant="neutral" className="font-mono">
                      {totalRowCount.toLocaleString()} rows
                    </Badge>
                  )}
                </div>
                {sampling && (
                  <p className="text-[10px] text-muted-foreground mt-1 select-none font-medium">
                    Sampled via <span className="font-bold font-mono">{sampling.stratifiedMethod || sampling.exploratoryMethod}</span> ({sampling.stratifiedSampleSize || sampling.exploratorySampleSize} rows)
                  </p>
                )}
              </div>

              {/* Sub Tabs Selector */}
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
                <button
                  onClick={() => setActiveTab(tableKey, "preprocessing")}
                  className={`px-3 py-1 cursor-pointer transition-colors ${
                    activeTab === "preprocessing" ? "bg-surface text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Prep Actions
                </button>
              </div>
            </div>

            {/* Content Area */}
            <div className="p-5 select-text flex-1">
              
              {/* Tab 1: Quality & Fields */}
              {activeTab === "quality" && (
                <div className="space-y-4">
                  <SectionHeader title="Column Profiles & Frequency" subtitle="Detailed overview of uniqueness, types, and values distribution" />
                  <DynamicTable data={columns} />
                </div>
              )}

              {/* Tab 2: Statistics & Outliers */}
              {activeTab === "statistics" && (
                <div className="space-y-6">
                  <SectionHeader title="Numerical Field Statistics" subtitle="In-depth analysis of numeric column distributions and bounds" />

                  {numericColumns.length === 0 ? (
                    <div className="p-6 text-center bg-surface-muted/20 border border-dashed border-border">
                      <p className="text-xs text-muted-foreground">No numeric column statistics computed for this table.</p>
                    </div>
                  ) : (
                    <div className="space-y-6">
                      {numericColumns.map((col: any, ncIdx: number) => {
                        const outliers = col.outliers || { count: 0, outlierValues: [] };
                        const hasOutliers = outliers.count > 0;
                        const p = col.percentiles || {};
                        const columnNameStr = typeof col.name === "object" && col.name !== null
                          ? (col.name.technicalName || col.name.name || "unknown")
                          : String(col.name || "");

                        return (
                          <div key={ncIdx} className="border border-border/80 bg-surface/30 p-4 space-y-4">
                            {/* Column Header */}
                            <div className="flex items-center justify-between border-b border-border/40 pb-2 select-none">
                              <span className="font-mono font-bold text-foreground text-xs flex items-center gap-1.5 select-all font-sans">
                                🔢 {columnNameStr}
                              </span>
                              {col.distributionShape && (
                                <Badge variant="primary" className="capitalize text-[9px]">
                                  {col.distributionShape.replace(/_/g, " ")} Distribution
                                </Badge>
                              )}
                            </div>

                            {/* Stat Metrics Grid */}
                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 select-none">
                              <StatCard label="Min Value" value={col.min} variant="slate" />
                              <StatCard label="Median" value={col.median} variant="indigo" />
                              <StatCard label="Mean" value={col.mean ? Number(col.mean).toFixed(2) : "n/a"} variant="indigo" />
                              <StatCard label="Max Value" value={col.max} variant="slate" />
                              <StatCard label="Std Deviation" value={col.stddev ? Number(col.stddev).toFixed(2) : "n/a"} variant="slate" />
                            </div>

                            {/* Percentiles & Outliers Dual Columns */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
                              {/* Percentiles */}
                              <div className="p-3.5 bg-surface-muted/30 border border-border/60 space-y-3">
                                <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground block select-none">Percentiles Distribution</span>
                                <div className="space-y-2 select-text text-xs">
                                  {[
                                    { name: "5th (p5)", val: p.p5 },
                                    { name: "25th (p25)", val: p.p25 },
                                    { name: "50th (p50 / Median)", val: p.p50 },
                                    { name: "75th (p75)", val: p.p75 },
                                    { name: "95th (p95)", val: p.p95 },
                                  ].map((item, idx) => (
                                    <div key={idx} className="flex justify-between items-center py-0.5 border-b border-border/40 last:border-b-0 font-medium">
                                      <span className="text-muted-foreground">{item.name}</span>
                                      <span className="font-mono font-bold text-foreground select-all">
                                        {item.val !== undefined ? Number(item.val).toLocaleString() : "n/a"}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              </div>

                              {/* Outliers */}
                              <div className={`p-3.5 border space-y-3 ${hasOutliers ? "border-rose-500/10 bg-rose-500/[0.01]" : "border-border/60 bg-surface-muted/30"}`}>
                                <div className="flex items-center justify-between select-none">
                                  <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Outlier Analysis</span>
                                  <Badge variant={hasOutliers ? "error" : "success"}>
                                    {hasOutliers ? `${outliers.count} Outliers` : "No Outliers"}
                                  </Badge>
                                </div>

                                <div className="space-y-2 text-xs">
                                  <div className="flex justify-between items-center font-medium">
                                    <span className="text-muted-foreground">Lower Bound Threshold</span>
                                    <span className="font-mono text-foreground font-semibold select-all">
                                      {outliers.lowerBound !== undefined ? Number(outliers.lowerBound).toLocaleString() : "n/a"}
                                    </span>
                                  </div>
                                  <div className="flex justify-between items-center font-medium">
                                    <span className="text-muted-foreground">Upper Bound Threshold</span>
                                    <span className="font-mono text-foreground font-semibold select-all">
                                      {outliers.upperBound !== undefined ? Number(outliers.upperBound).toLocaleString() : "n/a"}
                                    </span>
                                  </div>

                                  {hasOutliers && outliers.outlierValues && outliers.outlierValues.length > 0 && (
                                    <div className="pt-2 border-t border-border/40 select-none">
                                      <span className="text-[9px] font-bold uppercase tracking-wider text-rose-500 block mb-1">Detected Outlier Samples</span>
                                      <div className="flex flex-wrap gap-1.5 select-text">
                                        {outliers.outlierValues.slice(0, 10).map((ov: any, ovIdx: number) => (
                                          <span key={ovIdx} className="px-1.5 py-0.5 bg-rose-50 dark:bg-rose-950/20 text-rose-700 dark:text-rose-400 font-mono text-[10px]rder border-rose-100 dark:border-rose-900/60 font-semibold select-all">
                                            {ov}
                                          </span>
                                        ))}
                                        {outliers.outlierValues.length > 10 && (
                                          <span className="text-[9px] text-muted-foreground font-bold self-center">
                                            + {outliers.outlierValues.length - 10} more
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Tab 3: Preprocessing Actions */}
              {activeTab === "preprocessing" && (
                <div className="space-y-4">
                  <SectionHeader title="Preprocessing & Cleaning Actions" subtitle="Rules and transformations generated for this table" />

                  {actionsApplied.length === 0 ? (
                    <div className="p-6 text-center bg-surface-muted/20 border border-dashed border-border">
                      <p className="text-xs text-muted-foreground">No automated cleaning actions were required for this table.</p>
                    </div>
                  ) : (
                    <div className="space-y-4 select-none">
                      {prepSummary && (
                        <div className="flex gap-4 p-3.5 bg-surface-muted/30 border border-border/60 text-xs font-semibold text-foreground/80 select-text">
                          <div className="flex flex-col">
                            <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground block mb-0.5">Applied Actions</span>
                            <span className="text-sm font-extrabold font-mono text-emerald-500">{prepSummary.applied || 0}</span>
                          </div>
                          <div className="flex flex-col">
                            <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground block mb-0.5">Skipped Actions</span>
                            <span className="text-sm font-extrabold font-mono text-amber-500">{prepSummary.skipped || 0}</span>
                          </div>
                          <div className="flex flex-col">
                            <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground block mb-0.5">Total Issues Identified</span>
                            <span className="text-sm font-extrabold font-mono text-indigo-500">{prepSummary.totalActions || 0}</span>
                          </div>
                        </div>
                      )}

                      <div className="border border-border/80 overflow-hidden divide-y divide-border/60 bg-surface">
                        {actionsApplied.map((action: any, actIdx: number) => {
                          const priority = action.priority || "LOW";
                          const result = action.result || "skipped";
                          const columnNameStr = typeof action.columnName === "object" && action.columnName !== null
                            ? (action.columnName.technicalName || action.columnName.name || "unknown")
                            : String(action.columnName || "");

                          return (
                            <div key={actIdx} className="p-4 flex flex-col sm:flex-row sm:items-start justify-between gap-3 text-xs select-text">
                              <div className="space-y-2 flex-1">
                                <div className="flex items-center gap-2 flex-wrap select-none">
                                  <span className="font-mono font-black text-foreground select-all">
                                    🔧 {columnNameStr}
                                  </span>
                                  <Badge variant={result === "applied" ? "success" : result === "skipped" ? "warning" : "error"} className="capitalize">
                                    {result}
                                  </Badge>
                                  <Badge variant={priority === "HIGH" ? "error" : priority === "MEDIUM" ? "warning" : "neutral"} className="capitalize text-[9px]">
                                    {priority} Priority
                                  </Badge>
                                </div>
                                <p className="text-foreground/90 font-bold leading-relaxed">{action.issue}</p>
                                {action.details && (
                                  <p className="text-muted-foreground italic leading-relaxed text-[11px] font-medium">{action.details}</p>
                                )}
                              </div>
                              <div className="shrink-0 text-right select-none font-mono font-black uppercase text-[10px] text-muted-foreground/80 pt-0.5">
                                Method: {action.method}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

            </div>
          </div>
        );
      })}

      {/* Fallback to old preprocessing formatting if no source-level preprocessing plan exists */}
      {profileTables.length === 0 && (oldPreSteps.length > 0 || oldPreNotes) && (
        <div className="border border-border bg-surface p-5 space-y-4">
          <SectionHeader title="Preprocessing Operations" subtitle="Auto-generated data transformations and cleanup" />
          
          {oldPreSteps.length > 0 && (
            <div className="flex flex-wrap gap-2 select-none">
              {oldPreSteps.map((step: string) => (
                <span key={step} className="px-2.5 py-1 text-xs font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-100 dark:border-indigo-900 capitalize">
                  {step.replace(/_/g, " ")}
                </span>
              ))}
            </div>
          )}
          {oldPreNotes && (
            <div className="p-3.5 bg-surface-muted border border-border text-xs text-foreground/80 leading-relaxed whitespace-pre-wrap select-text font-medium">
              {oldPreNotes}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
