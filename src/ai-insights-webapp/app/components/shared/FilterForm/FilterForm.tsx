"use client";

import React, { useState, useRef, useEffect } from "react";
import { useFilterForm, FormSchema, FormField, FilterGroup } from "../../../hooks/useFilterForm";

export interface FilterFormProps {
  schema: FormSchema;
  apiBaseUrl?: string;
  onFilterChange?: (values: Record<string, any>) => void;
}

interface ModernSelectProps {
  field: FormField;
  value: any;
  options: any[];
  isLoading: boolean;
  onChange: (val: any) => void;
  onSearchChange?: (term: string) => void;
  onOpen?: () => void;
  searchTerm?: string;
  placeholder?: string;
}

function ModernSelect({
  field,
  value,
  options = [],
  isLoading,
  onChange,
  onSearchChange,
  onOpen,
  searchTerm = "",
  placeholder,
}: ModernSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [localSearch, setLocalSearch] = useState(searchTerm);
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Close on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      setTimeout(() => searchInputRef.current?.focus(), 50);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  const handleToggle = () => {
    const next = !isOpen;
    setIsOpen(next);
    if (next && onOpen) {
      onOpen();
    }
  };

  const handleSearch = (term: string) => {
    setLocalSearch(term);
    if (onSearchChange) {
      onSearchChange(term);
    }
  };

  // Filter options locally based on search
  const filteredOptions = options.filter((opt) => {
    if (!localSearch.trim()) return true;
    const optLabel = typeof opt === "object" ? opt.label || opt.name || opt.value || opt.id : String(opt);
    return String(optLabel).toLowerCase().includes(localSearch.toLowerCase().trim());
  });

  const selectedOption = options.find((opt) => {
    const optVal = typeof opt === "object" ? opt.value || opt.id : opt;
    return String(optVal) === String(value);
  });

  const selectedDisplay = selectedOption
    ? typeof selectedOption === "object"
      ? selectedOption.label || selectedOption.name || selectedOption.value || selectedOption.id
      : selectedOption
    : value || "";

  return (
    <div className="relative w-full" ref={containerRef}>
      {/* Dropdown Trigger Box */}
      <button
        type="button"
        onClick={handleToggle}
        className={`w-full h-10 px-3.5 flex items-center justify-between rounded-xl border text-xs font-medium transition-all duration-200 shadow-sm outline-none cursor-pointer select-none ${
          isOpen
            ? "border-primary ring-2 ring-primary/20 bg-background dark:bg-slate-900 shadow-md"
            : value
            ? "border-primary/40 bg-primary/5 hover:border-primary/60 text-foreground"
            : "border-border/80 bg-background dark:bg-slate-900/80 hover:border-border text-muted-foreground"
        }`}
      >
        <div className="flex items-center gap-2 min-w-0 flex-1 text-left">
          {isLoading ? (
            <span className="w-3.5 h-3.5 border-2 border-primary border-t-transparent rounded-full animate-spin shrink-0" />
          ) : null}
          <span className={`truncate ${value ? "font-semibold text-foreground" : ""}`}>
            {selectedDisplay || placeholder || `Select ${field.label}`}
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0 ml-2">
          {value && (
            <span
              onClick={(e) => {
                e.stopPropagation();
                onChange("");
              }}
              title="Clear selection"
              className="w-4 h-4 rounded-full hover:bg-surface-muted text-muted-foreground hover:text-foreground flex items-center justify-center transition-colors text-[10px] cursor-pointer"
            >
              ✕
            </span>
          )}
          <svg
            className={`w-3.5 h-3.5 text-muted-foreground transition-transform duration-200 ${
              isOpen ? "rotate-180 text-primary" : ""
            }`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth="2.5"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {/* Modern Popover Dropdown Menu */}
      {isOpen && (
        <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-[100] rounded-2xl border border-border/80 bg-surface dark:bg-[#161a23] shadow-2xl ring-1 ring-black/10 overflow-hidden flex flex-col max-h-72 animate-in fade-in zoom-in-95 duration-150">
          {/* Embedded Search Input inside Dropdown */}
          <div className="p-2.5 border-b border-border/60 bg-surface-muted/60 shrink-0">
            <div className="relative flex items-center">
              <svg
                className="absolute left-3 w-3.5 h-3.5 text-muted-foreground"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                ref={searchInputRef}
                type="text"
                value={localSearch}
                onChange={(e) => handleSearch(e.target.value)}
                placeholder={`Search ${field.label}...`}
                className="w-full pl-9 pr-8 py-2 text-xs bg-background border border-border/70 rounded-xl text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all shadow-inner"
              />
              {localSearch && (
                <button
                  type="button"
                  onClick={() => handleSearch("")}
                  className="absolute right-2.5 text-muted-foreground hover:text-foreground text-xs cursor-pointer"
                >
                  ✕
                </button>
              )}
            </div>
          </div>

          {/* Options Scroll List */}
          <div className="overflow-y-auto flex-1 p-1.5 space-y-0.5 text-xs custom-scrollbar">
            {/* Clear / All Option */}
            <div
              onClick={() => {
                onChange("");
                setIsOpen(false);
              }}
              className={`flex items-center justify-between px-3 py-2 rounded-xl cursor-pointer transition-colors ${
                !value
                  ? "bg-primary/10 text-primary font-semibold"
                  : "text-muted-foreground hover:bg-surface-muted hover:text-foreground"
              }`}
            >
              <span>All {field.label}</span>
              {!value && (
                <svg className="w-4 h-4 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              )}
            </div>

            {filteredOptions.length > 0 ? (
              filteredOptions.map((opt: any, idx: number) => {
                const optVal = typeof opt === "object" ? opt.value || opt.id : opt;
                const optLabel = typeof opt === "object" ? opt.label || opt.name || opt.value || opt.id : String(opt);
                const isSelected = String(optVal) === String(value);

                return (
                  <div
                    key={`${optVal}-${idx}`}
                    onClick={() => {
                      onChange(optVal);
                      setIsOpen(false);
                    }}
                    className={`flex items-center justify-between px-3 py-2 rounded-xl cursor-pointer transition-all duration-150 ${
                      isSelected
                        ? "bg-primary text-primary-foreground font-semibold shadow-sm"
                        : "text-foreground hover:bg-primary/10 hover:text-primary"
                    }`}
                  >
                    <span className="truncate pr-2">{optLabel}</span>
                    {isSelected && (
                      <svg className="w-4 h-4 text-primary-foreground shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </div>
                );
              })
            ) : (
              <div className="py-6 px-4 text-center text-muted-foreground space-y-1.5">
                <span className="text-xl block">🔍</span>
                <p className="text-xs font-semibold text-foreground">No matching options</p>
                <p className="text-[11px] text-muted-foreground">
                  {options.length === 0 ? "No records found in data source" : "Try modifying your search term"}
                </p>
              </div>
            )}
          </div>

          {/* Bottom Option Footer Count */}
          <div className="px-3.5 py-2 bg-surface-muted/40 border-t border-border/60 text-[11px] text-muted-foreground flex justify-between items-center shrink-0">
            <span>
              {filteredOptions.length} of {options.length} choices
            </span>
            {isLoading && <span className="text-primary font-medium animate-pulse">Syncing...</span>}
          </div>
        </div>
      )}
    </div>
  );
}

export default function FilterForm({ schema, apiBaseUrl = "http://127.0.0.1:4000", onFilterChange }: FilterFormProps) {
  const {
    selectedValues,
    setFieldValue,
    resetAllFilters,
    optionsMap,
    dateRanges,
    loadingMap,
    errorMap,
    searchTerms,
    handleSearchChange,
    retryFetch,
    fetchOptions,
  } = useFilterForm({ schema, apiBaseUrl });

  const groups = schema.filterGroups || schema.forms || [];
  const activeFilterCount = Object.values(selectedValues).filter(
    (v) => v !== undefined && v !== null && String(v).trim() !== ""
  ).length;

  const handleChange = (fieldId: string, val: any) => {
    setFieldValue(fieldId, val);
    if (onFilterChange) {
      onFilterChange({ ...selectedValues, [fieldId]: val });
    }
  };

  const renderFieldControl = (field: FormField) => {
    const fieldId = field.fieldId;
    const value = selectedValues[fieldId] || "";
    const options = optionsMap[fieldId] || field.options || [];
    const isLoading = loadingMap[fieldId] || false;
    const errorMessage = errorMap[fieldId];

    if (errorMessage) {
      return (
        <div className="flex items-center justify-between text-xs text-rose-500 bg-rose-50 dark:bg-rose-950/40 p-2.5 rounded-xl border border-rose-200 dark:border-rose-900">
          <div className="flex items-center gap-1.5">
            <span>⚠️</span>
            <span>Failed to load choices</span>
          </div>
          <button
            type="button"
            onClick={() => retryFetch(fieldId)}
            className="px-2.5 py-1 bg-rose-500 text-white rounded-lg font-medium hover:bg-rose-600 transition-colors text-xs cursor-pointer shadow-sm"
          >
            Retry
          </button>
        </div>
      );
    }

    if (field.controlType === "date_range") {
      const range = dateRanges[fieldId] || { min: "2023-01-01", max: "2026-12-31" };
      const startDate = value?.start || "";
      const endDate = value?.end || "";

      return (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={startDate}
              min={range.min || undefined}
              max={endDate || range.max || undefined}
              onChange={(e) => handleChange(fieldId, { ...value, start: e.target.value })}
              className="w-full h-10 rounded-xl border border-border/80 bg-background px-3 py-1.5 text-xs text-foreground transition-colors focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary shadow-sm"
            />
            <span className="text-muted-foreground text-xs font-semibold">to</span>
            <input
              type="date"
              value={endDate}
              min={startDate || range.min || undefined}
              max={range.max || undefined}
              onChange={(e) => handleChange(fieldId, { ...value, end: e.target.value })}
              className="w-full h-10 rounded-xl border border-border/80 bg-background px-3 py-1.5 text-xs text-foreground transition-colors focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary shadow-sm"
            />
          </div>
          {range.min && range.max && (
            <p className="text-[11px] text-muted-foreground flex items-center gap-1">
              <span>📅</span>
              <span>Available bounds: {range.min} to {range.max}</span>
            </p>
          )}
        </div>
      );
    }

    // Modern custom searchable dropdown with on-demand refresh
    return (
      <ModernSelect
        field={field}
        value={value}
        options={options}
        isLoading={isLoading}
        onChange={(val) => handleChange(fieldId, val)}
        onSearchChange={(term) => handleSearchChange(fieldId, term)}
        onOpen={() => {
          if (options.length === 0) {
            fetchOptions(field, selectedValues);
          }
        }}
        searchTerm={searchTerms[fieldId] || ""}
        placeholder={`Select ${field.label}`}
      />
    );
  };

  const renderGroup = (group: FilterGroup, idx: number) => {
    const isPrimary = group.priority === "primary" || !group.priority;
    return (
      <div
        key={`group-${group.groupName}-${idx}`}
        className="rounded-2xl border border-border/80 bg-surface/70 dark:bg-slate-900/70 p-6 shadow-sm space-y-5 hover:border-border transition-all duration-200"
      >
        <div className="flex items-center justify-between border-b border-border/60 pb-3.5">
          <div className="flex items-center gap-2.5">
            <span className="w-2.5 h-2.5 rounded-full bg-primary" />
            <h3 className="text-xs font-bold text-foreground uppercase tracking-wider">
              {group.groupName}
            </h3>
          </div>
          {group.priority && (
            <span
              className={`text-[10px] px-2.5 py-0.5 rounded-full font-semibold uppercase tracking-wider ${
                isPrimary
                  ? "bg-primary/10 text-primary border border-primary/20"
                  : "bg-surface-muted text-muted-foreground border border-border"
              }`}
            >
              {group.priority}
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {(group.fields || []).map((field) => {
            const parents = field.parentFields || (field.parentField ? [field.parentField] : []);
            return (
              <div key={field.fieldId} className="space-y-1.5">
                <label className="block text-xs font-semibold text-foreground flex items-center justify-between">
                  <span className="truncate">{field.label}</span>
                  {parents.length > 0 && (
                    <span className="text-[10px] text-primary font-medium bg-primary/10 px-2 py-0.5 rounded-md border border-primary/20 shrink-0 ml-2 truncate max-w-[180px]">
                      Cascades: {parents.join(", ")}
                    </span>
                  )}
                </label>

                {renderFieldControl(field)}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6 w-full">
      {/* Header controls & summary */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            <span className="font-medium text-foreground">Active Filter Form</span>
            {schema.sourceId && (
              <span className="font-mono text-[11px] bg-surface-muted px-2.5 py-0.5 rounded-md border border-border text-foreground">
                Source ID: {schema.sourceId}
              </span>
            )}
          </div>
          {activeFilterCount > 0 && (
            <span className="text-[11px] px-2.5 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 font-semibold">
              {activeFilterCount} active
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={resetAllFilters}
          disabled={activeFilterCount === 0}
          className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl border text-xs font-semibold transition-all duration-200 shadow-sm ${
            activeFilterCount > 0
              ? "border-border bg-background hover:bg-surface-muted text-foreground cursor-pointer hover:border-primary"
              : "border-border/40 bg-surface-muted/30 text-muted-foreground/50 cursor-not-allowed"
          }`}
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          <span>Reset Filters</span>
        </button>
      </div>

      {/* Render Groups */}
      <div className="space-y-5 w-full">
        {groups.map((group, idx) => renderGroup(group, idx))}
      </div>
    </div>
  );
}
