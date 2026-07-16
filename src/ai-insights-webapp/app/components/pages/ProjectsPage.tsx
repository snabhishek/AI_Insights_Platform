"use client";

import React, { useState, useEffect } from "react";
import Image from "next/image";
import {
  PostgresqlIcon,
  MysqlIcon,
  SqlServerIcon,
  SnowflakeIcon,
  MongodbIcon,
  RestApiIcon,
} from "../datasource/Icons";
import { useApp, Project } from "../providers/AppContext";
import { PipelineStatuses, RunStatus } from "../projects/types";
import { INITIAL_PIPELINE_STATUSES } from "../projects/constants";
import ProjectsListPage   from "../projects/ProjectsListPage";
import ProjectDetailPage  from "../projects/ProjectDetailPage";
import ProjectCreatePage  from "../projects/ProjectCreatePage";

// ─── Data-source icon renderer (shared utility) ───────────────────────────────

function renderDataSourceIcon(type: string): React.ReactNode {
  switch (type) {
    case "postgres":   return <PostgresqlIcon size={16} />;
    case "mysql":      return <MysqlIcon size={16} />;
    case "sqlserver":  return <SqlServerIcon size={16} />;
    case "snowflake":  return <SnowflakeIcon size={16} />;
    case "mongodb":    return <MongodbIcon size={16} />;
    case "excel":      return <Image src="/images/microsoft-excel.jpg" alt="Excel"  width={16} height={16} className="object-contain shrink-0" />;
    case "csv":        return <Image src="/images/csv.png"              alt="CSV"   width={16} height={16} className="object-contain shrink-0" />;
    case "tsv":        return <Image src="/images/tsv.png"              alt="TSV"   width={16} height={16} className="object-contain shrink-0" />;
    case "restapi":    return <RestApiIcon size={16} />;
    default:           return null;
  }
}

// ─── View states ──────────────────────────────────────────────────────────────

type View = "list" | "detail" | "create";

// ─── Root Page Component ──────────────────────────────────────────────────────

export default function ProjectsPage() {
  const {
    projects,
    addProject,
    deleteProject,
    dataSources,
    addDataSource,
    activeWorkspaceId,
    showConfirm,
    showAlert,
    userProfile,
  } = useApp();

  // ── View routing ──────────────────────────────────────────────────────────
  const [view, setView]                     = useState<View>("list");
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const selectedProject = projects.find((p) => p.id === selectedProjectId);

  // Reset to list when workspace changes
  useEffect(() => {
    setView("list");
    setSelectedProjectId(null);
    resetPipeline();
  }, [activeWorkspaceId]);

  // ── Pipeline simulation state ─────────────────────────────────────────────
  const [pipelineStatuses, setPipelineStatuses] = useState<PipelineStatuses>(
    INITIAL_PIPELINE_STATUSES
  );
  const [runStatus, setRunStatus]   = useState<RunStatus>("Idle");
  const [lastRunTime, setLastRunTime] = useState("Jun 25, 2026 04:28 PM");

  const resetPipeline = () => {
    setPipelineStatuses(INITIAL_PIPELINE_STATUSES);
    setRunStatus("Idle");
  };

  const completedCount    = Object.values(pipelineStatuses).filter((s) => s === "Completed").length;
  const inProgressCount   = Object.values(pipelineStatuses).filter((s) => s === "In Progress").length;
  const activeProgressIdx = completedCount + (inProgressCount > 0 ? 0.5 : 0);
  const completionPct     = (activeProgressIdx / 7) * 100;

  const runSimulation = () => {
    if (runStatus === "Running") return;
    setRunStatus("Running");

    const steps = [
      "Data Ingestion",
      "Data Profiling",
      "Schema resolver",
      "Feature Engineering",
      "Model Training",
      "Model Validation",
      "Forecast",
    ];

    const initial: PipelineStatuses = {};
    steps.forEach((s, i) => { initial[s] = i === 0 ? "In Progress" : "Pending"; });
    setPipelineStatuses(initial);

    let idx = 0;
    const interval = setInterval(() => {
      if (idx >= steps.length) {
        clearInterval(interval);
        setRunStatus("Success");
        setLastRunTime(
          new Date().toLocaleString("en-US", {
            month: "short", day: "2-digit", year: "numeric",
            hour: "2-digit", minute: "2-digit", hour12: true,
          })
        );
        showAlert({ title: "Run Success", message: "The data insights pipeline executed successfully!", type: "success" });
        return;
      }
      const current = steps[idx];
      setPipelineStatuses((prev) => {
        const next = { ...prev };
        next[current] = "Completed";
        if (idx + 1 < steps.length) next[steps[idx + 1]] = "In Progress";
        return next;
      });
      idx++;
    }, 1500);
  };

  // ── Navigation helpers ────────────────────────────────────────────────────

  const openProject = (id: string) => {
    setSelectedProjectId(id);
    resetPipeline();
    setView("detail");
  };

  const goToList = () => {
    setView("list");
    setSelectedProjectId(null);
    resetPipeline();
  };

  const confirmDeleteProject = (project: Project) => {
    showConfirm({
      title: "Delete Project",
      message: `Are you sure you want to delete the project "${project.name}"? This action cannot be undone.`,
      confirmText: "Delete",
      cancelText: "Cancel",
      onConfirm: () => {
        deleteProject(project.id);
        if (selectedProjectId === project.id) goToList();
      },
    });
  };

  // ── Render ────────────────────────────────────────────────────────────────

  if (view === "create") {
    return (
      <ProjectCreatePage
        dataSources={dataSources}
        onCancel={goToList}
        onSubmit={(name, useCase, sources) => {
          addProject(name, "OWNER", sources, useCase);
          goToList();
        }}
        onAddDataSource={(name, type, subtext, config) =>
          addDataSource(name, type, subtext, config)
        }
      />
    );
  }

  if (view === "detail" && selectedProject) {
    return (
      <ProjectDetailPage
        project={selectedProject}
        allDataSources={dataSources}
        userProfile={userProfile}
        pipelineStatuses={pipelineStatuses}
        completionPercentage={completionPct}
        runStatus={runStatus}
        lastRunTime={lastRunTime}
        onRunWorkflow={runSimulation}
        onGoBack={goToList}
        onDelete={() => confirmDeleteProject(selectedProject)}
        onEdit={() =>
          showAlert({ title: "Edit Project", message: "Edit Project is being worked separately in the backend.", type: "info" })
        }
        onViewHistory={() =>
          showAlert({ title: "Run History", message: "Project execution logs are being worked separately in the backend.", type: "info" })
        }
        onManageSources={() =>
          showAlert({ title: "Manage Data Sources", message: "Data source management is being worked separately in the backend.", type: "info" })
        }
        onAddTag={() =>
          showAlert({ title: "Add Tag", message: "Tag management is being worked separately in the backend.", type: "info" })
        }
        showAlert={showAlert}
      />
    );
  }

  // Default: list view
  return (
    <ProjectsListPage
      projects={projects}
      dataSources={dataSources}
      activeWorkspaceId={activeWorkspaceId}
      onOpenProject={openProject}
      onDeleteProject={confirmDeleteProject}
      onCreateProject={() => setView("create")}
      renderIcon={renderDataSourceIcon}
    />
  );
}
