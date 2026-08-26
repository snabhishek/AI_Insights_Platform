"use client";

import React, { useState, useEffect, useRef } from "react";
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
import { executeWorkflowApi, stopWorkflowApi, WorkflowRequestPayload } from "../../services/aiWorkflowService";

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
    updateProject,
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
  const abortControllerRef = useRef<AbortController | null>(null);

  const resetPipeline = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
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

  const mapStageToPipelineStatus = (
    stageStatuses?: Record<string, string>,
    currentStatuses?: PipelineStatuses
  ): PipelineStatuses => {
    const next = { ...(currentStatuses || INITIAL_PIPELINE_STATUSES) } as PipelineStatuses;
    if (!stageStatuses) return next;

    const isCompleted = (v?: string) => v === "Completed" || v === "completed" || v === "Success" || v === "success" || v === "ok" || v === "done";
    const isRunning = (v?: string) => v === "In Progress" || v === "in_progress" || v === "in-progress" || v === "Running" || v === "running" || v === "Retrying" || v === "retrying";

    // Single-node stages
    const mapSingle = (node: string, label: string) => {
      const v = stageStatuses[node];
      if (!v) return;
      if (isCompleted(v)) next[label] = "Completed";
      else if (isRunning(v)) next[label] = "In Progress";
      else if (v === "Failed" || v === "failed") next[label] = "Pending";
      else if ((v === "Pending" || v === "pending") && next[label] !== "Completed") next[label] = "Pending";
    };

    mapSingle("inspect", "Data Inspection");
    mapSingle("inspect", "Data Inspection");
    mapSingle("resolveSchema", "Schema Resolver");
    mapSingle("hierarchyMapper", "Hierarchy Mapper");
    mapSingle("hierarchyMapperNode", "Hierarchy Mapper");
    mapSingle("relationshipBuilder", "Hierarchy Mapper");
    mapSingle("formBuilder", "Hierarchy Mapper");
    mapSingle("featureArchitect", "Feature Architect");
    mapSingle("featureArchitectNode", "Feature Architect");
    mapSingle("featureValidator", "Feature Validator");
    mapSingle("featureValidatorNode", "Feature Validator");
    mapSingle("exogenousScout", "Exogenous Scout");
    mapSingle("exogenous", "Exogenous Scout");

    // Merged stage: Data Profiling = profileData + preprocess
    const profileVal = stageStatuses.profileData;
    const preprocessVal = stageStatuses.preprocess;
    if (profileVal || preprocessVal) {
      if (isCompleted(profileVal) || isCompleted(preprocessVal)) {
        next["Data Profiling"] = "Completed";
      } else if (isRunning(profileVal) || isRunning(preprocessVal)) {
        next["Data Profiling"] = "In Progress";
      }
    }

    // Feature Engineering composite status
    const hmVal = stageStatuses.hierarchyMapper || stageStatuses.hierarchyMapperNode || stageStatuses.relationshipBuilder;
    const faVal = stageStatuses.featureArchitect || stageStatuses.featureArchitectNode;
    const fvVal = stageStatuses.featureValidator || stageStatuses.featureValidatorNode;
    const exoVal = stageStatuses.exogenousScout || stageStatuses.exogenous;

    const feSteps = [hmVal, faVal, fvVal, exoVal].filter(Boolean);
    if (feSteps.length > 0 && feSteps.every((v) => isCompleted(v))) {
      next["Feature Engineering"] = "Completed";
    } else if (feSteps.some((v) => isRunning(v) || isCompleted(v))) {
      next["Feature Engineering"] = "In Progress";
    }

    return next;
  };

  const determineActiveStage = (payload: Partial<WorkflowResponse["data"]>): string => {
    if (payload.status === "completed" || payload.requiresApproval) {
      if (payload.stageOutputs?.exogenousScout || payload.stageStatuses?.exogenousScout || payload.stageStatuses?.exogenous) {
        return "exogenousScout";
      }
      return "resolveSchema";
    }
    if (payload.requiresApproval) {
      if (payload.nextStep === "profileData") {
        return "inspect";
      }
      if (payload.nextStep === "resolveSchema") {
        return "profileData";
      }
      if (payload.nextStep === "exogenous" || payload.nextStep === "exogenousScout") {
        return "resolveSchema";
      }
    }
    if (payload.currentStage || payload.currentNode) {
      const node = payload.currentStage || payload.currentNode;
      if (node === "preprocess") return "profileData";
      if (node === "exogenous") return "exogenousScout";
      return node!;
    }
    return "inspect";
  };

  // Hydrate pipeline state whenever selectedProject changes
  useEffect(() => {
    if (!selectedProject) return;

    const state = selectedProject.agentState as Record<string, any> | undefined;
    const hasValidState = state && typeof state === "object" && (state.stageStatuses || state.status || state.stageOutputs);

    if (hasValidState) {
      const nextStatuses = mapStageToPipelineStatus(state.stageStatuses, pipelineStatuses);
      setPipelineStatuses(nextStatuses);

      if (state.status === "completed") {
        setRunStatus("Success");
      } else if (state.status === "failed") {
        setRunStatus("Idle");
      } else if (state.requiresApproval) {
        setRunStatus("Paused");
      } else if (state.status === "running") {
        setRunStatus("Running");
      } else {
        setRunStatus("Idle");
      }

      setWorkflowMessage(state.message || state.summary || "Workflow loaded from DB");
      if (state.stageOutputs) {
        setStageOutputs(state.stageOutputs);
      }
      setActiveStage(determineActiveStage(state));
      setRequiresApproval(Boolean(state.requiresApproval));
      if (state.sessionId) {
        setWorkflowSessionId(state.sessionId);
      }

      if (state.status === "completed" || state.lastRunTime) {
        const dateObj = new Date(state.lastRunTime || state.updatedAt || Date.now());
        setLastRunTime(dateObj.toLocaleString("en-US", {
          month: "short",
          day: "2-digit",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          hour12: true,
        }));
      } else {
        setLastRunTime("Not run yet");
      }
    } else {
      // Fresh project with no workflow runs yet
      setPipelineStatuses(INITIAL_PIPELINE_STATUSES);
      setStageOutputs({});
      setRunStatus("Idle");
      setRequiresApproval(false);
      setWorkflowSessionId(null);
      setWorkflowMessage("");
      setLastRunTime("Not run yet");
      setActiveStage("inspect");
    }
  }, [selectedProjectId, selectedProject?.agentState]);

  const updateWorkflowState = (payload: WorkflowResponse["data"]) => {
    setPipelineStatuses((prev) => {
      const nextStatuses = mapStageToPipelineStatus(payload.stageStatuses, prev);
      return nextStatuses;
    });

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

    if (selectedProject?.id) {
      updateProject(selectedProject.id, { agentState: payload });
    }
  };

  const runWorkflow = async (action?: "approve" | "retry", step?: string, overrideUserPrompt?: string) => {
    if ((runStatus === "Running" || runStatus === "Paused") && !action) return;

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setRunStatus("Running");
    if (action === "approve") {
      setRequiresApproval(false);
    }
    if (!action) {
      setRequiresApproval(false);
      setStageOutputs({});
      setActiveStage("inspect");
      setPipelineStatuses({
        "Data Inspection": "In Progress",
        "Data Profiling": "Pending",
        "Schema Resolver": "Pending",
        "Feature Engineering": "Not Started",
        "Model Training": "Not Started",
        "Model Validation": "Not Started",
        "Forecast": "Not Started",
      });
    }
    let lastData: any = null;
    try {
      const payload: WorkflowRequestPayload = {
        connectorId: workflowConnectorIds,
        userPrompt: overrideUserPrompt !== undefined ? overrideUserPrompt : (selectedProject?.useCase || ""),
        projectId: selectedProject?.id,
      };
      if (workflowSessionId) {
        payload.sessionId = workflowSessionId;
      }
      if (action) {
        payload.action = action;
      }
      if (step) {
        const stepMap: Record<string, string> = {
          "Data Inspection": "inspect",
          "Data Profiling": "profileData",
          "Schema Resolver": "resolveSchema",
          "Hierarchy Mapper": "hierarchyMapperNode",
          "Feature Architect": "featureArchitectNode",
          "Feature Validator": "featureArchitectNode",
          "Exogenous Scout": "exogenous",
          "Feature Engineering": "hierarchyMapperNode",
        };
        payload.step = stepMap[step] || step;
      }
      const response = await executeWorkflowApi(payload, controller.signal);
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("Response body reader not available");
      }

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const dataStr = line.slice(6);
            if (dataStr === "[DONE]") {
              break;
            }
            try {
              const chunk = JSON.parse(dataStr);
              if (chunk.success && chunk.data) {
                lastData = chunk.data;
                updateWorkflowState(chunk.data);
              } else if (chunk.success === false) {
                throw new Error(chunk.message || "AI workflow failed");
              }
            } catch (err: any) {
              console.warn("Failed to parse stream chunk", err);
            }
          }
        }
      }

      if (lastData && lastData.status === "completed") {
        showAlert({ title: "Run Success", message: lastData.summary || "The workflow completed successfully.", type: "success" });
      }
    } catch (error: any) {
      if (error.name === "AbortError") {
        console.info("Workflow execution request aborted by user.");
        return;
      }
      console.error("Workflow execution stream error", error);
      if (lastData && (lastData.status === "completed" || lastData.stageStatuses?.resolveSchema === "Completed")) {
        updateWorkflowState(lastData);
        showAlert({ title: "Run Success", message: lastData.summary || "Data Ingestion completed successfully.", type: "success" });
        return;
      }
      setRunStatus("Idle");
      showAlert({ title: "Workflow Error", message: error.message || "The workflow stream was interrupted.", type: "error" });
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
    }
  };

  const handleStopWorkflow = () => {
    const currentSession = workflowSessionId;
    const currentProjectId = selectedProject?.id;

    resetPipeline();

    if (currentProjectId) {
      void updateProject(currentProjectId, {
        agentState: {
          status: "failed",
          summary: "Workflow stopped by user",
          message: "Workflow stopped by user",
          sessionId: currentSession || undefined,
          requiresApproval: false,
        },
      });
    }

    if (currentSession || currentProjectId) {
      void stopWorkflowApi(currentSession || undefined, currentProjectId);
    }

    showAlert({
      title: "Workflow Stopped",
      message: "The agentic workflow execution has been stopped and pipeline stages have been reset.",
      type: "info",
    });
  };

  const runSimulation = () => {
    void runWorkflow();
  };

  const handleApprove = () => {
    setRequiresApproval(false);
    setRunStatus("Running");
    setActiveStage("Feature Engineering");
    setWorkflowMessage("Advancing workflow to Feature Engineering stage...");
    setPipelineStatuses((prev) => ({
      ...prev,
      "Data Inspection": "Completed",
      "Data Profiling": "Completed",
      "Schema Resolver": "Completed",
      "Feature Engineering": "In Progress",
    }));

    void runWorkflow("approve", "Feature Engineering");
  };

  const handleRetry = (step?: string) => {
    const stepMap: Record<string, string> = {
      inspect: "inspect",
      profileData: "profileData",
      preprocess: "preprocess",
      resolveSchema: "resolveSchema",
      exogenous: "exogenous",
      exogenousScout: "exogenous",
      "Data Inspection": "inspect",
      "Data Profiling": "profileData",
      "Schema Resolver": "resolveSchema",
      "Exogenous Scout": "exogenous",
      "Feature Engineering": "exogenous",
    };
    const normalizedStep = typeof step === "string" ? stepMap[step] || step : undefined;
    void runWorkflow("retry", normalizedStep);
  };

  const handleStageSelect = (stepId: string) => {
    const stageMap: Record<string, string> = {
      "Data Inspection": "inspect",
      "Data Profiling": "profileData",
      "Schema Resolver": "resolveSchema",
      "Exogenous Scout": "exogenousScout",
      "Feature Engineering": "exogenousScout",
    };
    setActiveStage(stageMap[stepId] || stepId);
  };

  const handleReRunWorkflow = async (newUseCase?: string) => {
    if (!selectedProject) return;
    if (newUseCase !== undefined && newUseCase !== selectedProject.useCase) {
      await updateProject(selectedProject.id, { useCase: newUseCase });
    }
    // Clear workflow session ID to start a fresh execution run
    setWorkflowSessionId(null);
    setRunStatus("Idle");
    setRequiresApproval(false);
    setStageOutputs({});
    setActiveStage("inspect");
    setPipelineStatuses({
      "Data Inspection": "In Progress",
      "Data Profiling": "Pending",
      "Schema Resolver": "Pending",
      "Feature Engineering": "Not Started",
      "Model Training": "Not Started",
      "Model Validation": "Not Started",
      "Forecast": "Not Started",
    });
    void runWorkflow(undefined, undefined, newUseCase ?? selectedProject.useCase);
  };

  // ── Navigation helpers ────────────────────────────────────────────────────

  const openProject = (id: string) => {
    setSelectedProjectId(id);
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
        onSubmit={async (name, useCase, sources, domain, subDomain) => {
          const success = await addProject(name, "OWNER", sources, useCase, domain, subDomain);
          if (success) {
            goToList();
          }
          return success;
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
        onReRunWorkflow={handleReRunWorkflow}
        onSaveUseCase={(newUseCase) => updateProject(selectedProject.id, { useCase: newUseCase })}
        onStopWorkflow={handleStopWorkflow}
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
