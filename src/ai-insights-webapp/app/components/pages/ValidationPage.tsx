"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import FilterForm from "../shared/FilterForm/FilterForm";
import { FormSchema } from "../../hooks/useFilterForm";
import { useApp, BACKEND_URL, Project } from "../providers/AppContext";
import ModelValidationStepOutput from "../projects/pipeline-outputs/ModelValidationStepOutput";
import {
  VALIDATION_FREQUENCY_OPTIONS,
  VALIDATION_UI_STRINGS,
  VALIDATION_API_ENDPOINTS,
} from "../projects/validationConstants";

interface ModernProjectSelectProps {
  projects: Array<{ id: string; name: string }>;
  selectedProjectId: string;
  onSelect: (id: string) => void;
}

function ModernProjectSelect({ projects, selectedProjectId, onSelect }: ModernProjectSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  const selectedProject = projects.find((p) => p.id === selectedProjectId);

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-3 px-3.5 py-2 rounded-xl border text-xs font-semibold transition-all duration-200 shadow-sm cursor-pointer ${
          isOpen
            ? "border-primary ring-2 ring-primary/20 bg-background shadow-md text-foreground"
            : "border-border/80 bg-surface/80 hover:border-border hover:bg-surface-muted text-foreground"
        }`}
      >
        <span className="text-muted-foreground font-normal flex items-center gap-1.5">
          <span>📁</span>
          <span>{VALIDATION_UI_STRINGS.SELECT_PROJECT_LABEL}</span>
        </span>
        <span className="text-foreground font-bold">{selectedProject?.name || VALIDATION_UI_STRINGS.CHOOSE_PROJECT_PLACEHOLDER}</span>
        <svg
          className={`w-3.5 h-3.5 text-muted-foreground transition-transform duration-200 ml-1 ${
            isOpen ? "rotate-180 text-primary" : ""
          }`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth="2.5"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute left-0 top-[calc(100%+6px)] z-[110] min-w-[240px] rounded-2xl border border-border/80 bg-surface shadow-2xl ring-1 ring-black/10 overflow-hidden animate-in fade-in zoom-in-95 duration-150 p-1.5 space-y-0.5">
          {projects.map((p) => {
            const isSelected = p.id === selectedProjectId;
            return (
              <div
                key={p.id}
                onClick={() => {
                  onSelect(p.id);
                  setIsOpen(false);
                }}
                className={`flex items-center justify-between px-3.5 py-2 rounded-xl cursor-pointer text-xs font-medium transition-colors ${
                  isSelected
                    ? "bg-primary text-primary-foreground font-semibold shadow-sm"
                    : "text-foreground hover:bg-primary/10 hover:text-primary"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span>📊</span>
                  <span className="truncate">{p.name}</span>
                </div>
                {isSelected && (
                  <svg
                    className="w-4 h-4 text-primary-foreground shrink-0"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth="2.5"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Strips technical logging prefixes from error messages so the message
 * is presented cleanly without log prefixes.
 */
function cleanErrorMessage(msg: string | null): string {
  if (!msg) return "";
  return msg
    .replace(/^\[[a-zA-Z0-9_]+\]\s*/i, "")
    .replace(/^Error:\s*/i, "")
    .trim();
}

/**
 * Robustly inspects an agentState object across candidate locations
 * to extract a non-empty FormBuilder filter schema.
 */
function extractFormSchemaFromState(state: any, project: any): FormSchema | null {
  if (!state || typeof state !== "object") return null;

  const candidates = [
    state?.stageOutputs?.formBuilder,
    state?.stageOutputs?.hierarchyMapper?.formBuilder,
    state?.hierarchyMapper?.formBuilder,
    state?.formBuilder,
    state?.stageOutputs?.hierarchyMapper,
    state?.hierarchyMapper,
  ];

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") continue;
    const groups = candidate.filterGroups || candidate.forms || candidate.groups;
    if (Array.isArray(groups) && groups.length > 0) {
      const primarySourceId =
        (project.dataSources && project.dataSources.length > 0 ? project.dataSources[0] : null) ||
        candidate.sourceId ||
        "default_source";

      return {
        sourceId: primarySourceId,
        projectId: project.id,
        projectName: project.name,
        filterGroups: groups,
        forms: groups,
      };
    }
  }

  return null;
}

interface ValidationPageProps {
  project?: Project;
}

export default function ValidationPage({ project: propProject }: ValidationPageProps = {}) {
  const { projects, updateProject } = useApp();
  const [selectedProjectId, setSelectedProjectId] = useState<string>(propProject?.id || "");
  const [activeSchema, setActiveSchema] = useState<FormSchema | null>(null);
  const [isLoadingSchema, setIsLoadingSchema] = useState<boolean>(false);

  // Filter state captured from Active Filter Form
  const [filterValues, setFilterValues] = useState<Record<string, any>>({});

  // Model Validation Execution State — NO SILENT DEFAULTS
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  const [startDate, setStartDate] = useState<string>("");
  const [horizon, setHorizon] = useState<number | "">("");
  const [frequency, setFrequency] = useState<string>("");
  const [isValidating, setIsValidating] = useState<boolean>(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [validationResults, setValidationResults] = useState<any | null>(null);

  // Automatically select the project or sync when projects change
  useEffect(() => {
    if (propProject?.id) {
      setSelectedProjectId(propProject.id);
    } else if (projects.length > 0) {
      if (!selectedProjectId || !projects.some((p) => p.id === selectedProjectId)) {
        setSelectedProjectId(projects[0].id);
      }
    } else {
      setSelectedProjectId("");
      setActiveSchema(null);
    }
  }, [propProject?.id, projects, selectedProjectId]);

  const currentProject = propProject || projects.find((p) => p.id === selectedProjectId);

  // Extract trained candidate models from project state
  const candidateModels = useMemo(() => {
    const state = currentProject?.agentState as any;
    const report = state?.modelTraining?.report || state?.stageOutputs?.modelTraining?.report;
    const rawCandidates =
      report?.ranked_models ||
      report?.model_results ||
      state?.modelSelection?.candidates ||
      state?.stageOutputs?.modelSelection?.candidates ||
      [];

    if (Array.isArray(rawCandidates)) {
      return rawCandidates.map((c: any) => ({
        model_id: c.model_id || c.id || String(c),
        displayName: c.displayName || c.model_id || c.id || String(c),
        framework: c.framework || VALIDATION_UI_STRINGS.DEFAULT_UNKNOWN_FRAMEWORK,
        score: typeof c.score === "number" ? c.score : c.metrics?.score,
      }));
    }
    if (rawCandidates && typeof rawCandidates === "object") {
      return Object.entries(rawCandidates).map(([k, v]: [string, any]) => ({
        model_id: v?.model_id || k,
        displayName: v?.displayName || v?.model_id || k,
        framework: v?.framework || VALIDATION_UI_STRINGS.DEFAULT_UNKNOWN_FRAMEWORK,
        score: typeof v?.score === "number" ? v?.score : v?.metrics?.score,
      }));
    }
    return [];
  }, [currentProject?.agentState]);

  const championModelId = useMemo(() => {
    const state = currentProject?.agentState as any;
    const report = state?.modelTraining?.report || state?.stageOutputs?.modelTraining?.report;
    return report?.champion_model_id || report?.best_model_id || null;
  }, [currentProject?.agentState]);

  // Resolve user-selected split date from model training / configuration
  const trainingSplitStartDate = useMemo(() => {
    if (!currentProject) return "";
    const state = currentProject.agentState as any;
    const split =
      currentProject.splitDate ||
      state?.splitDate ||
      state?.splitEndDate ||
      state?.trainingConfiguration?.splitDate ||
      state?.trainingConfiguration?.splitEndDate ||
      state?.trainingConfiguration?.configuration?.split?.split_date ||
      state?.trainingConfiguration?.configuration?.split?.cutoff_date ||
      state?.trainingConfiguration?.configuration?.data_splitting?.cutoff_date ||
      state?.modelTraining?.splitEndDate ||
      state?.modelTraining?.splitDate ||
      state?.modelTraining?.report?.split_date ||
      state?.modelTraining?.report?.splitEndDate ||
      "";

    if (!split || typeof split !== "string") return "";
    const trimmed = split.trim();
    if (!trimmed) return "";

    // Starting month from that particular split date: YYYY-MM-01
    const match = /^(\d{4})-(\d{2})/.exec(trimmed);
    if (match) {
      return `${match[1]}-${match[2]}-01`;
    }
    try {
      const d = new Date(trimmed);
      if (!isNaN(d.getTime())) {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, "0");
        return `${y}-${m}-01`;
      }
    } catch {}
    return trimmed;
  }, [currentProject]);

  // Minimum selectable date: starting month from training split date
  const minSelectableDate = useMemo(() => {
    return trainingSplitStartDate || undefined;
  }, [trainingSplitStartDate]);

  // Auto-populate prediction objective start date from model training split date
  useEffect(() => {
    if (trainingSplitStartDate) {
      setStartDate(trainingSplitStartDate);
    } else {
      setStartDate("");
    }
  }, [currentProject?.id, trainingSplitStartDate]);

  // Fetch initial validation run or schema on project change
  useEffect(() => {
    if (!currentProject) {
      setActiveSchema(null);
      setIsLoadingSchema(false);
      setValidationResults(null);
      return;
    }

    // 1. Try immediate synchronous extraction from in-memory project.agentState
    const inMemorySchema = extractFormSchemaFromState(currentProject.agentState, currentProject);
    if (inMemorySchema) {
      setActiveSchema(inMemorySchema);
      setIsLoadingSchema(false);
    } else {
      let isMounted = true;
      setIsLoadingSchema(true);

      async function fetchFormSchema() {
        const wsId = currentProject!.workspaceId || "default";
        try {
          const schemaRes = await fetch(`${BACKEND_URL}/workspaces/${wsId}/projects/${currentProject!.id}/form-schema`);
          if (schemaRes.ok) {
            const contentType = schemaRes.headers.get("content-type") || "";
            if (contentType.includes("application/json")) {
              const json = await schemaRes.json();
              if (json.success && json.schema && isMounted) {
                setActiveSchema({
                  sourceId: json.schema.sourceId || currentProject!.dataSources?.[0] || "default_source",
                  projectId: currentProject!.id,
                  projectName: currentProject!.name,
                  filterGroups: json.schema.filterGroups || json.schema.forms || [],
                  forms: json.schema.forms || json.schema.filterGroups || [],
                });
                setIsLoadingSchema(false);
                return;
              }
            }
          }
        } catch (err) {
          console.warn("[ValidationPage] Failed to fetch project form schema fallback:", err);
        }

        if (isMounted) {
          setActiveSchema(null);
          setIsLoadingSchema(false);
        }
      }

      fetchFormSchema();
    }

    // 2. Fetch latest validation run from dedicated repository endpoint
    let isMountedVal = true;
    async function fetchValidation() {
      try {
        const res = await fetch(`${BACKEND_URL}${VALIDATION_API_ENDPOINTS.RESULTS}/${currentProject!.id}`);
        const contentType = res.headers.get("content-type") || "";
        if (res.ok && contentType.includes("application/json")) {
          const json = await res.json();
          if (json.success && json.data && isMountedVal) {
            setValidationResults(json.data);
          }
        }
      } catch (err) {
        console.warn("[ValidationPage] Failed to fetch validation run results:", err);
      }
    }

    // Check project state first, then fallback to API
    const inStateValidation =
      (currentProject.agentState as any)?.modelValidation ||
      (currentProject.agentState as any)?.stageOutputs?.modelValidation;
    if (inStateValidation) {
      setValidationResults(inStateValidation);
    } else {
      fetchValidation();
    }

    return () => {
      isMountedVal = false;
    };
  }, [currentProject?.id, currentProject?.agentState]);

  // Model Validation Execution Handler
  const handleValidateModels = async () => {
    if (
      !startDate ||
      horizon === "" ||
      typeof horizon !== "number" ||
      horizon <= 0 ||
      !frequency ||
      selectedModels.length === 0
    ) {
      setValidationError(VALIDATION_UI_STRINGS.MISSING_SELECTION_ALERT);
      return;
    }

    if (!currentProject?.id) return;

    setIsValidating(true);
    setValidationError(null);

    try {
      const res = await fetch(`${BACKEND_URL}${VALIDATION_API_ENDPOINTS.VALIDATE}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: currentProject.id,
          predictionObjectiveStartDate: startDate,
          predictionHorizon: Number(horizon),
          predictionFrequency: frequency,
          selectedModels,
          filters: filterValues,
        }),
      });

      const contentType = res.headers.get("content-type") || "";
      let json: any = null;
      if (contentType.includes("application/json")) {
        json = await res.json();
      } else {
        const text = await res.text();
        throw new Error(
          `Validation endpoint returned non-JSON response (${res.status}): ${text.slice(0, 160)}`
        );
      }

      if (!res.ok || !json.success) {
        throw new Error(json.message || VALIDATION_UI_STRINGS.VALIDATION_FAILED_ERROR);
      }

      setValidationResults(json.data);

      // Update in memory application state
      if (updateProject && currentProject.id) {
        const existingAgentState = (currentProject.agentState as any) || {};
        await updateProject(currentProject.id, {
          agentState: {
            ...existingAgentState,
            modelValidation: json.data,
            stageOutputs: {
              ...(existingAgentState.stageOutputs || {}),
              modelValidation: json.data,
            },
          },
        });
      }
    } catch (err: any) {
      setValidationError(err.message || VALIDATION_UI_STRINGS.VALIDATION_FAILED_ERROR);
    } finally {
      setIsValidating(false);
    }
  };

  const hasDesignedForm =
    activeSchema && Array.isArray(activeSchema.filterGroups) && activeSchema.filterGroups.length > 0;

  const isFormValid =
    Boolean(startDate) &&
    typeof horizon === "number" &&
    horizon > 0 &&
    Boolean(frequency) &&
    selectedModels.length > 0;

  return (
    <main className="min-h-full bg-background/50 p-6 md:p-8 space-y-8">
      {/* Top Bar: Left-Aligned Modern Project Selector if not scoped to a propProject */}
      {!propProject && projects.length > 0 && (
        <div className="flex items-center justify-between pb-2 border-b border-border/80">
          <ModernProjectSelect
            projects={projects}
            selectedProjectId={selectedProjectId}
            onSelect={(id) => setSelectedProjectId(id)}
          />
        </div>
      )}

      {/* Main Content Area */}
      <div className="w-full space-y-8">
        {isLoadingSchema ? (
          <div className="flex flex-col items-center justify-center min-h-[440px] w-full rounded-3xl border border-border/60 bg-surface/30 backdrop-blur-sm p-12 text-center shadow-sm animate-pulse space-y-4">
            <div className="w-14 h-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center text-3xl shadow-sm">
              <span className="animate-spin text-primary">⚙️</span>
            </div>
            <div>
              <h2 className="text-base font-bold text-foreground tracking-tight">
                {VALIDATION_UI_STRINGS.LOADING_SCHEMA_TITLE}
              </h2>
              <p className="text-xs text-muted-foreground mt-1 max-w-sm">
                {VALIDATION_UI_STRINGS.LOADING_SCHEMA_DESC}
              </p>
            </div>
          </div>
        ) : hasDesignedForm ? (
          <FilterForm
            schema={activeSchema}
            apiBaseUrl={BACKEND_URL}
            onFilterChange={setFilterValues}
          />
        ) : (
          <div className="flex flex-col items-center justify-center min-h-[240px] w-full rounded-3xl border border-dashed border-border/80 bg-surface/30 backdrop-blur-sm p-8 text-center shadow-sm animate-in fade-in duration-300">
            <div className="w-12 h-12 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center text-2xl mb-3 shadow-sm">
              📐
            </div>
            <h2 className="text-base font-bold text-foreground tracking-tight mb-1">
              {VALIDATION_UI_STRINGS.PROJECT_NOT_DESIGNED_TITLE}
            </h2>
            <p className="text-xs text-muted-foreground max-w-md">
              {VALIDATION_UI_STRINGS.PROJECT_NOT_DESIGNED_DESC}
            </p>
          </div>
        )}

        {/* ─── Dedicated Model Validation Section ─── */}
        <div className="w-full rounded-3xl border border-border/80 bg-surface/40 backdrop-blur-sm p-6 sm:p-8 space-y-6 shadow-sm">
          {/* Section Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-border/80">
            <div>
              <h3 className="text-base font-bold text-foreground tracking-tight flex items-center gap-2">
                <span>📊</span>
                <span>{VALIDATION_UI_STRINGS.VALIDATION_SECTION_TITLE}</span>
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5 max-w-2xl">
                {VALIDATION_UI_STRINGS.VALIDATION_SECTION_DESC}
              </p>
            </div>

            {/* Filter Status Badge */}
            <div className="shrink-0">
              {Object.keys(filterValues).length > 0 ? (
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-xs font-semibold">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  <span>{VALIDATION_UI_STRINGS.ACTIVE_FILTER_NOTICE}</span>
                </div>
              ) : (
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-surface-muted border border-border text-muted-foreground text-xs font-medium">
                  <span>ℹ️</span>
                  <span>{VALIDATION_UI_STRINGS.UNFILTERED_NOTICE}</span>
                </div>
              )}
            </div>
          </div>

          {/* Model Selection from Completed Training */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-foreground tracking-wide uppercase">
                {VALIDATION_UI_STRINGS.MODELS_LABEL}
              </label>
              {candidateModels.length > 0 && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedModels(candidateModels.map((c) => c.model_id))}
                    className="px-2.5 py-1 text-xs font-medium rounded-lg border border-border bg-surface hover:bg-surface-muted text-foreground transition-all cursor-pointer"
                  >
                    {VALIDATION_UI_STRINGS.SELECT_ALL_LABEL}
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedModels([])}
                    className="px-2.5 py-1 text-xs font-medium rounded-lg border border-border bg-surface hover:bg-surface-muted text-foreground transition-all cursor-pointer"
                  >
                    {VALIDATION_UI_STRINGS.DESELECT_ALL_LABEL}
                  </button>
                </div>
              )}
            </div>

            {candidateModels.length === 0 ? (
              <div className="p-4 rounded-2xl border border-dashed border-border bg-surface-muted/40 text-xs text-muted-foreground">
                {VALIDATION_UI_STRINGS.NO_TRAINED_MODELS_ALERT}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                {candidateModels.map((candidate) => {
                  const isChecked = selectedModels.includes(candidate.model_id);
                  const isChamp = candidate.model_id === championModelId;

                  return (
                    <div
                      key={candidate.model_id}
                      onClick={() => {
                        setSelectedModels((prev) =>
                          prev.includes(candidate.model_id)
                            ? prev.filter((id) => id !== candidate.model_id)
                            : [...prev, candidate.model_id]
                        );
                      }}
                      className={`p-3.5 rounded-2xl border transition-all cursor-pointer select-none flex items-start gap-3 ${
                        isChecked
                          ? "border-primary bg-primary/5 dark:bg-primary/10 shadow-xs ring-1 ring-primary/20"
                          : "border-border bg-surface/70 hover:border-border/80 opacity-70"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => {}}
                        className="mt-0.5 w-4 h-4 rounded text-primary border-border focus:ring-0 cursor-pointer"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-1.5">
                          <span className="text-xs font-bold text-foreground truncate">
                            {candidate.displayName}
                          </span>
                          {isChamp && (
                            <span className="text-[9px] uppercase font-black px-1.5 py-0.5 rounded bg-amber-500 text-white shrink-0">
                              {VALIDATION_UI_STRINGS.CHAMPION_BADGE}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center justify-between mt-1 text-[11px] text-muted-foreground">
                          <span className="font-mono">{candidate.framework}</span>
                          {typeof candidate.score === "number" && (
                            <span className="text-emerald-600 dark:text-emerald-400 font-semibold font-mono">
                              {(candidate.score * 100).toFixed(1)}%
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Primary Outlined Error Message Banner - On top of input parameters */}
          {validationError && (
            <div className="flex items-center gap-2.5 px-4 py-3 rounded-xl border border-destructive/60 bg-destructive/5 text-destructive text-xs font-semibold">
              <svg className="w-4 h-4 shrink-0 text-destructive" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <span className="flex-1">{cleanErrorMessage(validationError)}</span>
            </div>
          )}

          {/* Validation Parameters Form Controls */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-4 border-t border-border/60">
            {/* Start Date */}
            <div>
              <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
                {VALIDATION_UI_STRINGS.START_DATE_LABEL}
              </label>
              <input
                type="date"
                min={minSelectableDate}
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                placeholder={VALIDATION_UI_STRINGS.START_DATE_PLACEHOLDER}
                className="w-full h-10 px-3.5 rounded-xl border border-border bg-background text-xs font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 transition cursor-pointer"
              />
            </div>

            {/* Forecast Horizon */}
            <div>
              <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
                {VALIDATION_UI_STRINGS.HORIZON_LABEL}
              </label>
              <input
                type="number"
                min={1}
                value={horizon}
                onChange={(e) => setHorizon(e.target.value ? parseInt(e.target.value, 10) : "")}
                placeholder={VALIDATION_UI_STRINGS.HORIZON_PLACEHOLDER}
                className="w-full h-10 px-3.5 rounded-xl border border-border bg-background text-xs font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 transition"
              />
            </div>

            {/* Forecast Frequency */}
            <div>
              <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
                {VALIDATION_UI_STRINGS.FREQUENCY_LABEL}
              </label>
              <select
                value={frequency}
                onChange={(e) => setFrequency(e.target.value)}
                className="w-full h-10 px-3.5 rounded-xl border border-border bg-background text-xs font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 transition cursor-pointer"
              >
                <option value="">{VALIDATION_UI_STRINGS.FREQUENCY_PLACEHOLDER}</option>
                {VALIDATION_FREQUENCY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Action Trigger */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
            <p className="text-xs text-muted-foreground">
              {selectedModels.length} {VALIDATION_UI_STRINGS.MODELS_SELECTED_SUFFIX}
            </p>

            <button
              type="button"
              disabled={!isFormValid || isValidating}
              onClick={handleValidateModels}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl bg-primary text-primary-foreground text-xs font-bold tracking-wide uppercase shadow-md hover:bg-primary/90 hover:scale-[1.01] active:scale-98 transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {isValidating ? (
                <>
                  <span className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                  <span>{VALIDATION_UI_STRINGS.VALIDATING_BUTTON}</span>
                </>
              ) : (
                <>
                  <span>▶</span>
                  <span>{VALIDATION_UI_STRINGS.VALIDATE_MODELS_BUTTON}</span>
                </>
              )}
            </button>
          </div>

          {/* Validation Results Display */}
          {validationResults && (
            <div className="mt-8 pt-6 border-t border-border/80">
              <h3 className="text-base font-bold text-foreground mb-4">
                {VALIDATION_UI_STRINGS.VALIDATION_COMPLETE_TITLE}
              </h3>
              <ModelValidationStepOutput
                modelValidation={validationResults}
                modelTraining={currentProject?.agentState?.modelTraining}
                trainingConfiguration={currentProject?.agentState?.trainingConfiguration}
                modelSelection={currentProject?.agentState?.modelSelection}
                projectId={currentProject?.id}
                activeRunTimestamp={(currentProject?.agentState as any)?.runTimestamp}
              />
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
