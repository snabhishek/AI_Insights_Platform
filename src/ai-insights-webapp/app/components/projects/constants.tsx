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
    step: [
      {
        id: "Hierarchy Mapper",
        title: "Hierarchy Mapper",
        description: "Discovers dimensional hierarchies and builds the queryable filter graph",
        metric: "HierarchyMapper",
        color: "green",
        icon: (
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
          </svg>
        ),
      },
      {
        id: "Feature Architect",
        title: "Feature Architect",
        description: "Generates and statistically validates lag/rolling/seasonal/calendar feature",
        metric: "FeatureArchitect",
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
        id: "Feature Validator",
        title: "Feature Validator",
        description: "Audits features for leakage, multicollinearity, drift, and importance",
        metric: "FeatureValidator",
        color: "teal",
        icon: (
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 11l3 3L22 4" />
            <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
          </svg>
        ),
      },
      {
        id: "Exogenous Scout",
        title: "Exogenous Scout",
        description: "Scouts and ranks external signals by predictive power",
        metric: "ExogenousScout",
        color: "purple",
        icon: (
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
            <path d="M11 8a3 3 0 0 0-3 3" />
          </svg>
        ),
      },
    ]
  },
  {
    id: "Model Training & Validation",
    title: "Model Training & Validation",
    description: "Train, evaluate, validate, and select the best model",
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
    step: [
      { id: "Training Data Preparation", title: "Training Data Preparation", description: "Prepare leakage-safe train, validation, and test datasets", metric: "Prepare", color: "blue", icon: <span>01</span> },
      { id: "Model Training", title: "Model Training", description: "Train candidate models from the prepared feature dataset", metric: "Train", color: "pink", icon: <span>02</span> },
      { id: "Model Evaluation", title: "Model Evaluation", description: "Compare candidate models using problem-appropriate metrics", metric: "Evaluate", color: "purple", icon: <span>03</span> },
      { id: "Model Validation", title: "Model Validation", description: "Validate the leading model on held-out data", metric: "Validate", color: "teal", icon: <span>04</span> },
      { id: "Model Selection", title: "Model Selection", description: "Persist the best validated model and its selection rationale", metric: "Select", color: "green", icon: <span>05</span> },
    ],
  },
];

export const INITIAL_PIPELINE_STATUSES: Record<string, "Not Started"> = {
  "Data Inspection": "Not Started",
  "Data Profiling": "Not Started",
  "Schema Resolver": "Not Started",
  "Feature Engineering": "Not Started",
  "Training Data Preparation": "Not Started",
  "Model Training": "Not Started",
  "Model Evaluation": "Not Started",
  "Model Validation": "Not Started",
  "Model Selection": "Not Started",
};
