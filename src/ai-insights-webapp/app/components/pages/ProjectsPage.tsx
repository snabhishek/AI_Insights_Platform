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
import { PipelineStatus, PipelineStatuses, RunStatus } from "../projects/types";
import { INITIAL_PIPELINE_STATUSES } from "../projects/constants";
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
    stageOutputs?: Record<string, unknown>;
    stageStatuses?: Record<string, string>;
    agentThinking?: Record<string, Array<{ time: string; text: string; done: boolean }>>;
    inspection?: Record<string, unknown>;
    schemaResolution?: Record<string, unknown>;
    dataProfile?: Record<string, unknown>;
    runTimestamp?: string;
  };
}

// ─── Connector icon renderer (shared utility) ───────────────────────────────

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

// ─── View states ──────────────────────────────────────────────────────────────

type View = "list" | "project";

const INITIAL_AGENT_STAGE_STATUSES: Record<string, string> = {
  inspect: "Pending",
  profileData: "Pending",
  resolveSchema: "Pending",
  hierarchyMapper: "Pending",
  featureArchitect: "Pending",
  featureValidator: "Pending",
  exogenousScout: "Pending",
  modelSelection: "Pending",
  trainingConfiguration: "Pending",
  preFlight: "Pending",
  modelTrainingCode: "Pending",
  modelTrainingExec: "Pending",
  modelTraining: "Pending",
  modelEvaluation: "Pending",
  modelValidation: "Pending",
  dataProfile: "Pending",
  schemaResolution: "Pending",
  relationshipBuilder: "Pending",
  formBuilder: "Pending",
  exogenous: "Pending",
  modelSelectionNode: "Pending",
  preFlightNode: "Pending",
  modelTrainingNode: "Pending",
  modelTrainingExecNode: "Pending",
  modelTrainingCodeNode: "Pending",
  modelEvaluationNode: "Pending",
  modelValidationNode: "Pending",
  trainingConfigurationNode: "Pending",
  hierarchyMapperNode: "Pending",
  featureArchitectNode: "Pending",
  featureValidatorNode: "Pending",
};

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

  const [activeProjectTab, setActiveProjectTab] = useState<ProjectTabType>("project-detail");

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
    setActiveProjectTab("project-detail");
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
  const lastCompletedSummaryRef = useRef<string | null>(null);

  const resetPipeline = () => {
    lastCompletedSummaryRef.current = null;
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
    currentStatuses?: PipelineStatuses,
    currentNodeOrStage?: string,
    stageOutputsParam?: Record<string, any>
  ): PipelineStatuses => {
    const next = { ...(currentStatuses || INITIAL_PIPELINE_STATUSES) } as PipelineStatuses;
    if (!stageStatuses && !currentNodeOrStage && !stageOutputsParam) return next;
    stageStatuses = stageStatuses || {};

    const isCompleted = (v?: string) => v === "Completed" || v === "completed" || v === "Success" || v === "success" || v === "ok" || v === "done";
    const isRunning = (v?: string) => v === "In Progress" || v === "in_progress" || v === "in-progress" || v === "Running" || v === "running" || v === "Retrying" || v === "retrying";
    const isStopped = (v?: string) => v === "Stopped" || v === "stopped";

    const getStageStatus = (nodes: string[]): string | undefined => {
      const values = nodes.map((node) => stageStatuses[node]).filter((value): value is string => Boolean(value));
      if (values.some(isStopped)) return "Stopped";
      if (values.some(isRunning)) return "In Progress";
      if (values.some(isCompleted)) return "Completed";
      if (values.some((value) => value === "Failed" || value === "failed" || value === "Pending" || value === "pending")) {
        return "Pending";
      }
      return undefined;
    };

    const mapStage = (nodes: string[], label: string) => {
      const status = getStageStatus(nodes);
      if (status) next[label] = status as PipelineStatus;
    };

    mapStage(["inspect"], "Data Inspection");
    mapStage(["profileData", "dataProfile"], "Data Profiling");
    mapStage(["resolveSchema", "schemaResolution"], "Schema Resolver");
    mapStage(["hierarchyMapper", "hierarchyMapperNode", "relationshipBuilder", "formBuilder"], "Hierarchy Mapper");
    mapStage(["featureArchitect", "featureArchitectNode"], "Feature Architect");
    mapStage(["featureValidator", "featureValidatorNode"], "Feature Validator");
    mapStage(["exogenousScout", "exogenous"], "Exogenous Scout");
    mapStage(["modelSelection", "modelSelectionNode"], "Model Selection");
    mapStage(["trainingConfiguration", "trainingConfigurationNode", "datasetAnalyserAgent", "datasetAnalyserNode"], "Training Configuration");
    mapStage(["preFlight", "preFlightNode"], "Pre Flight");
    mapStage([
      "modelTrainingCode", "modelTrainingCodeNode", "modelTrainingExec", "modelTrainingExecNode",
      "modelTraining", "modelTrainingNode", "modelEvaluation", "modelEvaluationNode",
    ], "Model Training");
    mapStage(["modelValidation", "modelValidationNode"], "Model Validation");

    // Output presence confirmation
    if (stageOutputsParam) {
      if (stageOutputsParam.inspection) next["Data Inspection"] = "Completed";
      if (stageOutputsParam.dataProfile) next["Data Profiling"] = "Completed";
      if (stageOutputsParam.schemaResolution) next["Schema Resolver"] = "Completed";
      if (stageOutputsParam.hierarchyMapper) next["Hierarchy Mapper"] = "Completed";
      if (stageOutputsParam.featureArchitect) next["Feature Architect"] = "Completed";
      if (stageOutputsParam.featureValidator) next["Feature Validator"] = "Completed";
      if (stageOutputsParam.exogenousScout || stageOutputsParam.exogenous) next["Exogenous Scout"] = "Completed";
      if (stageOutputsParam.modelSelection) next["Model Selection"] = "Completed";
      if (stageOutputsParam.trainingConfiguration?.contractPath) next["Training Configuration"] = "Completed";
      if (stageOutputsParam.preFlight) next["Pre Flight"] = "Completed";
      if (stageOutputsParam.modelTraining) next["Model Training"] = "Completed";
    }

    // Ingestion completion: if resolveSchema is completed or both inspect & profileData completed without active running
    const inspectStatus = getStageStatus(["inspect"]) || (stageOutputsParam?.inspection ? "Completed" : undefined);
    const profileStatus = getStageStatus(["profileData", "dataProfile"]) || (stageOutputsParam?.dataProfile ? "Completed" : undefined);
    const schemaStatus = getStageStatus(["resolveSchema", "schemaResolution"]) || (stageOutputsParam?.schemaResolution ? "Completed" : undefined);
    const isDIRunning = isRunning(inspectStatus) || isRunning(profileStatus) || isRunning(schemaStatus);
    const isDIDone = !isDIRunning && (
      isCompleted(schemaStatus) ||
      (isCompleted(inspectStatus) && isCompleted(profileStatus))
    );

    if (isDIDone) {
      next["Data Inspection"] = "Completed";
      next["Data Profiling"] = "Completed";
      next["Schema Resolver"] = "Completed";
      next["Data Ingestion"] = "Completed";
    }

    // Feature Engineering composite status
    const hmVal = getStageStatus(["hierarchyMapper", "hierarchyMapperNode", "relationshipBuilder", "formBuilder"]) || (stageOutputsParam?.hierarchyMapper ? "Completed" : undefined);
    const faVal = getStageStatus(["featureArchitect", "featureArchitectNode"]) || (stageOutputsParam?.featureArchitect ? "Completed" : undefined);
    const fvVal = getStageStatus(["featureValidator", "featureValidatorNode"]) || (stageOutputsParam?.featureValidator ? "Completed" : undefined);
    const exoVal = getStageStatus(["exogenousScout", "exogenous"]) || (stageOutputsParam?.exogenousScout || stageOutputsParam?.exogenous ? "Completed" : undefined);

    const isFERunning = isRunning(hmVal) || isRunning(faVal) || isRunning(fvVal) || isRunning(exoVal);
    const isFEDone = isCompleted(hmVal) && isCompleted(faVal) && (isCompleted(exoVal) || isCompleted(fvVal));

    if (isFERunning) {
      next["Feature Engineering"] = "In Progress";
    } else if (isFEDone) {
      next["Feature Engineering"] = "Completed";
    } else if (isCompleted(hmVal) || isCompleted(faVal) || isCompleted(fvVal) || isCompleted(exoVal)) {
      next["Feature Engineering"] = "In Progress";
    }

    const isFEActiveOrDone = isFERunning || isFEDone || isCompleted(hmVal) || isCompleted(faVal) || isCompleted(fvVal) || isCompleted(exoVal);

    // If Model Selection / Training / Validation is active or completed, earlier phases are guaranteed Completed
    // ONLY if Data Ingestion or Feature Engineering is NOT currently running.
    const isModelPhaseActiveOrDone =
      !isDIRunning &&
      !isFERunning &&
      (isCompleted(stageStatuses.modelSelection) ||
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
        isCompleted(stageStatuses.modelTrainingCode) ||
        isRunning(stageStatuses.modelTrainingCode) ||
        isCompleted(stageStatuses.modelTrainingCodeNode) ||
        isRunning(stageStatuses.modelTrainingCodeNode) ||
        isCompleted(stageStatuses.modelTrainingExec) ||
        isRunning(stageStatuses.modelTrainingExec) ||
        isCompleted(stageStatuses.modelTrainingExecNode) ||
        isRunning(stageStatuses.modelTrainingExecNode) ||
        isCompleted(stageStatuses.modelTraining) ||
        isRunning(stageStatuses.modelTraining) ||
        isCompleted(stageStatuses.modelTrainingNode) ||
        isRunning(stageStatuses.modelTrainingNode) ||
        isCompleted(stageStatuses.modelEvaluation) ||
        isRunning(stageStatuses.modelEvaluation) ||
        isCompleted(stageStatuses.modelEvaluationNode) ||
        isRunning(stageStatuses.modelEvaluationNode) ||
        isCompleted(stageStatuses.modelValidation) ||
        isRunning(stageStatuses.modelValidation) ||
        isCompleted(stageStatuses.modelValidationNode) ||
        isRunning(stageStatuses.modelValidationNode) ||
        Boolean(stageOutputsParam?.modelSelection) ||
        Boolean(stageOutputsParam?.trainingConfiguration) ||
        Boolean(stageOutputsParam?.preFlight) ||
        Boolean(stageOutputsParam?.modelTraining));

    if (isFEActiveOrDone || isModelPhaseActiveOrDone) {
      next["Data Inspection"] = "Completed";
      next["Data Profiling"] = "Completed";
      next["Schema Resolver"] = "Completed";
      next["Data Ingestion"] = "Completed";
    }

    if (isModelPhaseActiveOrDone) {
      next["Hierarchy Mapper"] = "Completed";
      next["Feature Architect"] = "Completed";
      next["Feature Validator"] = "Completed";
      next["Exogenous Scout"] = "Completed";
      next["Feature Engineering"] = "Completed";
    }

    // Model sub-step cascaded completion:
    if (
      isCompleted(stageStatuses.trainingConfiguration) ||
      isRunning(stageStatuses.trainingConfiguration) ||
      isCompleted(stageStatuses.trainingConfigurationNode) ||
      isRunning(stageStatuses.trainingConfigurationNode) ||
      Boolean(stageOutputsParam?.trainingConfiguration?.contractPath)
    ) {
      next["Model Selection"] = "Completed";
    }

    if (
      isCompleted(stageStatuses.preFlight) ||
      isRunning(stageStatuses.preFlight) ||
      isCompleted(stageStatuses.preFlightNode) ||
      isRunning(stageStatuses.preFlightNode) ||
      Boolean(stageOutputsParam?.preFlight)
    ) {
      next["Model Selection"] = "Completed";
      next["Training Configuration"] = "Completed";
    }

    if (
      isCompleted(stageStatuses.modelTraining) ||
      isRunning(stageStatuses.modelTraining) ||
      isCompleted(stageStatuses.modelTrainingNode) ||
      isRunning(stageStatuses.modelTrainingNode) ||
      isCompleted(stageStatuses.modelTrainingExec) ||
      isRunning(stageStatuses.modelTrainingExec) ||
      isCompleted(stageStatuses.modelTrainingCode) ||
      isRunning(stageStatuses.modelTrainingCode) ||
      Boolean(stageOutputsParam?.modelTraining)
    ) {
      next["Model Selection"] = "Completed";
      next["Training Configuration"] = "Completed";
      next["Pre Flight"] = "Completed";
    }

    const hasStoppedStage = Object.values(stageStatuses).some(isStopped);
    if (hasStoppedStage) {
      for (const [stage, status] of Object.entries(next)) {
        if (status === "In Progress") next[stage] = "Stopped";
      }
    }

    // Some workflow updates identify the active node separately from stageStatuses.
    // Use it to keep the matching modal substep visibly running.
    const activeStepByNode: Record<string, string> = {
      inspect: "Data Inspection",
      profileData: "Data Profiling",
      resolveSchema: "Schema Resolver",
      "Data Inspection": "Data Inspection",
      "Data Profiling": "Data Profiling",
      "Schema Resolver": "Schema Resolver",
      hierarchyMapper: "Hierarchy Mapper",
      hierarchyMapperNode: "Hierarchy Mapper",
      featureArchitect: "Feature Architect",
      featureArchitectNode: "Feature Architect",
      featureValidator: "Feature Validator",
      featureValidatorNode: "Feature Validator",
      exogenous: "Exogenous Scout",
      exogenousScout: "Exogenous Scout",
      modelSelection: "Model Selection",
      modelSelectionNode: "Model Selection",
      trainingConfiguration: "Training Configuration",
      trainingConfigurationNode: "Training Configuration",
      preFlight: "Pre Flight",
      preFlightNode: "Pre Flight",
      modelTraining: "Model Training",
      modelTrainingNode: "Model Training",
      modelTrainingExec: "Model Training",
      modelTrainingExecNode: "Model Training",
      modelValidation: "Model Validation",
      modelValidationNode: "Model Validation",
    };
    const activeStep = currentNodeOrStage ? activeStepByNode[currentNodeOrStage] : undefined;
    if (
      activeStep &&
      next[activeStep] !== "Completed" &&
      !hasStoppedStage &&
      !(activeStep === "Data Inspection" && isDIDone) &&
      !(activeStep === "Data Inspection" && (isFEActiveOrDone || isModelPhaseActiveOrDone)) &&
      !(activeStep === "Hierarchy Mapper" && isModelPhaseActiveOrDone) &&
      !(activeStep === "Model Selection" && (isCompleted(stageStatuses.trainingConfiguration) || Boolean(stageOutputsParam?.trainingConfiguration?.contractPath)))
    ) {
      next[activeStep] = "In Progress";
    }

    return next;
  };

  const determineActiveStage = (payload: Partial<WorkflowResponse["data"]>): string => {
    const stageOutputs = payload.stageOutputs as Record<string, any> | undefined;
    const stageStatuses = payload.stageStatuses as Record<string, any> | undefined;
    const currentNode = (payload.currentNode || payload.currentStage || "").trim();
    const nextStep = (payload.nextStep || "").toLowerCase().trim();

    // 1. Direct currentNode mapping (highest priority: current actively executing or paused node)
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

    // 2. Explicit nextStep approval / resume targets
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

    // 3. Fallback to latest outputs or stageStatuses in reverse lifecycle order
    if (
      stageStatuses?.modelValidation === "In Progress" ||
      stageStatuses?.modelValidation === "Completed" ||
      stageStatuses?.modelValidationNode === "In Progress" ||
      stageStatuses?.modelValidationNode === "Completed" ||
      stageOutputs?.modelValidation
    ) {
      return "Model Validation";
    }
    if (
      stageStatuses?.modelTraining === "In Progress" ||
      stageStatuses?.modelTraining === "Completed" ||
      stageStatuses?.modelTrainingNode === "In Progress" ||
      stageStatuses?.modelTrainingNode === "Completed" ||
      stageStatuses?.modelTrainingExec === "In Progress" ||
      stageStatuses?.modelTrainingExec === "Completed" ||
      stageStatuses?.modelTrainingExecNode === "In Progress" ||
      stageStatuses?.modelTrainingExecNode === "Completed" ||
      stageStatuses?.modelEvaluation === "In Progress" ||
      stageStatuses?.modelEvaluation === "Completed" ||
      stageStatuses?.modelEvaluationNode === "In Progress" ||
      stageStatuses?.modelEvaluationNode === "Completed" ||
      stageStatuses?.modelTrainingCode === "In Progress" ||
      stageStatuses?.modelTrainingCode === "Completed" ||
      stageStatuses?.modelTrainingCodeNode === "In Progress" ||
      stageStatuses?.modelTrainingCodeNode === "Completed" ||
      stageOutputs?.modelTraining ||
      stageOutputs?.modelTrainingCode
    ) {
      return "Model Training";
    }
    if (
      stageStatuses?.preFlight === "In Progress" ||
      stageStatuses?.preFlight === "Completed" ||
      stageStatuses?.preFlightNode === "In Progress" ||
      stageStatuses?.preFlightNode === "Completed" ||
      stageOutputs?.preFlight
    ) {
      return "Pre Flight";
    }
    if (
      stageStatuses?.trainingConfiguration === "In Progress" ||
      stageStatuses?.trainingConfiguration === "Completed" ||
      stageStatuses?.trainingConfigurationNode === "In Progress" ||
      stageStatuses?.trainingConfigurationNode === "Completed" ||
      stageOutputs?.trainingConfiguration
    ) {
      return "Training Configuration";
    }
    if (
      stageStatuses?.modelSelection === "In Progress" ||
      stageStatuses?.modelSelection === "Completed" ||
      stageStatuses?.modelSelectionNode === "In Progress" ||
      stageStatuses?.modelSelectionNode === "Completed" ||
      stageOutputs?.modelSelection
    ) {
      return "Model Selection";
    }
    if (
      stageStatuses?.exogenousScout === "Completed" ||
      stageStatuses?.exogenousScout === "In Progress" ||
      stageStatuses?.exogenous === "Completed" ||
      stageStatuses?.exogenous === "In Progress" ||
      stageOutputs?.exogenousScout
    ) {
      return "Exogenous Scout";
    }
    if (
      stageStatuses?.featureValidator === "Completed" ||
      stageStatuses?.featureValidator === "In Progress" ||
      stageStatuses?.featureValidatorNode === "Completed" ||
      stageStatuses?.featureValidatorNode === "In Progress" ||
      stageOutputs?.featureValidator
    ) {
      return "Feature Validator";
    }
    if (
      stageStatuses?.featureArchitect === "Completed" ||
      stageStatuses?.featureArchitect === "In Progress" ||
      stageStatuses?.featureArchitectNode === "Completed" ||
      stageStatuses?.featureArchitectNode === "In Progress" ||
      stageOutputs?.featureArchitect
    ) {
      return "Feature Architect";
    }
    if (
      stageStatuses?.hierarchyMapper === "Completed" ||
      stageStatuses?.hierarchyMapper === "In Progress" ||
      stageStatuses?.hierarchyMapperNode === "Completed" ||
      stageStatuses?.hierarchyMapperNode === "In Progress" ||
      stageStatuses?.relationshipBuilder === "Completed" ||
      stageStatuses?.relationshipBuilder === "In Progress" ||
      stageStatuses?.formBuilder === "Completed" ||
      stageStatuses?.formBuilder === "In Progress" ||
      stageOutputs?.hierarchyMapper
    ) {
      return "Hierarchy Mapper";
    }
    if (
      stageStatuses?.resolveSchema === "Completed" ||
      stageStatuses?.resolveSchema === "In Progress" ||
      stageStatuses?.schemaResolution === "Completed" ||
      stageStatuses?.schemaResolution === "In Progress" ||
      stageOutputs?.schemaResolution
    ) {
      return "Schema Resolver";
    }
    if (
      stageStatuses?.profileData === "Completed" ||
      stageStatuses?.profileData === "In Progress" ||
      stageStatuses?.dataProfile === "Completed" ||
      stageStatuses?.dataProfile === "In Progress" ||
      stageOutputs?.dataProfile
    ) {
      return "Data Profiling";
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
      const nextStatuses = mapStageToPipelineStatus(
        state.stageStatuses,
        pipelineStatuses,
        state.currentNode || state.currentStage,
        state.stageOutputs
      );
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
        setRunStatus("Paused");
        setIsPaused(false);
        setRequiresApproval(true);
        setApprovalNextStep("Training Configuration");
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
              setPipelineStatuses((prev) =>
                mapStageToPipelineStatus(
                  freshState.stageStatuses,
                  prev,
                  freshState.currentNode || freshState.currentStage,
                  freshState.stageOutputs
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

        setPipelineStatuses((prev) =>
          mapStageToPipelineStatus(
            freshState.stageStatuses,
            prev,
            freshState.currentNode || freshState.currentStage,
            freshState.stageOutputs
          )
        );
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
          isExecutingRef.current = false;
          setRunStatus("Success");
          setIsPaused(false);
          setRequiresApproval(false);
          setApprovalNextStep(null);
          clearInterval(interval);
          const completionMsg = freshState.summary || "Workflow completed successfully";
          if (lastCompletedSummaryRef.current !== completionMsg) {
            lastCompletedSummaryRef.current = completionMsg;
            showAlert({ title: completionMsg, type: "success" });
          }
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
            setRunStatus("Paused");
            setIsPaused(false);
            setRequiresApproval(true);
            setApprovalNextStep("Training Configuration");
          } else if (freshState.requiresApproval) {
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
          // resetPipeline()
        }
      } catch (pollErr) {
        console.warn("[ProjectsPage] Background poll sync error:", pollErr);
      }
    }, 5000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [selectedProjectId, runStatus, isApproving, activeWorkspaceId]);

  const updateWorkflowState = (payload: WorkflowResponse["data"]) => {
    setPipelineStatuses((prev) => {
      const nextStatuses = mapStageToPipelineStatus(
        payload.stageStatuses,
        prev,
        payload.currentNode || payload.currentStage,
        payload.stageOutputs
      );
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
      setRunStatus("Paused");
      setIsPaused(false);
      setRequiresApproval(true);
      setApprovalNextStep("Training Configuration");
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
      // Always keep local projects state in sync so re-entering the project has the latest data immediately
      setProjects((prev) => prev.map((project) => {
        if (project.id !== targetProjectId) return project;
        const existingAgentState = (project.agentState as Record<string, unknown>) || {};
        return {
          ...project,
          status: payload.status || "running",
          agentState: {
            ...existingAgentState,
            ...payload,
            runTimestamp: payload.runTimestamp || existingAgentState.runTimestamp,
          },
        };
      }));

      // Local state is updated above; backend persists state directly to the database during workflow execution
    }
  };

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
      // ignore active check network error
    }

    if (isExecutingRef.current) return;
    isExecutingRef.current = true;
    activeRunningProjectIdRef.current = selectedProject.id;
    lastCompletedSummaryRef.current = null;

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
      if (action === "resume") {
        await updateProject(selectedProject.id, {
          status: "running",
          agentState: {
            ...((selectedProject.agentState as Record<string, unknown>) || {}),
            status: "running",
          },
        });
      }
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
        "Feature Engineering": "Pending",
        "Model Selection": "Pending",
        "Training Configuration": "Pending",
        "Pre Flight": "Pending",
        "Model Training": "Pending",
        "Model Evaluation": "Pending",
        "Model Validation": "Pending",
      });
      // Clear pause state when starting fresh
      setIsPaused(false);
      setPausedAtPhase(null);
      setPausedStateSnapshot(null);
      setPausedSessionId(null);
    }
    let lastData: any = null;
    try {
      const effectiveSplitDate = splitEndDate || selectedProject?.splitDate || (selectedProject?.agentState as any)?.splitDate;
      const effectiveSplitEndDate = splitEndDate || selectedProject?.splitDate || (selectedProject?.agentState as any)?.splitEndDate;

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
        setRunStatus("Success");
        setIsPaused(false);
        setRequiresApproval(false);
        setApprovalNextStep(null);
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
      // if (lastData && (lastData.status === "completed" || lastData.stageStatuses?.resolveSchema === "Completed")) {
      //   updateWorkflowState(lastData);
      //   const completionMsg = lastData.summary || "Data Ingestion completed successfully";
      //   if (lastCompletedSummaryRef.current !== completionMsg) {
      //     lastCompletedSummaryRef.current = completionMsg;
      //     showAlert({ title: completionMsg, type: "success" });
      //   }
      //   return;
      // }
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
      // Stream complete; backend has persisted final/paused state
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

    setRunStatus("Stopped");
    setWorkflowMessage("Workflow stopped by user");
    const stoppedAt = new Date().toISOString();
    const targetProject = projects.find((project) => project.id === currentProjectId);
    const existingAgentState = (targetProject?.agentState as Record<string, any>) || {};
    const stoppedStageStatuses = { ...(existingAgentState.stageStatuses || {}) };
    for (const [stage, status] of Object.entries(stoppedStageStatuses)) {
      if (status === "In Progress" || status === "Running" || status === "Retrying" || status === "running") {
        stoppedStageStatuses[stage] = "Stopped";
      }
    }

    const stoppedState = {
      ...existingAgentState,
      status: "stopped",
      summary: "Workflow stopped by user",
      message: "Workflow stopped by user",
      sessionId: currentSession || existingAgentState.sessionId,
      requiresApproval: false,
      nextStep: undefined,
      stageStatuses: stoppedStageStatuses,
      lastRunTime: stoppedAt,
    };

    setPipelineStatuses((prev) => Object.fromEntries(
      Object.entries(prev).map(([stage, status]) => [stage, status === "In Progress" ? "Stopped" : status])
    ) as PipelineStatuses);
    setLastRunTime(new Date(stoppedAt).toLocaleString("en-US", {
      month: "short",
      day: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    }));

    if (currentProjectId) {
      setProjects((prev) => prev.map((project) => project.id === currentProjectId
        ? { ...project, status: "stopped", agentState: stoppedState }
        : project));
    }

    void (async () => {
      if (currentSession || currentProjectId) {
        await stopWorkflowApi(currentSession || undefined, currentProjectId);
      }
      if (currentProjectId) {
        await updateProject(currentProjectId, { status: "stopped", agentState: stoppedState });
      }
    })();

    showAlert({
      title: "Workflow Stopped",
      message: "",
      type: "info",
    });
  };

  const runSimulation = () => {
    void runWorkflow();
  };

  const handleApprove = (
    overrideTargetPhase?: unknown,
    selectedModels?: string[],
    splitEndDate?: string,
    predictionHorizon?: number,
    predictionFrequency?: string,
    predictionObjectiveStartDate?: string
  ) => {
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

  const handleRetry = async (step?: string) => {
    const rawStep = step || activeStage || "inspect";
    const phase = SUBSTEP_TO_PIPELINE_MAP[rawStep] || PIPELINE_PHASES.MODEL_TRAINING_VALIDATION;

    let rootNode: string;
    const statusesToUpdate: Record<string, PipelineStatus> = {};
    const outputsToClear: string[] = [];

    if (phase === PIPELINE_PHASES.DATA_INGESTION) {
      rootNode = "inspect";
      statusesToUpdate["Data Ingestion"] = "In Progress";
      statusesToUpdate["Data Inspection"] = "In Progress";
      statusesToUpdate["Data Profiling"] = "Pending";
      statusesToUpdate["Schema Resolver"] = "Pending";
      statusesToUpdate["Feature Engineering"] = "Pending";
      statusesToUpdate["Hierarchy Mapper"] = "Pending";
      statusesToUpdate["Feature Architect"] = "Pending";
      statusesToUpdate["Feature Validator"] = "Pending";
      statusesToUpdate["Exogenous Scout"] = "Pending";
      statusesToUpdate["Model Training & Validation"] = "Pending";
      statusesToUpdate["Model Selection"] = "Pending";
      statusesToUpdate["Training Configuration"] = "Pending";
      statusesToUpdate["Pre Flight"] = "Pending";
      statusesToUpdate["Model Training"] = "Pending";
      statusesToUpdate["Model Validation"] = "Pending";
      outputsToClear.push(
        "inspect", "profileData", "resolveSchema", "schemaResolution", "dataProfile", "inspection",
        "hierarchyMapper", "hierarchyMapperNode", "relationshipBuilder", "formBuilder",
        "featureArchitect", "featureArchitectNode", "featureValidator", "featureValidatorNode",
        "exogenousScout", "exogenous", "modelSelection", "modelSelectionNode",
        "trainingConfiguration", "trainingConfigurationNode", "preFlight", "preFlightNode",
        "modelTrainingCode", "modelTrainingCodeNode", "modelTrainingExec", "modelTrainingExecNode",
        "modelTraining", "modelTrainingNode", "modelEvaluation", "modelEvaluationNode",
        "modelValidation", "modelValidationNode"
      );
    } else if (phase === PIPELINE_PHASES.FEATURE_ENGINEERING) {
      rootNode = "hierarchyMapperNode";
      statusesToUpdate["Data Ingestion"] = "Completed";
      statusesToUpdate["Data Inspection"] = "Completed";
      statusesToUpdate["Data Profiling"] = "Completed";
      statusesToUpdate["Schema Resolver"] = "Completed";
      statusesToUpdate["Feature Engineering"] = "In Progress";
      statusesToUpdate["Hierarchy Mapper"] = "In Progress";
      statusesToUpdate["Feature Architect"] = "Pending";
      statusesToUpdate["Feature Validator"] = "Pending";
      statusesToUpdate["Exogenous Scout"] = "Pending";
      statusesToUpdate["Model Training & Validation"] = "Pending";
      statusesToUpdate["Model Selection"] = "Pending";
      statusesToUpdate["Training Configuration"] = "Pending";
      statusesToUpdate["Pre Flight"] = "Pending";
      statusesToUpdate["Model Training"] = "Pending";
      statusesToUpdate["Model Validation"] = "Pending";
      outputsToClear.push(
        "hierarchyMapper", "hierarchyMapperNode", "relationshipBuilder", "formBuilder",
        "featureArchitect", "featureArchitectNode", "featureValidator", "featureValidatorNode",
        "exogenousScout", "exogenous", "modelSelection", "modelSelectionNode",
        "trainingConfiguration", "trainingConfigurationNode", "preFlight", "preFlightNode",
        "modelTrainingCode", "modelTrainingCodeNode", "modelTrainingExec", "modelTrainingExecNode",
        "modelTraining", "modelTrainingNode", "modelEvaluation", "modelEvaluationNode",
        "modelValidation", "modelValidationNode"
      );
    } else {
      // Model Training & Validation stage -> full stage retry from root node modelSelectionNode!
      rootNode = "modelSelectionNode";
      statusesToUpdate["Data Ingestion"] = "Completed";
      statusesToUpdate["Data Inspection"] = "Completed";
      statusesToUpdate["Data Profiling"] = "Completed";
      statusesToUpdate["Schema Resolver"] = "Completed";
      statusesToUpdate["Feature Engineering"] = "Completed";
      statusesToUpdate["Hierarchy Mapper"] = "Completed";
      statusesToUpdate["Feature Architect"] = "Completed";
      statusesToUpdate["Feature Validator"] = "Completed";
      statusesToUpdate["Exogenous Scout"] = "Completed";
      statusesToUpdate["Model Training & Validation"] = "In Progress";
      statusesToUpdate["Model Selection"] = "In Progress";
      statusesToUpdate["Training Configuration"] = "Pending";
      statusesToUpdate["Pre Flight"] = "Pending";
      statusesToUpdate["Model Training"] = "Pending";
      statusesToUpdate["Model Validation"] = "Pending";
      outputsToClear.push(
        "modelSelection", "modelSelectionNode", "trainingConfiguration", "trainingConfigurationNode",
        "preFlight", "preFlightNode", "modelTrainingCode", "modelTrainingCodeNode",
        "modelTrainingExec", "modelTrainingExecNode", "modelTraining", "modelTrainingNode",
        "modelEvaluation", "modelEvaluationNode", "modelValidation", "modelValidationNode"
      );
    }

    setPipelineStatuses((prev) => ({
      ...prev,
      ...statusesToUpdate,
    }));

    setStageOutputs((prev) => {
      const next = { ...prev };
      for (const key of outputsToClear) {
        delete next[key];
      }
      return next;
    });

    const agentState = { ...((selectedProject?.agentState as Record<string, any>) || {}) };
    const agentStageOutputs = { ...((agentState.stageOutputs as Record<string, unknown>) || {}) };
    const stageStatuses = { ...((agentState.stageStatuses as Record<string, string>) || {}) };
    for (const key of outputsToClear) {
      delete agentState[key];
      delete agentStageOutputs[key];
      if (key in INITIAL_AGENT_STAGE_STATUSES) stageStatuses[key] = "Pending";
    }
    if (rootNode === "inspect") {
      stageStatuses.inspect = "In Progress";
    } else if (rootNode === "hierarchyMapperNode") {
      stageStatuses.hierarchyMapper = "In Progress";
      stageStatuses.hierarchyMapperNode = "In Progress";
    } else {
      stageStatuses.modelSelection = "In Progress";
      stageStatuses.modelSelectionNode = "In Progress";
    }
    const resetAgentState = {
      ...agentState,
      status: "running",
      stageOutputs: agentStageOutputs,
      stageStatuses,
    };
    setProjects((prev) => prev.map((project) => project.id === selectedProject?.id
      ? { ...project, status: "running", agentState: resetAgentState }
      : project));

    setRequiresApproval(false);
    setIsAwaitingResponse(false);
    setApprovalNextStep(null);
    setRunStatus("Running");

    if (selectedProject) {
      await updateProject(selectedProject.id, {
        status: "running",
        agentState: resetAgentState,
        replaceAgentState: true,
      });
    }
    void runWorkflow("retry", rootNode);
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
      const existingAgentState = (selectedProject?.agentState as Record<string, any>) || {};
      const isAwaitingApproval = requiresApproval || isAwaitingResponse || approvalNextStep != null;
      void updateProject(currentProjectId, {
        status: "paused",
        agentState: {
          ...existingAgentState,
          stageOutputs: {
            ...(existingAgentState.stageOutputs || {}),
            ...stageOutputs,
          },
          status: "paused",
          summary: isAwaitingApproval
            ? (existingAgentState.summary || `Workflow waiting for approval at ${approvalNextStep || activeStage || "current"} phase`)
            : `Workflow paused at ${activeStage || "inspect"} phase`,
          message: isAwaitingApproval
            ? (existingAgentState.message || `Waiting for approval before ${approvalNextStep || activeStage || "current"} phase.`)
            : `Paused mid-phase. Ready to resume from ${activeStage || "current"} phase.`,
          sessionId: currentSession || undefined,
          requiresApproval: isAwaitingApproval,
          nextStep: approvalNextStep || existingAgentState.nextStep,
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
      "Feature Engineering": "Pending",
      "Model Selection": "Pending",
      "Training Configuration": "Pending",
      "Pre Flight": "Pending",
      "Model Training": "Pending",
      "Model Evaluation": "Pending",
      "Model Validation": "Pending",
    });

    // Cleanly clear project agentState in database so stale training configs don't leak into new run
    await updateProject(selectedProject.id, {
      status: "idle",
      agentState: {
        status: "idle",
        stageOutputs: {},
        stageStatuses: INITIAL_AGENT_STAGE_STATUSES,
      },
      replaceAgentState: true,
    });

    void runWorkflow(undefined, undefined, validUseCase ?? selectedProject.useCase);
  };

  // ── Navigation helpers ────────────────────────────────────────────────────

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

  // ── Render ────────────────────────────────────────────────────────────────

  if (view === "project") {
    return (
      <ProjectWorkspace
        project={selectedProject}
        dataSources={dataSources}
        userProfile={userProfile}
        activeProjectTab={activeProjectTab}
        onTabChange={(tab) => setActiveProjectTab(tab)}
        onGoToList={goToList}
        onSaveProject={async (name, useCase, sources, domain, subDomain) => {
          const created = await addProject(name, "OWNER", sources, useCase, domain, subDomain);
          if (created && typeof created === "object" && "id" in created) {
            setSelectedProjectId(created.id);
            showAlert({ title: "Project saved successfully", type: "success" });
            return created;
          } else if (created) {
            const found = projects.find((p) => p.name === name);
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

  // Default: list view
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
