"use client";

import React from "react";
import { WorkflowStep } from "./types";

export const PIPELINE_STEPS: WorkflowStep[] = [
  {
    id: "Data Ingestion",
    title: "Data Ingestion",
    description: "Collect data from connected sources",
    metric: "3 Sources",
    color: "green",
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
      </svg>
    ),
  },
  {
    id: "Data Profiling",
    title: "Data Profiling",
    description: "Profile and analyze data quality",
    metric: "12 Profiling Rules",
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
    id: "Schema resolver",
    title: "Schema Resolver",
    description: "Resolve and map data schema",
    metric: "8 Schemas Resolved",
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
  {
    id: "Feature Engineering",
    title: "Feature Engineering",
    description: "Generate features for training",
    metric: "15 Features",
    color: "yellow",
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
      </svg>
    ),
  },
  {
    id: "Model Training",
    title: "Model Training",
    description: "Train machine learning models",
    metric: "5 Models",
    color: "red",
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M9.59 4.59A2 2 0 1 1 11 8H2m10.59 11.41A2 2 0 1 0 14 16H2m15.59-5.59A2 2 0 1 1 19 14H2" />
      </svg>
    ),
  },
  {
    id: "Model Validation",
    title: "Model Validation",
    description: "Validate model performance",
    metric: "2 Validations",
    color: "pink",
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
        <polyline points="22 4 12 14.01 9 11.01" />
      </svg>
    ),
  },
  {
    id: "Forecast",
    title: "Forecast",
    description: "Generate forecasts and predictions",
    metric: "Business Impact",
    color: "teal",
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M3 3v18h18" />
        <polyline points="18.7 8l-5.1 5.2-2.8-2.7L7 14.3" />
      </svg>
    ),
  },
];

export const INITIAL_PIPELINE_STATUSES: Record<string, "Not Started"> = {
  "Data Ingestion": "Not Started",
  "Data Profiling": "Not Started",
  "Schema resolver": "Not Started",
  "Feature Engineering": "Not Started",
  "Model Training": "Not Started",
  "Model Validation": "Not Started",
  "Forecast": "Not Started",
};
