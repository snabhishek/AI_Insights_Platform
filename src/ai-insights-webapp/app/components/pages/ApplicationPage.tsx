"use client";

import React, { useState, useEffect, useRef } from "react";
import FilterForm from "../shared/FilterForm/FilterForm";
import { FormSchema } from "../../hooks/useFilterForm";
import { useApp } from "../providers/AppContext";

// Default fallback schema when no project or workflow has been run yet
const SAMPLE_FORM_SCHEMA: FormSchema = {
  sourceId: "demand_forecasting_dataset",
  filterGroups: [
    {
      groupName: "Product Hierarchy",
      priority: "primary",
      fields: [
        {
          fieldId: "category",
          label: "Product Category",
          controlType: "dropdown",
          parentField: null,
          parentFields: [],
          options: ["Heat Pumps", "AC Units", "Furnaces", "Thermostats"],
        },
        {
          fieldId: "segment",
          label: "Product Segment",
          controlType: "dropdown",
          parentField: "category",
          parentFields: ["category"],
          options: ["Residential", "Commercial", "Industrial"],
        },
        {
          fieldId: "sku",
          label: "SKU / Model",
          controlType: "searchable_dropdown",
          parentField: "segment",
          parentFields: ["category", "segment"],
          requiredParentParams: ["category", "segment"],
          options: ["HP-100", "HP-200", "AC-500", "AC-600", "FN-900"],
        },
      ],
    },
    {
      groupName: "Geographic Location",
      priority: "primary",
      fields: [
        {
          fieldId: "region",
          label: "Region",
          controlType: "dropdown",
          parentField: null,
          parentFields: [],
          options: ["North America", "EMEA", "APAC", "LATAM"],
        },
        {
          fieldId: "country",
          label: "Country",
          controlType: "dropdown",
          parentField: "region",
          parentFields: ["region"],
          options: ["United States", "Canada", "Germany", "Japan", "Brazil"],
        },
      ],
    },
    {
      groupName: "Time & Dates",
      priority: "primary",
      fields: [
        {
          fieldId: "order_year",
          label: "Order Year",
          controlType: "dropdown",
          parentField: null,
          parentFields: [],
          options: [2023, 2024, 2025, 2026],
        },
        {
          fieldId: "order_date",
          label: "Order Date Range",
          controlType: "date_range",
          parentField: "order_year",
          parentFields: ["order_year"],
        },
      ],
    },
  ],
};

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

export default function ApplicationPage() {
  const { projects } = useApp();
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [activeSchema, setActiveSchema] = useState<FormSchema>(SAMPLE_FORM_SCHEMA);

  // Automatically select the first available project or sync when projects change
  useEffect(() => {
    if (projects.length > 0) {
      if (!selectedProjectId || !projects.some((p) => p.id === selectedProjectId)) {
        setSelectedProjectId(projects[0].id);
      }
    }
  }, [projects, selectedProjectId]);

  // Update active schema based on selected project's AI-generated Hierarchy Mapper Form Builder output
  useEffect(() => {
    if (!selectedProjectId) return;
    const project = projects.find((p) => p.id === selectedProjectId);
    if (!project) return;

    const agentState = project.agentState as any;
    const rawFormBuilder =
      agentState?.formBuilder ||
      agentState?.stageOutputs?.formBuilder ||
      agentState?.stageOutputs?.hierarchyMapper?.formBuilder ||
      agentState?.stageOutputs?.hierarchyMapper;

    const primarySourceId =
      project.dataSources && project.dataSources.length > 0
        ? project.dataSources[0]
        : rawFormBuilder?.sourceId || "default_source";

    if (rawFormBuilder && (Array.isArray(rawFormBuilder.filterGroups) || Array.isArray(rawFormBuilder.forms))) {
      const groups = rawFormBuilder.filterGroups || rawFormBuilder.forms;
      setActiveSchema({
        sourceId: primarySourceId,
        filterGroups: groups,
        forms: groups,
      });
    } else if (primarySourceId && primarySourceId !== "default_source") {
      setActiveSchema((prev) => ({
        ...prev,
        sourceId: primarySourceId,
      }));
    }
  }, [selectedProjectId, projects]);

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

      {/* Full-Width Filter Form */}
      <div className="w-full">
        <FilterForm
          schema={activeSchema}
          apiBaseUrl="http://127.0.0.1:4000"
        />
      </div>
    </main>
  );
}
