"use client";

import React, { useState, useEffect } from "react";
import { useApp, DataSource, ConnectionConfig } from "../providers/AppContext";
import DataPreviewGrid from "./DataPreviewGrid";
import Image from "next/image";
import {
  PostgresqlIcon,
  SnowflakeIcon,
  SqlServerIcon,
  MysqlIcon,
  MongodbIcon,
  RestApiIcon,
} from "./Icons";

interface SourceDetailModalProps {
  source: DataSource | null;
  onClose: () => void;
}

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

export default function SourceDetailModal({ source: propSource, onClose }: SourceDetailModalProps) {
  const { dataSources, updateDataSource, showAlert } = useApp();
  const source = dataSources.find((ds) => ds.id === propSource?.id) || propSource;

  const [activeTab, setActiveTab] = useState<"config" | "data">("config");
  const [isEditing, setIsEditing] = useState(false);

  // Editable fields state
  const [editName, setEditName] = useState("");
  const [editHost, setEditHost] = useState("");
  const [editPort, setEditPort] = useState("");
  const [editDatabase, setEditDatabase] = useState("");
  const [editUsername, setEditUsername] = useState("");
  const [editPassword, setEditPassword] = useState("");
  const [editAccount, setEditAccount] = useState("");
  const [editUrl, setEditUrl] = useState("");
  const [editFileName, setEditFileName] = useState("");

  // Sync edits when source changes
  useEffect(() => {
    if (source) {
      setEditName(source.name);
      const cfg = source.connectionConfig || {};
      setEditHost(cfg.host || "");
      setEditPort(cfg.port || "");
      setEditDatabase(cfg.database || "");
      setEditUsername(cfg.username || "");
      setEditPassword(cfg.password || "");
      setEditAccount(cfg.account || "");
      setEditUrl(cfg.url || "");
      setEditFileName(cfg.fileName || "");
      setIsEditing(false);
    }
  }, [source]);

  if (!source) return null;

  const getSourceLabel = () => {
    switch (source.type) {
      case "postgres":
        return "PostgreSQL";
      case "snowflake":
        return "Snowflake Warehouse";
      case "sqlserver":
        return "Microsoft SQL Server";
      case "mysql":
        return "MySQL";
      case "mongodb":
        return "MongoDB";
      case "excel":
        return "Excel Spreadsheet";
      case "csv":
        return "CSV File";
      case "tsv":
        return "TSV File";
      case "restapi":
        return "REST API";
      default:
        return "Data Source";
    }
  };

  const handleSaveEdits = async () => {
    if (!editName.trim()) {
      showAlert({ title: "Validation Error", message: "Name is required", type: "error" });
      return;
    }

    const updatedConfig: ConnectionConfig = {
      ...source.connectionConfig,
      host: editHost,
      port: editPort,
      database: editDatabase,
      username: editUsername,
      password: editPassword,
      account: editAccount,
      url: editUrl,
      fileName: editFileName,
    };

    try {
      await updateDataSource(source.id, editName, updatedConfig);
      setIsEditing(false);
    } catch (err: any) {
      console.error(err);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/50 backdrop-blur-md animate-fade-in">
      <div className="relative w-full max-w-3xl overflow-hidden rounded-xl border border-border bg-surface shadow-2xl transition-all scale-100 flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-border/80 px-5 py-3 bg-surface-muted/60">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center p-1.5 rounded-lg bg-surface border border-border/20">
              {getSourceIcon(source.type)}
            </div>
            <div>
              {isEditing ? (
                <div className="flex flex-col gap-1">
                  <label className="text-[9px] font-bold uppercase text-muted-foreground">Edit Name</label>
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="h-8 px-2 rounded border border-border bg-surface text-xs font-semibold text-foreground focus:outline-none focus:border-primary"
                  />
                </div>
              ) : (
                <>
                  <h3 className="text-sm font-bold text-foreground">
                    {source.name} Explorer
                  </h3>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Provider: {getSourceLabel()}
                  </p>
                </>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-background hover:text-foreground transition-colors cursor-pointer"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Tab Selection Bar */}
        <div className="flex border-b border-border px-6 bg-surface-muted/30">
          <button
            onClick={() => setActiveTab("config")}
            disabled={isEditing}
            className={`py-3 px-4 text-xs font-bold border-b-2 transition-all cursor-pointer ${
              activeTab === "config"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            Configuration
          </button>
          <button
            onClick={() => setActiveTab("data")}
            disabled={isEditing}
            className={`py-3 px-4 text-xs font-bold border-b-2 transition-all cursor-pointer ${
              activeTab === "data"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            Data Preview & Schema
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {activeTab === "config" ? (
            <div className="space-y-6">
              {/* Status & Health Pills */}
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-surface-muted rounded-xl p-3 border border-border/40">
                  <span className="block text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                    Connection Status
                  </span>
                  <div className="mt-1 flex items-center gap-1.5 text-sm font-semibold">
                    <span
                      className={`w-2 h-2 rounded-full ${
                        source.status === "Connected"
                          ? "bg-green-500 animate-pulse"
                          : source.status === "Syncing"
                          ? "bg-blue-500 animate-spin"
                          : "bg-gray-500"
                      }`}
                    />
                    <span className="text-foreground">{source.status}</span>
                  </div>
                </div>

                <div className="bg-surface-muted rounded-xl p-3 border border-border/40">
                  <span className="block text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                    Data Health
                  </span>
                  <div className="mt-1 flex items-center gap-1.5 text-sm font-semibold">
                    <span
                      className={`w-2 h-2 rounded-full ${
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
                </div>
              </div>

              {/* Connection Parameters */}
              <div className="space-y-3">
                <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                  Connection Parameters
                </h4>

                <div className="rounded-xl border border-border/60 bg-surface divide-y divide-border/60 text-sm">
                  {/* Host / Server IP */}
                  {source.connectionConfig?.host !== undefined && (
                    <div className="flex justify-between items-center p-3.5">
                      <span className="text-muted-foreground">Server Address</span>
                      {isEditing ? (
                        <input
                          type="text"
                          value={editHost}
                          onChange={(e) => setEditHost(e.target.value)}
                          className="h-8 px-2.5 rounded border border-border bg-surface text-xs font-medium text-foreground text-right focus:outline-none focus:border-primary"
                        />
                      ) : (
                        <span className="font-semibold text-foreground">{source.connectionConfig.host}</span>
                      )}
                    </div>
                  )}

                  {/* Port */}
                  {source.connectionConfig?.port !== undefined && (
                    <div className="flex justify-between items-center p-3.5">
                      <span className="text-muted-foreground">Port</span>
                      {isEditing ? (
                        <input
                          type="text"
                          value={editPort}
                          onChange={(e) => setEditPort(e.target.value)}
                          className="h-8 w-20 px-2.5 rounded border border-border bg-surface text-xs font-medium text-foreground text-right focus:outline-none focus:border-primary"
                        />
                      ) : (
                        <span className="font-semibold text-foreground">{source.connectionConfig.port}</span>
                      )}
                    </div>
                  )}

                  {/* Database Name */}
                  {source.connectionConfig?.database !== undefined && (
                    <div className="flex justify-between items-center p-3.5">
                      <span className="text-muted-foreground">Database Name</span>
                      {isEditing ? (
                        <input
                          type="text"
                          value={editDatabase}
                          onChange={(e) => setEditDatabase(e.target.value)}
                          className="h-8 px-2.5 rounded border border-border bg-surface text-xs font-medium text-foreground text-right focus:outline-none focus:border-primary"
                        />
                      ) : (
                        <span className="font-semibold text-foreground">{source.connectionConfig.database}</span>
                      )}
                    </div>
                  )}

                  {/* Snowflake Account */}
                  {source.connectionConfig?.account !== undefined && (
                    <div className="flex justify-between items-center p-3.5">
                      <span className="text-muted-foreground">Account Identifier</span>
                      {isEditing ? (
                        <input
                          type="text"
                          value={editAccount}
                          onChange={(e) => setEditAccount(e.target.value)}
                          className="h-8 px-2.5 rounded border border-border bg-surface text-xs font-medium text-foreground text-right focus:outline-none focus:border-primary"
                        />
                      ) : (
                        <span className="font-semibold text-foreground">{source.connectionConfig.account}</span>
                      )}
                    </div>
                  )}

                  {/* Username */}
                  {source.connectionConfig?.username !== undefined && (
                    <div className="flex justify-between items-center p-3.5">
                      <span className="text-muted-foreground">Username</span>
                      {isEditing ? (
                        <input
                          type="text"
                          value={editUsername}
                          onChange={(e) => setEditUsername(e.target.value)}
                          className="h-8 px-2.5 rounded border border-border bg-surface text-xs font-medium text-foreground text-right focus:outline-none focus:border-primary"
                        />
                      ) : (
                        <span className="font-semibold text-foreground">{source.connectionConfig.username}</span>
                      )}
                    </div>
                  )}

                  {/* Password */}
                  {source.connectionConfig?.password !== undefined && (
                    <div className="flex justify-between items-center p-3.5">
                      <span className="text-muted-foreground">Password</span>
                      {isEditing ? (
                        <input
                          type="password"
                          placeholder="••••••••"
                          value={editPassword}
                          onChange={(e) => setEditPassword(e.target.value)}
                          className="h-8 px-2.5 rounded border border-border bg-surface text-xs font-medium text-foreground text-right focus:outline-none focus:border-primary"
                        />
                      ) : (
                        <span className="font-semibold text-foreground">••••••••</span>
                      )}
                    </div>
                  )}

                  {/* API URL */}
                  {source.connectionConfig?.url !== undefined && (
                    <div className="flex flex-col gap-1 p-3.5">
                      <span className="text-muted-foreground">API Endpoint URL</span>
                      {isEditing ? (
                        <input
                          type="text"
                          value={editUrl}
                          onChange={(e) => setEditUrl(e.target.value)}
                          className="h-9 w-full px-2.5 rounded border border-border bg-surface text-xs font-medium text-foreground focus:outline-none focus:border-primary"
                        />
                      ) : (
                        <span className="font-mono text-xs text-foreground bg-surface-muted p-2 rounded-lg border border-border/40 select-all break-all">
                          {source.connectionConfig.url}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Excel/CSV File Name */}
                  {source.connectionConfig?.fileName !== undefined && (
                    <div className="flex justify-between items-center p-3.5">
                      <span className="text-muted-foreground">Local File Name</span>
                      {isEditing ? (
                        <input
                          type="text"
                          value={editFileName}
                          onChange={(e) => setEditFileName(e.target.value)}
                          className="h-8 px-2.5 rounded border border-border bg-surface text-xs font-medium text-foreground text-right focus:outline-none focus:border-primary"
                        />
                      ) : (
                        <span className="font-semibold text-primary">{source.connectionConfig.fileName}</span>
                      )}
                    </div>
                  )}

                  {/* Un-editable Last Synced */}
                  <div className="flex justify-between p-3.5 text-xs text-muted-foreground bg-surface-muted/30">
                    <span>Last Synced</span>
                    <span className="font-mono">{source.lastSyncDate} ({source.lastSyncTime})</span>
                  </div>
                </div>
              </div>

              {/* Connected Assets breakdown */}
              <div className="space-y-3">
                <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                  Discovered Schema Assets (Read Only)
                </h4>

                <div className="grid grid-cols-3 gap-3 text-center">
                  <div className="bg-surface-muted rounded-xl p-3 border border-border/40 flex flex-col justify-center">
                    <span className="text-xl font-extrabold text-foreground">
                      {source.assets.tables}
                    </span>
                    <span className="text-[10px] text-muted-foreground font-semibold mt-1">Tables</span>
                  </div>

                  <div className="bg-surface-muted rounded-xl p-3 border border-border/40 flex flex-col justify-center">
                    <span className="text-xl font-extrabold text-foreground">
                      {source.assets.views !== null ? source.assets.views : "—"}
                    </span>
                    <span className="text-[10px] text-muted-foreground font-semibold mt-1">Views</span>
                  </div>

                  <div className="bg-surface-muted rounded-xl p-3 border border-border/40 flex flex-col justify-center">
                    <span className="text-xl font-extrabold text-foreground">
                      {source.assets.pipelines}
                    </span>
                    <span className="text-[10px] text-muted-foreground font-semibold mt-1">Pipelines</span>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <DataPreviewGrid source={source} />
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between border-t border-border/80 px-5 py-3 bg-surface-muted/60">
          {activeTab === "config" ? (
            isEditing ? (
              <button
                type="button"
                onClick={() => setIsEditing(false)}
                className="h-8 px-3.5 rounded-lg border border-border text-xs font-semibold text-foreground hover:bg-surface transition-all cursor-pointer"
              >
                Cancel Edits
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setIsEditing(true)}
                className="h-8 px-3.5 rounded-lg border border-primary/20 text-xs font-semibold text-primary hover:bg-primary/5 hover:border-primary/45 transition-all cursor-pointer"
              >
                Edit Connection
              </button>
            )
          ) : (
            <div />
          )}

          <div className="flex items-center gap-2.5">
            {isEditing ? (
              <button
                type="button"
                onClick={handleSaveEdits}
                className="h-8 px-4 bg-green-600 hover:bg-green-700 text-white text-xs font-semibold rounded-lg hover:scale-105 active:scale-95 transition-all cursor-pointer"
              >
                Save Changes
              </button>
            ) : (
              <button
                type="button"
                onClick={onClose}
                className="h-8 px-4 bg-primary text-white text-xs font-semibold rounded-lg hover:scale-105 active:scale-95 transition-all cursor-pointer"
              >
                Close Explorer
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
