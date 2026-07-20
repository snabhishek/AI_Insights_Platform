"use client";

import React from "react";
import { DataSource } from "../providers/AppContext";

interface ProjectDataSourcesProps {
  displaySources: DataSource[];
  onManage: () => void;
  onViewDetails: (ds: DataSource) => void;
}

function getSubtextCategory(subtext: string): string {
  const s = subtext.toLowerCase();
  if (s.includes("warehouse")) return "Data Warehouse";
  if (s.includes("database")) return "Database";
  if (s.includes("api")) return "API";
  if (s.includes("cloud") || s.includes("storage")) return "Cloud Storage";
  if (s.includes("file")) return "File";
  return "Database";
}

export default function ProjectDataSources({
  displaySources,
  onManage,
  onViewDetails,
}: ProjectDataSourcesProps) {
  return (
    <div className="col-span-12 lg:col-span-4 xl:col-span-3 flex flex-col bg-surface border border-border rounded-2xl p-5 shadow-soft">
      <div className="mb-4">
        <h2 className="text-base font-bold text-foreground">
          Data Sources ({displaySources.length})
        </h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Data sources connected to this project.
        </p>
      </div>

      {/* List */}
      <div className="space-y-3 mb-5 flex-1">
        {displaySources.map((ds) => {
          const category = getSubtextCategory(ds.subtext);
          const detail = ds.connectionConfig?.host
            ? `${ds.connectionConfig.database ?? "Database"} · ${ds.connectionConfig.host}${ds.connectionConfig.port ? `:${ds.connectionConfig.port}` : ""}`
            : ds.connectionConfig?.fileName ?? category;

          return (
            <div
              key={ds.id}
              className="flex items-center justify-between p-3.5 border border-border bg-surface rounded-xl hover:shadow-sm transition-all"
            >
              <div className="flex items-center gap-3 overflow-hidden">
                {/* Icon placeholder — text initials fallback */}
                <div className="w-9 h-9 rounded-xl bg-surface-muted border border-border flex items-center justify-center shrink-0 text-[10px] font-bold text-muted-foreground uppercase">
                  {ds.name.slice(0, 2)}
                </div>
                <div className="flex flex-col overflow-hidden">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-foreground truncate max-w-[115px]" title={ds.name}>
                      {ds.name}
                    </span>
                    <span className="px-1.5 py-0.5 rounded bg-surface-muted border border-border text-[9px] font-semibold text-muted-foreground uppercase shrink-0">
                      {category}
                    </span>
                  </div>
                  <span className="text-[10px] text-muted-foreground truncate mt-0.5" title={detail}>{detail}</span>
                  <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold mt-0.5 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                    Connected
                  </span>
                </div>
              </div>

              <button
                onClick={() => onViewDetails(ds)}
                className="w-7 h-7 rounded-lg text-muted-foreground hover:bg-surface-muted flex items-center justify-center cursor-pointer transition-colors shrink-0"
                title="View details"
              >
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <circle cx="12" cy="5" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="12" cy="19" r="1" />
                </svg>
              </button>
            </div>
          );
        })}
      </div>

      <button
        onClick={onManage}
        className="w-full py-2.5 border border-border bg-surface hover:bg-surface-muted text-foreground rounded-xl text-xs font-bold cursor-pointer transition-colors flex items-center justify-center gap-2 shadow-sm"
      >
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-muted-foreground">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.62V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
        Manage Data Sources
      </button>
    </div>
  );
}
