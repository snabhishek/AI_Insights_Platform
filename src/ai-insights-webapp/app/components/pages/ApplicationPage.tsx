"use client";

import React, { useState, useEffect, useRef } from "react";
import FilterForm from "../shared/FilterForm/FilterForm";
import { FormSchema } from "../../hooks/useFilterForm";
import { useApp, BACKEND_URL } from "../providers/AppContext";

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
          <span>Select Project:</span>
        </span>
        <span className="text-foreground font-bold">{selectedProject?.name || "Choose a project"}</span>
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
 * Robustly inspects an agentState object across all possible candidate locations
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

export default function ApplicationPage() {
  const { projects } = useApp();
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [activeSchema, setActiveSchema] = useState<FormSchema | null>(null);
  const [isLoadingSchema, setIsLoadingSchema] = useState<boolean>(false);

  // Automatically select the first available project or sync when projects change
  useEffect(() => {
    if (projects.length > 0) {
      if (!selectedProjectId || !projects.some((p) => p.id === selectedProjectId)) {
        setSelectedProjectId(projects[0].id);
      }
    } else {
      setSelectedProjectId("");
      setActiveSchema(null);
    }
  }, [projects, selectedProjectId]);

  // Update active schema based on selected project with synchronous extraction and asynchronous backend fallback
  useEffect(() => {
    if (!selectedProjectId) {
      setActiveSchema(null);
      setIsLoadingSchema(false);
      return;
    }

    const project = projects.find((p) => p.id === selectedProjectId);
    if (!project) {
      setActiveSchema(null);
      setIsLoadingSchema(false);
      return;
    }

    // 1. Try immediate synchronous extraction from in-memory project.agentState
    const inMemorySchema = extractFormSchemaFromState(project.agentState, project);
    if (inMemorySchema) {
      setActiveSchema(inMemorySchema);
      setIsLoadingSchema(false);
      return;
    }

    // 2. Asynchronous fallback: fetch dedicated form-schema or project runs from backend
    let isMounted = true;
    setIsLoadingSchema(true);

    async function fetchFormSchema() {
      const wsId = project!.workspaceId || "default";
      try {
        // First try dedicated form-schema endpoint
        const schemaRes = await fetch(`${BACKEND_URL}/workspaces/${wsId}/projects/${project!.id}/form-schema`);
        if (schemaRes.ok) {
          const json = await schemaRes.json();
          if (json.success && json.schema && isMounted) {
            setActiveSchema({
              sourceId: json.schema.sourceId || project!.dataSources?.[0] || "default_source",
              projectId: project!.id,
              projectName: project!.name,
              filterGroups: json.schema.filterGroups || json.schema.forms || [],
              forms: json.schema.forms || json.schema.filterGroups || [],
            });
            setIsLoadingSchema(false);
            return;
          }
        }

        // Second fallback: check historical project runs
        const runsRes = await fetch(`${BACKEND_URL}/workspaces/${wsId}/projects/${project!.id}/runs`);
        if (runsRes.ok) {
          const runs: any[] = await runsRes.json();
          if (Array.isArray(runs) && runs.length > 0) {
            for (const run of runs) {
              const runSchema = extractFormSchemaFromState(run.agentState, project);
              if (runSchema && isMounted) {
                setActiveSchema(runSchema);
                setIsLoadingSchema(false);
                return;
              }
            }
          }
        }
      } catch (err) {
        console.warn("[ApplicationPage] Failed to fetch project form schema fallback:", err);
      }

      if (isMounted) {
        setActiveSchema(null);
        setIsLoadingSchema(false);
      }
    }

    fetchFormSchema();

    return () => {
      isMounted = false;
    };
  }, [selectedProjectId, projects]);

  const hasDesignedForm =
    activeSchema && Array.isArray(activeSchema.filterGroups) && activeSchema.filterGroups.length > 0;

  return (
    <main className="min-h-screen bg-background/50 p-6 md:p-8 space-y-6">
      {/* Top Bar: Left-Aligned Modern Project Selector */}
      {projects.length > 0 && (
        <div className="flex items-center justify-between pb-2 border-b border-border/80">
          <ModernProjectSelect
            projects={projects}
            selectedProjectId={selectedProjectId}
            onSelect={(id) => setSelectedProjectId(id)}
          />
        </div>
      )}

      {/* Main Content Area */}
      <div className="w-full">
        {isLoadingSchema ? (
          <div className="flex flex-col items-center justify-center min-h-[440px] w-full rounded-3xl border border-border/60 bg-surface/30 backdrop-blur-sm p-12 text-center shadow-sm animate-pulse space-y-4">
            <div className="w-14 h-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center text-3xl shadow-sm">
              <span className="animate-spin text-primary">⚙️</span>
            </div>
            <div>
              <h2 className="text-base font-bold text-foreground tracking-tight">
                Loading Application Forms...
              </h2>
              <p className="text-xs text-muted-foreground mt-1 max-w-sm">
                Resolving AI-generated data hierarchies and interactive filter configurations.
              </p>
            </div>
          </div>
        ) : hasDesignedForm ? (
          <FilterForm
            schema={activeSchema}
            apiBaseUrl={BACKEND_URL}
          />
        ) : (
          <div className="flex flex-col items-center justify-center min-h-[440px] w-full rounded-3xl border border-dashed border-border/80 bg-surface/30 backdrop-blur-sm p-12 text-center shadow-sm animate-in fade-in duration-300">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center text-3xl mb-4 shadow-sm">
              📐
            </div>
            <h2 className="text-xl font-bold text-foreground tracking-tight mb-2">
              Project is yet to be designed.
            </h2>
            <p className="text-sm text-muted-foreground max-w-md">
              This project does not have any completed workflow runs or filter forms yet. Run the AI workflow pipeline to generate data hierarchies and filter forms.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
