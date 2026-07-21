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

interface WorkflowResponse {
  success: boolean;
  data: {
    sessionId?: string;
    status: string;
    summary: string;
    message?: string;
    requiresApproval?: boolean;
    nextStep?: string;
    currentNode?: string;
    currentStage?: string;
    stageOutputs?: Record<string, unknown>;
    stageStatuses?: Record<string, string>;
    inspection?: Record<string, unknown>;
    schemaResolution?: Record<string, unknown>;
    dataProfile?: Record<string, unknown>;
    preprocessing?: Record<string, unknown>;
  };
}

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
  const [runStatus, setRunStatus] = useState<RunStatus>("Idle");
  const [lastRunTime, setLastRunTime] = useState("Not run yet");
  const [workflowSessionId, setWorkflowSessionId] = useState<string | null>(null);
  const [activeStage, setActiveStage] = useState<string | null>(null);
  const [stageOutputs, setStageOutputs] = useState<Record<string, unknown>>({});
  const [workflowMessage, setWorkflowMessage] = useState<string>("Idle");
  const [requiresApproval, setRequiresApproval] = useState(false);

  const resetPipeline = () => {
    setPipelineStatuses(INITIAL_PIPELINE_STATUSES);
    setRunStatus("Idle");
    setWorkflowSessionId(null);
    setActiveStage(null);
    setStageOutputs({});
    setWorkflowMessage("Idle");
    setRequiresApproval(false);
  };

  const completedCount = Object.values(pipelineStatuses).filter((s) => s === "Completed").length;
  const inProgressCount = Object.values(pipelineStatuses).filter((s) => s === "In Progress").length;
  const totalSteps = Object.keys(pipelineStatuses).length || 1;
  const completionPct = ((completedCount + (inProgressCount > 0 ? 0.5 : 0)) / totalSteps) * 100;
  const workflowConnectorIds = Array.isArray(selectedProject?.dataSources)
    ? selectedProject.dataSources.filter((sourceId): sourceId is string => typeof sourceId === "string" && sourceId.trim().length > 0)
    : [];

  const mapStageToPipelineStatus = (stageStatuses?: Record<string, string>): PipelineStatuses => {
    const next = { ...INITIAL_PIPELINE_STATUSES } as PipelineStatuses;
    if (!stageStatuses) return next;

    // Single-node stages
    const mapSingle = (node: string, label: string) => {
      const v = stageStatuses[node] || "Pending";
      if (v === "Completed") next[label] = "Completed";
      else if (v === "Retrying" || v === "In Progress") next[label] = "In Progress";
      else if (v === "Failed") next[label] = "Pending";
    };
    mapSingle("inspect", "Data Ingestion");
    mapSingle("resolveSchema", "Schema Resolver");

    // Merged stage: Data Profiling = profileData + preprocess
    const profileVal = stageStatuses.profileData || "Pending";
    const preprocessVal = stageStatuses.preprocess || "Pending";
    const isAnyRunning = [profileVal, preprocessVal].some((v) => v === "In Progress" || v === "Retrying");
    const allCompleted = profileVal === "Completed" && preprocessVal === "Completed";
    const anyCompleted = profileVal === "Completed" || preprocessVal === "Completed";

    if (allCompleted) {
      next["Data Profiling"] = "Completed";
    } else if (isAnyRunning || anyCompleted) {
      next["Data Profiling"] = "In Progress";
    }
    // else stays "Not Started" from INITIAL_PIPELINE_STATUSES

    return next;
  };

  const determineActiveStage = (payload: WorkflowResponse["data"]): string => {
    if (payload.status === "completed") {
      return "resolveSchema";
    }
    if (payload.requiresApproval) {
      if (payload.nextStep === "profileData") {
        return "inspect";
      }
      if (payload.nextStep === "resolveSchema") {
        return "profileData";
      }
    }
    if (payload.currentStage || payload.currentNode) {
      const node = payload.currentStage || payload.currentNode;
      if (node === "preprocess") return "profileData";
      return node!;
    }
    return "inspect";
  };

  const updateWorkflowState = (payload: WorkflowResponse["data"]) => {
    const nextStatuses = mapStageToPipelineStatus(payload.stageStatuses);
    setPipelineStatuses(nextStatuses);

    if (payload.status === "completed") {
      setRunStatus("Success");
    } else if (payload.status === "failed") {
      setRunStatus("Idle");
    } else if (payload.requiresApproval) {
      setRunStatus("Paused");
    } else {
      setRunStatus("Running");
    }

    setWorkflowMessage(payload.message || payload.summary || "Workflow updated");
    if (payload.stageOutputs) {
      setStageOutputs(payload.stageOutputs);
    }
    if (payload.sessionId) {
      setWorkflowSessionId(payload.sessionId);
    }
    
    setActiveStage(determineActiveStage(payload));
    setRequiresApproval(Boolean(payload.requiresApproval));
    
    if (payload.status === "completed") {
      setLastRunTime(new Date().toLocaleString("en-US", {
        month: "short",
        day: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      }));
    }
  };

  const runWorkflow = async (action?: "approve" | "retry", step?: string) => {
    if ((runStatus === "Running" || runStatus === "Paused") && !action) return;
    setRunStatus("Running");
    if (action === "approve") {
      setRequiresApproval(false);
    }
    setWorkflowMessage(action === "approve" ? "Resuming workflow..." : "Starting workflow...");

    try {
      const body: Record<string, unknown> = {
        connectorId: workflowConnectorIds,
        userPrompt: selectedProject?.useCase || "",
        projectId: selectedProject?.id,
      };
      if (workflowSessionId) {
        body.sessionId = workflowSessionId;
      }
      if (action) {
        body.action = action;
      }
      if (step) {
        const stepMap: Record<string, string> = {
          "Data Ingestion": "inspect",
          "Data Profiling": "profileData",
          "Schema Resolver": "resolveSchema",
        };
        body.step = stepMap[step] || step;
      }
      const res = await fetch("http://127.0.0.1:4000/api/ai/ingestion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as WorkflowResponse;
      if (!json.success) {
        throw new Error("Workflow request failed");
      }
      updateWorkflowState(json.data);
      if (json.data.status === "completed") {
        showAlert({ title: "Run Success", message: json.data.summary || "The workflow completed successfully.", type: "success" });
      }
    } catch (error) {
      console.error("Workflow execution failed", error);
      setRunStatus("Idle");
      showAlert({ title: "Workflow Error", message: "The workflow could not be started or resumed.", type: "error" });
    }
  };

  const runSimulation = () => {
    void runWorkflow();
  };

  const handleApprove = () => {
    setRequiresApproval(false);
    setRunStatus("Running");
    if (activeStage === "inspect" || activeStage === null) {
      setActiveStage("profileData");
      setWorkflowMessage("Running Data Profiling & Preprocessing...");
    } else if (activeStage === "profileData" || activeStage === "preprocess") {
      setActiveStage("resolveSchema");
      setWorkflowMessage("Running Schema Resolution...");
    }
    void runWorkflow("approve");
  };

  const handleRetry = (step?: string) => {
    const stepMap: Record<string, string> = {
      inspect: "inspect",
      profileData: "profileData",
      preprocess: "preprocess",
      resolveSchema: "resolveSchema",
      "Data Ingestion": "inspect",
      "Data Profiling": "profileData",
      "Schema Resolver": "resolveSchema",
    };
    const normalizedStep = typeof step === "string" ? stepMap[step] || step : undefined;
    void runWorkflow("retry", normalizedStep);
  };

  const handleStageSelect = (stepId: string) => {
    const stageMap: Record<string, string> = {
      "Data Ingestion": "inspect",
      "Data Profiling": "profileData",
      "Schema Resolver": "resolveSchema",
    };
    setActiveStage(stageMap[stepId] || stepId);
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
        activeStage={activeStage}
        stageOutputs={stageOutputs}
        requiresApproval={requiresApproval}
        workflowMessage={workflowMessage}
        onSelectStage={handleStageSelect}
        onApprove={handleApprove}
        onRetry={(stepId) => handleRetry(stepId)}
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
