"use client";

import React from "react";
import { Workflow } from "./types";

export const PIPELINE_STEPS: Workflow[] = [
  {
    id: "Data Ingestion",
    title: "Data Ingestion",
    description: "Inspect connector sources and discover structure",
    color: "green",
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
      </svg>
    ),
    step: [
      {
        id: "Data Inspection",
        title: "Data Inspection",
        description: "Inspect connector sources and discover structure",
        metric: "Inspect",
        color: "green",
        icon: (
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
          </svg>
        ),
      },
      {
        id: "Data Profiling",
        title: "Data Profiling & Preprocess",
        description: "Profile and preprocess data quality findings",
        metric: "Profile + Prep",
        color: "blue",
        icon: (
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
            <polyline points="10 9 9 9 8 9" />
          </svg>
        ),
      },
      {
        id: "Schema Resolver",
        title: "Schema Resolver",
        description: "Resolve and map the schema for downstream use",
        metric: "Resolve",
        color: "purple",
        icon: (
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="7" height="9" rx="1" />
            <rect x="14" y="3" width="7" height="5" rx="1" />
            <rect x="14" y="12" width="7" height="9" rx="1" />
            <rect x="3" y="16" width="7" height="5" rx="1" />
          </svg>
        ),
      },
    ]
  },
  {
    id: "Feature Engineering",
    title: "Feature Engineering",
    description: "Shape the data into features for downstream analytics",
    // metric: "Features",
    color: "yellow",
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M4 6h16" />
        <path d="M4 12h10" />
        <path d="M4 18h6" />
        <circle cx="17" cy="12" r="3" />
      </svg>
    ),
  },
  {
    id: "Model Training",
    title: "Model Training",
    description: "Train predictive models from prepared data",
    // metric: "Train",
    color: "pink",
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M4 19V5" />
        <path d="M20 19V9" />
        <path d="M12 19V13" />
        <circle cx="4" cy="19" r="2" />
        <circle cx="12" cy="19" r="2" />
        <circle cx="20" cy="19" r="2" />
      </svg>
    ),
  },
  {
    id: "Model Validation",
    title: "Model Validation",
    description: "Validate model quality and confidence",
    // metric: "Validate",
    color: "teal",
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="4" y="4" width="16" height="16" rx="2" />
        <path d="M8 12h8" />
        <path d="M8 8h8" />
        <path d="M8 16h5" />
      </svg>
    ),
  },
  {
    id: "Forecast",
    title: "Forecast",
    description: "Publish the final forecast for business action",
    // metric: "Forecast",
    color: "red",
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M5 19V9" />
        <path d="M12 19V5" />
        <path d="M19 19v-7" />
        <path d="M2 19h20" />
      </svg>
    ),
  },
];

export const INITIAL_PIPELINE_STATUSES: Record<string, "Not Started"> = {
  "Data Ingestion": "Not Started",
  "Data Profiling": "Not Started",
  "Schema Resolver": "Not Started",
  "Feature Engineering": "Not Started",
  "Model Training": "Not Started",
  "Model Validation": "Not Started",
  "Forecast": "Not Started",
};
