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
} from "../connectors/Icons";
import { useApp, Project, BACKEND_URL } from "../providers/AppContext";
import { AgentOutput, PipelineStatuses, RunStatus, StageOutputs } from "../projects/types";
import { INITIAL_PIPELINE_STATUSES } from "../projects/constants";
import {
  NODE_CONFIG,
  normalizeFlatStageStatuses,
  normalizeGroupedStageStatuses,
  TrackedAgentKey,
  TRACKED_AGENT_KEYS,
} from "../projects/pipelineNames";
import { resolveNextWorkflowPhase, STEP_TO_NODE_MAP, PIPELINE_PHASES, SUBSTEP_TO_PIPELINE_MAP } from "../projects/pipelineFlowConfig";
import ProjectsListPage from "../projects/ProjectsListPage";
import ProjectWorkspace, { ProjectTabType } from "../projects/ProjectWorkspace";
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
    stageOutputs?: StageOutputs;
    stageStatuses?: PipelineStatuses;
    agentThinking?: Record<string, Array<{ time: string; text: string; done: boolean }>>;
    inspection?: AgentOutput;
    schemaResolution?: AgentOutput;
    dataProfile?: AgentOutput;
    runTimestamp?: string;
  };
}

function renderConnectorIcon(type: string): React.ReactNode {
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

type View = "list" | "project";

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

  const [activeProjectTab, setActiveProjectTab] = useState<ProjectTabType>("project-detail");

  const activeRunningProjectIdRef = useRef<string | null>(null);

  const [view, setView] = useState<View>("list");
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const selectedProject = projects.find((p) => p.id === selectedProjectId);

  useEffect(() => {
    setView("list");
    setSelectedProjectId(null);
    setActiveProjectTab("project-detail");
    resetPipeline();
  }, [activeWorkspaceId]);

  const [pipelineStatuses, setPipelineStatuses] = useState<PipelineStatuses>(
    INITIAL_PIPELINE_STATUSES
  );
  const [runStatus, setRunStatus] = useState<RunStatus>("None");
  const [lastRunTime, setLastRunTime] = useState("Not run yet");
  const [workflowSessionId, setWorkflowSessionId] = useState<string | null>(null);
  const [activeStage, setActiveStage] = useState<string | null>(null);
  const [stageOutputs, setStageOutputs] = useState<StageOutputs>({});
  const [agentThinking, setAgentThinking] = useState<Record<string, Array<{ time: string; text: string; done: boolean }>>>({});
  const [workflowMessage, setWorkflowMessage] = useState<string>("None");
  const [requiresApproval, setRequiresApproval] = useState(false);
  const [approvalNextStep, setApprovalNextStep] = useState<string | null>(null);
  const [isApproving, setIsApproving] = useState(false);
  const [isSubmittingWorkflow, setIsSubmittingWorkflow] = useState(false);
  const [isPausingWorkflow, setIsPausingWorkflow] = useState(false);
  const [isStoppingWorkflow, setIsStoppingWorkflow] = useState(false);
  const [isResumingWorkflow, setIsResumingWorkflow] = useState(false);
  const [isRetryingWorkflow, setIsRetryingWorkflow] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const isExecutingRef = useRef<boolean>(false);

  const [isPaused, setIsPaused] = useState(false);
  const [isAwaitingResponse, setIsAwaitingResponse] = useState(false);
  const [pausedAtPhase, setPausedAtPhase] = useState<string | null>(null);
  const [pausedSessionId, setPausedSessionId] = useState<string | null>(null);
  const lastCompletedSummaryRef = useRef<string | null>(null);

  const resetPipeline = () => {
    lastCompletedSummaryRef.current = null;
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    isExecutingRef.current = false;
    setPipelineStatuses(INITIAL_PIPELINE_STATUSES);
    setRunStatus("None");
    setWorkflowSessionId(null);
    setActiveStage(null);
    setStageOutputs({});
    setAgentThinking({});
    setWorkflowMessage("None");
    setRequiresApproval(false);
    setApprovalNextStep(null);
    setIsAwaitingResponse(false);

    setIsPaused(false);
    setPausedAtPhase(null);
    setPausedSessionId(null);
  };

  const stageStatusValues = Object.values(pipelineStatuses).map((stage) => stage.status);
  const completedCount = stageStatusValues.filter((status) => status === "Completed").length;
  const inProgressCount = stageStatusValues.filter((status) => status === "In-Progress").length;
  const totalSteps = stageStatusValues.length || 1;
  const completionPct = ((completedCount + (inProgressCount > 0 ? 0.5 : 0)) / totalSteps) * 100;
  const workflowConnectorIds = Array.isArray(selectedProject?.dataSources)
    ? selectedProject.dataSources.filter((sourceId): sourceId is string => typeof sourceId === "string" && sourceId.trim().length > 0)
    : [];

  const mapStageToPipelineStatus = (
    stageStatuses?: unknown,
    currentStatuses?: PipelineStatuses
  ): PipelineStatuses => normalizeGroupedStageStatuses(
    stageStatuses ?? currentStatuses ?? INITIAL_PIPELINE_STATUSES
  );

  const determineActiveStage = (payload: Partial<WorkflowResponse["data"]>): string => {
    const stageOutputs = payload.stageOutputs;
    const stageStatuses = payload.stageStatuses;
    const normalizedStatuses = normalizeFlatStageStatuses(stageStatuses);
    const currentNode = (payload.currentNode || payload.currentStage || "").trim();
    const nextStep = (payload.nextStep || "").toLowerCase().trim();

    if (currentNode in NODE_CONFIG) {
      return NODE_CONFIG[currentNode as TrackedAgentKey].displayName;
    }
    const activeNode = TRACKED_AGENT_KEYS.find((node) =>
      normalizedStatuses[node] === "In-Progress" ||
      normalizedStatuses[node] === "Paused" ||
      normalizedStatuses[node] === "Awaiting Approval" ||
      normalizedStatuses[node] === "User Input"
    );
    if (activeNode) return NODE_CONFIG[activeNode].displayName;

    if (currentNode === "modelValidationNode" || currentNode === "modelValidation") {
      return "Model Validation";
    }
    if (
      currentNode === "modelTrainingExecNode" ||
      currentNode === "modelTrainingCodeNode" ||
      currentNode === "modelTraining" ||
      currentNode === "modelTrainingNode" ||
      currentNode === "modelEvaluation" ||
      currentNode === "modelEvaluationNode"
    ) {
      return "Model Training";
    }
    if (currentNode === "preFlightNode" || currentNode === "preFlight" || currentNode === "Pre Flight") {
      return "Pre Flight";
    }
    if (
      currentNode === "trainingConfigurationNode" ||
      currentNode === "trainingConfiguration" ||
      currentNode === "datasetAnalyserAgent" ||
      currentNode === "datasetAnalyserNode"
    ) {
      return "Training Configuration";
    }
    if (currentNode === "modelSelectionNode" || currentNode === "modelSelection" || currentNode === "finalModelSelectionNode") {
      return "Model Selection";
    }
    if (currentNode === "exogenous" || currentNode === "exogenousScout") {
      return "Exogenous Scout";
    }
    if (currentNode === "featureValidator" || currentNode === "featureValidatorNode") {
      return "Feature Validator";
    }
    if (currentNode === "featureArchitect" || currentNode === "featureArchitectNode") {
      return "Feature Architect";
    }
    if (currentNode === "hierarchyMapper" || currentNode === "hierarchyMapperNode" || currentNode === "relationshipBuilder") {
      return "Hierarchy Mapper";
    }
    if (currentNode === "resolveSchema") {
      return "Schema Resolver";
    }
    if (currentNode === "profileData") {
      return "Data Profiling";
    }
    if (currentNode === "inspect") {
      return "Data Inspection";
    }

    if (nextStep.includes("validation")) {
      return "Model Validation";
    }
    if (nextStep.includes("model training") || nextStep.includes("modeltraining")) {
      return "Model Training";
    }
    if (nextStep.includes("pre flight") || nextStep.includes("preflight")) {
      return "Pre Flight";
    }
    if (nextStep.includes("training configuration") || nextStep.includes("trainingconfiguration")) {
      return "Training Configuration";
    }
    if (nextStep.includes("model selection") || nextStep.includes("modelselection")) {
      return "Model Selection";
    }

    const hasProgress = (node: TrackedAgentKey) => {
      const status = normalizedStatuses[node];
      return status === "In-Progress" || status === "Completed" ||
        status === "Paused" ||
        status === "Awaiting Approval" || status === "User Input";
    };
    const activeNodes: Array<[TrackedAgentKey, string]> = [
      ["modelTrainingExecNode", "Model Training"],
      ["modelTrainingCodeNode", "Model Training"],
      ["preFlightNode", "Pre Flight"],
      ["trainingConfigurationNode", "Training Configuration"],
      ["modelSelectionNode", "Model Selection"],
      ["exogenous", "Exogenous Scout"],
      ["featureValidatorNode", "Feature Validator"],
      ["featureArchitectNode", "Feature Architect"],
      ["hierarchyMapperNode", "Hierarchy Mapper"],
      ["resolveSchema", "Schema Resolver"],
      ["profileData", "Data Profiling"],
      ["inspect", "Data Inspection"],
    ];
    const activeStep = activeNodes.find(([node]) => hasProgress(node));
    if (activeStep) return activeStep[1];
    if (stageOutputs?.modelTrainingExecNode?.modelValidation) return "Model Validation";
    const outputNodes: Array<[TrackedAgentKey, string]> = [
      ["modelTrainingExecNode", "Model Training"],
      ["modelTrainingCodeNode", "Model Training"],
      ["preFlightNode", "Pre Flight"],
      ["trainingConfigurationNode", "Training Configuration"],
      ["modelSelectionNode", "Model Selection"],
      ["exogenous", "Exogenous Scout"],
      ["featureValidatorNode", "Feature Validator"],
      ["featureArchitectNode", "Feature Architect"],
      ["hierarchyMapperNode", "Hierarchy Mapper"],
      ["resolveSchema", "Schema Resolver"],
      ["profileData", "Data Profiling"],
      ["inspect", "Data Inspection"],
    ];
    const completedStep = outputNodes.find(([node]) => Boolean(stageOutputs?.[node]));
    if (completedStep) return completedStep[1];

    return "inspect";
  };

  useEffect(() => {
    if (!selectedProjectId) return;

    const projectToHydrate = projects.find((p) => p.id === selectedProjectId);
    if (!projectToHydrate) return;

    const state = projectToHydrate.agentState;
    const hasValidState = state && typeof state === "object" && (state.stageStatuses || state.status || state.stageOutputs);

    if (hasValidState) {
      const nextStatuses = mapStageToPipelineStatus(
        state.stageStatuses,
        pipelineStatuses
      );
      setPipelineStatuses(nextStatuses);

      const rawStatus = (state.status || projectToHydrate.status || "").toLowerCase();
      const hasInProgressStage = state.stageStatuses &&
        Object.values(state.stageStatuses).some((s: any) =>
          s?.status === "In-Progress" || s === "In-Progress"
        );
      const isStillRunningLocally =
        rawStatus === "in-progress" ||
        rawStatus === "queued" ||
        (Boolean(hasInProgressStage) && rawStatus !== "paused" && rawStatus !== "stopped" && rawStatus !== "failed");

      if (isStillRunningLocally) {
        setRunStatus("In-Progress");
        setIsPaused(false);
        setRequiresApproval(false);
        setApprovalNextStep(null);
      } else if (rawStatus === "completed") {
        setRunStatus("Completed");
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
        setRunStatus("None");
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

      setIsAwaitingResponse(false);
      if (state.sessionId) {
        setWorkflowSessionId(state.sessionId);
      }

      const timestamp = state.runTimestamp || state.lastRunTime || state.updatedAt || projectToHydrate.createdAt;
      if (timestamp && (state.status || hasInProgressStage)) {
        const dateObj = new Date(timestamp);
        if (!isNaN(dateObj.getTime())) {
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
        setLastRunTime("Not run yet");
      }
    } else {

      setPipelineStatuses(INITIAL_PIPELINE_STATUSES);
      setStageOutputs({});
      setAgentThinking({});
      setRunStatus("None");
      setIsPaused(false);
      setRequiresApproval(false);
      setApprovalNextStep(null);
      setWorkflowSessionId(null);
      setWorkflowMessage("");
      setLastRunTime("Not run yet");
      setActiveStage("inspect");
    }

    let isCancelled = false;
    const checkLiveState = async () => {
      try {
        const wsId = activeWorkspaceId || "default";
        const res = await fetch(`${BACKEND_URL}/workspaces/${wsId}/projects/${selectedProjectId}`).catch(() => null);

        if (isCancelled) return;

        if (res && res.ok) {
          const freshProject = await res.json();
          if (isCancelled || !freshProject) return;

          setProjects((prev) =>
            prev.map((p) => (p.id === selectedProjectId ? { ...p, ...freshProject } : p))
          );

          if (freshProject.agentState) {
            const freshState = freshProject.agentState;
            const freshStatus = (freshState.status || freshProject.status || "").toLowerCase();

            const hasInProgressStage = freshState.stageStatuses &&
              Object.values(freshState.stageStatuses).some((s: any) =>
                s?.status === "In-Progress" || s === "In-Progress"
              );
            const isStillRunning =
              freshStatus === "in-progress" ||
              freshStatus === "queued" ||
              (Boolean(hasInProgressStage) && freshStatus !== "paused" && freshStatus !== "stopped" && freshStatus !== "failed");

            if (isStillRunning) {
              setRunStatus("In-Progress");
              setIsPaused(false);
              setRequiresApproval(false);
              setApprovalNextStep(null);
            } else if (freshStatus === "completed") {
              setRunStatus("Completed");
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
            } else if (freshStatus === "paused") {
              setRunStatus("Paused");
              setIsPaused(!freshState.requiresApproval);
              setRequiresApproval(Boolean(freshState.requiresApproval));
              setApprovalNextStep(freshState.requiresApproval ? (freshState.nextStep || null) : null);
              setPausedAtPhase(determineActiveStage(freshState));
              if (freshState.sessionId) setPausedSessionId(freshState.sessionId);
            }

            const timestamp = freshState.runTimestamp || freshState.lastRunTime || freshState.updatedAt || freshProject.createdAt;
            if (timestamp && (isStillRunning || freshStatus === "completed" || freshStatus === "success" || freshStatus === "paused" || freshStatus === "stopped" || freshStatus === "failed")) {
              const dateObj = new Date(timestamp);
              if (!isNaN(dateObj.getTime())) {
                setLastRunTime(dateObj.toLocaleString("en-US", {
                  month: "short",
                  day: "2-digit",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                  hour12: true,
                }));
              }
            }

            if (freshState.stageStatuses) {
              setPipelineStatuses((prev) =>
                mapStageToPipelineStatus(
                  freshState.stageStatuses,
                  prev
                )
              );
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

  // Keep the selected project synchronized from persisted backend state, regardless of local run status.
  useEffect(() => {
    if (!selectedProjectId) return;

    let isMounted = true;
    let isRefreshing = false;
    const hydrateProject = async () => {
      if (isRefreshing) return;
      isRefreshing = true;
      try {
        const wsId = activeWorkspaceId || "default";
        const res = await fetch(`${BACKEND_URL}/workspaces/${wsId}/projects/${selectedProjectId}`);
        if (!res.ok) {
          console.warn(`[ProjectsPage] Project hydration failed with status ${res.status}`);
          return;
        }
        const freshProject = await res.json();
        if (!isMounted || !freshProject) return;
        const freshState = freshProject.agentState || {};
        const freshStatus = String(freshState.status || freshProject.status || "idle").toLowerCase();

        // Keep the project cache synchronized only with the backend hydration response.
        setProjects((prev) =>
          prev.map((p) => (p.id === selectedProjectId ? { ...p, ...freshProject } : p))
        );

        setPipelineStatuses(mapStageToPipelineStatus(freshState.stageStatuses, INITIAL_PIPELINE_STATUSES));
        setStageOutputs(freshState.stageOutputs || {});
        setAgentThinking(freshState.agentThinking || {});
        setWorkflowMessage(freshState.message || freshState.summary || "Workflow loaded from backend");
        setWorkflowSessionId(typeof freshState.sessionId === "string" ? freshState.sessionId : null);
        setActiveStage(determineActiveStage(freshState));
        setIsAwaitingResponse(false);

        const hasInProgressStage = freshState.stageStatuses &&
          Object.values(freshState.stageStatuses).some((s: any) =>
            s?.status === "In-Progress" || s === "In-Progress"
          );
        const isRunning =
          freshStatus === "in-progress" ||
          freshStatus === "queued" ||
          (Boolean(hasInProgressStage) && freshStatus !== "paused" && freshStatus !== "stopped" && freshStatus !== "failed");

        if (isRunning) {
          setRunStatus("In-Progress");
          setIsPaused(false);
          setRequiresApproval(false);
          setApprovalNextStep(null);
          setPausedAtPhase(null);
          activeRunningProjectIdRef.current = selectedProjectId;
          lastCompletedSummaryRef.current = null;
        } else if (freshStatus === "completed") {
          activeRunningProjectIdRef.current = null;
          isExecutingRef.current = false;
          setRunStatus("Completed");
          setIsPaused(false);
          setRequiresApproval(false);
          setApprovalNextStep(null);
          const completionMsg = freshState.summary || "Workflow completed successfully";
          if (lastCompletedSummaryRef.current !== completionMsg) {
            lastCompletedSummaryRef.current = completionMsg;
            showAlert({ title: completionMsg, type: "success" });
          }
        } else if (freshStatus === "failed") {
          activeRunningProjectIdRef.current = null;
          isExecutingRef.current = false;
          setRunStatus("Failed");
          setIsPaused(false);
          setRequiresApproval(false);
          setApprovalNextStep(null);
        } else if (freshStatus === "paused") {
          activeRunningProjectIdRef.current = null;
          isExecutingRef.current = false;
          setRunStatus("Paused");
          setIsPaused(!freshState.requiresApproval);
          setRequiresApproval(Boolean(freshState.requiresApproval));
          setApprovalNextStep(freshState.requiresApproval ? (freshState.nextStep || null) : null);
          setPausedAtPhase(determineActiveStage(freshState));
          setPausedSessionId(typeof freshState.sessionId === "string" ? freshState.sessionId : null);
        } else if (freshStatus === "stopped") {
          activeRunningProjectIdRef.current = null;
          isExecutingRef.current = false;
          setRunStatus("Stopped");
          setIsPaused(false);
          setRequiresApproval(false);
          setApprovalNextStep(null);
        } else {
          activeRunningProjectIdRef.current = null;
          setRunStatus("None");
          setIsPaused(false);
          setRequiresApproval(false);
          setApprovalNextStep(null);
        }

        const rawTimestamp = freshState.runTimestamp || freshState.lastRunTime || freshState.updatedAt || freshProject.createdAt;
        if (rawTimestamp && (isRunning || freshStatus === "completed" || freshStatus === "success" || freshStatus === "paused" || freshStatus === "stopped" || freshStatus === "failed")) {
          const dateObj = new Date(rawTimestamp);
          if (!isNaN(dateObj.getTime())) {
            setLastRunTime(dateObj.toLocaleString("en-US", {
              month: "short",
              day: "2-digit",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
              hour12: true,
            }));
          }
        } else if (!rawTimestamp) {
          setLastRunTime("Not run yet");
        }
      } catch (pollErr) {
        console.warn("[ProjectsPage] Background poll sync error:", pollErr);
      } finally {
        isRefreshing = false;
      }
    };

    void hydrateProject();
    const interval = setInterval(() => void hydrateProject(), 5000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [selectedProjectId, activeWorkspaceId, setProjects, showAlert]);

  const runWorkflow = async (
    action?: "approve" | "retry" | "resume",
    step?: string,
    overrideUserPrompt?: string,
    selectedModels?: string[],
    splitEndDate?: string,
    predictionHorizon?: number,
    predictionFrequency?: string,
    predictionObjectiveStartDate?: string
  ) => {
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

    }

    if (isExecutingRef.current) return;
    isExecutingRef.current = true;
    if (action === "approve") {
      setIsApproving(true);
    } else if (action === "resume") {
      setIsResumingWorkflow(true);
      setRunStatus("In-Progress");
      setIsPaused(false);
    } else if (action === "retry") {
      setIsRetryingWorkflow(true);
      setRunStatus("In-Progress");
      setIsPaused(false);
    } else {
      setIsSubmittingWorkflow(true);
      setRunStatus("In-Progress");
      setIsPaused(false);
      setRequiresApproval(false);
      setApprovalNextStep(null);
    }
    activeRunningProjectIdRef.current = selectedProject.id;
    lastCompletedSummaryRef.current = null;

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    let lastData: any = null;
    try {
      const effectiveSplitDate = splitEndDate || selectedProject?.splitDate || selectedProject?.agentState?.splitDate;
      const effectiveSplitEndDate = splitEndDate || selectedProject?.splitDate || selectedProject?.agentState?.splitEndDate;

      const payload: WorkflowRequestPayload = {
        connectorId: workflowConnectorIds,
        userPrompt: overrideUserPrompt !== undefined ? overrideUserPrompt : (selectedProject?.useCase || ""),
        projectId: selectedProject?.id,
        ...(effectiveSplitDate ? { splitDate: effectiveSplitDate } : {}),
        ...(effectiveSplitEndDate ? { splitEndDate: effectiveSplitEndDate } : {}),
        ...(selectedModels && selectedModels.length > 0 ? { selectedModels } : {}),
        ...(predictionHorizon !== undefined ? { predictionHorizon } : {}),
        ...(predictionFrequency ? { predictionFrequency } : {}),
        ...(predictionObjectiveStartDate ? { predictionObjectiveStartDate } : {}),
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
      setIsSubmittingWorkflow(false);

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
                const update = chunk.data;
                lastData = update;

                const statusStr = String(update.status || "").toLowerCase();
                const isRunning =
                  statusStr === "in-progress" ||
                  statusStr === "queued";

                if (isRunning) {
                  setRunStatus("In-Progress");
                  setIsPaused(false);
                  setRequiresApproval(false);
                  setApprovalNextStep(null);
                  setPausedAtPhase(null);
                } else if (statusStr === "paused") {
                  setRunStatus("Paused");
                  setIsPaused(!update.requiresApproval);
                  setRequiresApproval(Boolean(update.requiresApproval));
                  setApprovalNextStep(update.requiresApproval ? (update.nextStep || null) : null);
                  if (update.currentStage || update.currentNode) {
                    setPausedAtPhase(update.currentNode || update.currentStage);
                  }
                } else if (statusStr === "completed") {
                  setRunStatus("Completed");
                  setIsPaused(false);
                  setRequiresApproval(false);
                  setApprovalNextStep(null);
                } else if (statusStr === "stopped") {
                  setRunStatus("Stopped");
                  setIsPaused(false);
                  setRequiresApproval(false);
                  setApprovalNextStep(null);
                } else if (statusStr === "failed") {
                  setRunStatus("Failed");
                  setIsPaused(false);
                  setRequiresApproval(false);
                  setApprovalNextStep(null);
                } else if (update.requiresApproval !== undefined) {
                  setRequiresApproval(Boolean(update.requiresApproval));
                  if (update.requiresApproval) {
                    setApprovalNextStep(update.nextStep || null);
                  }
                }

                if (update.stageStatuses) {
                  setPipelineStatuses((prev) => mapStageToPipelineStatus(update.stageStatuses, prev));
                }
                if (update.stageOutputs) {
                  setStageOutputs((prev) =>
                    update.replaceStageOutputs
                      ? update.stageOutputs
                      : { ...prev, ...update.stageOutputs }
                  );
                }
                if (update.agentThinking) {
                  setAgentThinking((prev) => ({ ...prev, ...update.agentThinking }));
                }
                if (update.currentNode || update.currentStage) {
                  setActiveStage(update.currentNode || update.currentStage);
                }
                if (update.message || update.summary) {
                  setWorkflowMessage(update.message || update.summary);
                }
                if (update.sessionId) {
                  setWorkflowSessionId(update.sessionId);
                }

                if (selectedProject?.id) {
                  setProjects((prev) =>
                    prev.map((p) =>
                      p.id === selectedProject.id
                        ? {
                            ...p,
                            status: update.status || p.status,
                            agentState: {
                              ...(p.agentState || {}),
                              ...update,
                              stageStatuses: update.stageStatuses || p.agentState?.stageStatuses,
                              stageOutputs: update.replaceStageOutputs
                                ? update.stageOutputs
                                : update.stageOutputs || p.agentState?.stageOutputs,
                            },
                          }
                        : p
                    )
                  );
                }

                // Backend has responded with the new step/state: clear button loading spinners
                setIsApproving(false);
                setIsSubmittingWorkflow(false);
                setIsResumingWorkflow(false);
                setIsRetryingWorkflow(false);
                setIsAwaitingResponse(false);
              } else if (chunk.success === false) {
                setIsApproving(false);
                setIsSubmittingWorkflow(false);
                setIsResumingWorkflow(false);
                setIsRetryingWorkflow(false);
                throw new Error(chunk.message || "AI workflow failed");
              }
            } catch (err: any) {
              console.warn("Failed to parse stream chunk", err);
            }
          }
        }
      }

      if (lastData && lastData.status === "completed") {
        const completionMsg = lastData.summary || "Workflow completed successfully";
        if (lastCompletedSummaryRef.current !== completionMsg) {
          lastCompletedSummaryRef.current = completionMsg;
          showAlert({ title: completionMsg, type: "success" });
        }
      } else if (action === "resume" && lastData && lastData.status !== "failed") {
        showAlert({
          title: "Workflow Resumed",
          type: "success",
        });
      }
    } catch (error: any) {
      setIsApproving(false);
      setIsSubmittingWorkflow(false);
      setIsResumingWorkflow(false);
      setIsRetryingWorkflow(false);
      if (error.name === "AbortError") {
        console.info("Workflow execution request aborted by user.");
        return;
      }
      console.error("Workflow execution stream error", error);
      if (error.message?.includes("Another pipeline is currently running")) {
        showAlert({
          title: "Another pipeline is currently running and wait until the current progress is completed to run the workflow.",
          message: "",
          type: "warning",
          isModal: true,
        });
        return;
      }

      showAlert({ title: error.message || "Workflow stream was interrupted", type: "error" });
    } finally {
      setIsApproving(false);
      setIsSubmittingWorkflow(false);
      setIsResumingWorkflow(false);
      setIsRetryingWorkflow(false);
      isExecutingRef.current = false;
      activeRunningProjectIdRef.current = null;
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }

    }
  };

  const handleStopWorkflow = async () => {
    if (isStoppingWorkflow) return;
    setIsStoppingWorkflow(true);
    const currentSession = workflowSessionId || pausedSessionId;
    const currentProjectId = activeRunningProjectIdRef.current || selectedProject?.id;

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    isExecutingRef.current = false;
    activeRunningProjectIdRef.current = null;

    try {
      const response = await stopWorkflowApi(currentSession || undefined, currentProjectId);
      if (response.data?.status) {
        setRunStatus("Stopped");
        setIsPaused(false);
        setRequiresApproval(false);
        setApprovalNextStep(null);
        showAlert({ title: "Workflow Stopped", type: "info" });
      }
      if (currentProjectId) await refreshProjects();
    } catch (error) {
      showAlert({
        title: error instanceof Error ? error.message : "Failed to stop workflow",
        type: "error",
      });
    } finally {
      setIsStoppingWorkflow(false);
      setIsSubmittingWorkflow(false);
    }
  };

  const runSimulation = () => {
    void runWorkflow();
  };

  const handleApprove = (
    overrideTargetPhase?: string,
    selectedModels?: string[],
    splitEndDate?: string,
    predictionHorizon?: number,
    predictionFrequency?: string,
    predictionObjectiveStartDate?: string
  ) => {
    if (isApproving || isExecutingRef.current || isSubmittingWorkflow || isPausingWorkflow || isStoppingWorkflow || isResumingWorkflow || isRetryingWorkflow) return;
    setIsApproving(true);

    const targetPhase = resolveNextWorkflowPhase({
      approvalNextStep,
      overrideTargetPhase,
    });

    void runWorkflow(
      "approve",
      targetPhase,
      undefined,
      selectedModels,
      splitEndDate,
      predictionHorizon,
      predictionFrequency,
      predictionObjectiveStartDate
    );
  };

  const handleRetry = (step?: string) => {
    if (runStatus === "Stopped" || runStatus === "Failed" || isExecutingRef.current || isRetryingWorkflow) return;
    setIsRetryingWorkflow(true);
    const rawStep = step || activeStage || "inspect";
    const phase = SUBSTEP_TO_PIPELINE_MAP[rawStep] || PIPELINE_PHASES.MODEL_TRAINING_VALIDATION;
    const rootNode = phase === PIPELINE_PHASES.DATA_INGESTION
      ? "inspect"
      : phase === PIPELINE_PHASES.FEATURE_ENGINEERING
        ? "hierarchyMapperNode"
        : "modelSelectionNode";
    void runWorkflow("retry", rootNode);
  };

  const handlePauseWorkflow = async () => {
    if (isPausingWorkflow || isStoppingWorkflow) return;
    setIsPausingWorkflow(true);
    const currentSession = workflowSessionId || pausedSessionId;
    const currentProjectId = activeRunningProjectIdRef.current || selectedProject?.id;

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    isExecutingRef.current = false;
    activeRunningProjectIdRef.current = null;

    try {
      const response = await pauseWorkflowApi(currentSession || undefined, currentProjectId);
      if (response.data?.status) {
        setRunStatus("Paused");
        setIsPaused(true);
        setRequiresApproval(false);
        setApprovalNextStep(null);
        showAlert({ title: "Workflow Paused", type: "info" });
      }
      if (currentProjectId) await refreshProjects();
    } catch (error) {
      showAlert({
        title: error instanceof Error ? error.message : "Failed to pause workflow",
        type: "error",
      });
    } finally {
      setIsPausingWorkflow(false);
      setIsSubmittingWorkflow(false);
    }
  };

  const handleResumeWorkflow = () => {
    if (!isPaused && runStatus !== "Paused") {
      showAlert({
        title: "No paused state found. Cannot resume",
        type: "error",
      });
      return;
    }

    if (isResumingWorkflow || isSubmittingWorkflow || isApproving) return;
    setIsResumingWorkflow(true);
    void runWorkflow("resume");
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

    void runWorkflow(undefined, undefined, validUseCase ?? selectedProject.useCase);
  };

  const openProject = (id: string) => {
    setSelectedProjectId(id);
    setActiveProjectTab("workflow");
    setView("project");
  };

  const goToList = () => {
    setView("list");
    setSelectedProjectId(null);
    setActiveProjectTab("project-detail");
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

  if (view === "project") {
    return (
      <ProjectWorkspace
        project={selectedProject}
        dataSources={dataSources}
        userProfile={userProfile}
        activeProjectTab={activeProjectTab}
        onTabChange={(tab) => setActiveProjectTab(tab)}
        onGoToList={goToList}
        onSaveProject={async (projectName, name, useCase, sources, domain, subDomain) => {
          const created = await addProject(projectName, name, "OWNER", sources, useCase, domain, subDomain);
          if (created && typeof created === "object" && "id" in created) {
            setSelectedProjectId(created.id);
            showAlert({ title: "Project saved successfully", type: "success" });
            return created;
          } else if (created) {
            const found = projects.find((p) => (p.projectName || p.name) === projectName || p.name === name);
            if (found) setSelectedProjectId(found.id);
            showAlert({ title: "Project saved successfully", type: "success" });
            return true;
          }
          return false;
        }}
        onUpdateProject={async (id, updates) => {
          await updateProject(id, updates);
          showAlert({ title: "Project details updated successfully", type: "success" });
        }}
        onAddDataSource={(name, type, subtext, config) =>
          addDataSource(name, type, subtext || "", config as any)
        }
        onDeleteProject={(proj) => confirmDeleteProject(proj)}
        pipelineStatuses={pipelineStatuses}
        completionPct={completionPct}
        runStatus={runStatus}
        lastRunTime={lastRunTime}
        activeStage={activeStage}
        stageOutputs={stageOutputs}
        requiresApproval={requiresApproval}
        workflowMessage={workflowMessage}
        isApproving={isApproving}
        isSubmittingWorkflow={isSubmittingWorkflow}
        isPausing={isPausingWorkflow}
        isStopping={isStoppingWorkflow}
        isResuming={isResumingWorkflow}
        isRetrying={isRetryingWorkflow}
        isPaused={isPaused}
        pausedAtPhase={pausedAtPhase}
        approvalNextStep={approvalNextStep}
        isAwaitingResponse={isAwaitingResponse}
        agentThinking={agentThinking}
        showAlert={showAlert}
        onRunSimulation={runSimulation}
        onReRunWorkflow={handleReRunWorkflow}
        onStopWorkflow={handleStopWorkflow}
        onPauseWorkflow={handlePauseWorkflow}
        onResumeWorkflow={handleResumeWorkflow}
        onStageSelect={handleStageSelect}
        onApprove={(override, selectedModels, splitEndDate, predictionHorizon, predictionFrequency, predictionObjectiveStartDate) =>
          handleApprove(
            typeof override === "string" ? override : undefined,
            selectedModels,
            splitEndDate,
            predictionHorizon,
            predictionFrequency,
            predictionObjectiveStartDate
          )
        }
        onRetry={(stepId) => handleRetry(stepId)}
      />
    );
  }

  return (
    <ProjectsListPage
      projects={projects}
      dataSources={dataSources}
      activeWorkspaceId={activeWorkspaceId}
      onOpenProject={openProject}
      onDeleteProject={confirmDeleteProject}
      onCreateProject={() => {
        setSelectedProjectId(null);
        resetPipeline();
        setActiveProjectTab("workflow");
        setView("project");
      }}
      renderIcon={renderConnectorIcon}
    />
  );
}
