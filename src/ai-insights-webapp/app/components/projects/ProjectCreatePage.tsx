"use client";

import React, { useState, useRef, useEffect } from "react";
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
    case "postgres":  return <PostgresqlIcon size={16} />;
    case "mysql":     return <MysqlIcon size={16} />;
    case "sqlserver": return <SqlServerIcon size={16} />;
    case "snowflake": return <SnowflakeIcon size={16} />;
    case "mongodb":   return <MongodbIcon size={16} />;
    case "excel":     return <Image src="/images/microsoft-excel.jpg" alt="Excel" width={16} height={16} className="object-contain shrink-0" />;
    case "csv":       return <Image src="/images/csv.png" alt="CSV" width={16} height={16} className="object-contain shrink-0" />;
    case "tsv":       return <Image src="/images/tsv.png" alt="TSV" width={16} height={16} className="object-contain shrink-0" />;
    case "restapi":   return <RestApiIcon size={16} />;
    default:          return null;
  }
}

function getSubtextCategory(subtext: string): string {
  const s = subtext.toLowerCase();
  if (s.includes("warehouse")) return "Data Warehouse";
  if (s.includes("database"))  return "Database";
  if (s.includes("api"))       return "API";
  if (s.includes("cloud") || s.includes("storage")) return "Cloud Storage";
  if (s.includes("file"))      return "File";
  return "Database";
}

const ITEMS_PER_PAGE = 6;

// ─── Custom Modern Dropdown Component ─────────────────────────────────────────

interface CustomSelectOption {
  value: string;
  label: string;
}

interface CustomSelectProps {
  options: CustomSelectOption[];
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

function CustomSelect({
  options,
  value,
  onChange,
  placeholder = "-- Select --",
  disabled = false,
  className = "",
}: CustomSelectProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const selectedOpt = options.find((o) => o.value === value);

  return (
    <div ref={containerRef} className={`relative w-full ${className}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
        className="w-full h-11 px-4 flex items-center justify-between gap-2 rounded-xl border border-border bg-surface text-base font-normal text-foreground transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shadow-sm focus:outline-none focus:ring-0 focus:border-border"
      >
        <span className={`truncate ${!selectedOpt?.value ? "text-muted-foreground/70" : ""}`}>
          {selectedOpt ? selectedOpt.label : placeholder}
        </span>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`shrink-0 text-muted-foreground transition-transform duration-200 ${open ? "rotate-180 text-primary dark:text-white" : ""}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && !disabled && (
        <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-50 max-h-60 overflow-y-auto rounded-2xl border border-border/80 bg-surface/95 p-1.5 shadow-2xl backdrop-blur-xl animate-fade-in space-y-0.5 select-none">
          {options.map((opt) => {
            const isSelected = opt.value === value;
            return (
              <button
                key={opt.value || opt.label}
                type="button"
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
                className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-sm font-normal text-left transition-all cursor-pointer ${
                  isSelected
                    ? "bg-primary/10 text-primary dark:bg-white/10 dark:text-white font-medium"
                    : "text-foreground hover:bg-surface-muted/80 dark:hover:bg-white/5"
                }`}
              >
                <span className="truncate">{opt.label}</span>
                {isSelected && (
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="shrink-0 text-primary dark:text-white">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface ProjectCreatePageProps {
  dataSources: DataSource[];
  onCancel: () => void;
  onSubmit: (name: string, useCase: string, selectedSources: string[], domain?: string, subDomain?: string) => Promise<boolean | void> | void;
  onAddDataSource: (name: string, type: DataSource["type"], subtext: string, config: ConnectionConfig) => void;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function ProjectCreatePage({
  dataSources,
  onCancel,
  onSubmit,
  onAddDataSource,
}: ProjectCreatePageProps) {
  const [projectName, setProjectName]         = useState("");
  const [useCaseInfo, setUseCaseInfo]         = useState("");
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [previewMode, setPreviewMode]         = useState(false);
  const [history, setHistory]                 = useState<string[]>([""]);
  const [historyIndex, setHistoryIndex]       = useState(0);
  const [sourceSearch, setSourceSearch]       = useState("");
  const [sourceTypeFilter, setSourceTypeFilter] = useState("All Types");
  const [currentPage, setCurrentPage]         = useState(1);

  // Form submission state
  const [submitError, setSubmitError]         = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting]       = useState(false);

  // Domain & Sub-domain state
  const [domainList, setDomainList]           = useState<{ id: string; domain: string; subDomains: string[] }[]>([]);
  const [selectedDomain, setSelectedDomain]   = useState("");
  const [selectedSubDomain, setSelectedSubDomain] = useState("");
  const [customSubDomain, setCustomSubDomain] = useState("");

  const [showConnectLibrary, setShowConnectLibrary] = useState(false);
  const [activeConnectType, setActiveConnectType]   = useState<DataSource["type"] | null>(null);
  const wasSubmitClicked = useRef(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "http://127.0.0.1:5000/api";
    fetch(`${backendUrl}/domains`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => {
        if (Array.isArray(data) && data.length > 0) {
          setDomainList(data);
        }
      })
      .catch((err) => console.warn("[ProjectCreatePage] Could not fetch domains from API:", err));
  }, []);

  const defaultDomains = [
    {
      id: "dom-1",
      domain: "Retail & E-Commerce",
      subDomains: ["Order Management", "Inventory & Stock Control", "Customer & Loyalty Analytics", "Pricing & Promotions", "E-Commerce Fulfillment"],
    },
    {
      id: "dom-2",
      domain: "Finance & Banking",
      subDomains: ["Risk Management", "Fraud Detection", "Credit & Loan Origination", "Wealth Management", "Transaction Auditing"],
    },
    {
      id: "dom-3",
      domain: "Healthcare & Life Sciences",
      subDomains: ["Patient Health Records", "Clinical Trial Analytics", "Hospital Operations", "Medical Billing & Claims", "Pharmaceutical Supply"],
    },
    {
      id: "dom-4",
      domain: "Supply Chain & Logistics",
      subDomains: ["Demand Forecasting & Planning", "Warehouse Operations", "Freight & Transportation", "Supplier Performance", "Procurement & Sourcing"],
    },
    {
      id: "dom-5",
      domain: "Manufacturing",
      subDomains: ["Quality Assurance & Control", "Equipment Predictive Maintenance", "Production Line Optimization", "Material Requirements Planning", "Safety & Compliance"],
    },
    {
      id: "dom-6",
      domain: "Energy & Utilities",
      subDomains: ["Smart Grid Analytics", "Asset Performance Management", "Energy Consumption Forecasting", "Environmental Monitoring"],
    },
    {
      id: "dom-7",
      domain: "Telecommunications",
      subDomains: ["Network Performance Monitoring", "Subscriber Churn Prediction", "Billing & Rating Systems", "Customer Experience Analytics"],
    },
    {
      id: "dom-8",
      domain: "Other",
      subDomains: ["General Business Analytics"],
    },
  ];

  const effectiveDomains = domainList.length > 0 ? domainList : defaultDomains;

  // Always ensure 'Other' is at the very end of the domain dropdown list!
  const sortedDomains = [
    ...effectiveDomains.filter((d) => d.domain !== "Other"),
    ...effectiveDomains.filter((d) => d.domain === "Other"),
  ];

  const currentDomainObj = sortedDomains.find((d) => d.domain === selectedDomain);
  const activeSubDomainOptions = currentDomainObj ? currentDomainObj.subDomains : [];

  // Options for CustomSelect components
  const domainSelectOptions = [
    { value: "", label: "-- Select Domain --" },
    ...sortedDomains.map((d) => ({ value: d.domain, label: d.domain })),
  ];

  const subDomainSelectOptions = [
    { value: "", label: selectedDomain ? "-- Select Sub Domain --" : "Select a domain first" },
    ...activeSubDomainOptions.map((sub) => ({ value: sub, label: sub })),
    ...(selectedDomain ? [{ value: "Other (Custom Sub Domain)", label: "Other (Custom Sub Domain)" }] : []),
  ];

  const sourceTypeSelectOptions = ["All Types", "Database", "Data Warehouse", "API", "Cloud Storage", "File"].map(
    (t) => ({ value: t, label: t })
  );

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
      setHistoryIndex(historyIndex - 1);
      setUseCaseInfo(history[historyIndex - 1]);
    }
  };

  const handleRedo = () => {
    if (historyIndex < history.length - 1) {
      setHistoryIndex(historyIndex + 1);
      setUseCaseInfo(history[historyIndex + 1]);
    }
  };

  const wordCount = useCaseInfo.trim() ? useCaseInfo.trim().split(/\s+/).length : 0;

  const renderMarkdown = (text: string) => {
    let html = text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/### (.*)/g, "<h3 class='text-sm font-bold text-foreground mt-3 mb-1'>$1</h3>")
      .replace(/\*\*(.*?)\*\*/g, "<strong class='font-bold text-foreground'>$1</strong>")
      .replace(/\*(.*?)\*/g, "<em class='italic'>$1</em>")
      .replace(/^- (.*)/gm, "<li class='ml-4 list-disc text-muted-foreground'>$1</li>");
    html = html.replace(/\n/g, "<br />");
    return html;
  };

  // ── Filtered sources ──────────────────────────────────────────────────────

  const filteredSources = dataSources.filter((ds) => {
    const matchSearch = ds.name.toLowerCase().includes(sourceSearch.toLowerCase()) || ds.subtext.toLowerCase().includes(sourceSearch.toLowerCase());
    const cat = getSubtextCategory(ds.subtext);
    return matchSearch && (sourceTypeFilter === "All Types" || cat === sourceTypeFilter);
  });

  const totalPages       = Math.ceil(filteredSources.length / ITEMS_PER_PAGE);
  const paginatedSources = filteredSources.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);
  const startIdx         = filteredSources.length === 0 ? 0 : (currentPage - 1) * ITEMS_PER_PAGE + 1;
  const endIdx           = Math.min(currentPage * ITEMS_PER_PAGE, filteredSources.length);

  // ── Submit ────────────────────────────────────────────────────────────────

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectName.trim() || !useCaseInfo.trim() || selectedSources.length === 0 || isSubmitting) return;

    setSubmitError(null);
    setIsSubmitting(true);

    try {
      let finalSubDomain = selectedSubDomain;
      if (
        selectedDomain === "Other" ||
        selectedSubDomain === "Other (Custom Sub Domain)" ||
        !selectedSubDomain
      ) {
        finalSubDomain = customSubDomain.trim();
      }

      const success = await onSubmit(
        projectName.trim(),
        useCaseInfo.trim(),
        selectedSources,
        selectedDomain,
        finalSubDomain
      );

      if (success === false) {
        setSubmitError(`A project named "${projectName.trim()}" with similar configuration already exists. Please update the title to continue.`);
      }
    } catch (err: any) {
      setSubmitError(err.message || `A project named "${projectName.trim()}" already exists. Please update the title.`);
    } finally {
      setIsSubmitting(false);
    }
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
            className="px-6 py-2 border border-border bg-surface text-foreground hover:bg-surface-muted rounded-xl text-sm font-semibold cursor-pointer transition-colors shadow-sm focus:outline-none focus:ring-0 focus:border-border"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!projectName.trim() || !useCaseInfo.trim() || selectedSources.length === 0 || isSubmitting}
            title={selectedSources.length === 0 ? "Please connect at least one data source to save" : undefined}
            className="px-6 py-2 bg-primary text-white hover:bg-primary/95 rounded-xl text-sm font-semibold cursor-pointer transition-all shadow-md hover:scale-105 active:scale-95 disabled:opacity-50 disabled:scale-100 disabled:cursor-not-allowed focus:outline-none focus:ring-0 flex items-center gap-2"
          >
            {isSubmitting ? (
              <>
                <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                <span>Saving...</span>
              </>
            ) : (
              <span>Save Project</span>
            )}
          </button>
        </div>
      </div>

      {/* Body Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-8 items-start">
        {/* Left: Project Details */}
        <div className="bg-surface border border-border rounded-2xl p-6 shadow-soft flex flex-col">
          <h2 className="text-base font-bold text-foreground mb-6">Project Details</h2>
          <div className="space-y-6">

            {/* Inline Error Message */}
            {submitError && (
              <div className="p-3.5 rounded-xl border border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400 text-xs font-semibold flex items-center justify-between animate-fade-in shadow-sm">
                <div className="flex items-center gap-2.5">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="shrink-0 text-red-500"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                  <span>{submitError}</span>
                </div>
                <button onClick={() => setSubmitError(null)} className="p-1 hover:bg-red-500/20 rounded-lg cursor-pointer transition-colors focus:outline-none">
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>
            )}

            {/* Domain & Sub-domain Selection */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-foreground uppercase tracking-wider mb-2">
                  Company Domain
                </label>
                <CustomSelect
                  options={domainSelectOptions}
                  value={selectedDomain}
                  onChange={(val) => {
                    setSelectedDomain(val);
                    setSelectedSubDomain("");
                    setCustomSubDomain("");
                  }}
                  placeholder="-- Select Domain --"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-foreground uppercase tracking-wider mb-2">
                  Sub Domain
                </label>
                {selectedDomain === "Other" ? (
                  <input
                    type="text"
                    placeholder="Enter company sub domain..."
                    value={customSubDomain}
                    onChange={(e) => setCustomSubDomain(e.target.value)}
                    className="w-full h-11 px-4 rounded-xl border border-border bg-surface text-base font-normal text-foreground focus:outline-none focus:ring-0 focus:border-border transition-all placeholder:text-muted-foreground/60 shadow-sm"
                  />
                ) : (
                  <CustomSelect
                    disabled={!selectedDomain}
                    options={subDomainSelectOptions}
                    value={selectedSubDomain}
                    onChange={(val) => {
                      setSelectedSubDomain(val);
                      if (val !== "Other (Custom Sub Domain)") {
                        setCustomSubDomain("");
                      }
                    }}
                    placeholder={selectedDomain ? "-- Select Sub Domain --" : "Select a domain first"}
                  />
                )}
              </div>
            </div>

            {/* Custom Sub Domain Text Field when "Other (Custom Sub Domain)" is selected */}
            {selectedDomain && selectedDomain !== "Other" && selectedSubDomain === "Other (Custom Sub Domain)" && (
              <div>
                <label className="block text-xs font-semibold text-foreground uppercase tracking-wider mb-2">
                  Custom Sub Domain
                </label>
                <input
                  type="text"
                  placeholder="Enter custom sub domain..."
                  value={customSubDomain}
                  onChange={(e) => setCustomSubDomain(e.target.value)}
                  className="w-full h-11 px-4 rounded-xl border border-border bg-surface text-base font-normal text-foreground focus:outline-none focus:ring-0 focus:border-border transition-all placeholder:text-muted-foreground/60 shadow-sm"
                />
              </div>
            )}

            {/* Name */}
            <div>
              <label className="block text-xs font-semibold text-foreground uppercase tracking-wider mb-2">
                Use Case Title <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                maxLength={150}
                required
                placeholder="e.g., Demand Forecasting, Predictive Maintenance, Customer Churn Analytics..."
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                className="w-full h-11 px-4 rounded-xl border border-border bg-surface text-base font-normal text-foreground focus:outline-none focus:ring-0 focus:border-border transition-all placeholder:text-muted-foreground/60 shadow-sm"
              />
              <div className="flex justify-end mt-1 text-[10px] text-muted-foreground font-semibold">
                {projectName.length}/150
              </div>
            </div>

            {/* Use Case Editor */}
            <div>
              <label className="block text-xs font-semibold text-foreground uppercase tracking-wider mb-2">
                Use Case Information <span className="text-red-500">*</span>
              </label>
              <div className="flex flex-col border border-border rounded-xl bg-surface overflow-hidden transition-all">
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
                        className={`p-1.5 hover:bg-surface hover:text-foreground rounded transition-colors text-xs cursor-pointer focus:outline-none focus:ring-0 ${className}`}
                      >
                        {label}
                      </button>
                    ))}
                    <span className="h-4 w-px bg-border mx-1" />
                    <button type="button" onClick={() => insertText("- ", "")} title="Bullet List" className="p-1.5 hover:bg-surface hover:text-foreground rounded transition-colors cursor-pointer focus:outline-none focus:ring-0">
                      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="9" y1="6" x2="20" y2="6" /><line x1="9" y1="12" x2="20" y2="12" /><line x1="9" y1="18" x2="20" y2="18" /><circle cx="4" cy="6" r="1.5" fill="currentColor" /><circle cx="4" cy="12" r="1.5" fill="currentColor" /><circle cx="4" cy="18" r="1.5" fill="currentColor" /></svg>
                    </button>
                    <span className="h-4 w-px bg-border mx-1" />
                    <button type="button" onClick={handleUndo} disabled={historyIndex === 0} title="Undo" className="p-1.5 hover:bg-surface hover:text-foreground disabled:opacity-30 rounded transition-colors cursor-pointer focus:outline-none focus:ring-0">
                      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M3 7v6h6" /><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" /></svg>
                    </button>
                    <button type="button" onClick={handleRedo} disabled={historyIndex >= history.length - 1} title="Redo" className="p-1.5 hover:bg-surface hover:text-foreground disabled:opacity-30 rounded transition-colors cursor-pointer focus:outline-none focus:ring-0">
                      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 7v6h-6" /><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 3" /></svg>
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => setPreviewMode(!previewMode)}
                    className={`px-3 py-1 text-xs font-bold rounded-lg border transition-all cursor-pointer focus:outline-none focus:ring-0 ${
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
                      rows={5}
                      placeholder="Describe the purpose, goals, scope, data flow, business logic, and expected decisions or outcomes..."
                      value={useCaseInfo}
                      onChange={handleTextareaChange}
                      className="w-full p-4 text-base font-normal text-foreground bg-transparent focus:outline-none focus:ring-0 focus:border-transparent resize-y min-h-[140px] placeholder:text-muted-foreground/60"
                    />
                  ) : (
                    <div
                      className="w-full p-4 text-base font-normal text-foreground overflow-y-auto min-h-[140px] prose dark:prose-invert max-w-none bg-surface"
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
          <div className="flex items-center gap-3 mb-6">
            <div className="relative flex-1 min-w-0">
              <input
                type="text"
                placeholder="Search data sources..."
                value={sourceSearch}
                onChange={(e) => { setSourceSearch(e.target.value); setCurrentPage(1); }}
                className="w-full h-11 pl-10 pr-4 rounded-xl border border-border bg-surface text-base font-normal text-foreground focus:outline-none focus:ring-0 focus:border-border transition-all placeholder:text-muted-foreground/60 shadow-sm"
              />
              <span className="absolute left-3.5 top-[14px] text-muted-foreground pointer-events-none">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
              </span>
            </div>

            <div className="w-44 shrink-0">
              <CustomSelect
                options={sourceTypeSelectOptions}
                value={sourceTypeFilter}
                onChange={(val) => { setSourceTypeFilter(val); setCurrentPage(1); }}
              />
            </div>
          </div>

          {/* Selected sources */}
          <div className="mb-6">
            <h3 className="text-xs font-bold text-foreground uppercase tracking-wider mb-2">
              Selected Sources ({selectedSources.length})
            </h3>
            {selectedSources.length === 0 ? (
              <div className="border border-dashed border-border/80 rounded-2xl p-6 flex flex-col items-center justify-center text-center bg-gradient-to-br from-surface-muted/20 via-surface to-surface-muted/20 shadow-inner">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary mb-2">
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>
                </div>
                <p className="text-sm font-bold text-foreground">No data sources selected</p>
                <p className="text-xs text-muted-foreground mt-0.5 max-w-xs">Choose data sources from below to connect to this project</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-36 overflow-y-auto border border-border/80 rounded-2xl p-3 bg-surface-muted/30">
                {selectedSources.map((id) => {
                  const ds = dataSources.find((s) => s.id === id);
                  return (
                    <div key={id} className="flex items-center justify-between p-2.5 rounded-xl border border-primary/40 bg-surface shadow-sm transition-all hover:scale-[1.01]">
                      <div className="flex items-center gap-2 overflow-hidden">
                        <span className="shrink-0 text-primary scale-90">{renderDataSourceIcon(ds?.type ?? "postgres")}</span>
                        <span className="text-sm font-bold text-foreground truncate">{ds?.name ?? id}</span>
                      </div>
                      <button type="button" onClick={() => toggleSource(id)} className="p-1 rounded-lg text-muted-foreground hover:bg-red-500/10 hover:text-red-500 cursor-pointer transition-colors focus:outline-none">
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
            <div className="flex items-center justify-between mb-2.5">
              <h3 className="text-xs font-bold text-foreground uppercase tracking-wider">Available Sources</h3>
              <button type="button" onClick={() => setShowConnectLibrary(true)} className="text-xs text-primary font-bold hover:underline cursor-pointer flex items-center gap-1 focus:outline-none">
                <span>+ Connect New</span>
              </button>
            </div>

            {paginatedSources.length > 0 ? (
              <div className="space-y-2">
                {paginatedSources.map((ds) => {
                  const isSelected = selectedSources.includes(ds.id);
                  return (
                    <div
                      key={ds.id}
                      onClick={() => toggleSource(ds.id)}
                      className={`flex items-center justify-between p-3.5 rounded-xl border cursor-pointer transition-all duration-200 ${
                        isSelected
                          ? "border-primary/50 bg-primary/5 shadow-sm"
                          : "border-border/80 bg-surface hover:border-primary/30 hover:bg-surface-muted/30"
                      }`}
                    >
                      <div className="flex items-center gap-3 overflow-hidden">
                        <div className="w-9 h-9 rounded-xl bg-surface-muted/60 border border-border flex items-center justify-center shrink-0">
                          {renderDataSourceIcon(ds.type)}
                        </div>
                        <div className="flex flex-col overflow-hidden">
                          <span className="text-sm font-bold text-foreground truncate">{ds.name}</span>
                          <span className="text-xs text-muted-foreground font-semibold mt-0.5 flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                            {getSubtextCategory(ds.subtext)}
                          </span>
                        </div>
                      </div>

                      <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all ${
                        isSelected ? "border-primary bg-primary text-white" : "border-border bg-surface"
                      }`}>
                        {isSelected && (
                          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="border border-dashed border-border rounded-2xl p-8 text-center text-xs text-muted-foreground italic bg-surface-muted/10">
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
                  <button type="button" disabled={currentPage === 1} onClick={() => setCurrentPage((p) => Math.max(1, p - 1))} className="w-8 h-8 border border-border hover:bg-surface-muted/50 rounded-xl flex items-center justify-center text-muted-foreground disabled:opacity-40 cursor-pointer transition-colors focus:outline-none">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6" /></svg>
                  </button>
                  {Array.from({ length: totalPages }, (_, i) => i + 1).map((pg) => (
                    <button key={pg} onClick={() => setCurrentPage(pg)} className={`w-8 h-8 rounded-xl text-xs font-bold cursor-pointer transition-all focus:outline-none ${currentPage === pg ? "bg-primary text-white shadow-sm" : "border border-border text-muted-foreground hover:bg-surface-muted/50"}`}>
                      {pg}
                    </button>
                  ))}
                  <button type="button" disabled={currentPage === totalPages} onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))} className="w-8 h-8 border border-border hover:bg-surface-muted/50 rounded-xl flex items-center justify-center text-muted-foreground disabled:opacity-40 cursor-pointer transition-colors focus:outline-none">
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
              <button onClick={() => setShowConnectLibrary(false)} className="rounded-lg p-1.5 text-muted-foreground hover:bg-surface-muted hover:text-foreground transition-colors cursor-pointer focus:outline-none">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4 p-1 overflow-y-auto max-h-[60vh]">
              {[
                { id: "postgres" as const, name: "PostgreSQL", description: "Connect to PostgreSQL databases", icon: <PostgresqlIcon size={40} /> },
                { id: "mysql" as const, name: "MySQL", description: "Connect to MySQL databases", icon: <MysqlIcon size={40} /> },
                { id: "sqlserver" as const, name: "SQL Server", description: "Connect to Microsoft SQL Server", icon: <SqlServerIcon size={40} /> },
                { id: "snowflake" as const, name: "Snowflake", description: "Connect to Snowflake Warehouse", icon: <SnowflakeIcon size={40} /> },
                { id: "mongodb" as const, name: "MongoDB", description: "Connect to MongoDB databases", icon: <MongodbIcon size={40} /> },
                { id: "excel" as const, name: "Excel", description: "Connect to Excel spreadsheets", icon: <Image src="/images/microsoft-excel.jpg" alt="Excel" width={40} height={40} className="object-contain" /> },
                { id: "csv" as const, name: "CSV", description: "Upload and connect CSV files", icon: <Image src="/images/csv.png" alt="CSV" width={40} height={40} className="object-contain" /> },
                { id: "tsv" as const, name: "TSV", description: "Upload and connect TSV files", icon: <Image src="/images/tsv.png" alt="TSV" width={40} height={40} className="object-contain" /> },
                { id: "restapi" as const, name: "REST API", description: "Connect to REST API endpoints", icon: <RestApiIcon size={40} /> },
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
                    className="mt-4 w-full bg-primary text-white text-xs font-semibold py-1.5 px-3 rounded-lg cursor-pointer transition-all duration-200 hover:scale-105 active:scale-95 shadow-sm focus:outline-none"
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
