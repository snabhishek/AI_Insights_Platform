"use client";

import React from "react";
import { useFilterForm, FormSchema, FormField, FilterGroup } from "../../../hooks/useFilterForm";

export interface FilterFormProps {
  schema: FormSchema;
  apiBaseUrl?: string;
  onFilterChange?: (values: Record<string, any>) => void;
}

export default function FilterForm({ schema, apiBaseUrl = "http://localhost:4000", onFilterChange }: FilterFormProps) {
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
  } = useFilterForm({ schema, apiBaseUrl });

  const groups = schema.filterGroups || schema.forms || [];
  const primaryGroups = groups.filter((g) => g.priority === "primary" || !g.priority);

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
    const isLoading = loadingMap[fieldId];
    const errorMessage = errorMap[fieldId];

    if (errorMessage) {
      return (
        <div className="flex items-center gap-2 text-xs text-rose-500 mt-1 bg-rose-50 dark:bg-rose-950/40 p-2 rounded border border-rose-200 dark:border-rose-900">
          <span>Error loading choices.</span>
          <button
            type="button"
            onClick={() => retryFetch(fieldId)}
            className="underline font-medium hover:text-rose-700 dark:hover:text-rose-300 cursor-pointer"
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
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={startDate}
              min={range.min || undefined}
              max={endDate || range.max || undefined}
              onChange={(e) => handleChange(fieldId, { ...value, start: e.target.value })}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-xs transition-colors focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <span className="text-muted-foreground text-xs">to</span>
            <input
              type="date"
              value={endDate}
              min={startDate || range.min || undefined}
              max={range.max || undefined}
              onChange={(e) => handleChange(fieldId, { ...value, end: e.target.value })}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-xs transition-colors focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          {range.min && range.max && (
            <p className="text-[10px] text-muted-foreground">
              Available bounds: {range.min} to {range.max}
            </p>
          )}
        </div>
      );
    }

    if (field.controlType === "searchable_dropdown") {
      const searchTerm = searchTerms[fieldId] || "";
      return (
        <div className="space-y-1.5 relative">
          <div className="relative">
            <input
              type="text"
              placeholder={`Search ${field.label}...`}
              value={searchTerm}
              onChange={(e) => handleSearchChange(fieldId, e.target.value)}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 pr-8 text-xs transition-colors focus:outline-none focus:ring-2 focus:ring-primary"
            />
            {isLoading && (
              <span className="absolute right-2.5 top-2.5 text-xs text-muted-foreground animate-spin">
                ⏳
              </span>
            )}
          </div>

          <select
            value={value}
            onChange={(e) => handleChange(fieldId, e.target.value)}
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-xs transition-colors focus:outline-none focus:ring-2 focus:ring-primary cursor-pointer"
          >
            <option value="">-- Select {field.label} --</option>
            {options.map((opt: any, idx: number) => {
              const optVal = typeof opt === "object" ? opt.value || opt.id : opt;
              const optLabel = typeof opt === "object" ? opt.label || opt.name || optVal : opt;
              return (
                <option key={`${optVal}-${idx}`} value={optVal}>
                  {optLabel}
                </option>
              );
            })}
          </select>

          {options.length === 0 && !isLoading && (
            <p className="text-[10px] text-muted-foreground italic">No matching choices found</p>
          )}
        </div>
      );
    }

    // Default dropdown / multi_select
    return (
      <div className="space-y-1">
        <div className="relative">
          <select
            value={value}
            onChange={(e) => handleChange(fieldId, e.target.value)}
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-xs transition-colors focus:outline-none focus:ring-2 focus:ring-primary cursor-pointer"
          >
            <option value="">-- Select {field.label} --</option>
            {options.map((opt: any, idx: number) => {
              const optVal = typeof opt === "object" ? opt.value || opt.id : opt;
              const optLabel = typeof opt === "object" ? opt.label || opt.name || optVal : opt;
              return (
                <option key={`${optVal}-${idx}`} value={optVal}>
                  {optLabel}
                </option>
              );
            })}
          </select>
          {isLoading && (
            <span className="absolute right-7 top-2 text-xs text-muted-foreground animate-spin">
              ⏳
            </span>
          )}
        </div>

        {options.length === 0 && !isLoading && (
          <p className="text-[10px] text-muted-foreground italic">No options available</p>
        )}
      </div>
    );
  };

  const renderGroup = (group: FilterGroup, idx: number) => {
    return (
      <div key={`group-${group.groupName}-${idx}`} className="rounded-xl border border-border bg-card p-4 shadow-sm space-y-3">
        <div className="flex items-center justify-between border-b border-border pb-2">
          <h3 className="text-xs font-semibold text-foreground uppercase tracking-wider">
            {group.groupName}
          </h3>
          {group.priority && (
            <span
              className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                group.priority === "primary"
                  ? "bg-primary/10 text-primary"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {group.priority}
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
          {(group.fields || []).map((field) => {
            const parents = field.parentFields || (field.parentField ? [field.parentField] : []);
            return (
              <div key={field.fieldId} className="space-y-1">
                <label className="block text-xs font-medium text-foreground flex items-center justify-between">
                  <span>{field.label}</span>
                  {parents.length > 0 && (
                    <span className="text-[10px] text-muted-foreground">
                      Cascades from: {parents.join(", ")}
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
    <div className="space-y-6">
      {/* Active Filter Header & Reset Button */}
      <div className="flex items-center justify-between border-b border-border pb-3">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold text-foreground">Active Filter Form</h2>
          <span className="text-xs text-muted-foreground">
            Source ID: <code className="font-bold text-primary font-mono">{schema.sourceId || "default_source"}</code>
          </span>
        </div>

        <button
          type="button"
          onClick={() => resetAllFilters()}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface hover:bg-surface-muted border border-border text-xs font-medium text-foreground transition-colors shadow-sm cursor-pointer"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
            <path d="M3 3v5h5" />
          </svg>
          <span>Reset Filters</span>
        </button>
      </div>

      {/* Primary Groups */}
      <div className="space-y-4">
        {primaryGroups.map((group, idx) => renderGroup(group, idx))}
      </div>

      {/* 
        Secondary Groups / Show More Filters (Commented out for future maintenance)
        {secondaryGroups.length > 0 && ( ... )}
      */}
    </div>
  );
}
