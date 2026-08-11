"use client";

import React, { useState } from "react";
import Image from "next/image";
import { useApp, DataSource, ConnectionConfig } from "../providers/AppContext";
import {
  PostgresqlIcon,
  SnowflakeIcon,
  SqlServerIcon,
  MysqlIcon,
  MongodbIcon,
  RestApiIcon,
} from "./Icons";

interface ConnectionModalProps {
  type: DataSource["type"] | null;
  onClose: () => void;
  onConnect: (name: string, subtext: string, config: ConnectionConfig) => void;
}

const getSourceIcon = (type: DataSource["type"]) => {
  switch (type) {
    case "postgres":
      return <PostgresqlIcon size={24} />;
    case "snowflake":
      return <SnowflakeIcon size={24} />;
    case "sqlserver":
      return <SqlServerIcon size={24} />;
    case "csv":
      return <Image src="/images/csv.png" alt="CSV" width={24} height={24} className="object-contain" />;
    case "tsv":
      return <Image src="/images/tsv.png" alt="TSV" width={24} height={24} className="object-contain" />;
    case "excel":
      return <Image src="/images/microsoft-excel.jpg" alt="Excel" width={24} height={24} className="object-contain" />;
    case "mysql":
      return <MysqlIcon size={24} />;
    case "mongodb":
      return <MongodbIcon size={24} />;
    case "restapi":
      return <RestApiIcon size={24} />;
    default:
      return <PostgresqlIcon size={24} />;
  }
};

export default function ConnectionModal({
  type,
  onClose,
  onConnect,
}: ConnectionModalProps) {
  const { testConnection, dataSources } = useApp();

  const [name, setName] = useState("");
  const isDuplicate = dataSources.some(
    (ds) =>
      ds.name.toLowerCase().trim() === name.toLowerCase().trim() &&
      ds.type === type
  );
  const [host, setHost] = useState("");
  const [port, setPort] = useState("");
  const [database, setDatabase] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [account, setAccount] = useState(""); // snowflake
  const [url, setUrl] = useState(""); // restapi
  const [fileName, setFileName] = useState(""); // excel/csv/tsv
  const [fileContent, setFileContent] = useState("");

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<"success" | "error" | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [latency, setLatency] = useState<number | null>(null);

  if (!type) return null;

  const getSourceLabel = () => {
    switch (type) {
      case "postgres":
        return "PostgreSQL";
      case "mysql":
        return "MySQL";
      case "sqlserver":
        return "Microsoft SQL Server";
      case "snowflake":
        return "Snowflake Warehouse";
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

  const handleTestConnection = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (type === "restapi" && !url) {
      setTestResult("error");
      setErrorMessage("Endpoint URL is required");
      return;
    }
    if ((type === "excel" || type === "csv" || type === "tsv") && !fileName) {
      setTestResult("error");
      setErrorMessage("Please drop or choose a file first");
      return;
    }
    if (["postgres", "mysql", "sqlserver", "mongodb"].includes(type) && (!host || !database)) {
      setTestResult("error");
      setErrorMessage("Host and Database Name are required");
      return;
    }

    setTesting(true);
    setTestResult(null);
    setErrorMessage("");
    setLatency(null);

    try {
      const config: ConnectionConfig = {
        host,
        port,
        database,
        username,
        password,
        account,
        url,
        fileName,
        fileContent,
      };
      const result = await testConnection(type, config);
      setTesting(false);
      if (result.success) {
        setTestResult("success");
        setLatency(result.latencyMs);
      } else {
        setTestResult("error");
        setErrorMessage(result.message);
      }
    } catch (err: any) {
      setTesting(false);
      setTestResult("error");
      setErrorMessage(err.message || "Failed to contact validation server");
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    let subtext = "";
    if (["postgres", "mysql", "sqlserver", "mongodb"].includes(type)) {
      const defaultPort = type === "postgres" ? "5432" : type === "mysql" ? "3306" : "1433";
      subtext = `${database} • ${host}:${port || defaultPort}`;
    } else if (type === "snowflake") {
      subtext = `${database} • ${account || "snowflake"}`;
    } else if (type === "restapi") {
      subtext = `API • ${url.substring(0, 30)}${url.length > 30 ? "..." : ""}`;
    } else {
      subtext = fileName || `${name.toLowerCase()}.file`;
    }

    const config: ConnectionConfig = {
      host,
      port,
      database,
      username,
      password,
      account,
      url,
      fileName,
      fileContent,
    };

    onConnect(name, subtext, config);
    onClose();
  };

  const isFormValid = () => {
    if (!name.trim() || isDuplicate) return false;
    if (type === "restapi") return !!url;
    if (["excel", "csv", "tsv"].includes(type)) return !!fileName;
    return !!host && !!database;
  };

  const processFile = (file: File) => {
    setFileName(file.name);
    if (!name) {
      setName(file.name.split(".")[0].replace(/[-_]/g, " "));
    }

    const reader = new FileReader();
    reader.onload = (evt) => {
      setFileContent(evt.target?.result as string || "");
    };
    reader.readAsDataURL(file);
  };

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processFile(e.dataTransfer.files[0]);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/50 backdrop-blur-md animate-fade-in">
      <div className="relative w-full max-w-lg overflow-hidden rounded-xl border border-border bg-surface shadow-2xl transition-all scale-100 flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-border/80 px-5 py-3 bg-surface-muted/60">
          <div className="flex items-center gap-2.5">
            <div className="flex items-center justify-center p-1.5 rounded-lg bg-surface border border-border/20 shrink-0">
              {getSourceIcon(type)}
            </div>
            <div>
              <h3 className="text-sm font-bold text-foreground">
                Connect to {getSourceLabel()}
              </h3>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Provide authorization details to pull catalog metadata.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-background hover:text-foreground transition-colors cursor-pointer"
          >
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
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Modal Form */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 space-y-3.5">
          <div>
            <label className="block text-xs font-semibold text-muted-foreground uppercase mb-1">
              Source Connection Name *
            </label>
            <input
              type="text"
              required
              placeholder="e.g. Analytics Warehouse, Customer CSV"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full h-10 px-3.5 rounded-lg border border-border bg-surface text-sm text-foreground focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all"
            />
            {isDuplicate && (
              <p className="text-[11px] text-red-500 mt-1.5 font-bold animate-pulse">
                A data source with this name and type already exists in this workspace.
              </p>
            )}
          </div>

          {/* Database Inputs */}
          {["postgres", "mysql", "sqlserver", "snowflake", "mongodb"].includes(type) && (
            <>
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label className="block text-xs font-semibold text-muted-foreground uppercase mb-1">
                    Host / Server Address *
                  </label>
                  <input
                    type="text"
                    placeholder="192.168.1.1 or db.example.com"
                    value={host}
                    onChange={(e) => setHost(e.target.value)}
                    className="w-full h-10 px-3.5 rounded-lg border border-border bg-surface text-sm text-foreground focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground uppercase mb-1">
                    Port
                  </label>
                  <input
                    type="text"
                    placeholder={type === "postgres" ? "5432" : type === "mysql" ? "3306" : "Port"}
                    value={port}
                    onChange={(e) => setPort(e.target.value)}
                    className="w-full h-10 px-3.5 rounded-lg border border-border bg-surface text-sm text-foreground focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all"
                  />
                </div>
              </div>

              {type === "snowflake" && (
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground uppercase mb-1">
                    Snowflake Account Identifier *
                  </label>
                  <input
                    type="text"
                    placeholder="xy12345.us-east-1"
                    value={account}
                    onChange={(e) => setAccount(e.target.value)}
                    className="w-full h-10 px-3.5 rounded-lg border border-border bg-surface text-sm text-foreground focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all"
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-muted-foreground uppercase mb-1">
                  Database Name / Schema *
                </label>
                <input
                  type="text"
                  placeholder="production_db"
                  value={database}
                  onChange={(e) => setDatabase(e.target.value)}
                  className="w-full h-10 px-3.5 rounded-lg border border-border bg-surface text-sm text-foreground focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground uppercase mb-1">
                    Username
                  </label>
                  <input
                    type="text"
                    placeholder="admin_user"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="w-full h-10 px-3.5 rounded-lg border border-border bg-surface text-sm text-foreground focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground uppercase mb-1">
                    Password
                  </label>
                  <input
                    type="password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full h-10 px-3.5 rounded-lg border border-border bg-surface text-sm text-foreground focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all"
                  />
                </div>
              </div>
            </>
          )}

          {/* File Upload zone */}
          {["excel", "csv", "tsv"].includes(type) && (
            <div>
              <label className="block text-xs font-semibold text-muted-foreground uppercase mb-1">
                Upload File *
              </label>
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleFileDrop}
                className="border-2 border-dashed border-border hover:border-primary/50 rounded-xl p-8 text-center bg-surface-muted hover:bg-primary/[0.02] transition-colors cursor-pointer"
                onClick={() => {
                  const fileInput = document.createElement("input");
                  fileInput.type = "file";
                  fileInput.accept = type === "csv" ? ".csv" : type === "tsv" ? ".tsv" : ".xlsx,.xls";
                  fileInput.onchange = (e) => {
                    const files = (e.target as HTMLInputElement).files;
                    if (files && files[0]) {
                      processFile(files[0]);
                    }
                  };
                  fileInput.click();
                }}
              >
                <div className="flex flex-col items-center justify-center gap-2">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="32"
                    height="32"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="text-muted-foreground"
                  >
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />
                  </svg>
                  {fileName ? (
                    <div className="mt-1">
                      <p className="text-sm font-semibold text-primary">{fileName}</p>
                      <p className="text-xs text-muted-foreground">Click or drop to replace file</p>
                    </div>
                  ) : (
                    <div>
                      <p className="text-sm font-semibold text-foreground">
                        Drag and drop your file here
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        or click to browse from folders
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* REST API inputs */}
          {type === "restapi" && (
            <>
              <div>
                <label className="block text-xs font-semibold text-muted-foreground uppercase mb-1">
                  API Endpoint URL *
                </label>
                <input
                  type="url"
                  required
                  placeholder="https://api.example.com/v1/data"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  className="w-full h-10 px-3.5 rounded-lg border border-border bg-surface text-sm text-foreground focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-muted-foreground uppercase mb-1">
                  HTTP Method
                </label>
                <select className="w-full h-10 px-3.5 rounded-lg border border-border bg-surface text-sm text-foreground focus:outline-none focus:border-primary transition-all">
                  <option value="GET">GET</option>
                  <option value="POST">POST</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-muted-foreground uppercase mb-1">
                  Headers (JSON Format)
                </label>
                <textarea
                  rows={3}
                  placeholder='{ "Authorization": "Bearer token_value" }'
                  className="w-full p-3 rounded-lg border border-border bg-surface text-sm text-foreground focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all font-mono"
                />
              </div>
            </>
          )}

          {/* Test Connection Results */}
          {testing && (
            <div className="flex items-center gap-2 text-sm text-primary animate-pulse">
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25" />
                <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              <span>Verifying server connection metrics...</span>
            </div>
          )}

          {testResult === "success" && (
            <div className="rounded-lg bg-green-500/10 p-3 text-xs font-semibold text-green-600 dark:text-green-400 flex items-center gap-2 border border-green-500/20">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
              <span>Connection check successful! Database is accessible.{latency !== null && ` (Latency: ${latency}ms)`}</span>
            </div>
          )}

          {testResult === "error" && (
            <div className="rounded-lg bg-red-500/10 p-3 text-xs font-semibold text-red-600 dark:text-red-400 flex items-center gap-2 border border-red-500/20">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
              <span>{errorMessage || "Connection failed. Please check inputs."}</span>
            </div>
          )}
        </form>

        {/* Modal Footer */}
        <div className="flex items-center justify-between border-t border-border/80 px-5 py-3 bg-surface-muted/60">
          {!["excel", "csv", "tsv"].includes(type) ? (
            <button
              type="button"
              onClick={handleTestConnection}
              disabled={testing || isDuplicate}
              className="h-8 px-3.5 rounded-lg border border-border text-xs font-semibold text-foreground hover:bg-surface hover:border-foreground/30 transition-all cursor-pointer disabled:opacity-50"
            >
              Test Connection
            </button>
          ) : (
            <div />
          )}

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="h-8 px-3.5 rounded-lg border border-border text-xs font-semibold text-foreground hover:bg-surface hover:border-foreground/30 transition-all cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!isFormValid() || testing}
              className="h-8 px-4 bg-primary text-white text-xs font-semibold rounded-lg hover:scale-105 active:scale-95 transition-all cursor-pointer disabled:opacity-50 disabled:scale-100"
            >
              Save Connector
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
