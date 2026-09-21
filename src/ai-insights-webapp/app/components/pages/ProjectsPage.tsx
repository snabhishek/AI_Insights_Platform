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
import { useApp, Project, BACKEND_URL } from "../providers/AppContext";
import { PipelineStatuses, RunStatus } from "../projects/types";
import { INITIAL_PIPELINE_STATUSES } from "../projects/constants";
import { resolveNextWorkflowPhase, STEP_TO_NODE_MAP } from "../projects/pipelineFlowConfig";
import ProjectsListPage from "../projects/ProjectsListPage";
import ProjectDetailPage from "../projects/ProjectDetailPage";
import ProjectCreatePage from "../projects/ProjectCreatePage";
import { executeWorkflowApi, pauseWorkflowApi, stopWorkflowApi, fetchActiveWorkflowApi, WorkflowRequestPayload } from "../../services/aiWorkflowService";

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
    agentThinking?: Record<string, Array<{ time: string; text: string; done: boolean }>>;
    inspection?: Record<string, unknown>;
    schemaResolution?: Record<string, unknown>;
    dataProfile?: Record<string, unknown>;
    preprocessing?: Record<string, unknown>;
    runTimestamp?: string;
  };
}

// ─── Data-source icon renderer (shared utility) ───────────────────────────────

function renderDataSourceIcon(type: string): React.ReactNode {
  switch (type) {
    case "postgres": return <PostgresqlIcon size={16} />;
    case "mysql": return <MysqlIcon size={16} />;
    case "sqlserver": return <SqlServerIcon size={16} />;
    case "snowflake": return <SnowflakeIcon size={16} />;
    case "mongodb": return <MongodbIcon size={16} />;
    case "excel": return <Image src="/images/microsoft-excel.jpg" alt="Excel" width={16} height={16} className="object-contain shrink-0" />;
    case "csv": return <Image src="/images/csv.png" alt="CSV" width={16} height={16} className="object-contain shrink-0" />;
    case "tsv": return <Image src="/images/tsv.png" alt="TSV" width={16} height={16} className="object-contain shrink-0" />;
    case "restapi": return <RestApiIcon size={16} />;
    default: return null;
  }
}

// ─── View states ──────────────────────────────────────────────────────────────

type View = "list" | "detail" | "create";

// ─── Root Page Component ──────────────────────────────────────────────────────

export default function ProjectsPage() {
  const {
    projects,
    setProjects,
    refreshProjects,
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

  // Ref to track the currently running project ID across navigation
  const activeRunningProjectIdRef = useRef<string | null>(null);

  // ── View routing ──────────────────────────────────────────────────────────
  const [view, setView] = useState<View>("list");
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
  const [stageOutputs, setStageOutputs] = useState<Record<string, any>>({});
  const [agentThinking, setAgentThinking] = useState<Record<string, Array<{ time: string; text: string; done: boolean }>>>({});
  const [workflowMessage, setWorkflowMessage] = useState<string>("Idle");
  const [requiresApproval, setRequiresApproval] = useState(false);
  const [approvalNextStep, setApprovalNextStep] = useState<string | null>(null);
  const [isApproving, setIsApproving] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const isExecutingRef = useRef<boolean>(false);

  // ── Pause/Resume state ────────────────────────────────────────────────────
  const [isPaused, setIsPaused] = useState(false);
  const [isAwaitingResponse, setIsAwaitingResponse] = useState(false);
  const [pausedAtPhase, setPausedAtPhase] = useState<string | null>(null);
  const [pausedStateSnapshot, setPausedStateSnapshot] = useState<any>(null);
  const [pausedSessionId, setPausedSessionId] = useState<string | null>(null);
  const lastDataRef = useRef<any>(null);

  const resetPipeline = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    isExecutingRef.current = false;
    setPipelineStatuses(INITIAL_PIPELINE_STATUSES);
    setRunStatus("Idle");
    setWorkflowSessionId(null);
    setActiveStage(null);
    setStageOutputs({});
    setAgentThinking({});
    setWorkflowMessage("Idle");
    setRequiresApproval(false);
    setApprovalNextStep(null);
    setIsAwaitingResponse(false);
    // Clear pause state
    setIsPaused(false);
    setPausedAtPhase(null);
    setPausedStateSnapshot(null);
    setPausedSessionId(null);
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
    mapSingle("modelSelection", "Model Selection");
    mapSingle("modelSelectionNode", "Model Selection");
    mapSingle("trainingConfiguration", "Training Configuration");
    mapSingle("trainingConfigurationNode", "Training Configuration");
    mapSingle("preFlight", "Pre Flight");
    mapSingle("preFlightNode", "Pre Flight");
    mapSingle("modelTraining", "Model Training");
    mapSingle("modelTrainingNode", "Model Training");
    mapSingle("modelValidation", "Model Validation");
    mapSingle("modelValidationNode", "Model Validation");

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

    // If Model Selection / Training / Validation is active or completed, earlier phases are guaranteed Completed
    const isModelPhaseActiveOrDone =
      isCompleted(stageStatuses.modelSelection) ||
      isRunning(stageStatuses.modelSelection) ||
      isCompleted(stageStatuses.modelSelectionNode) ||
      isRunning(stageStatuses.modelSelectionNode) ||
      isCompleted(stageStatuses.trainingConfiguration) ||
      isRunning(stageStatuses.trainingConfiguration) ||
      isCompleted(stageStatuses.trainingConfigurationNode) ||
      isRunning(stageStatuses.trainingConfigurationNode) ||
      isCompleted(stageStatuses.preFlight) ||
      isRunning(stageStatuses.preFlight) ||
      isCompleted(stageStatuses.preFlightNode) ||
      isRunning(stageStatuses.preFlightNode) ||
      isCompleted(stageStatuses.modelTraining) ||
      isRunning(stageStatuses.modelTraining) ||
      isCompleted(stageStatuses.modelTrainingNode) ||
      isRunning(stageStatuses.modelTrainingNode) ||
      isCompleted(stageStatuses.modelValidation) ||
      isRunning(stageStatuses.modelValidation) ||
      isCompleted(stageStatuses.modelValidationNode) ||
      isRunning(stageStatuses.modelValidationNode);

    if (isModelPhaseActiveOrDone) {
      next["Data Inspection"] = "Completed";
      next["Data Profiling"] = "Completed";
      next["Schema Resolver"] = "Completed";
      next["Hierarchy Mapper"] = "Completed";
      next["Feature Architect"] = "Completed";
      next["Feature Validator"] = "Completed";
      next["Exogenous Scout"] = "Completed";
      next["Feature Engineering"] = "Completed";
    }

    return next;
  };

  const determineActiveStage = (payload: Partial<WorkflowResponse["data"]>): string => {
    if (payload.status === "completed") {
      if (payload.stageOutputs?.modelSelection || payload.stageStatuses?.modelSelection === "Completed") {
        return "Model Selection";
      }
      if (
        payload.stageOutputs?.exogenousScout ||
        payload.stageStatuses?.exogenousScout === "Completed" ||
        payload.stageStatuses?.exogenous === "Completed"
      ) {
        return "Exogenous Scout";
      }
      return "resolveSchema";
    }
    if (payload.requiresApproval) {
      if (
        payload.stageOutputs?.modelSelection ||
        payload.stageStatuses?.modelSelection === "Completed" ||
        payload.nextStep?.toLowerCase().includes("model") ||
        payload.nextStep?.toLowerCase().includes("training")
      ) {
        return "Model Selection";
      }
      if (
        payload.stageOutputs?.exogenousScout ||
        payload.stageStatuses?.exogenousScout === "Completed" ||
        payload.stageStatuses?.exogenous === "Completed"
      ) {
        return "Exogenous Scout";
      }
      if (payload.nextStep === "profileData") {
        return "inspect";
      }
      if (payload.nextStep === "resolveSchema") {
        return "profileData";
      }
      return "resolveSchema";
    }
    if (payload.currentStage || payload.currentNode) {
      const node = payload.currentStage || payload.currentNode;
      if (node === "preprocess") return "profileData";
      if (node === "hierarchyMapper" || node === "hierarchyMapperNode") return "Hierarchy Mapper";
      if (node === "featureArchitect" || node === "featureArchitectNode") return "Feature Architect";
      if (node === "featureValidator" || node === "featureValidatorNode") return "Feature Validator";
      if (node === "exogenous" || node === "exogenousScout") return "Exogenous Scout";
      if (node === "modelSelection" || node === "modelSelectionNode") return "Model Selection";
      if (node === "trainingConfiguration" || node === "trainingConfigurationNode") return "Training Configuration";
      if (node === "preFlight" || node === "preFlightNode") return "Pre Flight";
      if (node === "modelTraining" || node === "modelTrainingNode") return "Model Training";
      if (node === "modelValidation" || node === "modelValidationNode") return "Model Validation";
      return node!;
    }
    return "inspect";
  };

  // Hydrate pipeline state whenever selectedProject changes
  useEffect(() => {
    if (!selectedProjectId) return;

    const isRunningLocally = Boolean(
      isExecutingRef.current && activeRunningProjectIdRef.current === selectedProjectId
    );

    const projectToHydrate = projects.find((p) => p.id === selectedProjectId);
    if (!projectToHydrate) return;

    const state = projectToHydrate.agentState as Record<string, any> | undefined;
    const hasValidState = state && typeof state === "object" && (state.stageStatuses || state.status || state.stageOutputs);

    if (hasValidState) {
      const nextStatuses = mapStageToPipelineStatus(state.stageStatuses, pipelineStatuses);
      setPipelineStatuses(nextStatuses);

      const rawStatus = (state.status || (projectToHydrate as any).status || "").toLowerCase();

      const isStillRunningLocally =
        rawStatus === "running" ||
        (isRunningLocally &&
          rawStatus !== "paused" &&
          rawStatus !== "completed" &&
          rawStatus !== "success" &&
          rawStatus !== "stopped" &&
          rawStatus !== "failed");

      if (isStillRunningLocally) {
        setRunStatus("Running");
        setIsPaused(false);
        setRequiresApproval(false);
        setApprovalNextStep(null);
      } else if (rawStatus === "completed" || rawStatus === "success") {
        setRunStatus("Success");
        setIsPaused(false);
        setRequiresApproval(false);
        setApprovalNextStep(null);
      } else if (rawStatus === "stopped") {
        setRunStatus("Stopped");
        setIsPaused(false);
        setRequiresApproval(false);
        setApprovalNextStep(null);
      } else if (rawStatus === "failed") {
        setRunStatus("Failed");
        setIsPaused(false);
        setRequiresApproval(false);
        setApprovalNextStep(null);
      } else if (rawStatus === "paused" && state.requiresApproval) {
        setRunStatus("Paused");
        setIsPaused(false);
        setRequiresApproval(true);
        setApprovalNextStep(state.nextStep || "Feature Engineering");
      } else if (rawStatus === "paused") {
        setRunStatus("Paused");
        setIsPaused(true);
        setRequiresApproval(false);
        setApprovalNextStep(null);
        setPausedAtPhase(determineActiveStage(state));
        if (state.sessionId) setPausedSessionId(state.sessionId);
      } else {
        setRunStatus("Idle");
        setIsPaused(false);
        setRequiresApproval(false);
        setApprovalNextStep(null);
      }

      setWorkflowMessage(state.message || state.summary || "Workflow loaded from DB");
      if (state.stageOutputs) {
        setStageOutputs(state.stageOutputs);
      }
      if (state.agentThinking) {
        setAgentThinking(state.agentThinking);
      } else {
        setAgentThinking({});
      }
      setActiveStage(determineActiveStage(state));

      // Check if waiting for internal HITL model confirmation
      const isWaitingForModelConfirmation =
        (nextStatuses["Model Selection"] === "Completed" || state.stageOutputs?.modelSelection !== undefined) &&
        !(state.stageOutputs as Record<string, any> | undefined)?.trainingConfiguration?.contractPath &&
        nextStatuses["Training Configuration"] !== "Completed" &&
        (state.nextStep === "Training Configuration" || state.nextStep === "trainingConfigurationNode");

      if (isWaitingForModelConfirmation) {
        setIsAwaitingResponse(true);
        setRunStatus("Running");
        setIsPaused(false);
        setRequiresApproval(false);
        setApprovalNextStep(null);
      } else {

        setIsAwaitingResponse(false);
        const isAtOrPastModelPhase =
          nextStatuses["Training Configuration"] === "Completed" ||
          nextStatuses["Pre Flight"] === "Completed" ||
          nextStatuses["Model Training"] === "Completed" ||
          nextStatuses["Model Validation"] === "Completed";

        if (isAtOrPastModelPhase) {
          setRequiresApproval(false);
          setApprovalNextStep(null);
        } else if (state.status !== "running" && !isStillRunningLocally) {
          setRequiresApproval(Boolean(state.requiresApproval));
          setApprovalNextStep(state.requiresApproval ? (state.nextStep || "Feature Engineering") : null);
        }
      }
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
      if (isRunningLocally) {
        setRunStatus("Running");
      } else {
        setPipelineStatuses(INITIAL_PIPELINE_STATUSES);
        setStageOutputs({});
        setAgentThinking({});
        setRunStatus("Idle");
        setIsPaused(false);
        setRequiresApproval(false);
        setApprovalNextStep(null);
        setWorkflowSessionId(null);
        setWorkflowMessage("");
        setLastRunTime("Not run yet");
        setActiveStage("inspect");
      }
    }

    // Check live state from backend to handle cross-tab or reloaded sessions
    let isCancelled = false;
    const checkLiveState = async () => {
      try {
        const wsId = activeWorkspaceId || "default";
        const [activeRun, res] = await Promise.all([
          fetchActiveWorkflowApi().catch(() => null),
          fetch(`${BACKEND_URL}/workspaces/${wsId}/projects/${selectedProjectId}`).catch(() => null),
        ]);

        if (isCancelled) return;

        const isBackendRunning = Boolean(
          activeRun?.data?.active && activeRun.data.projectId === selectedProjectId
        );

        if (isBackendRunning) {
          activeRunningProjectIdRef.current = selectedProjectId;
          setRunStatus("Running");
          setIsPaused(false);
          setRequiresApproval(false);
          setApprovalNextStep(null);
        }

        if (res && res.ok) {
          const freshProject = await res.json();
          if (isCancelled || !freshProject) return;

          setProjects((prev) =>
            prev.map((p) => (p.id === selectedProjectId ? { ...p, ...freshProject } : p))
          );

          if (freshProject.agentState) {
            const freshState = freshProject.agentState;
            const freshStatus = (freshState.status || freshProject.status || "").toLowerCase();

            if (isBackendRunning || freshStatus === "running" || (isExecutingRef.current && activeRunningProjectIdRef.current === selectedProjectId)) {
              setRunStatus("Running");
              setIsPaused(false);
              setRequiresApproval(false);
              setApprovalNextStep(null);
            } else if (freshStatus === "completed" || freshStatus === "success") {
              setRunStatus("Success");
              setIsPaused(false);
              setRequiresApproval(false);
              setApprovalNextStep(null);
            } else if (freshStatus === "failed") {
              setRunStatus("Failed");
              setIsPaused(false);
              setRequiresApproval(false);
              setApprovalNextStep(null);
            } else if (freshStatus === "stopped") {
              setRunStatus("Stopped");
              setIsPaused(false);
              setRequiresApproval(false);
              setApprovalNextStep(null);
            }

            if (freshState.stageStatuses) {
              setPipelineStatuses((prev) => mapStageToPipelineStatus(freshState.stageStatuses, prev));
            }
            if (freshState.stageOutputs) setStageOutputs(freshState.stageOutputs);
            if (freshState.agentThinking) setAgentThinking((prev) => ({ ...prev, ...freshState.agentThinking }));
            if (freshState.message || freshState.summary) setWorkflowMessage(freshState.message || freshState.summary);
            if (freshState.sessionId) setWorkflowSessionId(freshState.sessionId);
            if (freshState.currentStage || freshState.currentNode || freshState.stageStatuses) {
              setActiveStage(determineActiveStage(freshState));
            }
          }
        }
      } catch (err) {
        console.warn("[ProjectsPage] Live state check error:", err);
      }
    };

    checkLiveState();

    return () => {
      isCancelled = true;
    };
  }, [selectedProjectId]);

  // Background polling to synchronize state if workflow is running in background and client is not actively streaming
  useEffect(() => {
    const isProjectActive = Boolean(
      selectedProjectId && (
        runStatus === "Running" ||
        isApproving ||
        (isExecutingRef.current && activeRunningProjectIdRef.current === selectedProjectId)
      )
    );
    if (!isProjectActive) return;

    let isMounted = true;
    const interval = setInterval(async () => {
      try {
        const wsId = activeWorkspaceId || "default";
        const [res, activeRun] = await Promise.all([
          fetch(`${BACKEND_URL}/workspaces/${wsId}/projects/${selectedProjectId}`).catch(() => null),
          fetchActiveWorkflowApi().catch(() => null),
        ]);
        if (!res || !res.ok) return;
        const freshProject = await res.json();
        if (!isMounted || !freshProject?.agentState) return;

        const isBackendStillActive = Boolean(
          activeRun?.data?.active && activeRun.data.projectId === selectedProjectId
        );
        const isClientStillExecuting = Boolean(
          isExecutingRef.current && activeRunningProjectIdRef.current === selectedProjectId
        );

        const freshState = freshProject.agentState;
        const freshStatus = (freshState.status || freshProject.status || "").toLowerCase();

        // Keep local projects in sync
        setProjects((prev) =>
          prev.map((p) => (p.id === selectedProjectId ? { ...p, ...freshProject } : p))
        );

        setPipelineStatuses((prev) => mapStageToPipelineStatus(freshState.stageStatuses, prev));
        if (freshState.stageOutputs) setStageOutputs(freshState.stageOutputs);
        if (freshState.agentThinking) setAgentThinking((prev) => ({ ...prev, ...freshState.agentThinking }));
        if (freshState.message || freshState.summary) setWorkflowMessage(freshState.message || freshState.summary);
        if (freshState.sessionId) setWorkflowSessionId(freshState.sessionId);
        if (freshState.currentStage || freshState.currentNode || freshState.stageStatuses) {
          setActiveStage(determineActiveStage(freshState));
        }

        const isAtOrPastModel =
          freshState.stageStatuses?.modelSelection === "Completed" ||
          freshState.stageStatuses?.modelSelectionNode === "Completed" ||
          freshState.stageStatuses?.trainingConfiguration === "Completed" ||
          freshState.stageStatuses?.modelTraining === "Completed" ||
          freshState.stageOutputs?.modelSelection !== undefined;

        const isStillRunning =
          freshStatus === "running" ||
          ((isBackendStillActive || isClientStillExecuting) &&
            freshStatus !== "paused" &&
            freshStatus !== "completed" &&
            freshStatus !== "success" &&
            freshStatus !== "failed" &&
            freshStatus !== "stopped");

        if (isStillRunning) {
          setRunStatus("Running");
          setIsPaused(false);
          setRequiresApproval(false);
          setApprovalNextStep(null);
        } else if (freshStatus === "completed" || freshStatus === "success") {
          activeRunningProjectIdRef.current = null;
          setRunStatus("Success");
          setIsPaused(false);
          setRequiresApproval(false);
          setApprovalNextStep(null);
          showAlert({ title: freshState.summary || "Workflow completed successfully", type: "success" });
        } else if (freshStatus === "failed") {
          activeRunningProjectIdRef.current = null;
          setRunStatus("Failed");
          setIsPaused(false);
          setRequiresApproval(false);
          setApprovalNextStep(null);
        } else if (freshStatus === "paused") {
          activeRunningProjectIdRef.current = null;
          isExecutingRef.current = false;
          const pollStageOutputs = freshState.stageOutputs as Record<string, any> | undefined;
          const isWaitingForModel =
            (freshState.stageStatuses?.modelSelection === "Completed" || pollStageOutputs?.modelSelection !== undefined) &&
            !pollStageOutputs?.trainingConfiguration?.contractPath &&
            freshState.stageStatuses?.trainingConfiguration !== "Completed" &&
            (freshState.nextStep === "Training Configuration" || freshState.nextStep === "trainingConfigurationNode");

          if (isWaitingForModel) {
            setIsAwaitingResponse(true);
            setRunStatus("Running");
            setIsPaused(false);
            setRequiresApproval(false);
            setApprovalNextStep(null);
          } else if (freshState.requiresApproval && !isAtOrPastModel) {
            setIsAwaitingResponse(false);
            setRunStatus("Paused");
            setIsPaused(false);
            setRequiresApproval(true);
            setApprovalNextStep(freshState.nextStep || null);
          } else {
            setIsAwaitingResponse(false);
            setRunStatus("Paused");
            setIsPaused(true);
            setRequiresApproval(false);
            setApprovalNextStep(null);
          }
        } else if (freshStatus === "stopped") {
          activeRunningProjectIdRef.current = null;
          setRunStatus("Stopped");
          setIsPaused(false);
          setRequiresApproval(false);
          setApprovalNextStep(null);
        }
      } catch (pollErr) {
        console.warn("[ProjectsPage] Background poll sync error:", pollErr);
      }
    }, 2000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [selectedProjectId, runStatus, isApproving, activeWorkspaceId]);

  const updateWorkflowState = (payload: WorkflowResponse["data"]) => {
    setPipelineStatuses((prev) => {
      const nextStatuses = mapStageToPipelineStatus(payload.stageStatuses, prev);
      return nextStatuses;
    });

    const rawStatus = (payload.status || "").toLowerCase();
    const stageOutputs = payload.stageOutputs as Record<string, any> | undefined;
    const isWaitingForModelConfirmation =
      (payload.stageStatuses?.modelSelection === "Completed" || stageOutputs?.modelSelection !== undefined) &&
      !stageOutputs?.trainingConfiguration?.contractPath &&
      payload.stageStatuses?.trainingConfiguration !== "Completed" &&
      (payload.nextStep === "Training Configuration" || payload.nextStep === "trainingConfigurationNode");

    if (isWaitingForModelConfirmation) {
      setIsAwaitingResponse(true);
      setRunStatus("Running");
      setIsPaused(false);
      setRequiresApproval(false);
      setApprovalNextStep(null);
    } else {
      setIsAwaitingResponse(false);

      if (rawStatus === "completed" || rawStatus === "success") {
        setRunStatus("Success");
        setIsPaused(false);
        setRequiresApproval(false);
        setApprovalNextStep(null);
      } else if (rawStatus === "stopped") {
        setRunStatus("Stopped");
        setIsPaused(false);
        setRequiresApproval(false);
        setApprovalNextStep(null);
      } else if (rawStatus === "failed") {
        setRunStatus("Failed");
        setIsPaused(false);
        setRequiresApproval(false);
        setApprovalNextStep(null);
      } else if (rawStatus === "paused") {
        if (payload.requiresApproval) {
          setRunStatus("Paused");
          setIsPaused(false);
          setRequiresApproval(true);
          setApprovalNextStep(payload.nextStep || null);
        } else {
          setRunStatus("Paused");
          setIsPaused(true);
          setRequiresApproval(false);
          setApprovalNextStep(null);
          setPausedAtPhase(determineActiveStage(payload));
        }
      } else {
        setRunStatus("Running");
        setIsPaused(false);
        setRequiresApproval(false);
        setApprovalNextStep(null);
      }
    }

    setWorkflowMessage(payload.message || payload.summary || "Workflow updated");
    if (payload.stageOutputs) {
      setStageOutputs(payload.stageOutputs);
    }
    if (payload.agentThinking) {
      setAgentThinking((prev) => ({
        ...prev,
        ...payload.agentThinking,
      }));
    }
    if (payload.sessionId) {
      setWorkflowSessionId(payload.sessionId);
    }

    setActiveStage(determineActiveStage(payload));

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

    const targetProjectId = activeRunningProjectIdRef.current || selectedProject?.id;
    if (targetProjectId) {
      const existingProject = projects.find((p) => p.id === targetProjectId);
      const existingAgentState = (existingProject?.agentState as any) || {};
      const agentStateToSave = {
        ...existingAgentState,
        ...payload,
        runTimestamp: payload.runTimestamp || existingAgentState.runTimestamp,
      };

      // Always keep local projects state in sync so re-entering the project has the latest data immediately
      setProjects((prev) =>
        prev.map((p) =>
          p.id === targetProjectId
            ? { ...p, status: payload.status || "running", agentState: agentStateToSave }
            : p
        )
      );

      // Persist state to backend
      if (
        payload.status === "completed" ||
        payload.status === "failed" ||
        payload.status === "stopped" ||
        payload.status === "stopped" ||
        payload.status === "paused" ||
        payload.status === "running" ||
        payload.requiresApproval ||
        payload.stageStatuses?.resolveSchema === "Completed"
      ) {
        void updateProject(targetProjectId, { agentState: agentStateToSave, status: payload.status });
      }
    }
  };

  const runWorkflow = async (action?: "approve" | "retry" | "resume", step?: string, overrideUserPrompt?: string) => {
    if (!selectedProject) return;

    if (!workflowConnectorIds || workflowConnectorIds.length === 0) {
      showAlert({
        title: "Please attach a data source before running the workflow",
        type: "warning",
      });
      return;
    }

    try {
      const activeRun = await fetchActiveWorkflowApi();
      if (activeRun?.data?.active && activeRun.data.projectId && activeRun.data.projectId !== selectedProject.id) {
        showAlert({
          title: "Another pipeline is currently running and wait until the current progress is completed to run the workflow.",
          message: "",
          type: "warning",
          isModal: true,
        });
        return;
      }
    } catch {
      // ignore active check network error
    }

    if (isExecutingRef.current) return;
    isExecutingRef.current = true;
    activeRunningProjectIdRef.current = selectedProject.id;

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    if (action !== "approve") {
      setRunStatus("Running");
      setIsPaused(false);
      // Immediately sync running status into AppContext projects
      setProjects((prev) =>
        prev.map((p) =>
          p.id === selectedProject.id
            ? { ...p, status: "running", agentState: { ...((p.agentState as any) || {}), status: "running" } }
            : p
        )
      );
      void updateProject(selectedProject.id, { status: "running" });
    }
    if (action === "resume") {
      const resumeStep = step || pausedAtPhase || "inspect";
      const stepToStageMap: Record<string, string> = {
        "inspect": "Data Inspection",
        "Data Inspection": "Data Inspection",
        "profileData": "Data Profiling",
        "Data Profiling": "Data Profiling",
        "resolveSchema": "Schema Resolver",
        "Schema Resolver": "Schema Resolver",
        "hierarchyMapperNode": "Feature Engineering",
        "hierarchyMapper": "Feature Engineering",
        "Hierarchy Mapper": "Feature Engineering",
        "featureArchitectNode": "Feature Engineering",
        "featureArchitect": "Feature Engineering",
        "Feature Architect": "Feature Engineering",
        "exogenous": "Feature Engineering",
        "exogenousScout": "Feature Engineering",
        "Exogenous Scout": "Feature Engineering",
      };
      const resumingStage = stepToStageMap[resumeStep] || "Data Inspection";
      setActiveStage(resumeStep);
      setPipelineStatuses((prev) => ({
        ...prev,
        [resumingStage]: "In Progress",
      }));
      setWorkflowMessage(`Resuming workflow at ${resumingStage}...`);
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
        "Model Selection": "Not Started",
        "Training Configuration": "Not Started",
        "Pre Flight": "Not Started",
        "Model Training": "Not Started",
        "Model Evaluation": "Not Started",
        "Model Validation": "Not Started",
      });
      // Clear pause state when starting fresh
      setIsPaused(false);
      setPausedAtPhase(null);
      setPausedStateSnapshot(null);
      setPausedSessionId(null);
    }
    let lastData: any = null;
    try {
      const payload: WorkflowRequestPayload = {
        connectorId: workflowConnectorIds,
        userPrompt: overrideUserPrompt !== undefined ? overrideUserPrompt : (selectedProject?.useCase || ""),
        projectId: selectedProject?.id,
      };
      const currentSession = action === "resume" ? (pausedSessionId || workflowSessionId) : workflowSessionId;
      if (currentSession) {
        payload.sessionId = currentSession;
      }
      if (action) {
        payload.action = action;
      }
      if (step && typeof step === "string") {
        payload.step = STEP_TO_NODE_MAP[step] || step;
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
          const trimmed = line.trim();
          if (trimmed.startsWith("data: ")) {
            const dataStr = trimmed.slice(6).trim();
            if (dataStr === "[DONE]") {
              break;
            }
            try {
              const chunk = JSON.parse(dataStr);
              if (chunk.success && chunk.data) {
                setIsApproving(false);
                lastData = chunk.data;
                lastDataRef.current = chunk.data; // Store for pause resumption
                updateWorkflowState(chunk.data);
                if (chunk.data.status === "paused") {
                  setPausedStateSnapshot(null);
                  setPausedAtPhase(null);
                }
              } else if (chunk.success === false) {
                setIsApproving(false);
                throw new Error(chunk.message || "AI workflow failed");
              }
            } catch (err: any) {
              console.warn("Failed to parse stream chunk", err);
            }
          }
        }
      }

      if (lastData && lastData.status === "completed") {
        showAlert({ title: lastData.summary || "Workflow completed successfully", type: "success" });
      } else if (action === "resume" && lastData && lastData.status !== "failed") {
        showAlert({
          title: "Workflow Resumed",
          type: "success",
        });
      }
    } catch (error: any) {
      setIsApproving(false);
      if (error.name === "AbortError") {
        console.info("Workflow execution request aborted by user.");
        return;
      }
      console.error("Workflow execution stream error", error);
      if (error.message?.includes("Another pipeline is currently running")) {
        setRunStatus("Idle");
        setIsPaused(false);
        showAlert({
          title: "Another pipeline is currently running and wait until the current progress is completed to run the workflow.",
          message: "",
          type: "warning",
          isModal: true,
        });
        return;
      }
      if (lastData && (lastData.status === "completed" || lastData.stageStatuses?.resolveSchema === "Completed")) {
        updateWorkflowState(lastData);
        showAlert({ title: lastData.summary || "Data Ingestion completed successfully", type: "success" });
        showAlert({ title: lastData.summary || "Data Ingestion completed successfully", type: "success" });
        return;
      }
      if (action !== "approve") {
        setRunStatus("Idle");
        setIsPaused(false);
      }
      showAlert({ title: error.message || "Workflow stream was interrupted", type: "error" });
    } finally {
      setIsApproving(false);
      isExecutingRef.current = false;
      const finishedProjectId = activeRunningProjectIdRef.current || selectedProject?.id;
      activeRunningProjectIdRef.current = null;
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
      // Only persist lastData if the execution was NOT aborted/cancelled by user
      if (!controller.signal.aborted && finishedProjectId && lastData && lastData.status !== "stopped") {
        void updateProject(finishedProjectId, { agentState: lastData, status: lastData.status });
      }
    }
  };

  const handleStopWorkflow = () => {
    const currentSession = workflowSessionId || pausedSessionId;
    const currentProjectId = activeRunningProjectIdRef.current || selectedProject?.id;

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    isExecutingRef.current = false;
    activeRunningProjectIdRef.current = null;
    lastDataRef.current = null;

    resetPipeline();
    setRunStatus("Stopped");
    setWorkflowMessage("Workflow stopped by user");

    const stoppedState = {
      status: "stopped",
      summary: "Workflow stopped by user",
      message: "Workflow stopped by user",
      sessionId: currentSession || undefined,
      requiresApproval: false,
      lastRunTime: new Date().toISOString(),
    };

    if (currentProjectId) {
      void updateProject(currentProjectId, {
        status: "stopped",
        agentState: stoppedState,
      });
    }

    if (currentSession || currentProjectId) {
      void stopWorkflowApi(currentSession || undefined, currentProjectId);
    }

    showAlert({
      title: "Workflow Stopped",
      message: "",
      type: "info",
    });
  };

  const runSimulation = () => {
    void runWorkflow();
  };

  const handleApprove = (overrideTargetPhase?: unknown) => {
    if (isApproving || isExecutingRef.current) return;
    setIsApproving(true);

    const resolution = resolveNextWorkflowPhase({
      approvalNextStep,
      overrideTargetPhase,
      currentStatuses: pipelineStatuses,
      stageOutputs,
    });

    const { targetPhase, statusesToUpdate, outputsToClear } = resolution;

    if (Object.keys(statusesToUpdate).length > 0) {
      setPipelineStatuses((prev) => ({
        ...prev,
        ...statusesToUpdate,
      }));
    }

    if (outputsToClear.length > 0) {
      setStageOutputs((prev) => {
        const next = { ...prev };
        for (const key of outputsToClear) {
          delete next[key];
        }
        return next;
      });
    }

    // Clear pause state
    setIsPaused(false);
    setIsAwaitingResponse(false);
    setPausedAtPhase(null);
    setPausedStateSnapshot(null);

    void runWorkflow("approve", targetPhase);
  };

  const handleRetry = (step?: string) => {
    const normalizedStep = typeof step === "string" ? STEP_TO_NODE_MAP[step] || step : undefined;
    void runWorkflow("retry", normalizedStep);
  };

  const handlePauseWorkflow = () => {
    const currentSession = workflowSessionId || pausedSessionId;
    const currentProjectId = activeRunningProjectIdRef.current || selectedProject?.id;

    // Step 1: Abort current API calls
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    isExecutingRef.current = false;
    activeRunningProjectIdRef.current = null;

    // Step 2: Notify backend to pause
    if (currentSession || currentProjectId) {
      void pauseWorkflowApi(currentSession || undefined, currentProjectId);
    }

    // Step 3: Capture current state snapshot
    const stateSnapshot = {
      pipelineStatuses,
      stageOutputs,
      activeStage,
      workflowSessionId: currentSession,
      runStatus,
      lastData: lastDataRef.current,
    };

    // Step 4: Save pause state
    setIsPaused(true);
    setRunStatus("Paused");
    setPausedStateSnapshot(stateSnapshot);
    setPausedAtPhase(activeStage || "inspect");
    setPausedSessionId(currentSession);

    // Step 5: Update backend with pause status
    if (currentProjectId) {
      void updateProject(currentProjectId, {
        status: "paused",
        agentState: {
          status: "paused",
          summary: `Workflow paused at ${activeStage || "inspect"} phase`,
          message: `Paused mid-phase. Ready to resume from ${activeStage || "current"} phase.`,
          sessionId: currentSession || undefined,
          requiresApproval: false,
        },
      });
    }

    showAlert({
      title: "Workflow Paused",
      message: "",
      type: "info",
    });
  };

  const handleResumeWorkflow = async () => {
    if (!isPaused && runStatus !== "Paused") {
      showAlert({
        title: "No paused state found. Cannot resume",
        type: "error",
      });
      return;
    }

    const resumePhase = pausedAtPhase || activeStage || "inspect";
    if (pausedStateSnapshot) {
      if (pausedStateSnapshot.stageOutputs) setStageOutputs(pausedStateSnapshot.stageOutputs);
      if (pausedStateSnapshot.pipelineStatuses) setPipelineStatuses(pausedStateSnapshot.pipelineStatuses);
    }

    void runWorkflow("resume", resumePhase);
  };


  const handleStageSelect = (stepId: string) => {
    const stageMap: Record<string, string> = {
      "Data Inspection": "inspect",
      "Data Profiling": "profileData",
      "Schema Resolver": "resolveSchema",
      "Exogenous Scout": "exogenousScout",
      "Feature Engineering": "exogenousScout",
      "Model Training & Validation": "modelSelection",
    };
    setActiveStage(stageMap[stepId] || stepId);
  };

  const handleReRunWorkflow = async (newUseCase?: string) => {
    if (!selectedProject) return;
    const validUseCase = typeof newUseCase === "string" && newUseCase.trim().length > 0 ? newUseCase.trim() : undefined;
    if (validUseCase && validUseCase !== selectedProject.useCase) {
      await updateProject(selectedProject.id, { useCase: validUseCase });
    }
    // Clear workflow session ID to start a fresh execution run
    setWorkflowSessionId(null);
    setRunStatus("Idle");
    setIsPaused(false);
    setIsAwaitingResponse(false);
    setRequiresApproval(false);
    setStageOutputs({});
    setAgentThinking({});
    setActiveStage("inspect");
    setPipelineStatuses({
      "Data Inspection": "In Progress",
      "Data Profiling": "Pending",
      "Schema Resolver": "Pending",
      "Feature Engineering": "Not Started",
      "Model Selection": "Not Started",
      "Training Configuration": "Not Started",
      "Pre Flight": "Not Started",
      "Model Training": "Not Started",
      "Model Evaluation": "Not Started",
      "Model Validation": "Not Started",
    });

    // Cleanly clear project agentState in database so stale training configs don't leak into new run
    await updateProject(selectedProject.id, {
      status: "idle",
      agentState: {
        status: "idle",
        stageOutputs: {},
        stageStatuses: INITIAL_PIPELINE_STATUSES,
      },
    });

    void runWorkflow(undefined, undefined, validUseCase ?? selectedProject.useCase);
  };

  // ── Navigation helpers ────────────────────────────────────────────────────

  const openProject = (id: string) => {
    setSelectedProjectId(id);
    setView("detail");
  };

  const goToList = () => {
    setView("list");
    setSelectedProjectId(null);
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
          showAlert({ title: "Edit Project is being worked separately in the backend", type: "info" })
        }
        onViewHistory={() =>
          showAlert({ title: "Project execution logs are being worked separately in the backend", type: "info" })
        }
        onManageSources={() =>
          showAlert({ title: "Data source management is being worked separately in the backend", type: "info" })
        }
        onAddTag={() =>
          showAlert({ title: "Tag management is being worked separately in the backend", type: "info" })
        }
        activeStage={activeStage}
        stageOutputs={stageOutputs}
        requiresApproval={requiresApproval}
        workflowMessage={workflowMessage}
        onSelectStage={handleStageSelect}
        onApprove={(override) => handleApprove(typeof override === "string" ? override : undefined)}
        isApproving={isApproving}
        onRetry={(stepId) => handleRetry(stepId)}
        isPaused={isPaused}
        pausedAtPhase={pausedAtPhase}
        onPause={handlePauseWorkflow}
        onResume={handleResumeWorkflow}
        approvalNextStep={approvalNextStep}
        isAwaitingResponse={isAwaitingResponse}
        agentThinking={agentThinking}
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
