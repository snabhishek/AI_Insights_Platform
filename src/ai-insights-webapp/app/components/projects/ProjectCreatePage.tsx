"use client";

import React, { useState, useRef } from "react";
import Image from "next/image";
import {
  PostgresqlIcon,
  MysqlIcon,
  SqlServerIcon,
  SnowflakeIcon,
  MongodbIcon,
  RestApiIcon,
} from "../datasource/Icons";
import { DataSource, ConnectionConfig } from "../providers/AppContext";
import ConnectionModal from "../datasource/ConnectionModal";

// ─── Helper ───────────────────────────────────────────────────────────────────

function renderDataSourceIcon(type: string) {
  switch (type) {
    case "postgres":   return <PostgresqlIcon size={16} />;
    case "mysql":      return <MysqlIcon size={16} />;
    case "sqlserver":  return <SqlServerIcon size={16} />;
    case "snowflake":  return <SnowflakeIcon size={16} />;
    case "mongodb":    return <MongodbIcon size={16} />;
    case "excel":      return <Image src="/images/microsoft-excel.jpg" alt="Excel" width={16} height={16} className="object-contain shrink-0" />;
    case "csv":        return <Image src="/images/csv.png" alt="CSV" width={16} height={16} className="object-contain shrink-0" />;
    case "tsv":        return <Image src="/images/tsv.png" alt="TSV" width={16} height={16} className="object-contain shrink-0" />;
    case "restapi":    return <RestApiIcon size={16} />;
    default:           return null;
  }
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

const ITEMS_PER_PAGE = 6;

// ─── Props ────────────────────────────────────────────────────────────────────

interface ProjectCreatePageProps {
  dataSources: DataSource[];
  onCancel: () => void;
  onSubmit: (name: string, useCase: string, selectedSources: string[]) => void;
  onAddDataSource: (name: string, type: DataSource["type"], subtext: string, config: ConnectionConfig) => void;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function ProjectCreatePage({
  dataSources,
  onCancel,
  onSubmit,
  onAddDataSource,
}: ProjectCreatePageProps) {
  const [projectName, setProjectName]     = useState("");
  const [useCaseInfo, setUseCaseInfo]     = useState("");
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [previewMode, setPreviewMode]     = useState(false);
  const [history, setHistory]             = useState<string[]>([""]);
  const [historyIndex, setHistoryIndex]   = useState(0);
  const [sourceSearch, setSourceSearch]   = useState("");
  const [sourceTypeFilter, setSourceTypeFilter] = useState("All Types");
  const [currentPage, setCurrentPage]     = useState(1);

  const [showConnectLibrary, setShowConnectLibrary] = useState(false);
  const [activeConnectType, setActiveConnectType]   = useState<DataSource["type"] | null>(null);
  const wasSubmitClicked = useRef(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ── Helpers ──────────────────────────────────────────────────────────────

  const toggleSource = (id: string) =>
    setSelectedSources((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    );

  const insertText = (before: string, after = "") => {
    if (!textareaRef.current) return;
    const { selectionStart: start, selectionEnd: end, value } = textareaRef.current;
    const selected = value.substring(start, end);
    const newValue = value.substring(0, start) + before + selected + after + value.substring(end);
    setUseCaseInfo(newValue);
    pushHistory(newValue);
    setTimeout(() => {
      if (!textareaRef.current) return;
      textareaRef.current.focus();
      textareaRef.current.setSelectionRange(start + before.length, start + before.length + selected.length);
    }, 50);
  };

  const pushHistory = (val: string) => {
    const next = history.slice(0, historyIndex + 1);
    next.push(val);
    setHistory(next);
    setHistoryIndex(next.length - 1);
  };

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setUseCaseInfo(val);
    if (Math.abs(val.length - history[historyIndex].length) > 5) pushHistory(val);
  };

  const handleUndo = () => {
    if (historyIndex > 0) {
      const idx = historyIndex - 1;
      setHistoryIndex(idx);
      setUseCaseInfo(history[idx]);
    }
  };

  const handleRedo = () => {
    if (historyIndex < history.length - 1) {
      const idx = historyIndex + 1;
      setHistoryIndex(idx);
      setUseCaseInfo(history[idx]);
    }
  };

  const wordCount = useCaseInfo.trim() ? useCaseInfo.trim().split(/\s+/).length : 0;

  const renderMarkdown = (md: string) => {
    if (!md) return `<p class="text-muted-foreground italic text-xs">Start writing...</p>`;
    let html = md.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    html = html.replace(/^### (.*$)/gim, '<h3 class="text-base font-bold my-2 text-foreground">$1</h3>');
    html = html.replace(/^## (.*$)/gim,  '<h2 class="text-lg font-bold my-2 text-foreground">$1</h2>');
    html = html.replace(/^# (.*$)/gim,   '<h1 class="text-xl font-bold my-3 text-foreground">$1</h1>');
    html = html.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/\*(.*?)\*/g, "<em>$1</em>");
    html = html.replace(/`(.*?)`/g, '<code class="bg-surface-muted px-1.5 py-0.5 rounded font-mono text-xs text-primary">$1</code>');
    html = html.replace(/^\s*-\s+(.*$)/gim, '<li class="list-disc list-inside ml-2">$1</li>');
    html = html.replace(/\n/g, "<br />");
    return html;
  };

  // ── Filtered sources ──────────────────────────────────────────────────────

  const filteredSources = dataSources.filter((ds) => {
    const matchSearch = ds.name.toLowerCase().includes(sourceSearch.toLowerCase()) || ds.subtext.toLowerCase().includes(sourceSearch.toLowerCase());
    const cat = getSubtextCategory(ds.subtext);
    return matchSearch && (sourceTypeFilter === "All Types" || cat === sourceTypeFilter);
  });

  const totalPages     = Math.ceil(filteredSources.length / ITEMS_PER_PAGE);
  const paginatedSources = filteredSources.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);
  const startIdx = filteredSources.length === 0 ? 0 : (currentPage - 1) * ITEMS_PER_PAGE + 1;
  const endIdx   = Math.min(currentPage * ITEMS_PER_PAGE, filteredSources.length);

  // ── Submit ────────────────────────────────────────────────────────────────

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectName.trim() || !useCaseInfo.trim()) return;
    onSubmit(projectName.trim(), useCaseInfo.trim(), selectedSources);
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="p-8 w-full flex flex-col min-h-full bg-background animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Create New Project</h1>
          <p className="text-sm text-muted-foreground">Define your use case and connect the relevant data sources.</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={onCancel}
            className="px-6 py-2 border border-border bg-surface text-foreground hover:bg-surface-muted rounded-lg text-sm font-semibold cursor-pointer transition-colors shadow-sm"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!projectName.trim() || !useCaseInfo.trim()}
            className="px-6 py-2 bg-primary text-white hover:bg-primary/95 rounded-lg text-sm font-semibold cursor-pointer transition-all shadow-md hover:scale-105 active:scale-95 disabled:opacity-50 disabled:scale-100 disabled:cursor-not-allowed"
          >
            Save Project
          </button>
        </div>
      </div>

      {/* Body Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-8 items-start">
        {/* Left: Project Details */}
        <div className="bg-surface border border-border rounded-2xl p-6 shadow-soft flex flex-col">
          <h2 className="text-base font-bold text-foreground mb-6">Project Details</h2>
          <div className="space-y-6">
            {/* Name */}
            <div>
              <label className="block text-xs font-bold text-foreground uppercase tracking-wider mb-2">
                Use Case Title <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                maxLength={150}
                required
                placeholder="Enter a descriptive title for your use case"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                className="w-full h-11 px-4 rounded-lg border border-border bg-surface text-sm text-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition-all placeholder:text-muted-foreground/60"
              />
              <div className="flex justify-end mt-1 text-[10px] text-muted-foreground font-semibold">
                {projectName.length}/150
              </div>
            </div>

            {/* Use Case Editor */}
            <div>
              <label className="block text-xs font-bold text-foreground uppercase tracking-wider mb-2">
                Use Case Information <span className="text-red-500">*</span>
              </label>
              <div className="flex flex-col border border-border rounded-xl bg-surface overflow-hidden focus-within:border-primary focus-within:ring-1 focus-within:ring-primary/20 transition-all">
                {/* Toolbar */}
                <div className="flex items-center justify-between border-b border-border bg-surface-muted/30 px-3 py-1.5 select-none">
                  <div className="flex flex-wrap items-center gap-1.5 text-muted-foreground">
                    {[
                      { label: "B", title: "Bold",   action: () => insertText("**", "**"), className: "font-bold" },
                      { label: "I", title: "Italic",  action: () => insertText("*", "*"),  className: "italic"    },
                      { label: "H", title: "Heading", action: () => insertText("### ", ""), className: "font-semibold" },
                    ].map(({ label, title, action, className }) => (
                      <button
                        key={title}
                        type="button"
                        onClick={action}
                        title={title}
                        className={`p-1.5 hover:bg-surface hover:text-foreground rounded transition-colors text-xs cursor-pointer ${className}`}
                      >
                        {label}
                      </button>
                    ))}
                    <span className="h-4 w-px bg-border mx-1" />
                    <button type="button" onClick={() => insertText("- ", "")} title="Bullet List" className="p-1.5 hover:bg-surface hover:text-foreground rounded transition-colors cursor-pointer">
                      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="9" y1="6" x2="20" y2="6" /><line x1="9" y1="12" x2="20" y2="12" /><line x1="9" y1="18" x2="20" y2="18" /><circle cx="4" cy="6" r="1.5" fill="currentColor" /><circle cx="4" cy="12" r="1.5" fill="currentColor" /><circle cx="4" cy="18" r="1.5" fill="currentColor" /></svg>
                    </button>
                    <span className="h-4 w-px bg-border mx-1" />
                    <button type="button" onClick={handleUndo} disabled={historyIndex === 0} title="Undo" className="p-1.5 hover:bg-surface hover:text-foreground disabled:opacity-30 rounded transition-colors cursor-pointer">
                      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M3 7v6h6" /><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" /></svg>
                    </button>
                    <button type="button" onClick={handleRedo} disabled={historyIndex >= history.length - 1} title="Redo" className="p-1.5 hover:bg-surface hover:text-foreground disabled:opacity-30 rounded transition-colors cursor-pointer">
                      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 7v6h-6" /><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 3" /></svg>
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => setPreviewMode(!previewMode)}
                    className={`px-3 py-1 text-xs font-bold rounded-lg border transition-all cursor-pointer ${
                      previewMode ? "bg-primary text-white border-primary" : "border-border text-foreground hover:bg-surface"
                    }`}
                  >
                    Preview
                  </button>
                </div>

                {/* Editor / Preview */}
                <div className="relative">
                  {!previewMode ? (
                    <textarea
                      ref={textareaRef}
                      rows={14}
                      placeholder="Describe the purpose, goals, scope, data flow, business logic, and expected decisions or outcomes..."
                      value={useCaseInfo}
                      onChange={handleTextareaChange}
                      className="w-full p-4 text-sm text-foreground bg-transparent focus:outline-none resize-y min-h-[300px] placeholder:text-muted-foreground/60"
                    />
                  ) : (
                    <div
                      className="w-full p-4 text-sm text-foreground overflow-y-auto min-h-[300px] prose dark:prose-invert max-w-none bg-surface"
                      dangerouslySetInnerHTML={{ __html: renderMarkdown(useCaseInfo) }}
                    />
                  )}
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between border-t border-border bg-surface-muted/30 px-4 py-2 select-none">
                  <span className="text-[10px] text-muted-foreground/80 font-medium">Markdown supported</span>
                  <span className="text-[10px] text-muted-foreground/80 font-medium">{wordCount} words</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right: Connect Data Sources */}
        <div className="bg-surface border border-border rounded-2xl p-6 shadow-soft flex flex-col">
          <h2 className="text-base font-bold text-foreground mb-1">Connect Data Sources</h2>
          <p className="text-xs text-muted-foreground mb-5">Select and connect the data sources that will be used in this project.</p>

          {/* Search & Filter */}
          <div className="flex gap-3 mb-6">
            <div className="relative flex-1">
              <input
                type="text"
                placeholder="Search data sources..."
                value={sourceSearch}
                onChange={(e) => { setSourceSearch(e.target.value); setCurrentPage(1); }}
                className="w-full h-10 pl-10 pr-4 rounded-lg border border-border bg-surface text-sm text-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition-all placeholder:text-muted-foreground/60"
              />
              <span className="absolute left-3.5 top-[13px] text-muted-foreground pointer-events-none">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
              </span>
            </div>
            <select
              value={sourceTypeFilter}
              onChange={(e) => { setSourceTypeFilter(e.target.value); setCurrentPage(1); }}
              className="w-40 h-10 px-3 rounded-lg border border-border bg-surface text-xs font-semibold text-foreground focus:outline-none focus:border-primary transition-all cursor-pointer"
            >
              {["All Types", "Database", "Data Warehouse", "API", "Cloud Storage", "File"].map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>

          {/* Selected sources */}
          <div className="mb-6">
            <h3 className="text-xs font-bold text-foreground uppercase tracking-wider mb-2">
              Selected Sources ({selectedSources.length})
            </h3>
            {selectedSources.length === 0 ? (
              <div className="border-2 border-dashed border-border rounded-xl p-8 flex flex-col items-center justify-center text-center bg-surface-muted/10">
                <p className="text-xs font-bold text-foreground">No data sources selected</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">Choose data sources from below to connect to this project</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-36 overflow-y-auto border border-border/80 rounded-xl p-3 bg-surface-muted/30">
                {selectedSources.map((id) => {
                  const ds = dataSources.find((s) => s.id === id);
                  return (
                    <div key={id} className="flex items-center justify-between p-2 rounded-lg border border-primary/40 bg-surface shadow-sm">
                      <div className="flex items-center gap-2 overflow-hidden">
                        <span className="shrink-0 text-primary scale-90">{renderDataSourceIcon(ds?.type ?? "postgres")}</span>
                        <span className="text-xs font-semibold text-foreground truncate">{ds?.name ?? id}</span>
                      </div>
                      <button type="button" onClick={() => toggleSource(id)} className="p-1 rounded-md text-muted-foreground hover:bg-surface-muted hover:text-foreground cursor-pointer transition-colors">
                        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Available sources */}
          <div className="flex flex-col flex-1">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-bold text-foreground uppercase tracking-wider">Available Sources</h3>
              <button type="button" onClick={() => setShowConnectLibrary(true)} className="text-xs text-primary font-bold hover:underline cursor-pointer">
                + Connect New
              </button>
            </div>

            {paginatedSources.length > 0 ? (
              <div className="border border-border rounded-xl divide-y divide-border bg-surface overflow-hidden">
                {paginatedSources.map((ds) => {
                  const isSelected = selectedSources.includes(ds.id);
                  return (
                    <div
                      key={ds.id}
                      onClick={() => toggleSource(ds.id)}
                      className={`flex items-center justify-between p-3.5 cursor-pointer hover:bg-surface-muted/30 transition-all ${isSelected ? "bg-primary/5" : ""}`}
                    >
                      <div className="flex items-center gap-3 overflow-hidden">
                        <div className="w-8 h-8 rounded-lg bg-surface border border-border flex items-center justify-center shrink-0">
                          {renderDataSourceIcon(ds.type)}
                        </div>
                        <div className="flex flex-col overflow-hidden">
                          <span className="text-xs font-bold text-foreground truncate">{ds.name}</span>
                          <span className="text-[10px] text-muted-foreground font-semibold mt-0.5 flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-primary/45 shrink-0" />
                            {getSubtextCategory(ds.subtext)}
                          </span>
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => {}}
                        className="h-4 w-4 rounded border-border text-primary focus:ring-primary/20 accent-primary cursor-pointer"
                      />
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="border border-dashed border-border rounded-xl p-8 text-center text-xs text-muted-foreground italic bg-surface-muted/10">
                No matches found. Connect a data source in the Data Source tab.
              </div>
            )}

            {/* Pagination */}
            {filteredSources.length > 0 && (
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 mt-6 pt-4 border-t border-border/80 select-none">
                <span className="text-xs text-muted-foreground font-semibold">
                  Showing {startIdx} to {endIdx} of {filteredSources.length} sources
                </span>
                <div className="flex items-center gap-1">
                  <button type="button" disabled={currentPage === 1} onClick={() => setCurrentPage((p) => Math.max(1, p - 1))} className="w-8 h-8 border border-border hover:bg-surface-muted/50 rounded-lg flex items-center justify-center text-muted-foreground disabled:opacity-40 cursor-pointer transition-colors">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6" /></svg>
                  </button>
                  {Array.from({ length: totalPages }, (_, i) => i + 1).map((pg) => (
                    <button key={pg} onClick={() => setCurrentPage(pg)} className={`w-8 h-8 rounded-lg text-xs font-bold cursor-pointer transition-all ${currentPage === pg ? "bg-primary text-white" : "border border-border text-muted-foreground hover:bg-surface-muted/50"}`}>
                      {pg}
                    </button>
                  ))}
                  <button type="button" disabled={currentPage === totalPages} onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))} className="w-8 h-8 border border-border hover:bg-surface-muted/50 rounded-lg flex items-center justify-center text-muted-foreground disabled:opacity-40 cursor-pointer transition-colors">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6" /></svg>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Connect New Library Modal */}
      {showConnectLibrary && (
        <div className="fixed inset-0 z-[105] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
          <div className="relative w-full max-w-4xl rounded-2xl border border-border bg-surface p-6 shadow-2xl animate-fade-in flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between border-b border-border pb-4 mb-4 select-none">
              <div>
                <h3 className="text-lg font-bold text-foreground">Connect a New Data Source</h3>
                <p className="text-xs text-muted-foreground mt-0.5">Select a connector from the library below to establish a live catalog connection.</p>
              </div>
              <button onClick={() => setShowConnectLibrary(false)} className="rounded-lg p-1.5 text-muted-foreground hover:bg-surface-muted hover:text-foreground transition-colors cursor-pointer">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4 p-1 overflow-y-auto max-h-[60vh]">
              {[
                { id: "postgres"  as const, name: "PostgreSQL", description: "Connect to PostgreSQL databases",   icon: <PostgresqlIcon size={40} /> },
                { id: "mysql"     as const, name: "MySQL",      description: "Connect to MySQL databases",       icon: <MysqlIcon size={40} /> },
                { id: "sqlserver" as const, name: "SQL Server", description: "Connect to Microsoft SQL Server",  icon: <SqlServerIcon size={40} /> },
                { id: "snowflake" as const, name: "Snowflake",  description: "Connect to Snowflake Warehouse",   icon: <SnowflakeIcon size={40} /> },
                { id: "mongodb"   as const, name: "MongoDB",    description: "Connect to MongoDB databases",     icon: <MongodbIcon size={40} /> },
                { id: "excel"     as const, name: "Excel",      description: "Connect to Excel spreadsheets",    icon: <Image src="/images/microsoft-excel.jpg" alt="Excel" width={40} height={40} className="object-contain" /> },
                { id: "csv"       as const, name: "CSV",        description: "Upload and connect CSV files",     icon: <Image src="/images/csv.png" alt="CSV" width={40} height={40} className="object-contain" /> },
                { id: "tsv"       as const, name: "TSV",        description: "Upload and connect TSV files",     icon: <Image src="/images/tsv.png" alt="TSV" width={40} height={40} className="object-contain" /> },
                { id: "restapi"   as const, name: "REST API",   description: "Connect to REST API endpoints",   icon: <RestApiIcon size={40} /> },
              ].map((connector) => (
                <div key={connector.id} className="group flex flex-col items-center justify-between rounded-xl border border-border bg-surface p-4 text-center hover-lift duration-300 hover:border-primary/40">
                  <div className="flex items-center justify-center p-3 rounded-xl bg-surface-muted transition-colors group-hover:bg-primary/5">{connector.icon}</div>
                  <div className="mt-3 flex flex-col flex-1 justify-center">
                    <span className="text-sm font-bold text-foreground tracking-tight">{connector.name}</span>
                    <p className="text-[10px] text-muted-foreground leading-normal mt-1 line-clamp-2">{connector.description}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => { setActiveConnectType(connector.id); setShowConnectLibrary(false); }}
                    className="mt-4 w-full bg-primary text-white text-xs font-semibold py-1.5 px-3 rounded-lg cursor-pointer transition-all duration-200 hover:scale-105 active:scale-95 shadow-sm"
                  >
                    Connect
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Connection Modal */}
      {activeConnectType && (
        <ConnectionModal
          type={activeConnectType}
          onClose={() => {
            setActiveConnectType(null);
            if (!wasSubmitClicked.current) setShowConnectLibrary(true);
            wasSubmitClicked.current = false;
          }}
          onConnect={(name, subtext, config) => {
            wasSubmitClicked.current = true;
            onAddDataSource(name, activeConnectType, subtext, config);
            setActiveConnectType(null);
            setShowConnectLibrary(false);
          }}
        />
      )}
    </div>
  );
}
