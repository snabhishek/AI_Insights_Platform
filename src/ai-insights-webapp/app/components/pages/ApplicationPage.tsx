"use client";

import React, { useState, useEffect } from "react";
import FilterForm from "../shared/FilterForm/FilterForm";
import { FormSchema } from "../../hooks/useFilterForm";

// Default fallback schema
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
    {
      groupName: "Other Filters",
      priority: "secondary",
      fields: [
        {
          fieldId: "promotion_type",
          label: "Promotion Type",
          controlType: "dropdown",
          parentField: null,
          parentFields: [],
          options: ["Seasonal", "Flash Sale", "Clearance", "Standard"],
        },
      ],
    },
  ],
};

export default function ApplicationPage() {
  const [activeSchema, setActiveSchema] = useState<FormSchema>(SAMPLE_FORM_SCHEMA);
  const [activeFilters, setActiveFilters] = useState<Record<string, any>>({});
  const [projectsList, setProjectsList] = useState<any[]>([]);

  // Fetch recent connectors/projects from backend if available
  useEffect(() => {
    async function loadBackendData() {
      try {
        const res = await fetch("http://localhost:4000/api/connectors");
        if (res.ok) {
          const connectors = await res.json();
          if (Array.isArray(connectors) && connectors.length > 0) {
            setProjectsList(connectors);
            const firstConn = connectors[0];
            if (firstConn && firstConn.id) {
              setActiveSchema((prev) => ({
                ...prev,
                sourceId: firstConn.id,
              }));
            }
          }
        }
      } catch {
        // Use default fallback schema
      }
    }
    loadBackendData();
  }, []);

  return (
    <main className="min-h-screen bg-background p-6 space-y-6">
      {/* Connector Switcher Header */}
      {projectsList.length > 0 && (
        <div className="flex items-center justify-end border-b border-border pb-3">
          <div className="flex items-center gap-2">
            <label className="text-xs text-muted-foreground font-medium">Data Source:</label>
            <select
              value={activeSchema.sourceId || ""}
              onChange={(e) =>
                setActiveSchema((prev) => ({
                  ...prev,
                  sourceId: e.target.value,
                }))
              }
              className="rounded-lg border border-input bg-card px-3 py-1.5 text-xs text-foreground font-mono focus:outline-none focus:ring-2 focus:ring-primary cursor-pointer"
            >
              {projectsList.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.type})
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* Main Content Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Dynamic Filter Form */}
        <div className="lg:col-span-2 space-y-4">
          <FilterForm
            schema={activeSchema}
            apiBaseUrl="http://localhost:4000"
            onFilterChange={(vals) => setActiveFilters(vals)}
          />
        </div>

        {/* Live Filter Selection JSON Inspector */}
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-card p-4 shadow-sm space-y-3">
            <h2 className="text-sm font-semibold text-foreground border-b border-border pb-2">
              Selected Filter State
            </h2>
            <p className="text-xs text-muted-foreground">
              Live value map maintained by <code className="text-primary font-mono">useFilterForm</code>.
            </p>
            <pre className="bg-surface-muted/80 p-3 rounded-lg text-xs font-mono text-foreground overflow-x-auto max-h-96 border border-border">
              {JSON.stringify(activeFilters, null, 2)}
            </pre>
          </div>
        </div>
      </div>
    </main>
  );
}
