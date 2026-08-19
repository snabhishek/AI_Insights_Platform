"use client";

import React, { useState } from "react";
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
    fallbackMap,
    searchTerms,
    handleSearchChange,
    retryFetch,
  } = useFilterForm({ schema, apiBaseUrl });

  const [showSecondary, setShowSecondary] = useState(false);

  const groups = schema.filterGroups || schema.forms || [];
  const primaryGroups = groups.filter((g) => g.priority === "primary" || !g.priority);
  const secondaryGroups = groups.filter((g) => g.priority === "secondary");

  const handleChange = (fieldId: string, val: any) => {
    setFieldValue(fieldId, val);
    if (onFilterChange) {
      onFilterChange({ ...selectedValues, [fieldId]: val });
    }
  };

  const isFieldDisabled = (field: FormField): boolean => {
    // Check if any declared parent is missing a selected value
    const parents = field.parentFields || (field.parentField ? [field.parentField] : []);
    if (parents.length === 0) return false;
    return parents.some((p) => selectedValues[p] === undefined || selectedValues[p] === null || selectedValues[p] === "");
  };

  const renderFieldControl = (field: FormField) => {
    const fieldId = field.fieldId;
    const value = selectedValues[fieldId] || "";
    const options = optionsMap[fieldId] || field.options || [];
    const isLoading = loadingMap[fieldId];
    const errorMessage = errorMap[fieldId];
    const isFallback = fallbackMap[fieldId];
    const disabled = isFieldDisabled(field);

    if (errorMessage) {
      return (
        <div className="flex items-center gap-2 text-xs text-rose-500 mt-1 bg-rose-50 dark:bg-rose-950/40 p-2 rounded border border-rose-200 dark:border-rose-900">
          <span>Error loading choices.</span>
          <button
            type="button"
            onClick={() => retryFetch(fieldId)}
            className="underline font-medium hover:text-rose-700 dark:hover:text-rose-300"
          >
            Retry
          </button>
        </div>
      );
    }

    if (field.controlType === "date_range") {
      const range = dateRanges[fieldId] || { min: null, max: null };
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
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-xs transition-colors focus:outline-none focus:ring-2 focus:ring-primary"
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
          {isFallback && (
            <p className="text-[10px] text-amber-600 dark:text-amber-400">
              ℹ Showing all options (parent unselected)
            </p>
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
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-xs transition-colors focus:outline-none focus:ring-2 focus:ring-primary"
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
        {isFallback && (
          <p className="text-[10px] text-amber-600 dark:text-amber-400">
            ℹ Showing independent dataset choices
          </p>
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
      {/* Header Info */}
      <div className="flex items-center justify-between bg-surface-muted/50 p-3 rounded-lg border border-border">
        <div>
          <span className="text-xs text-muted-foreground">Data Source ID: </span>
          <span className="text-xs font-mono font-bold text-foreground">
            {schema.sourceId || "default_source"}
          </span>
        </div>
        <button
          type="button"
          onClick={() => resetAllFilters()}
          className="text-xs font-medium text-muted-foreground hover:text-foreground underline transition-colors"
        >
          Reset All Filters
        </button>
      </div>

      {/* Primary Groups */}
      <div className="space-y-4">
        {primaryGroups.map((group, idx) => renderGroup(group, idx))}
      </div>

      {/* Secondary Groups Disclosure */}
      {secondaryGroups.length > 0 && (
        <div className="space-y-3 pt-2">
          <button
            type="button"
            onClick={() => setShowSecondary(!showSecondary)}
            className="flex items-center gap-2 text-xs font-semibold text-primary hover:underline cursor-pointer"
          >
            <span>{showSecondary ? "▲ Hide More Filters" : "▼ Show More Filters"}</span>
            <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground">
              {secondaryGroups.length} group(s)
            </span>
          </button>

          {showSecondary && (
            <div className="space-y-4 pt-2">
              {secondaryGroups.map((group, idx) => renderGroup(group, idx + primaryGroups.length))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
