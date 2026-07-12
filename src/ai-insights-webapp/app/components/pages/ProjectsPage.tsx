"use client";

import React, { useState, useEffect, useRef } from "react";
import Image from "next/image";
import {
  PostgresqlIcon,
  MysqlIcon,
  SqlServerIcon,
  SnowflakeIcon,
  MongodbIcon,
  RestApiIcon,
} from "../datasource/Icons";
import { useApp, Project, DataSource } from "../providers/AppContext";
import ConnectionModal from "../datasource/ConnectionModal";

const renderDataSourceIcon = (type: string) => {
  switch (type) {
    case "postgres":
      return <PostgresqlIcon size={16} />;
    case "mysql":
      return <MysqlIcon size={16} />;
    case "sqlserver":
      return <SqlServerIcon size={16} />;
    case "snowflake":
      return <SnowflakeIcon size={16} />;
    case "mongodb":
      return <MongodbIcon size={16} />;
    case "excel":
      return <Image src="/images/microsoft-excel.jpg" alt="Excel" width={16} height={16} className="object-contain shrink-0" />;
    case "csv":
      return <Image src="/images/csv.png" alt="CSV" width={16} height={16} className="object-contain shrink-0" />;
    case "tsv":
      return <Image src="/images/tsv.png" alt="TSV" width={16} height={16} className="object-contain shrink-0" />;
    case "restapi":
      return <RestApiIcon size={16} />;
    default:
      return null;
  }
};

type RoleFilter = "all" | "OWNER" | "MEMBER";

export default function ProjectsPage() {
  const { projects, addProject, deleteProject, dataSources, activeWorkspaceId, showConfirm, setActiveWorkspaceId, addDataSource } = useApp();
  const [searchTerm, setSearchTerm] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");

  // Connect new overlay states
  const [showConnectNewLibraryModal, setShowConnectNewLibraryModal] = useState(false);
  const [activeConnectType, setActiveConnectType] = useState<DataSource["type"] | null>(null);
  const wasSubmitClicked = useRef(false);

  // Create Screen toggle
  const [isCreating, setIsCreating] = useState(false);

  // New Project Form State
  const [newProjectName, setNewProjectName] = useState("");
  const [newUseCaseInfo, setNewUseCaseInfo] = useState("");
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [previewMode, setPreviewMode] = useState(false);

  // History stack for Undo/Redo
  const [history, setHistory] = useState<string[]>([""]);
  const [historyIndex, setHistoryIndex] = useState(0);

  // Search/Filter sources in Create form
  const [sourceSearch, setSourceSearch] = useState("");
  const [sourceTypeFilter, setSourceTypeFilter] = useState<string>("All Types");
  const [currentPage, setCurrentPage] = useState(1);

  // Dropdown States
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setActiveMenuId(null);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  const handleCreateProjectSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProjectName.trim() || !newUseCaseInfo.trim()) return;

    const areSourceArraysEqual = (arr1: string[], arr2: string[]) => {
      if (arr1.length !== arr2.length) return false;
      const sorted1 = [...arr1].sort();
      const sorted2 = [...arr2].sort();
      return sorted1.every((val, index) => val === sorted2[index]);
    };
    
    const isDuplicate = projects.some(
      (p) =>
        p.name.toLowerCase() === newProjectName.trim().toLowerCase() &&
        areSourceArraysEqual(p.dataSources || [], selectedSources)
    );
    
    if (isDuplicate) {
      showConfirm({
        title: "Duplicate Project Alert",
        message: `A project with name "${newProjectName.trim()}" and the same selected data sources already exists in this workspace.`,
        confirmText: "OK",
        cancelText: "",
        onConfirm: () => {},
      });
      return;
    }

    addProject(newProjectName.trim(), "OWNER", selectedSources, newUseCaseInfo.trim());
    
    // Reset Form
    resetForm();
  };

  const resetForm = () => {
    setNewProjectName("");
    setNewUseCaseInfo("");
    setSelectedSources([]);
    setSourceSearch("");
    setSourceTypeFilter("All Types");
    setCurrentPage(1);
    setIsCreating(false);
    setPreviewMode(false);
    setHistory([""]);
    setHistoryIndex(0);
  };

  const toggleSourceSelection = (id: string) => {
    setSelectedSources((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    );
  };

  // Textarea toolbar formatting helpers
  const insertTextAtCursor = (before: string, after: string = "") => {
    if (!textareaRef.current) return;
    const start = textareaRef.current.selectionStart;
    const end = textareaRef.current.selectionEnd;
    const text = textareaRef.current.value;
    const selected = text.substring(start, end);
    const replacement = before + selected + after;
    const newValue = text.substring(0, start) + replacement + text.substring(end);
    
    setNewUseCaseInfo(newValue);
    
    // Update history
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(newValue);
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);

    setTimeout(() => {
      if (!textareaRef.current) return;
      textareaRef.current.focus();
      textareaRef.current.setSelectionRange(start + before.length, start + before.length + selected.length);
    }, 50);
  };

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setNewUseCaseInfo(val);
    
    // Simple debounce/throttle for typing history
    if (Math.abs(val.length - history[historyIndex].length) > 5) {
      const newHistory = history.slice(0, historyIndex + 1);
      newHistory.push(val);
      setHistory(newHistory);
      setHistoryIndex(newHistory.length - 1);
    }
  };

  const handleUndo = () => {
    if (historyIndex > 0) {
      const idx = historyIndex - 1;
      setHistoryIndex(idx);
      setNewUseCaseInfo(history[idx]);
    }
  };

  const handleRedo = () => {
    if (historyIndex < history.length - 1) {
      const idx = historyIndex + 1;
      setHistoryIndex(idx);
      setNewUseCaseInfo(history[idx]);
    }
  };

  const wordCount = newUseCaseInfo.trim() ? newUseCaseInfo.trim().split(/\s+/).length : 0;

  // Simple Markdown Renderer for Preview Panel
  const renderMarkdown = (md: string) => {
    if (!md) return `<p class="text-muted-foreground italic text-xs">Describe the purpose, goals, scope, data flow, business logic, and expected decisions or outcomes...</p>`;
    
    let html = md
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    
    // Headers (### Header)
    html = html.replace(/^### (.*$)/gim, '<h3 class="text-base font-bold my-2 text-foreground">$1</h3>');
    html = html.replace(/^## (.*$)/gim, '<h2 class="text-lg font-bold my-2 text-foreground">$1</h2>');
    html = html.replace(/^# (.*$)/gim, '<h1 class="text-xl font-bold my-3 text-foreground">$1</h1>');
    
    // Bold (**text** or __text__)
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/__(.*?)__/g, '<strong>$1</strong>');
    
    // Italic (*text* or _text_)
    html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
    html = html.replace(/_(.*?)_/g, '<em>$1</em>');
    
    // Blockquotes (> text)
    html = html.replace(/^\> (.*$)/gim, '<blockquote class="border-l-4 border-primary/40 pl-3 italic my-2 text-muted-foreground">$1</blockquote>');
    
    // Inline code (`code`)
    html = html.replace(/`(.*?)`/g, '<code class="bg-surface-muted px-1.5 py-0.5 rounded font-mono text-xs text-primary">$1</code>');
    
    // Code blocks (```code```)
    html = html.replace(/```([\s\S]*?)```/g, '<pre class="bg-surface-muted p-3 rounded-lg font-mono text-xs text-foreground overflow-auto my-2">$1</pre>');
    
    // Links ([text](url))
    html = html.replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-primary hover:underline">$1</a>');
    
    // Bullet lists (- item)
    html = html.replace(/^\s*-\s+(.*$)/gim, '<li class="list-disc list-inside ml-2">$1</li>');
    html = html.replace(/^\s*\*\s+(.*$)/gim, '<li class="list-disc list-inside ml-2">$1</li>');
    
    // Ordered lists (1. item)
    html = html.replace(/^\s*\d+\.\s+(.*$)/gim, '<li class="list-decimal list-inside ml-2">$1</li>');
    
    // Tables
    html = html.replace(/\|(.+)\|/g, (match) => {
      const cells = match.split("|").slice(1, -1);
      return `<tr class="border-b border-border">${cells.map(c => `<td class="p-2 border border-border">${c.trim()}</td>`).join("")}</tr>`;
    });
    
    // Line breaks
    html = html.replace(/\n/g, '<br />');
    
    return html;
  };

  // Filter projects by workspace, search term, and role
  const workspaceProjects = projects.filter((p) => p.workspaceId === activeWorkspaceId);
  
  let filteredProjects = workspaceProjects.filter((p) =>
    p.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (roleFilter !== "all") {
    filteredProjects = filteredProjects.filter((p) => p.role === roleFilter);
  }

  // Filter and paginated data sources in create project view
  const getSubtextCategory = (subtext: string): string => {
    const s = subtext.toLowerCase();
    if (s.includes("warehouse")) return "Data Warehouse";
    if (s.includes("database")) return "Database";
    if (s.includes("api")) return "API";
    if (s.includes("cloud") || s.includes("storage")) return "Cloud Storage";
    if (s.includes("file")) return "File";
    return "Database";
  };

  const filteredSources = dataSources.filter((ds) => {
    const matchesSearch = ds.name.toLowerCase().includes(sourceSearch.toLowerCase()) || 
                          ds.subtext.toLowerCase().includes(sourceSearch.toLowerCase());
    const sourceCategory = getSubtextCategory(ds.subtext);
    const matchesType = sourceTypeFilter === "All Types" || sourceCategory === sourceTypeFilter;
    return matchesSearch && matchesType;
  });

  const ITEMS_PER_PAGE = 6;
  const totalPages = Math.ceil(filteredSources.length / ITEMS_PER_PAGE);
  const paginatedSources = filteredSources.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  );

  const startIdx = filteredSources.length === 0 ? 0 : (currentPage - 1) * ITEMS_PER_PAGE + 1;
  const endIdx = Math.min(currentPage * ITEMS_PER_PAGE, filteredSources.length);

  // Return full Create Project page design matching visual style
  if (isCreating) {
    return (
      <div className="p-8 w-full flex flex-col min-h-full bg-background animate-fade-in">
        {/* Header section with buttons */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
          <div className="flex flex-col gap-1.5">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              Create New Project
            </h1>
            <p className="text-sm text-muted-foreground">
              Define your use case and connect the relevant data sources.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={resetForm}
              className="px-6 py-2 border border-border bg-surface text-foreground hover:bg-surface-muted rounded-lg text-sm font-semibold cursor-pointer transition-colors shadow-sm"
            >
              Cancel
            </button>
            <button
              onClick={handleCreateProjectSubmit}
              disabled={!newProjectName.trim() || !newUseCaseInfo.trim()}
              className="px-6 py-2 bg-primary text-white hover:bg-primary/95 rounded-lg text-sm font-semibold cursor-pointer transition-all shadow-md hover:scale-105 active:scale-95 disabled:opacity-50 disabled:scale-100 disabled:cursor-not-allowed"
            >
              Save Project
            </button>
          </div>
        </div>

        {/* Form Body Split Column Grid */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-8 items-start">
          
          {/* Left Panel: Project Details */}
          <div className="bg-surface border border-border rounded-2xl p-6 shadow-soft flex flex-col">
            <h2 className="text-base font-bold text-foreground mb-6">
              Project Details
            </h2>

            <div className="space-y-6">
              {/* Use Case Title */}
              <div>
                <label className="block text-xs font-bold text-foreground uppercase tracking-wider mb-2">
                  Use Case Title <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  maxLength={150}
                  required
                  placeholder="Enter a descriptive title for your use case"
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  className="w-full h-11 px-4 rounded-lg border border-border bg-surface text-sm text-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition-all placeholder:text-muted-foreground/60"
                />
                <div className="flex justify-end mt-1 text-[10px] text-muted-foreground font-semibold">
                  {newProjectName.length}/150
                </div>
              </div>

              {/* Use Case Information Editor */}
              <div>
                <label className="block text-xs font-bold text-foreground uppercase tracking-wider mb-2">
                  Use Case Information <span className="text-red-500">*</span>
                </label>
                
                {/* Editor Toolbar container */}
                <div className="flex flex-col border border-border rounded-xl bg-surface overflow-hidden focus-within:border-primary focus-within:ring-1 focus-within:ring-primary/20 transition-all">
                  
                  {/* Toolbar Row */}
                  <div className="flex items-center justify-between border-b border-border bg-surface-muted/30 px-3 py-1.5 select-none">
                    <div className="flex flex-wrap items-center gap-1.5 text-muted-foreground">
                      <button
                        type="button"
                        onClick={() => insertTextAtCursor("**", "**")}
                        title="Bold"
                        className="p-1.5 hover:bg-surface hover:text-foreground rounded transition-colors text-xs font-bold cursor-pointer"
                      >
                        B
                      </button>
                      <button
                        type="button"
                        onClick={() => insertTextAtCursor("*", "*")}
                        title="Italic"
                        className="p-1.5 hover:bg-surface hover:text-foreground rounded transition-colors text-xs italic cursor-pointer"
                      >
                        I
                      </button>
                      <button
                        type="button"
                        onClick={() => insertTextAtCursor("### ", "")}
                        title="Heading"
                        className="p-1.5 hover:bg-surface hover:text-foreground rounded transition-colors text-xs font-semibold cursor-pointer"
                      >
                        H
                      </button>
                      
                      <span className="h-4 w-px bg-border mx-1" />

                      <button
                        type="button"
                        onClick={() => insertTextAtCursor("- ", "")}
                        title="Bullet List"
                        className="p-1.5 hover:bg-surface hover:text-foreground rounded transition-colors cursor-pointer"
                      >
                        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <line x1="9" y1="6" x2="20" y2="6" /><line x1="9" y1="12" x2="20" y2="12" /><line x1="9" y1="18" x2="20" y2="18" />
                          <circle cx="4" cy="6" r="1.5" fill="currentColor" /><circle cx="4" cy="12" r="1.5" fill="currentColor" /><circle cx="4" cy="18" r="1.5" fill="currentColor" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        onClick={() => insertTextAtCursor("1. ", "")}
                        title="Numbered List"
                        className="p-1.5 hover:bg-surface hover:text-foreground rounded transition-colors cursor-pointer"
                      >
                        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <line x1="10" y1="6" x2="21" y2="6" /><line x1="10" y1="12" x2="21" y2="12" /><line x1="10" y1="18" x2="21" y2="18" />
                          <path d="M4 6h1v4M4 10h3M4 14h3v2a1 1 0 0 1-1 1H4v2h3" />
                        </svg>
                      </button>

                      <span className="h-4 w-px bg-border mx-1" />

                      <button
                        type="button"
                        onClick={() => insertTextAtCursor("[", "](url)")}
                        title="Insert Link"
                        className="p-1.5 hover:bg-surface hover:text-foreground rounded transition-colors cursor-pointer"
                      >
                        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        onClick={() => insertTextAtCursor("```\n", "\n```")}
                        title="Code Block"
                        className="p-1.5 hover:bg-surface hover:text-foreground rounded transition-colors cursor-pointer"
                      >
                        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        onClick={() => insertTextAtCursor("> ", "")}
                        title="Blockquote"
                        className="p-1.5 hover:bg-surface hover:text-foreground rounded transition-colors cursor-pointer"
                      >
                        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        onClick={() => insertTextAtCursor("| Col 1 | Col 2 |\n|---|---|\n| Val 1 | Val 2 |")}
                        title="Insert Table"
                        className="p-1.5 hover:bg-surface hover:text-foreground rounded transition-colors cursor-pointer"
                      >
                        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <path d="M3 3h18v18H3zM3 9h18M3 15h18M12 3v18" />
                        </svg>
                      </button>

                      <span className="h-4 w-px bg-border mx-1" />

                      <button
                        type="button"
                        onClick={() => insertTextAtCursor("  - ", "")}
                        title="Bullet List Sub-level"
                        className="p-1.5 hover:bg-surface hover:text-foreground rounded transition-colors cursor-pointer"
                      >
                        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <polyline points="9 18 15 12 9 6" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        onClick={() => insertTextAtCursor("- ", "")}
                        title="Bullet List Main-level"
                        className="p-1.5 hover:bg-surface hover:text-foreground rounded transition-colors cursor-pointer"
                      >
                        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <polyline points="15 18 9 12 15 6" />
                        </svg>
                      </button>

                      <span className="h-4 w-px bg-border mx-1" />

                      <button
                        type="button"
                        onClick={handleUndo}
                        disabled={historyIndex === 0}
                        title="Undo"
                        className="p-1.5 hover:bg-surface hover:text-foreground disabled:opacity-30 rounded transition-colors cursor-pointer"
                      >
                        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <path d="M3 7v6h6" /><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        onClick={handleRedo}
                        disabled={historyIndex >= history.length - 1}
                        title="Redo"
                        className="p-1.5 hover:bg-surface hover:text-foreground disabled:opacity-30 rounded transition-colors cursor-pointer"
                      >
                        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <path d="M21 7v6h-6" /><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 3" />
                        </svg>
                      </button>
                    </div>

                    {/* Preview Switcher */}
                    <button
                      type="button"
                      onClick={() => setPreviewMode(!previewMode)}
                      className={`px-3 py-1 text-xs font-bold rounded-lg border transition-all cursor-pointer ${
                        previewMode 
                          ? "bg-primary text-white border-primary" 
                          : "border-border text-foreground hover:bg-surface"
                      }`}
                    >
                      Preview
                    </button>
                  </div>

                  {/* Editor Box */}
                  <div className="relative">
                    {!previewMode ? (
                      <textarea
                        ref={textareaRef}
                        rows={14}
                        placeholder="Describe the purpose, goals, scope, data flow, business logic, and expected decisions or outcomes..."
                        value={newUseCaseInfo}
                        onChange={handleTextareaChange}
                        className="w-full p-4 text-sm text-foreground bg-transparent focus:outline-none resize-y min-h-[300px] placeholder:text-muted-foreground/60"
                      />
                    ) : (
                      <div
                        className="w-full p-4 text-sm text-foreground overflow-y-auto min-h-[300px] prose dark:prose-invert max-w-none bg-surface"
                        dangerouslySetInnerHTML={{ __html: renderMarkdown(newUseCaseInfo) }}
                      />
                    )}
                  </div>

                  {/* Editor Footer */}
                  <div className="flex items-center justify-between border-t border-border bg-surface-muted/30 px-4 py-2 select-none">
                    <span className="text-[10px] text-muted-foreground/80 font-medium">
                      Markdown supported
                    </span>
                    <span className="text-[10px] text-muted-foreground/80 font-medium">
                      {wordCount} words
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Right Panel: Connect Data Sources */}
          <div className="bg-surface border border-border rounded-2xl p-6 shadow-soft flex flex-col">
            <h2 className="text-base font-bold text-foreground mb-1">
              Connect Data Sources
            </h2>
            <p className="text-xs text-muted-foreground mb-5">
              Select and connect the data sources that will be used in this project.
            </p>

            {/* Search and Filters row */}
            <div className="flex gap-3 mb-6">
              <div className="relative flex-1">
                <input
                  type="text"
                  placeholder="Search data sources..."
                  value={sourceSearch}
                  onChange={(e) => {
                    setSourceSearch(e.target.value);
                    setCurrentPage(1);
                  }}
                  className="w-full h-10 pl-10 pr-4 rounded-lg border border-border bg-surface text-sm text-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition-all placeholder:text-muted-foreground/60"
                />
                <span className="absolute left-3.5 top-[13px] text-muted-foreground pointer-events-none">
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                </span>
              </div>

              <select
                value={sourceTypeFilter}
                onChange={(e) => {
                  setSourceTypeFilter(e.target.value);
                  setCurrentPage(1);
                }}
                className="w-40 h-10 px-3 rounded-lg border border-border bg-surface text-xs font-semibold text-foreground focus:outline-none focus:border-primary transition-all cursor-pointer"
              >
                <option value="All Types">All Types</option>
                <option value="Database">Database</option>
                <option value="Data Warehouse">Data Warehouse</option>
                <option value="API">API</option>
                <option value="Cloud Storage">Cloud Storage</option>
                <option value="File">File</option>
              </select>
            </div>

            {/* Selected Sources Box */}
            <div className="mb-6">
              <h3 className="text-xs font-bold text-foreground uppercase tracking-wider mb-2">
                Selected Sources ({selectedSources.length})
              </h3>
              
              {selectedSources.length === 0 ? (
                <div className="border-2 border-dashed border-border rounded-xl p-8 flex flex-col items-center justify-center text-center bg-surface-muted/10">
                  <div className="w-10 h-10 rounded-full bg-muted-foreground/5 flex items-center justify-center text-muted-foreground/60 mb-2">
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                    </svg>
                  </div>
                  <p className="text-xs font-bold text-foreground">No data sources selected</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Choose data sources from below to connect to this project
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-36 overflow-y-auto border border-border/80 rounded-xl p-3 bg-surface-muted/30">
                  {selectedSources.map((id) => {
                    const ds = dataSources.find((s) => s.id === id) || {
                      name: "Unknown Source",
                      type: "postgres" as const,
                    };
                    return (
                      <div
                        key={id}
                        className="flex items-center justify-between p-2 rounded-lg border border-primary/40 bg-surface shadow-sm"
                      >
                        <div className="flex items-center gap-2 overflow-hidden">
                          <span className="shrink-0 text-primary scale-90">{renderDataSourceIcon(ds.type)}</span>
                          <span className="text-xs font-semibold text-foreground truncate">{ds.name}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => toggleSourceSelection(id)}
                          className="p-1 rounded-md text-muted-foreground hover:bg-surface-muted hover:text-foreground cursor-pointer transition-colors"
                        >
                          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                          </svg>
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Available Sources List */}
            <div className="flex flex-col flex-1">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-bold text-foreground uppercase tracking-wider">
                  Available Sources
                </h3>
                <button
                  type="button"
                  onClick={() => setShowConnectNewLibraryModal(true)}
                  className="text-xs text-primary font-bold hover:underline cursor-pointer flex items-center gap-1"
                >
                  <span>+ Connect New</span>
                </button>
              </div>

              {paginatedSources.length > 0 ? (
                <div className="border border-border rounded-xl divide-y divide-border bg-surface overflow-hidden">
                  {paginatedSources.map((ds) => {
                    const isSelected = selectedSources.includes(ds.id);
                    return (
                      <div
                        key={ds.id}
                        onClick={() => toggleSourceSelection(ds.id)}
                        className={`flex items-center justify-between p-3.5 cursor-pointer hover:bg-surface-muted/30 transition-all ${
                          isSelected ? "bg-primary/5 hover:bg-primary/5" : ""
                        }`}
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
                          onChange={() => {}} // Controlled by row onClick
                          className="h-4.5 w-4.5 rounded border-border text-primary focus:ring-primary/20 accent-primary cursor-pointer"
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

              {/* Pagination controls */}
              {filteredSources.length > 0 && (
                <div className="flex flex-col sm:flex-row items-center justify-between gap-3 mt-6 pt-4 border-t border-border/80 select-none">
                  <span className="text-xs text-muted-foreground font-semibold">
                    Showing {startIdx} to {endIdx} of {filteredSources.length} sources
                  </span>
                  
                  <div className="flex items-center gap-1">
                    {/* Previous Page */}
                    <button
                      type="button"
                      disabled={currentPage === 1}
                      onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                      className="w-8 h-8 border border-border hover:bg-surface-muted/50 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent cursor-pointer transition-colors"
                    >
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <polyline points="15 18 9 12 15 6" />
                      </svg>
                    </button>

                    {/* Page Numbers */}
                    {Array.from({ length: totalPages }, (_, i) => i + 1).map((pg) => (
                      <button
                        key={pg}
                        onClick={() => setCurrentPage(pg)}
                        className={`w-8 h-8 rounded-lg text-xs font-bold cursor-pointer transition-all ${
                          currentPage === pg
                            ? "bg-primary text-white"
                            : "border border-border text-muted-foreground hover:bg-surface-muted/50 hover:text-foreground"
                        }`}
                      >
                        {pg}
                      </button>
                    ))}

                    {/* Next Page */}
                    <button
                      type="button"
                      disabled={currentPage === totalPages}
                      onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                      className="w-8 h-8 border border-border hover:bg-surface-muted/50 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent cursor-pointer transition-colors"
                    >
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Connector Library Overlay Modal (in Creation View) */}
        {showConnectNewLibraryModal && (
          <div className="fixed inset-0 z-[105] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
            <div className="relative w-full max-w-4xl rounded-2xl border border-border bg-surface p-6 shadow-2xl animate-fade-in flex flex-col max-h-[90vh]">
              {/* Modal Header */}
              <div className="flex items-center justify-between border-b border-border pb-4 mb-4 select-none">
                <div>
                  <h3 className="text-lg font-bold text-foreground">
                    Connect a New Data Source
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Select a connector from the library below to establish a live catalog connection.
                  </p>
                </div>
                <button
                  onClick={() => setShowConnectNewLibraryModal(false)}
                  className="rounded-lg p-1.5 text-muted-foreground hover:bg-surface-muted hover:text-foreground transition-colors cursor-pointer"
                >
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>

              {/* Library Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4 p-1 overflow-y-auto max-h-[60vh]">
                {[
                  {
                    id: "postgres" as const,
                    name: "PostgreSQL",
                    description: "Connect to PostgreSQL databases",
                    icon: <PostgresqlIcon size={40} />,
                  },
                  {
                    id: "mysql" as const,
                    name: "MySQL",
                    description: "Connect to MySQL databases",
                    icon: <MysqlIcon size={40} />,
                  },
                  {
                    id: "sqlserver" as const,
                    name: "SQL Server",
                    description: "Connect to Microsoft SQL Server",
                    icon: <SqlServerIcon size={40} />,
                  },
                  {
                    id: "snowflake" as const,
                    name: "Snowflake",
                    description: "Connect to Snowflake Warehouse",
                    icon: <SnowflakeIcon size={40} />,
                  },
                  {
                    id: "mongodb" as const,
                    name: "MongoDB",
                    description: "Connect to MongoDB databases",
                    icon: <MongodbIcon size={40} />,
                  },
                  {
                    id: "excel" as const,
                    name: "Excel",
                    description: "Connect to Excel spreadsheets",
                    icon: <Image src="/images/microsoft-excel.jpg" alt="Excel" width={40} height={40} className="object-contain" />,
                  },
                  {
                    id: "csv" as const,
                    name: "CSV",
                    description: "Upload and connect CSV files",
                    icon: <Image src="/images/csv.png" alt="CSV" width={40} height={40} className="object-contain" />,
                  },
                  {
                    id: "tsv" as const,
                    name: "TSV",
                    description: "Upload and connect TSV files",
                    icon: <Image src="/images/tsv.png" alt="TSV" width={40} height={40} className="object-contain" />,
                  },
                  {
                    id: "restapi" as const,
                    name: "REST API",
                    description: "Connect to REST API endpoints",
                    icon: <RestApiIcon size={40} />,
                  },
                ].map((connector) => (
                  <div
                    key={connector.id}
                    className="group flex flex-col items-center justify-between rounded-xl border border-border bg-surface p-4 text-center hover-lift duration-300 hover:border-primary/40"
                  >
                    <div className="flex items-center justify-center p-3 rounded-xl bg-surface-muted transition-colors group-hover:bg-primary/5">
                      {connector.icon}
                    </div>
                    <div className="mt-3 flex flex-col flex-1 justify-center">
                      <span className="text-sm font-bold text-foreground tracking-tight">
                        {connector.name}
                      </span>
                      <p className="text-[10px] text-muted-foreground leading-normal mt-1 max-h-[32px] overflow-hidden text-ellipsis line-clamp-2">
                        {connector.description}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setActiveConnectType(connector.id);
                        setShowConnectNewLibraryModal(false);
                      }}
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

        {/* Connection Popup Modal overlay (in Creation View) */}
        {activeConnectType && (
          <ConnectionModal
            type={activeConnectType}
            onClose={() => {
              setActiveConnectType(null);
              if (!wasSubmitClicked.current) {
                setShowConnectNewLibraryModal(true);
              }
              wasSubmitClicked.current = false;
            }}
            onConnect={(name, subtext, config) => {
              wasSubmitClicked.current = true;
              addDataSource(name, activeConnectType, subtext, config);
              setActiveConnectType(null);
              setShowConnectNewLibraryModal(false);
            }}
          />
        )}
      </div>
    );
  }

  // Fallback default: render list of project folders
  return (
    <div className="p-8 w-full flex flex-col min-h-full">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">
            My Projects
          </h1>
          <p className="text-sm text-muted-foreground">
            Group your work, link database catalogs, and invite collaborators.
          </p>
        </div>

        {/* Search and Filters */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-full sm:w-60">
            <input
              type="text"
              placeholder="Search projects..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full h-9 pl-9 pr-4 rounded-lg border border-border bg-surface text-sm text-foreground focus:outline-none focus:border-primary transition-colors"
            />
            <span className="absolute left-3 top-[10px] text-muted-foreground pointer-events-none z-10">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
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

          <div className="flex gap-1 bg-surface-muted p-0.5 rounded-lg border border-border text-xs font-semibold">
            {(["all", "OWNER", "MEMBER"] as const).map((role) => (
              <button
                key={role}
                onClick={() => setRoleFilter(role)}
                className={`px-3 py-1.5 rounded-md cursor-pointer transition-all ${
                  roleFilter === role
                    ? "bg-surface text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {role === "all" ? "All Roles" : role}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Project Cards Grid */}
      <div className="flex flex-wrap gap-5">
        {/* New Project Card Trigger */}
        <div
          onClick={() => setIsCreating(true)}
          style={{ width: 248, minHeight: 220 }}
          className="flex flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed border-primary/30 bg-gradient-to-br from-primary/5 via-surface to-surface p-6 text-center cursor-pointer transition-all duration-300 hover:border-primary hover:shadow-soft-hover hover:-translate-y-1.5 group"
        >
          {/* Pulsing visual icon with gradient background */}
          <div className="w-12 h-12 rounded-full bg-gradient-to-tr from-primary to-indigo-600 flex items-center justify-center text-white shadow-md transform transition-transform duration-500 group-hover:rotate-90 group-hover:scale-110">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </div>
          
          <div className="flex flex-col items-center">
            <p className="text-sm font-bold text-foreground tracking-tight group-hover:text-primary transition-colors">
              Create New Project
            </p>
            <p className="text-[11px] text-muted-foreground mt-1.5 leading-normal max-w-[190px]">
              Configure use case detail and link connected data catalogs.
            </p>
          </div>
        </div>

        {/* Project Cards */}
        {filteredProjects.map((project) => (
          <div
            key={project.id}
            style={{ width: 248 }}
            className="relative flex flex-col rounded-2xl border border-border bg-surface shadow-soft hover-lift duration-300"
          >
            {/* Folder tab shape */}
            <div className="absolute -top-[8px] left-4 w-[40%] h-3 bg-primary rounded-t-md" />

            {/* Card Body */}
            <div className="flex flex-col flex-1 p-4 pt-5">
              {/* Top row: folder icon + role badge */}
              <div className="flex items-start justify-between mb-3">
                <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    className="text-primary"
                  >
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                  </svg>
                </div>
                <div className="flex items-center gap-1">
                  <span
                    className={`text-[10px] font-bold tracking-wider px-2 py-0.5 rounded-full border ${
                      project.role === "OWNER"
                        ? "text-primary border-primary/30 bg-primary/5"
                        : "text-muted-foreground border-border bg-surface-muted"
                    }`}
                  >
                    {project.role}
                  </span>

                  {/* Delete Button */}
                  <button
                    onClick={() => {
                      showConfirm({
                        title: "Delete Project",
                        message: `Are you sure you want to delete the project "${project.name}"? This action cannot be undone.`,
                        confirmText: "Delete",
                        cancelText: "Cancel",
                        onConfirm: () => deleteProject(project.id),
                      });
                    }}
                    title="Delete Project"
                    className="w-7 h-7 flex items-center justify-center rounded-lg border border-border bg-surface text-muted-foreground hover:bg-red-500/5 hover:border-red-500/30 hover:text-red-500 transition-all duration-200 cursor-pointer"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="13"
                      height="13"
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
              </div>

              {/* Project name */}
              <h3 className="text-sm font-bold text-foreground tracking-tight mb-1 truncate" title={project.name}>
                {project.name}
              </h3>

              {/* Use Case summary if exists */}
              {project.useCase ? (
                <p className="text-[11px] text-muted-foreground truncate mb-2 mt-0.5">
                  {project.useCase.replace(/[#*`_\[\]]/g, "").slice(0, 50)}
                </p>
              ) : (
                <div className="h-4 mb-2" />
              )}

              {/* Data Sources Row */}
              <div className="flex items-center gap-2 mb-4 h-6">
                <div className="flex -space-x-1.5 overflow-hidden">
                  {project.dataSources.map((dsId) => {
                    const ds = dataSources.find((s) => s.id === dsId);
                    const type = ds ? ds.type : dsId;
                    const name = ds ? ds.name : dsId.toUpperCase();
                    return (
                      <div
                        key={dsId}
                        title={name}
                        className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-surface border border-border overflow-hidden p-1 shadow-sm shrink-0"
                      >
                        {renderDataSourceIcon(type)}
                      </div>
                    );
                  })}
                  {project.dataSources.length === 0 && (
                    <span className="text-[10px] text-muted-foreground italic font-medium">
                      No linked sources
                    </span>
                  )}
                </div>
              </div>

              {/* Separator */}
              <hr className="border-border mb-3" />

              {/* Bottom row: avatar + open link */}
              <div className="flex items-center justify-between mt-auto">
                <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-primary text-white text-[10px] font-bold">
                  {project.initials}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    // Show a quick details dialog to display the Markdown Use Case details!
                    // This is a premium addition that directly uses the use_case information we saved!
                    showConfirm({
                      title: project.name,
                      message: project.useCase || "No use case information provided for this project.",
                      confirmText: "Close",
                      cancelText: "Deselect", // unused
                      onConfirm: () => {},
                    });
                  }}
                  className="text-xs font-semibold text-muted-foreground hover:text-primary flex items-center gap-1 transition-colors cursor-pointer"
                >
                  Open
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <line x1="5" y1="12" x2="19" y2="12" />
                    <polyline points="12 5 19 12 12 19" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Connector Library Overlay Modal */}
      {showConnectNewLibraryModal && (
        <div className="fixed inset-0 z-[105] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
          <div className="relative w-full max-w-4xl rounded-2xl border border-border bg-surface p-6 shadow-2xl animate-fade-in flex flex-col max-h-[90vh]">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-border pb-4 mb-4 select-none">
              <div>
                <h3 className="text-lg font-bold text-foreground">
                  Connect a New Data Source
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Select a connector from the library below to establish a live catalog connection.
                </p>
              </div>
              <button
                onClick={() => setShowConnectNewLibraryModal(false)}
                className="rounded-lg p-1.5 text-muted-foreground hover:bg-surface-muted hover:text-foreground transition-colors cursor-pointer"
              >
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            {/* Library Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4 p-1 overflow-y-auto max-h-[60vh]">
              {[
                {
                  id: "postgres" as const,
                  name: "PostgreSQL",
                  description: "Connect to PostgreSQL databases",
                  icon: <PostgresqlIcon size={40} />,
                },
                {
                  id: "mysql" as const,
                  name: "MySQL",
                  description: "Connect to MySQL databases",
                  icon: <MysqlIcon size={40} />,
                },
                {
                  id: "sqlserver" as const,
                  name: "SQL Server",
                  description: "Connect to Microsoft SQL Server",
                  icon: <SqlServerIcon size={40} />,
                },
                {
                  id: "snowflake" as const,
                  name: "Snowflake",
                  description: "Connect to Snowflake Warehouse",
                  icon: <SnowflakeIcon size={40} />,
                },
                {
                  id: "mongodb" as const,
                  name: "MongoDB",
                  description: "Connect to MongoDB databases",
                  icon: <MongodbIcon size={40} />,
                },
                {
                  id: "excel" as const,
                  name: "Excel",
                  description: "Connect to Excel spreadsheets",
                  icon: <Image src="/images/microsoft-excel.jpg" alt="Excel" width={40} height={40} className="object-contain" />,
                },
                {
                  id: "csv" as const,
                  name: "CSV",
                  description: "Upload and connect CSV files",
                  icon: <Image src="/images/csv.png" alt="CSV" width={40} height={40} className="object-contain" />,
                },
                {
                  id: "tsv" as const,
                  name: "TSV",
                  description: "Upload and connect TSV files",
                  icon: <Image src="/images/tsv.png" alt="TSV" width={40} height={40} className="object-contain" />,
                },
                {
                  id: "restapi" as const,
                  name: "REST API",
                  description: "Connect to REST API endpoints",
                  icon: <RestApiIcon size={40} />,
                },
              ].map((connector) => (
                <div
                  key={connector.id}
                  className="group flex flex-col items-center justify-between rounded-xl border border-border bg-surface p-4 text-center hover-lift duration-300 hover:border-primary/40"
                >
                  <div className="flex items-center justify-center p-3 rounded-xl bg-surface-muted transition-colors group-hover:bg-primary/5">
                    {connector.icon}
                  </div>
                  <div className="mt-3 flex flex-col flex-1 justify-center">
                    <span className="text-sm font-bold text-foreground tracking-tight">
                      {connector.name}
                    </span>
                    <p className="text-[10px] text-muted-foreground leading-normal mt-1 max-h-[32px] overflow-hidden text-ellipsis line-clamp-2">
                      {connector.description}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveConnectType(connector.id);
                      setShowConnectNewLibraryModal(false);
                    }}
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

      {/* Connection Popup Modal overlay */}
      {activeConnectType && (
        <ConnectionModal
          type={activeConnectType}
          onClose={() => {
            setActiveConnectType(null);
            if (!wasSubmitClicked.current) {
              setShowConnectNewLibraryModal(true);
            }
            wasSubmitClicked.current = false;
          }}
          onConnect={(name, subtext, config) => {
            wasSubmitClicked.current = true;
            addDataSource(name, activeConnectType, subtext, config);
            setActiveConnectType(null);
            setShowConnectNewLibraryModal(false);
          }}
        />
      )}
    </div>
  );
}
