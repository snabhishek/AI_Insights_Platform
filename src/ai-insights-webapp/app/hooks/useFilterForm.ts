"use client";

import { useState, useEffect, useCallback, useRef } from "react";

export interface FormField {
  fieldId: string;
  name?: string;
  label: string;
  controlType: "dropdown" | "searchable_dropdown" | "date_range" | string;
  parentField?: string | null;
  parentFields?: string[];
  options?: any[];
  requiredParentParams?: string[];
}

export interface FilterGroup {
  groupName: string;
  priority?: "primary" | "secondary";
  fields: FormField[];
}

export interface FormSchema {
  sourceId?: string;
  filterGroups?: FilterGroup[];
  forms?: FilterGroup[];
}

export interface UseFilterFormOptions {
  schema?: FormSchema | null;
  apiBaseUrl?: string;
}

export function useFilterForm({ schema, apiBaseUrl = "http://localhost:4000" }: UseFilterFormOptions) {
  const [selectedValues, setSelectedValues] = useState<Record<string, any>>({});
  const [optionsMap, setOptionsMap] = useState<Record<string, any[]>>({});
  const [dateRanges, setDateRanges] = useState<Record<string, { min: string | null; max: string | null }>>({});
  const [loadingMap, setLoadingMap] = useState<Record<string, boolean>>({});
  const [errorMap, setErrorMap] = useState<Record<string, string | null>>({});
  const [fallbackMap, setFallbackMap] = useState<Record<string, boolean>>({});
  const [searchTerms, setSearchTerms] = useState<Record<string, string>>({});

  const abortControllersRef = useRef<Map<string, AbortController>>(new Map());
  const fetchSeqRef = useRef<Map<string, number>>(new Map());
  const searchDebounceTimersRef = useRef<Map<string, NodeJS.Timeout>>(new Map());

  // Extract all fields and build parent-child dependency graph
  const allFields = useRef<FormField[]>([]);
  const directChildrenMap = useRef<Map<string, Set<string>>>(new Map());

  useEffect(() => {
    const groups = schema?.filterGroups || schema?.forms || [];
    const fields: FormField[] = [];
    const childMap = new Map<string, Set<string>>();

    groups.forEach((group) => {
      (group.fields || []).forEach((field) => {
        fields.push(field);
        const parents = field.parentFields || (field.parentField ? [field.parentField] : []);
        parents.forEach((p) => {
          if (!childMap.has(p)) childMap.set(p, new Set());
          childMap.get(p)!.add(field.fieldId);
        });
      });
    });

    allFields.current = fields;
    directChildrenMap.current = childMap;
  }, [schema]);

  // Find all transitive descendant field IDs for a given parent fieldId
  const getTransitiveDescendants = useCallback((fieldId: string): Set<string> => {
    const descendants = new Set<string>();
    const stack = [fieldId];

    while (stack.length > 0) {
      const current = stack.pop()!;
      const children = directChildrenMap.current.get(current);
      if (children) {
        children.forEach((childId) => {
          if (!descendants.has(childId)) {
            descendants.add(childId);
            stack.push(childId);
          }
        });
      }
    }
    return descendants;
  }, []);

  // Fetch options for a field from the backend /api/filter-options endpoint
  const fetchOptions = useCallback(
    async (field: FormField, currentValues: Record<string, any>, searchOverride?: string) => {
      const fieldId = field.fieldId;
      const sourceId = schema?.sourceId || "default_source";

      // Abort previous in-flight request for this fieldId (Race Safety)
      if (abortControllersRef.current.has(fieldId)) {
        abortControllersRef.current.get(fieldId)!.abort();
      }
      const controller = new AbortController();
      abortControllersRef.current.set(fieldId, controller);

      const seq = (fetchSeqRef.current.get(fieldId) || 0) + 1;
      fetchSeqRef.current.set(fieldId, seq);

      setLoadingMap((prev) => ({ ...prev, [fieldId]: true }));
      setErrorMap((prev) => ({ ...prev, [fieldId]: null }));

      try {
        const parents = field.parentFields || (field.parentField ? [field.parentField] : []);
        const parentParamsObj: Record<string, any> = {};
        parents.forEach((p) => {
          if (currentValues[p] !== undefined && currentValues[p] !== null) {
            parentParamsObj[p] = currentValues[p];
          }
        });

        const queryParams = new URLSearchParams();
        queryParams.set("sourceId", sourceId);
        queryParams.set("fieldId", fieldId);
        if (field.controlType) queryParams.set("controlType", field.controlType);
        if (parents.length > 0) queryParams.set("parentFields", JSON.stringify(parents));
        if (Object.keys(parentParamsObj).length > 0) {
          queryParams.set("parents", JSON.stringify(parentParamsObj));
        }
        const activeSearch = searchOverride !== undefined ? searchOverride : searchTerms[fieldId] || "";
        if (activeSearch.trim()) {
          queryParams.set("search", activeSearch.trim());
        }

        const url = `${apiBaseUrl}/api/filter-options?${queryParams.toString()}`;
        const response = await fetch(url, { signal: controller.signal });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();

        // Discard stale response if a newer request was dispatched
        if (fetchSeqRef.current.get(fieldId) !== seq) {
          return;
        }

        if (data.dateRange) {
          setDateRanges((prev) => ({ ...prev, [fieldId]: data.dateRange }));
        }

        const resolvedValues = Array.isArray(data.values) ? data.values : [];
        setOptionsMap((prev) => ({ ...prev, [fieldId]: resolvedValues }));
        setFallbackMap((prev) => ({ ...prev, [fieldId]: !!data.isIndependentFallback }));
      } catch (err: any) {
        if (err.name === "AbortError") {
          return; // Intentionally aborted
        }
        console.warn(`[useFilterForm] Fetch options error for ${fieldId}:`, err);
        setErrorMap((prev) => ({ ...prev, [fieldId]: err.message || "Failed to load options" }));
      } finally {
        if (fetchSeqRef.current.get(fieldId) === seq) {
          setLoadingMap((prev) => ({ ...prev, [fieldId]: false }));
        }
      }
    },
    [schema, apiBaseUrl, searchTerms]
  );

  // Initial fetch for all fields when schema mounts
  useEffect(() => {
    if (!schema) return;
    const groups = schema.filterGroups || schema.forms || [];
    groups.forEach((group) => {
      (group.fields || []).forEach((field) => {
        fetchOptions(field, {});
      });
    });
  }, [schema, fetchOptions]);

  // Handle value change with Transitive Reset (Cascade Clear)
  const setFieldValue = useCallback(
    (fieldId: string, value: any) => {
      setSelectedValues((prev) => {
        const next = { ...prev, [fieldId]: value };

        // Transitive cascade reset: clear all direct & indirect child values
        const descendants = getTransitiveDescendants(fieldId);
        descendants.forEach((childId) => {
          delete next[childId];
        });

        // Trigger refetch for direct children with updated parent values
        const children = directChildrenMap.current.get(fieldId);
        if (children) {
          children.forEach((childId) => {
            const childField = allFields.current.find((f) => f.fieldId === childId);
            if (childField) {
              fetchOptions(childField, next);
            }
          });
        }

        return next;
      });
    },
    [getTransitiveDescendants, fetchOptions]
  );

  // Handle debounced search for searchable_dropdown controls (~250ms)
  const handleSearchChange = useCallback(
    (fieldId: string, term: string) => {
      setSearchTerms((prev) => ({ ...prev, [fieldId]: term }));

      if (searchDebounceTimersRef.current.has(fieldId)) {
        clearTimeout(searchDebounceTimersRef.current.get(fieldId)!);
      }

      const timer = setTimeout(() => {
        const field = allFields.current.find((f) => f.fieldId === fieldId);
        if (field) {
          fetchOptions(field, selectedValues, term);
        }
      }, 250);

      searchDebounceTimersRef.current.set(fieldId, timer);
    },
    [fetchOptions, selectedValues]
  );

  const retryFetch = useCallback(
    (fieldId: string) => {
      const field = allFields.current.find((f) => f.fieldId === fieldId);
      if (field) {
        fetchOptions(field, selectedValues);
      }
    },
    [fetchOptions, selectedValues]
  );

  const resetAllFilters = useCallback(() => {
    setSelectedValues({});
    setSearchTerms({});
    setErrorMap({});
  }, []);

  return {
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
  };
}
