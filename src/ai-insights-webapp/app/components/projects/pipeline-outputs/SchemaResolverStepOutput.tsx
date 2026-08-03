"use client";

import React from "react";
import { Badge, SectionHeader, DynamicTable } from "./utils";

interface SchemaResolverStepOutputProps {
  resolveSchema: any;
}

export default function SchemaResolverStepOutput({ resolveSchema }: SchemaResolverStepOutputProps) {
  // Extract resolution source details. Keep robust to support array format or object format
  const rawSources = resolveSchema?.sources;
  const sources = Array.isArray(rawSources)
    ? rawSources
    : Array.isArray(resolveSchema)
      ? resolveSchema
      : resolveSchema
        ? [resolveSchema]
        : [];

  const getTopicBadgeVariant = (topic: string) => {
    const norm = topic.toLowerCase();
    if (norm.includes("customer")) return "primary";
    if (norm.includes("order") || norm.includes("sale") || norm.includes("revenue")) return "teal";
    if (norm.includes("product") || norm.includes("inventory")) return "purple";
    if (norm.includes("finance") || norm.includes("payment")) return "success";
    return "neutral";
  };

  if (sources.length === 0) {
    return (
      <div className="p-6 text-center border border-dashed border-border bg-surface-muted/20 select-none">
        <span className="text-xl block mb-1">🔗</span>
        <p className="text-xs text-muted-foreground">No schema mappings found in payload.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 select-none">
      {/* Schema Resolution Success Banner */}
      <div className="p-4 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900 text-xs text-emerald-800 dark:text-emerald-300 flex items-start gap-2.5 shadow-sm font-semibold select-none">
        <span className="text-sm">✓</span>
        <div>
          <strong className="block text-emerald-900 dark:text-emerald-400">Schema Resolution Finalized</strong>
          <p className="text-emerald-700/90 dark:text-emerald-300/80 mt-0.5">The mapping logic between physical dataset tables and downstream business models has been successfully established and compiled.</p>
        </div>
      </div>

      {sources.map((src: any, srcIdx: number) => {
        const srcName = src.connectorName || src.connectorId || `Source #${srcIdx + 1}`;
        const domain = src.domain || "general";
        const strategy = src.strategy || "Unknown alignment logic";
        const resolvedTables = Array.isArray(src.resolvedTables) ? src.resolvedTables : [];
        const mappings = Array.isArray(src.mappings) ? src.mappings : [];
        const unmapped = Array.isArray(src.unmappedDatasetFields) ? src.unmappedDatasetFields : [];
        const parquetPath = src.parquetPath || null;

        return (
          <div key={srcIdx} className="space-y-6 select-text">
            {/* Metadata & Strategy Card */}
            <div className="border border-border bg-surface/50 p-5 space-y-4 shadow-soft">
              <div className="flex items-center justify-between border-b border-border/40 pb-2.5 select-none">
                <span className="text-xs font-black text-foreground">Schema Configuration</span>
                <Badge variant="teal">{domain}</Badge>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground block select-none">Alignment Strategy</span>
                  <p className="text-xs text-foreground/90 leading-relaxed font-semibold">{strategy}</p>
                </div>
                
                {resolvedTables.length > 0 && (
                  <div className="space-y-1">
                    <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground block select-none">Resolved Entity Tables</span>
                    <div className="flex flex-wrap gap-1.5 select-none">
                      {resolvedTables.map((tbl: string) => (
                        <span key={tbl} className="px-2.5 py-0.5 bg-surface-muted border border-border text-xs font-bold text-foreground">
                          {tbl}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {parquetPath && (
                <div className="space-y-1 pt-1 select-none">
                  <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground block">Parquet Target File Path</span>
                  <div className="p-2.5 bg-surface-muted/65 border border-border/60 text-[10px] font-mono text-muted-foreground truncate select-all" title={parquetPath}>
                    {parquetPath}
                  </div>
                </div>
              )}
            </div>

            {/* Mappings Table */}
            <div className="space-y-3">
              <SectionHeader title="Resolved Schema Mappings" subtitle="Semantic alignment of dataset columns to analytical structures" badgeText={`${mappings.length} Fields Mapped`} />

              {mappings.length === 0 ? (
                <p className="text-xs text-muted-foreground italic text-center p-4">No field mappings created.</p>
              ) : (
                <DynamicTable data={mappings} />
              )}
            </div>

            {/* Unmapped Fields Panel */}
            {unmapped.length > 0 && (
              <div className="p-4 border border-rose-500/10 bg-rose-500/[0.01] space-y-3">
                <span className="text-[10px] font-black uppercase tracking-wider text-rose-500 block select-none">Unmapped Dataset Fields</span>
                <p className="text-xs text-muted-foreground select-none font-medium">The following fields were ignored or could not be aligned to downstream analytical models:</p>
                <div className="flex flex-wrap gap-1.5 select-text">
                  {unmapped.map((f: any, fIdx: number) => {
                    const fStr = typeof f === "object" && f !== null
                      ? (f.technicalName || f.name || "unknown")
                      : String(f || "");
                    return (
                      <span key={fIdx} className="px-2 py-0.5 bg-rose-50/50 dark:bg-rose-950/20 border border-rose-100 dark:border-rose-900/60 text-[11px] text-rose-700 dark:text-rose-400 font-bold font-mono select-all">
                        {fStr}
                      </span>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
