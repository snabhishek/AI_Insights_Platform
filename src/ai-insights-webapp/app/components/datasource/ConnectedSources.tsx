"use client";

import React, { useState, useEffect, useRef } from "react";
import Image from "next/image";
import {
  PostgresqlIcon,
  SnowflakeIcon,
  SqlServerIcon,
  MysqlIcon,
  MongodbIcon,
  RestApiIcon,
  TableIcon,
  ViewIcon,
  PipelineIcon,
} from "./Icons";
import { useApp, DataSource } from "../providers/AppContext";

const getSourceIcon = (type: DataSource["type"]) => {
  switch (type) {
    case "postgres":
      return <PostgresqlIcon size={36} />;
    case "snowflake":
      return <SnowflakeIcon size={36} />;
    case "sqlserver":
      return <SqlServerIcon size={36} />;
    case "csv":
      return <Image src="/images/csv.png" alt="CSV" width={36} height={36} className="object-contain" />;
    case "tsv":
      return <Image src="/images/tsv.png" alt="TSV" width={36} height={36} className="object-contain" />;
    case "excel":
      return <Image src="/images/microsoft-excel.jpg" alt="Excel" width={36} height={36} className="object-contain" />;
    case "mysql":
      return <MysqlIcon size={36} />;
    case "mongodb":
      return <MongodbIcon size={36} />;
    case "restapi":
      return <RestApiIcon size={36} />;
    default:
      return <PostgresqlIcon size={36} />;
  }
};

type FilterType = "all" | "Connected" | "Disconnected" | "Warning";
type SortField = "name" | "status" | "health" | "lastSync";
type SortOrder = "asc" | "desc";

interface ConnectedSourcesProps {
  onViewDetails: (source: DataSource) => void;
}

export default function ConnectedSources({ onViewDetails }: ConnectedSourcesProps) {
  const { dataSources, deleteDataSource, syncDataSource, disconnectDataSource, reconnectDataSource, showConfirm } = useApp();
  const [searchTerm, setSearchTerm] = useState("");
  const [activeFilter, setActiveFilter] = useState<FilterType>("all");
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortOrder, setSortOrder] = useState<SortOrder>("asc");

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortOrder("asc");
    }
  };

  // 1. Text Search Filter
  let filtered = dataSources.filter(
    (source) =>
      source.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      source.subtext.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // 2. Tab Category Filter
  if (activeFilter !== "all") {
    if (activeFilter === "Warning") {
      filtered = filtered.filter((s) => s.health === "Warning" || s.health === "Error");
    } else {
      filtered = filtered.filter((s) => s.status === activeFilter);
    }
  }

  // 3. Sort logic
  const sortedSources = [...filtered].sort((a, b) => {
    let comparison = 0;
    if (sortField === "name") {
      comparison = a.name.localeCompare(b.name);
    } else if (sortField === "status") {
      comparison = a.status.localeCompare(b.status);
    } else if (sortField === "health") {
      comparison = a.health.localeCompare(b.health);
    } else if (sortField === "lastSync") {
      comparison = a.lastSyncDate.localeCompare(b.lastSyncDate);
    }
    return sortOrder === "asc" ? comparison : -comparison;
  });

  return (
    <div className="flex flex-col rounded-2xl border border-border bg-surface p-6 shadow-soft hover:shadow-soft-hover transition-shadow duration-300">
      {/* Top bar with Title & Search */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div>
          <h3 className="text-base font-semibold text-foreground">
            Connected Sources
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Active server connections and catalogs loaded in this workspace.
          </p>
        </div>
        <div className="relative w-full sm:w-72">
          <input
            type="text"
            placeholder="Search connected sources..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full h-10 pl-10 pr-4 rounded-lg border border-border bg-surface text-sm text-foreground focus:outline-none focus:border-primary transition-colors"
          />
          <span className="absolute left-3.5 top-[12px] text-muted-foreground pointer-events-none z-10">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </span>
        </div>
      </div>

      {/* Modern Segmented Filter Control */}
      <div className="flex justify-between items-center mb-5 pb-4 border-b border-border">
        <div className="inline-flex p-1 rounded-xl bg-surface-muted border border-border/80 text-xs font-semibold gap-1">
          {(["all", "Connected", "Disconnected", "Warning"] as const).map((filter) => {
            const isActive = activeFilter === filter;
            return (
              <button
                key={filter}
                onClick={() => setActiveFilter(filter)}
                className={`px-4 py-1.5 rounded-lg transition-all duration-200 cursor-pointer ${
                  isActive
                    ? "bg-surface text-foreground shadow-sm border border-border/30 font-bold scale-[1.02]"
                    : "text-muted-foreground hover:text-foreground hover:bg-surface/30"
                }`}
              >
                {filter === "all" ? "All Sources" : filter === "Warning" ? "Issues / Alerts" : filter}
              </button>
            );
          })}
        </div>
      </div>

      {/* Table container */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[800px] border-collapse text-left">
          <thead>
            <tr className="border-b border-border text-[10px] font-bold text-muted-foreground tracking-wider uppercase select-none">
              <th
                className="pb-3 pt-2 font-semibold cursor-pointer hover:text-primary transition-colors"
                onClick={() => handleSort("name")}
              >
                Source Name {sortField === "name" && (sortOrder === "asc" ? "▲" : "▼")}
              </th>
              <th
                className="pb-3 pt-2 font-semibold w-[130px] cursor-pointer hover:text-primary transition-colors"
                onClick={() => handleSort("status")}
              >
                Status {sortField === "status" && (sortOrder === "asc" ? "▲" : "▼")}
              </th>
              <th
                className="pb-3 pt-2 font-semibold w-[130px] cursor-pointer hover:text-primary transition-colors"
                onClick={() => handleSort("health")}
              >
                Data Health {sortField === "health" && (sortOrder === "asc" ? "▲" : "▼")}
              </th>
              <th
                className="pb-3 pt-2 font-semibold w-[180px] cursor-pointer hover:text-primary transition-colors"
                onClick={() => handleSort("lastSync")}
              >
                Last Sync {sortField === "lastSync" && (sortOrder === "asc" ? "▲" : "▼")}
              </th>
              <th className="pb-3 pt-2 font-semibold w-[240px]">Data Assets</th>
              <th className="pb-3 pt-2 font-semibold w-[120px] text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {sortedSources.length > 0 ? (
              sortedSources.map((source) => (
                <tr
                  key={source.id}
                  className="group hover:bg-surface-muted/50 transition-colors"
                >
                  {/* Source Name */}
                  <td className="py-4 pr-4">
                    <div className="flex items-center gap-3">
                      <div className="flex items-center justify-center p-1.5 rounded-lg bg-surface-muted group-hover:bg-surface border border-border/20 transition-all">
                        {getSourceIcon(source.type)}
                      </div>
                      <div className="flex flex-col">
                        <span className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors">
                          {source.name}
                        </span>
                        <span className="text-xs text-muted-foreground mt-0.5">
                          {source.subtext}
                        </span>
                      </div>
                    </div>
                  </td>

                  {/* Status */}
                  <td className="py-4 pr-4 align-middle">
                    {source.status === "Syncing" ? (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-500/10 text-blue-600 dark:text-blue-400">
                        <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-spin" />
                        Syncing...
                      </span>
                    ) : source.status === "Connected" ? (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-green-500/10 text-green-600 dark:text-green-400">
                        <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                        Connected
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-gray-500/10 text-gray-600 dark:text-gray-400">
                        <span className="w-1.5 h-1.5 rounded-full bg-gray-500" />
                        Disconnected
                      </span>
                    )}
                  </td>

                  {/* Data Health */}
                  <td className="py-4 pr-4 align-middle">
                    <div className="flex items-center gap-1.5 text-xs font-semibold">
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          source.health === "Healthy"
                            ? "bg-green-500"
                            : source.health === "Warning"
                            ? "bg-amber-500"
                            : "bg-red-500"
                        }`}
                      />
                      <span
                        className={
                          source.health === "Healthy"
                            ? "text-green-600 dark:text-green-400"
                            : source.health === "Warning"
                            ? "text-amber-600 dark:text-amber-400"
                            : "text-red-600 dark:text-red-400"
                        }
                      >
                        {source.health}
                      </span>
                    </div>
                  </td>

                  {/* Last Sync */}
                  <td className="py-4 pr-4 align-middle">
                    <div className="flex flex-col">
                      <span className="text-sm font-semibold text-foreground">
                        {source.lastSyncTime}
                      </span>
                      <span className="text-xs text-muted-foreground mt-0.5">
                        {source.lastSyncDate}
                      </span>
                    </div>
                  </td>

                  {/* Data Assets */}
                  <td className="py-4 pr-4 align-middle">
                    <div className="flex items-center gap-4 text-xs font-semibold text-foreground">
                      {/* File types: only show 1 Table and row count info */}
                      {["excel", "csv", "tsv"].includes(source.type) && (
                        <div className="flex items-center gap-1.5 bg-surface-muted/60 px-2 py-1 rounded-md border border-border/40">
                          <TableIcon className="text-muted-foreground w-3.5 h-3.5" />
                          <span>
                            <span className="text-foreground font-bold">1</span>
                            <span className="text-muted-foreground font-medium ml-1">Table</span>
                            <span className="text-xs text-muted-foreground font-normal ml-2 bg-surface px-1.5 py-0.5 rounded border border-border/20">50k rows</span>
                          </span>
                        </div>
                      )}

                      {/* REST API: show endpoint info */}
                      {source.type === "restapi" && (
                        <div className="flex items-center gap-1.5 bg-surface-muted/60 px-2 py-1 rounded-md border border-border/40">
                          <PipelineIcon className="text-muted-foreground w-3.5 h-3.5" />
                          <span>
                            <span className="text-foreground font-bold">1</span>
                            <span className="text-muted-foreground font-medium ml-1">API Endpoint</span>
                          </span>
                        </div>
                      )}

                      {/* Databases: show Tables, and conditionally show Views / Pipelines if > 0 */}
                      {!["excel", "csv", "tsv", "restapi"].includes(source.type) && (
                        <>
                          <div className="flex items-center gap-1.5 bg-surface-muted/60 px-2 py-1 rounded-md border border-border/40">
                            <TableIcon className="text-muted-foreground w-3.5 h-3.5" />
                            <span>
                              <span className="text-foreground font-bold">{source.assets.tables}</span>
                              <span className="text-muted-foreground font-medium ml-1">Tables</span>
                            </span>
                          </div>

                          {source.assets.views !== null && source.assets.views > 0 && (
                            <div className="flex items-center gap-1.5 bg-surface-muted/60 px-2 py-1 rounded-md border border-border/40">
                              <ViewIcon className="text-muted-foreground w-3.5 h-3.5" />
                              <span>
                                <span className="text-foreground font-bold">{source.assets.views}</span>
                                <span className="text-muted-foreground font-medium ml-1">Views</span>
                              </span>
                            </div>
                          )}

                          {source.assets.pipelines !== null && source.assets.pipelines > 0 && (
                            <div className="flex items-center gap-1.5 bg-surface-muted/60 px-2 py-1 rounded-md border border-border/40">
                              <PipelineIcon className="text-muted-foreground w-3.5 h-3.5" />
                              <span>
                                <span className="text-foreground font-bold">{source.assets.pipelines}</span>
                                <span className="text-muted-foreground font-medium ml-1">Pipelines</span>
                              </span>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </td>

                  {/* Actions (3 inline icon square buttons) */}
                  <td className="py-4 align-middle text-right">
                    <div className="inline-flex items-center gap-2 justify-end">
                      {/* Sync Button */}
                      <button
                        onClick={() => syncDataSource(source.id)}
                        disabled={source.status === "Syncing" || source.status === "Disconnected"}
                        title={source.status === "Disconnected" ? "Cannot sync disconnected source" : "Sync Schema"}
                        className="w-8 h-8 flex items-center justify-center rounded-lg border border-border bg-surface text-muted-foreground hover:bg-primary/5 hover:border-primary/30 hover:text-primary transition-all duration-200 cursor-pointer disabled:opacity-40 disabled:hover:bg-surface disabled:hover:text-muted-foreground disabled:cursor-not-allowed"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="15"
                          height="15"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className={source.status === "Syncing" ? "animate-spin" : ""}
                        >
                          <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
                        </svg>
                      </button>

                      {/* View details Button */}
                      <button
                        onClick={() => onViewDetails(source)}
                        title="View Details"
                        className="w-8 h-8 flex items-center justify-center rounded-lg border border-border bg-surface text-muted-foreground hover:bg-blue-500/5 hover:border-blue-500/30 hover:text-blue-500 transition-all duration-200 cursor-pointer"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="15"
                          height="15"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                      </button>

                      {/* Disconnect / Connect Toggle Button */}
                      {source.status === "Disconnected" ? (
                        <button
                          onClick={() => {
                            const isFile = ["excel", "csv", "tsv"].includes(source.type);
                            const actionVerb = isFile ? "re-mount" : "reconnect";
                            showConfirm({
                              title: `Confirm ${isFile ? "Mount" : "Connection"}`,
                              message: `Are you sure you want to ${actionVerb} "${source.name}"? This will resume live catalog synchronization.`,
                              confirmText: isFile ? "Mount" : "Connect",
                              cancelText: "Cancel",
                              onConfirm: () => reconnectDataSource(source.id),
                            });
                          }}
                          title={["excel", "csv", "tsv"].includes(source.type) ? "Mount File" : "Connect Connection"}
                          className="w-8 h-8 flex items-center justify-center rounded-lg border border-border bg-surface text-green-500 hover:bg-green-500/5 hover:border-green-500/30 transition-all duration-200 cursor-pointer"
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="15"
                            height="15"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <rect x="2" y="12" width="20" height="8" rx="2" ry="2" />
                            <path d="M6 12V6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v6" />
                            <line x1="12" y1="2" x2="12" y2="4" />
                          </svg>
                        </button>
                      ) : (
                        <button
                          onClick={() => {
                            const isFile = ["excel", "csv", "tsv"].includes(source.type);
                            const actionVerb = isFile ? "unmount" : "disconnect";
                            showConfirm({
                              title: `Confirm ${isFile ? "Unmount" : "Disconnection"}`,
                              message: `Are you sure you want to ${actionVerb} "${source.name}"? This will pause catalog updates and hide active previews.`,
                              confirmText: isFile ? "Unmount" : "Disconnect",
                              cancelText: "Cancel",
                              onConfirm: () => disconnectDataSource(source.id),
                            });
                          }}
                          title={["excel", "csv", "tsv"].includes(source.type) ? "Unmount File" : "Disconnect Connection"}
                          className="w-8 h-8 flex items-center justify-center rounded-lg border border-border bg-surface text-muted-foreground hover:bg-amber-500/5 hover:border-amber-500/30 hover:text-amber-500 transition-all duration-200 cursor-pointer"
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="15"
                            height="15"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <rect x="2" y="12" width="20" height="8" rx="2" ry="2" />
                            <path d="M6 12V6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v6" />
                            <line x1="12" y1="2" x2="12" y2="4" />
                          </svg>
                        </button>
                      )}

                      {/* Delete Button */}
                      <button
                        onClick={() => {
                          showConfirm({
                            title: "Confirm Deletion",
                            message: `Are you sure you want to delete "${source.name}"? This will permanently remove the configuration and all stored cache data.`,
                            confirmText: "Delete",
                            cancelText: "Cancel",
                            onConfirm: () => deleteDataSource(source.id),
                          });
                        }}
                        title="Delete Connection"
                        className="w-8 h-8 flex items-center justify-center rounded-lg border border-border bg-surface text-muted-foreground hover:bg-red-500/5 hover:border-red-500/30 hover:text-red-500 transition-all duration-200 cursor-pointer"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="15"
                          height="15"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                          <line x1="10" y1="11" x2="10" y2="17" />
                          <line x1="14" y1="11" x2="14" y2="17" />
                        </svg>
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                  No connected sources match your filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
