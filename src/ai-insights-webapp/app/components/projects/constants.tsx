"use client";

import React from "react";
import {
  Database,
  ScanSearch,
  BarChart3,
  TableProperties,
  Network,
  DraftingCompass,
  ShieldCheck,
  Radar,
  BrainCircuit,
  SlidersHorizontal,
  Rocket,
  Code2,
} from "lucide-react";
import { Workflow } from "./types";
import { buildGroupedStageStatuses, TRACKED_AGENT_KEYS } from "./pipelineNames";

export const PIPELINE_STEPS: Workflow[] = [
  {
    id: "dataIngestion",
    title: "Data Ingestion",
    description: "Inspect connector sources and discover structure",
    color: "green",
    icon: <Database size={22} strokeWidth={2} />,
    step: [
      {
        id: "inspect",
        title: "Data Inspection",
        description: "Inspect connector sources and discover structure",
        metric: "Inspect",
        color: "green",
        icon: <ScanSearch size={18} strokeWidth={2} />,
      },
      {
        id: "profileData",
        title: "Data Profiling",
        description: "Profile data quality findings",
        metric: "Profile",
        color: "blue",
        icon: <BarChart3 size={18} strokeWidth={2} />,
      },
      {
        id: "resolveSchema",
        title: "Schema Resolver",
        description: "Resolve and map the schema for downstream use",
        metric: "Resolve",
        color: "purple",
        icon: <TableProperties size={18} strokeWidth={2} />,
      },
    ],
  },
  {
    id: "featureEngineering",
    title: "Feature Engineering",
    description: "Shape the data into features for downstream analytics",

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
        id: "hierarchyMapperNode",
        title: "Hierarchy Mapper",
        description: "Discovers dimensional hierarchies and builds the queryable filter graph",
        metric: "HierarchyMapper",
        color: "green",
        icon: <Network size={18} strokeWidth={2} />,
      },
      {
        id: "featureArchitectNode",
        title: "Feature Architect",
        description: "Generates and statistically validates lag/rolling/seasonal/calendar feature",
        metric: "FeatureArchitect",
        color: "blue",
        icon: <DraftingCompass size={18} strokeWidth={2} />,
      },
      {
        id: "featureValidatorNode",
        title: "Feature Validator",
        description: "Audits features for leakage, multicollinearity, drift, and importance",
        metric: "FeatureValidator",
        color: "teal",
        icon: <ShieldCheck size={18} strokeWidth={2} />,
      },
      {
        id: "exogenous",
        title: "Exogenous Scout",
        description: "Scouts and ranks external signals by predictive power",
        metric: "ExogenousScout",
        color: "purple",
        icon: <Radar size={18} strokeWidth={2} />,
      },
    ],
  },
  {
    id: "modelTrainingValidation",
    title: "Model Training & Validation",
    description: "Train, evaluate, validate, and select the best model",

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
      {
        id: "modelSelectionNode",
        title: "Model Selection",
        description: "Initialize model selection and select candidates",
        metric: "Select",
        color: "purple",
        icon: <BrainCircuit size={18} strokeWidth={2} />,
      },
      {
        id: "trainingConfigurationNode",
        title: "Training Configuration",
        description: "Configure training environment and dataset splits",
        metric: "Configure",
        color: "pink",
        icon: <SlidersHorizontal size={18} strokeWidth={2} />,
      },
      {
        id: "preFlightNode",
        title: "Pre Flight",
        description: "Validate runtime resources, environment and strategy pre-flight",
        metric: "Validate",
        color: "pink",
        icon: <Rocket size={18} strokeWidth={2} />,
      },
      {
        id: "modelTrainingCodeNode",
        title: "Model Training Code Generation",
        description: "Generate model training code and verify execution in Docker",
        metric: "Generate Code",
        color: "pink",
        icon: <Code2 size={18} strokeWidth={2} />,
      },
    ],
  },
];

export const INITIAL_PIPELINE_STATUSES = buildGroupedStageStatuses(
  Object.fromEntries(TRACKED_AGENT_KEYS.map((key) => [key, "None"]))
);
