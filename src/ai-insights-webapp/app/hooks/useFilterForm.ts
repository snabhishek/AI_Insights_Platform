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
  projectId?: string;
  projectName?: string;
  filterGroups?: FilterGroup[];
  forms?: FilterGroup[];
}

export interface UseFilterFormOptions {
  schema?: FormSchema | null;
  apiBaseUrl?: string;
}

export function useFilterForm({ schema, apiBaseUrl = "http://127.0.0.1:5000" }: UseFilterFormOptions) {
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
  const selectedValuesRef = useRef(selectedValues);
  const searchTermsRef = useRef(searchTerms);

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

  // Fetch options for a field from backend or fallback to inline schema choices
  const fetchOptions = useCallback(
    async (field: FormField, currentValues: Record<string, any>, searchOverride?: string) => {
      const fieldId = field.fieldId;
      const sourceId = (field as any).sourceId || schema?.sourceId || "default_source";

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
        let hasParentFilter = false;

        parents.forEach((p) => {
          if (currentValues[p] !== undefined && currentValues[p] !== null && String(currentValues[p]).trim() !== "") {
            parentParamsObj[p] = currentValues[p];
            hasParentFilter = true;
          }
        });

        const queryParams = new URLSearchParams();
        queryParams.set("sourceId", sourceId);
        if (schema?.projectId) queryParams.set("projectId", schema.projectId);
        if (schema?.projectName) queryParams.set("projectName", schema.projectName);
        queryParams.set("fieldId", fieldId);
        if ((field as any).columnName) queryParams.set("columnName", (field as any).columnName);
        const resolvedTable = (field as any).tableName || (field as any).table;
        if (resolvedTable) queryParams.set("table", resolvedTable);
        if (field.controlType) queryParams.set("controlType", field.controlType);
        if (parents.length > 0) queryParams.set("parentFields", JSON.stringify(parents));
        if (Object.keys(parentParamsObj).length > 0) {
          queryParams.set("parents", JSON.stringify(parentParamsObj));
        }
        const activeSearch = searchOverride !== undefined ? searchOverride : searchTermsRef.current[fieldId] || "";
        if (activeSearch.trim()) {
          queryParams.set("search", activeSearch.trim());
        }

        const resolvedApiBase = (apiBaseUrl || "http://127.0.0.1:5000").replace(/\/api\/?$/, "");
        const url = `${resolvedApiBase}/api/filter-options?${queryParams.toString()}`;
        const response = await fetch(url, { signal: controller.signal });

        if (fetchSeqRef.current.get(fieldId) !== seq) return;

        if (response.ok) {
          const data = await response.json();
          if (data.dateRange) {
            setDateRanges((prev) => ({ ...prev, [fieldId]: data.dateRange }));
          }
          // An empty array is a valid search result and must not be replaced by
          // the field's static fallback choices.
          const resolvedValues = Array.isArray(data.values) ? data.values : (field.options || []);
          setOptionsMap((prev) => ({ ...prev, [fieldId]: resolvedValues }));
          setFallbackMap((prev) => ({
            ...prev,
            [fieldId]: typeof data.isIndependentFallback === "boolean"
              ? data.isIndependentFallback
              : !hasParentFilter,
          }));
          setErrorMap((prev) => ({ ...prev, [fieldId]: null }));
        } else {
          setErrorMap((prev) => ({ ...prev, [fieldId]: `Request failed with status ${response.status}` }));
        }
      } catch (err: any) {
        if (err.name === "AbortError") return;
        if (fetchSeqRef.current.get(fieldId) !== seq) return;

        setErrorMap((prev) => ({
          ...prev,
          [fieldId]: err instanceof Error ? err.message : "Failed to load filter options",
        }));
      } finally {
        if (fetchSeqRef.current.get(fieldId) === seq) {
          setLoadingMap((prev) => ({ ...prev, [fieldId]: false }));
        }
      }
    },
    [schema?.sourceId, schema?.projectId, schema?.projectName, apiBaseUrl]
  );

  // Initial fetch for all fields when schema mounts or updates
  useEffect(() => {
    if (!schema) return;
    const groups = schema.filterGroups || schema.forms || [];
    groups.forEach((group) => {
      (group.fields || []).forEach((field) => {
        fetchOptions(field, {}, "");
      });
    });
  }, [schema, fetchOptions]);

  // Cancel outstanding work when the form is unmounted. Field-specific aborts
  // inside fetchOptions continue to handle replacement requests while mounted.
  useEffect(() => {
    const controllers = abortControllersRef.current;
    const timers = searchDebounceTimersRef.current;

    return () => {
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
      controllers.forEach((controller) => controller.abort());
      controllers.clear();
    };
  }, []);

  // Handle value change with Transitive Reset (Cascade Clear)
  const setFieldValue = useCallback(
    (fieldId: string, value: any) => {
      const next = { ...selectedValuesRef.current, [fieldId]: value };

      // Transitive cascade reset: clear descendant values and stale choices.
      const descendants = getTransitiveDescendants(fieldId);
      descendants.forEach((childId) => {
        delete next[childId];
        const timer = searchDebounceTimersRef.current.get(childId);
        if (timer) clearTimeout(timer);
        searchDebounceTimersRef.current.delete(childId);
        abortControllersRef.current.get(childId)?.abort();
      });

      selectedValuesRef.current = next;
      setSelectedValues(next);

      if (descendants.size > 0) {
        setOptionsMap((prev) => {
          const updated = { ...prev };
          descendants.forEach((childId) => delete updated[childId]);
          return updated;
        });
        setSearchTerms((prev) => {
          const updated = { ...prev };
          descendants.forEach((childId) => delete updated[childId]);
          searchTermsRef.current = updated;
          return updated;
        });
      }

      // Only direct children can be resolved from the new parent value.
      const children = directChildrenMap.current.get(fieldId);
      children?.forEach((childId) => {
        const childField = allFields.current.find((f) => f.fieldId === childId);
        if (childField) fetchOptions(childField, next, "");
      });
    },
    [getTransitiveDescendants, fetchOptions]
  );

  // Handle debounced search for searchable_dropdown controls (~250ms)
  const handleSearchChange = useCallback(
    (fieldId: string, term: string) => {
      setSearchTerms((prev) => {
        const next = { ...prev, [fieldId]: term };
        searchTermsRef.current = next;
        return next;
      });

      if (searchDebounceTimersRef.current.has(fieldId)) {
        clearTimeout(searchDebounceTimersRef.current.get(fieldId)!);
      }

      const timer = setTimeout(() => {
        const field = allFields.current.find((f) => f.fieldId === fieldId);
        if (field) {
          fetchOptions(field, selectedValuesRef.current, term);
        }
        searchDebounceTimersRef.current.delete(fieldId);
      }, 250);

      searchDebounceTimersRef.current.set(fieldId, timer);
    },
    [fetchOptions]
  );

  const retryFetch = useCallback(
    (fieldId: string) => {
      const field = allFields.current.find((f) => f.fieldId === fieldId);
      if (field) {
        fetchOptions(field, selectedValuesRef.current, searchTermsRef.current[fieldId] || "");
      }
    },
    [fetchOptions]
  );

  const resetAllFilters = useCallback(() => {
    searchDebounceTimersRef.current.forEach((timer) => clearTimeout(timer));
    searchDebounceTimersRef.current.clear();
    abortControllersRef.current.forEach((controller) => controller.abort());
    abortControllersRef.current.clear();
    selectedValuesRef.current = {};
    searchTermsRef.current = {};
    setSelectedValues({});
    setSearchTerms({});
    setErrorMap({});
    setLoadingMap({});

    allFields.current.forEach((field) => fetchOptions(field, {}, ""));
  }, [fetchOptions]);

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
    fetchOptions,
  };
}
