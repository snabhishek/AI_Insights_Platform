import { setMaxListeners } from "events";
import { MemorySaver } from "@langchain/langgraph";
import { ConnectorService } from "../../connector/connector.service";
import { ConnectionTesterService } from "../../connector/connectionTester.service";
import { IIngestionAgentService, IngestionAgentRunResult } from "./ingestionAgent.service.interface";
import { IFileService } from "../../file/file.service.interface";
import { ProjectService } from "../../project/project.service";
import { createAgentGraph } from "../../../agents/graph";
import {
  AgentTraceHelper,
  buildMessage,
  buildResultFromGraphState,
  mapRetryStepToInterruptNode
} from "../../../agents/utils/agentUtils";
import { AgentState, WorkflowSessionMeta } from "../../../agents/state";
import {
  applyPauseToStageStatuses,
  applyResumeToStageStatuses,
  buildGroupedStageStatuses,
  findPausedStep,
  FlatStageStatuses,
  INITIAL_STAGE_STATUSES,
  LEGACY_AGENT_KEY_ALIASES,
  NODE_CONFIG,
  normalizeFlatStageStatuses,
  normalizePipelineStepStatus,
  normalizeStageOutputs,
  PipelineStepStatus,
  StageKey,
  TrackedAgentKey,
  WorkflowAgentState,
} from "../../../agents/pipelineNames";
import { IAgentThinkingService } from "../agent-thinking/agentThinking.service.interface";
import { QueueService } from "../../queue/queue.service";
import { agentJobEvents } from "../../queue/queueEvents";
import { generateDateTimeStamp, ensureProjectRunFolder, getLatestProjectRunTimestamp, createProjectSchemaFile, syncTrainingConfigSplitDate } from "../../../agents/tools/helpers";
import { registerProjectMetadata } from "../../../agents/tools/filesystem/mcpFilesystemClient";
import { getPipelineForSubstep, resolveSafePredecessorNode, getApprovalGateForNode, getStageRuleByNode } from "../../../agents/pipelineFlowConfig";

const MODEL_RETRY_OUTPUT_KEYS = [
  "modelSelectionNode", "trainingConfigurationNode", "preFlightNode", "modelTrainingCodeNode",
  "modelTrainingExecNode",
];

const FEATURE_RETRY_OUTPUT_KEYS = [
  "hierarchyMapperNode", "featureArchitectNode", "featureValidatorNode", "exogenous",
  ...MODEL_RETRY_OUTPUT_KEYS,
];

const MODEL_RETRY_STATE_KEYS = [
  "modelSelectionNode", "trainingConfigurationNode", "preFlightNode", "modelTrainingCodeNode",
  "modelTrainingExecNode",
];

const FEATURE_RETRY_STATE_KEYS = [
  "hierarchyMapperNode", "featureArchitectNode", "featureValidatorNode", "exogenous",
  ...MODEL_RETRY_STATE_KEYS,
];

const INGESTION_RETRY_STATE_KEYS = [
  "inspect", "profileData", "resolveSchema", ...FEATURE_RETRY_STATE_KEYS,
];

function clearRetryStageOutputs(
  stageOutputs: unknown,
  targetNode?: string,
  replaceGraphValue = false
): Record<string, unknown> {
  const outputs = stageOutputs && typeof stageOutputs === "object" && !Array.isArray(stageOutputs)
    ? stageOutputs as Record<string, unknown>
    : {};
  const keysToClear = targetNode === "inspect"
    ? new Set(Object.keys(outputs))
    : new Set(targetNode === "hierarchyMapperNode" ? FEATURE_RETRY_OUTPUT_KEYS : MODEL_RETRY_OUTPUT_KEYS);
  const cleared = Object.fromEntries(Object.entries(outputs).filter(([key]) => !keysToClear.has(key)));
  return replaceGraphValue ? { ...cleared, __replaceStageOutputs: true } : cleared;
}

function getRetryStateOutputKeys(targetNode?: string): string[] {
  if (targetNode === "inspect") return INGESTION_RETRY_STATE_KEYS;
  if (targetNode === "hierarchyMapperNode") return FEATURE_RETRY_STATE_KEYS;
  return MODEL_RETRY_STATE_KEYS;
}

function normalizeRuntimeStageStatuses(value: unknown): FlatStageStatuses {
  const normalized = normalizeFlatStageStatuses(value);
  if (!value || typeof value !== "object" || Array.isArray(value)) return normalized;
  const raw = value as Record<string, unknown>;
  for (const [alias, key] of Object.entries(LEGACY_AGENT_KEY_ALIASES)) {
    const status = normalizePipelineStepStatus(raw[alias]);
    if (status) normalized[key] = status;
  }
  return normalized;
}

const SUBSTEP_THINKING_TEMPLATES: Record<string, string[]> = {
  "Data Ingestion": [
    "Resolving connector properties and verifying credentials...",
    "Connecting to database data sources...",
    "Running metadata table inspection schemas...",
    "Extracting tables list, column structures, and relationships..."
  ],
  "Data Profiling": [
    "Reading data samples from target sources...",
    "Computing column completeness profiles...",
    "Running anomaly detection (outliers, formatting errors)..."
  ],
  "Schema Resolver": [
    "Analyzing target schemas and downstream constraints...",
    "Generating mapping recommendations using LLM semantic alignment..."
  ],
  "Hierarchy Mapper": [
    "Reading Data Ingestion Schema and Domain Knowledge Schema for project...",
    "Running Relationship Builder to extract functional dependencies and hierarchies...",
    "Running Form Builder to generate dynamic hierarchical feature forms..."
  ],
  "Relationship Builder": [
    "Analyzing dataset schemas and domain rules for functional dependencies...",
    "Extracting parent-child key relationships and hierarchical structures..."
  ],
  "Form Builder": [
    "Mapping functional dependencies into structured feature fields...",
    "Building dynamic hierarchical form schemas..."
  ],
  "Exogenous Scout": [
    "Analyzing internal dataset schemas and domain context...",
    "Searching web for relevant external APIs, public datasets, and economic indicators...",
    "Scouting and ranking exogenous feature candidates by predictive power..."
  ],
  "Feature Architect": [
    "Analyzing table relationships and candidate features...",
    "Generating feature creation and transformation pipeline code...",
    "Assembling unified feature matrix and performing data validation...",
    "Executing feature extraction and selection algorithms in sandbox..."
  ],
  "Feature Validator": [
    "Auditing feature matrix for target leakage and temporal violations...",
    "Computing Variance Inflation Factors (VIF) and correlation matrices for multicollinearity...",
    "Assessing population stability index (PSI) for feature drift...",
    "Computing permutation importance rankings and emitting validated feature set..."
  ],
  "Feature Engineering": [
    "Discovering domain hierarchies and functional dependencies...",
    "Architecting and transforming candidate features...",
    "Validating features for leakage, multicollinearity, and drift...",
    "Scouting exogenous variables and external dataset signals..."
  ],
  "Model Selection": [
    "Reading validated feature matrix, target entity, and problem definition...",
    "Querying model registry for candidate algorithms matching task subtype...",
    "Evaluating dataset size, grain, sparsity, and temporal horizons...",
    "Formulating candidate model rankings and generating decision reasoning..."
  ],
  "Training Configuration": [
    "Configuring train/validation/test split ratios and CV folds...",
    "Preparing feature encoders and model hyperparameter search spaces...",
    "Setting up training execution environment and hardware resources..."
  ],
  "Pre Flight": [
    "Validating compute accelerators, system memory, and runtime environment...",
    "Verifying dataset partitions and asynchronous DataLoader configurations...",
    "Auditing data optimization strategies and pre-flight execution readiness..."
  ],
  "Model Training": [
    "Fitting candidate models against training partitions...",
    "Executing hyperparameter optimization trials...",
    "Recording intermediate loss and convergence diagnostics..."
  ],
  "Model Validation": [
    "Evaluating candidate models on held-out validation dataset...",
    "Computing out-of-sample metrics (RMSE, MAE, R², F1, AUC-ROC)...",
    "Running baseline model comparison and selecting champion model..."
  ]
};

class PushQueue<T> {
  private queue: T[] = [];
  private resolvers: Array<(value: IteratorResult<T>) => void> = [];
  private isDone = false;

  push(item: T) {
    if (this.resolvers.length > 0) {
      const resolve = this.resolvers.shift()!;
      resolve({ value: item, done: false });
    } else {
      this.queue.push(item);
    }
  }

  close() {
    this.isDone = true;
    for (const resolve of this.resolvers) {
      resolve({ value: undefined as any, done: true });
    }
    this.resolvers = [];
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<T, void, unknown> {
    while (true) {
      if (this.queue.length > 0) {
        yield this.queue.shift()!;
      } else if (this.isDone) {
        return;
      } else {
        const res = await new Promise<IteratorResult<T>>((r) => this.resolvers.push(r));
        if (res.done) return;
        yield res.value;
      }
    }
  }
}

export class IngestionAgentService implements IIngestionAgentService {
  private checkpointer = new MemorySaver();
  private sessionMeta = new Map<string, WorkflowSessionMeta>();
  private stoppedSessions = new Set<string>();
  private pausedSessions = new Set<string>();
  private sessionAbortControllers = new Map<string, AbortController>();
  private traceHelper = new AgentTraceHelper();
  private activeRuns = new Map<string, { threadId: string; projectId?: string; startedAt: string }>();

  findSessionIdForProject(projectId?: string): string | undefined {
    if (!projectId) return undefined;
    for (const [sessionId, r] of this.activeRuns.entries()) {
      if (r.projectId === projectId) {
        return sessionId;
      }
    }
    for (const [sessionId, meta] of this.sessionMeta.entries()) {
      if (meta.projectId === projectId && !this.stoppedSessions.has(sessionId)) {
        return sessionId;
      }
    }
    return undefined;
  }

  isProjectActive(projectId?: string): boolean {
    if (!projectId) return false;
    for (const [threadId, run] of this.activeRuns.entries()) {
      if (run.projectId === projectId && !this.stoppedSessions.has(threadId) && !this.pausedSessions.has(threadId)) {
        return true;
      }
    }
    for (const [sessionId, meta] of this.sessionMeta.entries()) {
      if (meta.projectId === projectId && !this.stoppedSessions.has(sessionId) && !this.pausedSessions.has(sessionId)) {
        return true;
      }
    }
    return false;
  }

  getActiveWorkflow(): { active: boolean; projectId: string | null; sessionId: string | null; status: PipelineStepStatus } {
    for (const [threadId, run] of this.activeRuns.entries()) {
      if (!this.stoppedSessions.has(threadId) && !this.pausedSessions.has(threadId)) {
        return {
          active: true,
          projectId: run.projectId || null,
          sessionId: threadId,
          status: "In-Progress",
        };
      }
    }
    return { active: false, projectId: null, sessionId: null, status: "None" };
  }

  constructor(
    private connectorService: ConnectorService,
    private connectionTester: ConnectionTesterService,
    private fileService: IFileService,
    private projectService: ProjectService,
    private agentThinkingService: IAgentThinkingService,
    private queueService: QueueService,
    private duckDBService?: any
  ) { }

  async *run(
    connectorId: string[],
    userPrompt?: string,
    options?: {
      sessionId?: string;
      action?: "approve" | "retry" | "resume";
      step?: string;
      projectId?: string;
      splitDate?: string;
      splitEndDate?: string;
      selectedModels?: string[];
      predictionHorizon?: number;
      predictionFrequency?: string;
      predictionObjectiveStartDate?: string;
    }
  ): AsyncGenerator<IngestionAgentRunResult, void, unknown> {
    const traceSession = await this.traceHelper.createTraceSession();
    const runStartedAt = new Date().toISOString();

    if (traceSession) {
      await this.traceHelper.appendTraceEntry("workflow:start", "input", {
        connectorId,
        startedAt: runStartedAt,
        action: options?.action,
        step: options?.step,
        sessionId: options?.sessionId,
      });
    }

    try {
      // Resolve or create the thread ID
      const isNewRun = !options?.action;
      let threadId: string = options?.sessionId || (isNewRun ? `workflow-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` : "");
      if (!threadId) {
        threadId = `workflow-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      }
      let meta = this.sessionMeta.get(threadId);

      if (isNewRun) {
        this.checkpointer = new MemorySaver();
        if (this.sessionMeta.size > 10) {
          const keysToDelete = Array.from(this.sessionMeta.keys()).slice(0, this.sessionMeta.size - 5);
          for (const k of keysToDelete) {
            this.sessionMeta.delete(k);
            this.stoppedSessions.delete(k);
          }
        }
        if (typeof global.gc === "function") {
          try { global.gc(); } catch { }
        }
      }

      let workflow = createAgentGraph(this.checkpointer);

      if (!meta) {
        meta = { threadId, connectorId, userPrompt: userPrompt ?? "", projectId: options?.projectId };
        this.sessionMeta.set(threadId, meta);
      } else if (options?.projectId && !meta.projectId) {
        meta.projectId = options.projectId;
        this.sessionMeta.set(threadId, meta);
      }

      const queue = new PushQueue<IngestionAgentRunResult>();

      let latestGraphStateValues: any = {
        status: "In-Progress",
        summary: "Ingestion workflow running",
        inspection: {},
        dataProfile: {},
        schemaResolution: {},
        batchedTables: [],
        steps: [{ name: "Data Ingestion", status: "In-Progress", summary: "Data Ingestion node running..." }],
        stageOutputs: {},
        stageStatuses: { ...INITIAL_STAGE_STATUSES, inspect: "In-Progress" }
      };

      let savedAgentState: AgentState | null = null;
      let resumeTargetStep: string | undefined;
      let resumePredecessorNode: string | undefined;
      let pWs: any = null;
      if (options?.projectId) {
        try {
          pWs = await this.projectService.getProjectWithWorkspace(options.projectId);
          if (pWs?.project?.name) {
            registerProjectMetadata(options.projectId, {
              projectName: pWs.project.name,
              workspaceName: pWs.workspaceName,
              folderPath: pWs.project.folderPath,
            });
          }
          savedAgentState = (pWs?.project?.agentState as any) || null;
          if (options?.action === "resume") {
            resumeTargetStep = findPausedStep(savedAgentState?.stageStatuses, savedAgentState?.currentNode) || options.step;
            resumePredecessorNode = getStageRuleByNode(resumeTargetStep)?.predecessorNode;
          }
          if (savedAgentState && (options?.action === "resume" || options?.action === "retry" || options?.action === "approve")) {
            latestGraphStateValues = {
              ...savedAgentState,
              stageStatuses: normalizeFlatStageStatuses(
                options?.action === "resume"
                  ? applyResumeToStageStatuses(savedAgentState.stageStatuses, resumeTargetStep)
                  : savedAgentState.stageStatuses
              ),
              stageOutputs: options?.action === "resume" && resumePredecessorNode === "__start__"
                ? {}
                : normalizeStageOutputs(savedAgentState.stageOutputs),
              status: "In-Progress",
              currentNode: options?.action === "resume"
                ? (resumeTargetStep || savedAgentState.currentNode || "inspect")
                : savedAgentState.currentNode,
              currentStage: options?.action === "resume" && resumeTargetStep && NODE_CONFIG[resumeTargetStep as TrackedAgentKey]?.stage
                ? NODE_CONFIG[resumeTargetStep as TrackedAgentKey]?.stage
                : savedAgentState.currentStage,
              summary: options?.action === "approve"
                ? `Advancing workflow to ${options.step || "Feature Engineering"} phase`
                : `Resuming workflow at ${resumeTargetStep || options.step || "inspect"} phase`,
              ...(options?.action === "approve" ? { requiresApproval: false, nextStep: undefined } : {}),
            };
          }
        } catch (e) {
          console.warn("[Workflow] Failed to lookup project with workspace:", e);
        }
      }
      if (options?.action === "resume") {
        if (!savedAgentState) {
          throw new Error("Cannot resume workflow: persisted project state is unavailable.");
        }
        if (!resumeTargetStep) {
          throw new Error("Cannot resume workflow without a recognized paused step.");
        }
        if (!resumePredecessorNode) {
          throw new Error(`Cannot resume workflow at unrecognized step "${resumeTargetStep}".`);
        }
      }
      // Determine the single unified runTimestamp for this execution
      let activeRunTimestamp = "";
      const isContinuing =
        options?.action === "approve" ||
        options?.action === "retry" ||
        options?.action === "resume" ||
        (Boolean(options?.step) && options?.step !== "Data Inspection" && options?.step !== "inspect");

      if (isContinuing) {
        if (savedAgentState?.runTimestamp && String(savedAgentState.runTimestamp).trim().length > 0) {
          activeRunTimestamp = String(savedAgentState.runTimestamp).trim();
        } else if (pWs?.project?.name && pWs?.workspaceName) {
          const latestOnDisk = getLatestProjectRunTimestamp(pWs.workspaceName, pWs.project.name);
          if (latestOnDisk) {
            activeRunTimestamp = latestOnDisk;
          }
        }
      }

      if (!activeRunTimestamp) {
        activeRunTimestamp = generateDateTimeStamp();
      }

      latestGraphStateValues.runTimestamp = activeRunTimestamp;

      if (pWs && pWs.project && pWs.workspaceName) {
        try {
          await ensureProjectRunFolder(pWs.workspaceName, pWs.project.name, activeRunTimestamp);
          await createProjectSchemaFile(
            pWs.workspaceName,
            {
              name: pWs.project.name,
              domain: pWs.project.domain,
              subDomain: pWs.project.subDomain,
              useCase: pWs.project.useCase,
            },
            activeRunTimestamp
          );
        } catch (folderErr) {
          console.warn("[Workflow] Warning ensuring project run folder:", folderErr);
        }
      }

      this.stoppedSessions.delete(threadId);
      this.pausedSessions.delete(threadId);
      this.activeRuns.set(threadId, { threadId, projectId: options?.projectId, startedAt: runStartedAt });
      latestGraphStateValues = {
        ...latestGraphStateValues,
        connectorId,
        projectId: options?.projectId,
        userPrompt: userPrompt ?? "",
        status: "In-Progress",
        summary: options?.action === "resume"
          ? `Resuming workflow at ${resumeTargetStep || options.step || "inspect"} phase`
          : options?.action === "approve"
            ? `Advancing workflow to ${options.step || "next"} phase`
            : options?.action === "retry"
              ? `Retrying workflow at ${options.step || "inspect"} phase`
              : "Ingestion workflow started",
        sessionId: threadId,
        runTimestamp: activeRunTimestamp,
        requiresApproval: false,
      };
      if (options?.projectId) {
        try {
          await this.projectService.updateAgentState(
            options.projectId,
            latestGraphStateValues,
            userPrompt,
            !isContinuing || (options?.action === "resume" && resumePredecessorNode === "__start__")
          );
        } catch (error) {
          this.activeRuns.delete(threadId);
          console.error(`[Workflow] Failed to persist running state for project ${options.projectId}:`, error);
          throw error;
        }
      }
      const sessionAbortController = new AbortController();
      try {
        setMaxListeners(100, sessionAbortController.signal);
      } catch (listenerErr) {

      }
      this.sessionAbortControllers.set(threadId, sessionAbortController);

      const services = {
        connectorService: this.connectorService,
        connectionTester: this.connectionTester,
        fileService: this.fileService,
        projectService: this.projectService,
        duckDBService: this.duckDBService,
        traceHelper: this.traceHelper,
        agentThinkingService: this.agentThinkingService,
        projectId: options?.projectId,
        projectName: pWs?.project?.name,
        workspaceName: pWs?.workspaceName,
        folderPath: pWs?.project?.folderPath,
        pipeline: getPipelineForSubstep(options?.action === "resume" ? (resumeTargetStep || options?.step) : options?.step) || "Data Ingestion",
        runTimestamp: activeRunTimestamp,
        isCancelled: () => this.stoppedSessions.has(threadId) || this.pausedSessions.has(threadId),
        abortSignal: sessionAbortController.signal,
        persistedActiveNodes: new Set<string>(),
        onThinkingUpdate: async (substep: string) => {
          if (this.stoppedSessions.has(threadId) || this.pausedSessions.has(threadId)) return;
          try {
            const currentPipeline = getPipelineForSubstep(substep);
            services.pipeline = currentPipeline;
            pipeline = currentPipeline;
            const allThinking = options?.projectId
              ? await this.getAllProjectPipelineThinking(options.projectId, currentPipeline)
              : {};

            const currentStageStatuses = { ...(latestGraphStateValues.stageStatuses || {}) };
            let currentNode = "inspect";
            let currentStage = "inspect";

            if (substep === "Data Inspection" || substep === "Data Ingestion" || substep === "inspect") {
              currentNode = "inspect";
              currentStage = "inspect";
              currentStageStatuses.inspect = "In-Progress";
            } else if (substep === "Data Profiling" || substep === "profileData") {
              currentNode = "profileData";
              currentStage = "profileData";
              currentStageStatuses.inspect = "Completed";
              currentStageStatuses.profileData = "In-Progress";
            } else if (substep === "Schema Resolver" || substep === "resolveSchema") {
              currentNode = "resolveSchema";
              currentStage = "resolveSchema";
              currentStageStatuses.inspect = "Completed";
              currentStageStatuses.profileData = "Completed";
              currentStageStatuses.resolveSchema = "In-Progress";
            } else if (substep === "Hierarchy Mapper" || substep === "hierarchyMapper" || substep === "hierarchyMapperNode" || substep === "relationshipBuilder" || substep === "formBuilder") {
              currentNode = "hierarchyMapperNode";
              currentStage = "hierarchyMapperNode";
              currentStageStatuses.inspect = "Completed";
              currentStageStatuses.profileData = "Completed";
              currentStageStatuses.resolveSchema = "Completed";
              currentStageStatuses.hierarchyMapperNode = "In-Progress";
            } else if (substep === "Feature Architect" || substep === "featureArchitect" || substep === "featureArchitectNode" || substep === "featureSupervisor" || substep === "featureCreation" || substep === "featureTransformation" || substep === "featureExtraction" || substep === "featureSelection") {
              currentNode = "featureArchitectNode";
              currentStage = "featureArchitectNode";
              currentStageStatuses.inspect = "Completed";
              currentStageStatuses.profileData = "Completed";
              currentStageStatuses.resolveSchema = "Completed";
              currentStageStatuses.hierarchyMapperNode = "Completed";
              currentStageStatuses.featureArchitectNode = "In-Progress";
            } else if (substep === "Feature Validator" || substep === "featureValidator" || substep === "featureValidatorNode") {
              currentNode = "featureValidatorNode";
              currentStage = "featureValidatorNode";
              currentStageStatuses.inspect = "Completed";
              currentStageStatuses.profileData = "Completed";
              currentStageStatuses.resolveSchema = "Completed";
              currentStageStatuses.hierarchyMapperNode = "Completed";
              currentStageStatuses.featureArchitectNode = "Completed";
              currentStageStatuses.featureValidatorNode = "In-Progress";
            } else if (substep === "Exogenous Scout" || substep === "exogenous") {
              currentNode = "exogenous";
              currentStage = "exogenous";
              currentStageStatuses.inspect = "Completed";
              currentStageStatuses.profileData = "Completed";
              currentStageStatuses.resolveSchema = "Completed";
              currentStageStatuses.hierarchyMapperNode = "Completed";
              currentStageStatuses.featureArchitectNode = "Completed";
              currentStageStatuses.featureValidatorNode = "Completed";
              currentStageStatuses.exogenous = "In-Progress";
            } else if (substep === "Model Selection" || substep === "modelSelection" || substep === "modelSelectionNode") {
              currentNode = "modelSelectionNode";
              currentStage = "modelSelectionNode";
              currentStageStatuses.hierarchyMapperNode = "Completed";
              currentStageStatuses.featureArchitectNode = "Completed";
              currentStageStatuses.featureValidatorNode = "Completed";
              currentStageStatuses.exogenous = "Completed";
              currentStageStatuses.modelSelectionNode = "In-Progress";
            } else if (substep === "Training Configuration" || substep === "trainingConfiguration" || substep === "trainingConfigurationNode") {
              currentNode = "trainingConfigurationNode";
              currentStage = "trainingConfigurationNode";
              currentStageStatuses.modelSelectionNode = "Completed";
              currentStageStatuses.trainingConfigurationNode = "In-Progress";
            } else if (substep === "Pre Flight" || substep === "preFlight" || substep === "preFlightNode") {
              currentNode = "preFlightNode";
              currentStage = "preFlightNode";
              currentStageStatuses.trainingConfigurationNode = "Completed";
              currentStageStatuses.preFlightNode = "In-Progress";
            } else if (substep === "Model Training Code Generation" || substep === "modelTrainingCode" || substep === "modelTrainingCodeNode") {
              currentNode = "modelTrainingCodeNode";
              currentStage = "modelTrainingCodeNode";
              currentStageStatuses.preFlightNode = "Completed";
              currentStageStatuses.modelTrainingCodeNode = "In-Progress";
              currentStageStatuses.modelTrainingExecNode = "In-Progress";
            } else if (substep === "Model Training Execution" || substep === "modelTrainingExec" || substep === "modelTrainingExecNode") {
              currentNode = "modelTrainingExecNode";
              currentStage = "modelTrainingExecNode";
              currentStageStatuses.preFlightNode = "Completed";
              currentStageStatuses.modelTrainingCodeNode = "Completed";
              currentStageStatuses.modelTrainingExecNode = "In-Progress";
            } else if (substep === "Model Training" || substep === "modelTraining" || substep === "modelTrainingNode") {
              currentNode = "modelTrainingExecNode";
              currentStage = "modelTrainingExecNode";
              currentStageStatuses.preFlightNode = "Completed";
              currentStageStatuses.modelTrainingExecNode = "In-Progress";
            } else if (substep === "Model Validation" || substep === "modelValidation" || substep === "modelValidationNode") {
              currentNode = "modelTrainingExecNode";
              currentStage = "modelTrainingExecNode";
              currentStageStatuses.modelTrainingCodeNode = "Completed";
              currentStageStatuses.modelTrainingExecNode = "In-Progress";
            }

            const mergedValues = {
              ...latestGraphStateValues,
              status: "In-Progress",
              currentNode,
              currentStage,
              stageStatuses: normalizeRuntimeStageStatuses(currentStageStatuses),
            };
            if (options?.projectId && !services.persistedActiveNodes.has(currentNode)) {
              await this.projectService.updateAgentState(options.projectId, mergedValues);
              services.persistedActiveNodes.add(currentNode);
              latestGraphStateValues = mergedValues;
            }

            const resVal = buildResultFromGraphState(
              { values: mergedValues },
              threadId,
              connectorId
            );
            resVal.currentNode = currentNode;
            resVal.currentStage = currentStage;
            resVal.agentThinking = allThinking;

            queue.push(resVal);
            agentJobEvents.emit(`job:update:${threadId}`, resVal);
          } catch (err) {
            console.warn(`[Workflow] Failed to push thinking update:`, err);
          }
        },
      };

      const config = {
        configurable: {
          thread_id: threadId,
          services,
        },
        recursionLimit: 100,
        signal: sessionAbortController.signal,
      };

      let pipeline = getPipelineForSubstep(options?.step) || "Data Ingestion";

      const isApprovingModelValidation = options?.action === "approve" && (
        options.step === "Model Validation" ||
        options.step === "modelValidation" ||
        options.step === "modelValidationNode" ||
        Boolean(options.step?.toLowerCase().includes("validation"))
      );

      const isApprovingModelTrainingExec = options?.action === "approve" && !isApprovingModelValidation && (
        options.step === "Model Training Execution" ||
        options.step === "modelTrainingExecNode" ||
        options.step === "modelTrainingExec"
      );

      const isApprovingModelTrainingCode = options?.action === "approve" && !isApprovingModelValidation && !isApprovingModelTrainingExec && (
        options.step === "Model Training Code Generation" ||
        options.step === "modelTrainingCodeNode" ||
        options.step === "modelTrainingCode" ||
        options.step === "Model Training" ||
        options.step === "modelTraining" ||
        options.step === "modelTrainingNode" ||
        (Boolean(options.step?.toLowerCase().includes("training")) &&
          !options.step?.toLowerCase().includes("configuration") &&
          Boolean(options?.splitEndDate || options?.splitDate))
      );

      const isApprovingPreFlight = options?.action === "approve" && !isApprovingModelValidation && !isApprovingModelTrainingExec && !isApprovingModelTrainingCode && (
        options.step === "Pre Flight" ||
        options.step === "preFlightNode" ||
        options.step === "preFlight" ||
        Boolean(options.step?.toLowerCase().includes("flight"))
      );

      const isApprovingTrainingConfig = options?.action === "approve" && !isApprovingModelValidation && !isApprovingModelTrainingExec && !isApprovingModelTrainingCode && !isApprovingPreFlight && (
        options.step === "Training Configuration" ||
        options.step === "trainingConfigurationNode" ||
        options.step === "trainingConfiguration" ||
        Boolean(options.step?.toLowerCase().includes("configuration")) ||
        ((Boolean(options.selectedModels && options.selectedModels.length > 0) ||
          Boolean(savedAgentState?.modelSelection?.candidates?.length > 0)) &&
          (options.step === "modelSelection" || options.step === "modelSelectionNode" || options.step === "Model Selection"))
      );

      const isApprovingModel = options?.action === "approve" && !isApprovingModelValidation && !isApprovingModelTrainingExec && !isApprovingModelTrainingCode && !isApprovingPreFlight && !isApprovingTrainingConfig && (
        options.step === "Model Selection" ||
        options.step === "modelSelection" ||
        options.step === "modelSelectionNode" ||
        options.step === "Model Training & Validation"
      );

      let initialStageStatuses: Record<string, string>;
      if (options?.action === "retry") {
        const retryTarget = mapRetryStepToInterruptNode(options.step);
        if (retryTarget === "inspect") {
          initialStageStatuses = {
            ...INITIAL_STAGE_STATUSES,
            inspect: "In-Progress",
          };
        } else if (retryTarget === "hierarchyMapperNode") {
          initialStageStatuses = {
            ...INITIAL_STAGE_STATUSES,
            inspect: "Completed",
            profileData: "Completed",
            resolveSchema: "Completed",
            hierarchyMapperNode: "In-Progress",
          };
        } else {

          initialStageStatuses = {
            ...INITIAL_STAGE_STATUSES,
            inspect: "Completed",
            profileData: "Completed",
            resolveSchema: "Completed",
            hierarchyMapperNode: "Completed",
            featureArchitectNode: "Completed",
            featureValidatorNode: "Completed",
            exogenous: "Completed",
            modelSelectionNode: "In-Progress",
          };
        }
      } else if (options?.action === "resume" && savedAgentState?.stageStatuses) {
        const pausedStep = findPausedStep(savedAgentState.stageStatuses) || options.step || "inspect";
        const resumedStatuses = applyResumeToStageStatuses(savedAgentState.stageStatuses, pausedStep);
        initialStageStatuses = {
          ...INITIAL_STAGE_STATUSES,
          ...normalizeFlatStageStatuses(resumedStatuses),
          [pausedStep]: "In-Progress",
        };
      } else if (isApprovingModelValidation) {
        initialStageStatuses = {
          ...INITIAL_STAGE_STATUSES,
          inspect: "Completed",
          profileData: "Completed",
          resolveSchema: "Completed",
          hierarchyMapperNode: "Completed",
          featureArchitectNode: "Completed",
          featureValidatorNode: "Completed",
          exogenous: "Completed",
          modelSelectionNode: "Completed",
          trainingConfigurationNode: "Completed",
          preFlightNode: "Completed",
          modelTrainingCodeNode: "Completed",
          modelTrainingExecNode: "In-Progress",
        };
      } else if (isApprovingPreFlight) {
        initialStageStatuses = {
          ...INITIAL_STAGE_STATUSES,
          inspect: "Completed",
          profileData: "Completed",
          resolveSchema: "Completed",
          hierarchyMapperNode: "Completed",
          featureArchitectNode: "Completed",
          featureValidatorNode: "Completed",
          exogenous: "Completed",
          modelSelectionNode: "Completed",
          trainingConfigurationNode: "Completed",
          preFlightNode: "In-Progress",
        };
      } else if (isApprovingModelTrainingCode || isApprovingModelTrainingExec) {
        initialStageStatuses = {
          ...INITIAL_STAGE_STATUSES,
          inspect: "Completed",
          profileData: "Completed",
          resolveSchema: "Completed",
          hierarchyMapperNode: "Completed",
          featureArchitectNode: "Completed",
          featureValidatorNode: "Completed",
          exogenous: "Completed",
          modelSelectionNode: "Completed",
          trainingConfigurationNode: "Completed",
          preFlightNode: "Completed",
          modelTrainingCodeNode: isApprovingModelTrainingCode ? "In-Progress" : "Completed",
          modelTrainingExecNode: "In-Progress",
        };
      } else if (isApprovingTrainingConfig) {
        initialStageStatuses = {
          ...INITIAL_STAGE_STATUSES,
          inspect: "Completed",
          profileData: "Completed",
          resolveSchema: "Completed",
          hierarchyMapperNode: "Completed",
          featureArchitectNode: "Completed",
          featureValidatorNode: "Completed",
          exogenous: "Completed",
          modelSelectionNode: "Completed",
          trainingConfigurationNode: "In-Progress",
        };
      } else if (isApprovingModel) {
        const hasExistingSelection = Boolean(
          (options?.selectedModels && options.selectedModels.length > 0) ||
          savedAgentState?.modelSelection?.userSelection ||
          savedAgentState?.trainingConfiguration?.models?.length
        );
        initialStageStatuses = {
          ...INITIAL_STAGE_STATUSES,
          inspect: "Completed",
          profileData: "Completed",
          resolveSchema: "Completed",
          hierarchyMapperNode: "Completed",
          featureArchitectNode: "Completed",
          featureValidatorNode: "Completed",
          exogenous: "Completed",
          modelSelectionNode: hasExistingSelection ? "Completed" : "In-Progress",
          trainingConfigurationNode: hasExistingSelection ? "In-Progress" : "Pending",
        };
      } else if (options?.action === "approve") {
        initialStageStatuses = {
          ...INITIAL_STAGE_STATUSES,
          inspect: "Completed",
          profileData: "Completed",
          resolveSchema: "Completed",
          hierarchyMapperNode: "In-Progress",
        };
      } else {
        initialStageStatuses = {
          ...INITIAL_STAGE_STATUSES,
          inspect: "In-Progress",
        };
      }

      initialStageStatuses = normalizeFlatStageStatuses(initialStageStatuses);

      const approveMessage = isApprovingModelValidation
        ? "Advancing workflow to Model Validation stage..."
        : isApprovingPreFlight
          ? "Advancing workflow to Pre Flight verification stage..."
          : isApprovingModelTrainingCode
            ? "Advancing workflow to Model Training Code Generation stage..."
            : isApprovingModelTrainingExec
              ? "Advancing workflow to Model Training Execution stage..."
              : isApprovingTrainingConfig
                ? "Advancing workflow to Training Configuration stage..."
                : isApprovingModel
                  ? "Advancing workflow to Model Selection stage..."
                  : `Advancing workflow to ${options?.step || "Feature Engineering"} stage...`;

      const resolvedApproveNode = options?.step || (
        isApprovingModelValidation
          ? "modelValidationNode"
          : isApprovingPreFlight
            ? "preFlightNode"
            : isApprovingModelTrainingCode
              ? "modelTrainingCodeNode"
              : isApprovingModelTrainingExec
                ? "modelTrainingExecNode"
                : isApprovingTrainingConfig
                  ? "trainingConfigurationNode"
                  : isApprovingModel
                    ? "modelSelectionNode"
                    : "hierarchyMapperNode"
      );

      if (options?.action === "approve") {
        latestGraphStateValues.stageStatuses = {
          ...(latestGraphStateValues.stageStatuses || {}),
          ...initialStageStatuses,
        };
      }

      if (options?.action === "approve" && options?.projectId) {
        const resolvedSplit = options?.splitEndDate || options?.splitDate;
        const approvedAgentState: any = {
          ...(savedAgentState || {}),
          status: "In-Progress",
          requiresApproval: false,
          runTimestamp: activeRunTimestamp,
          stageStatuses: buildGroupedStageStatuses(normalizeFlatStageStatuses(initialStageStatuses)),
          currentNode: resolvedApproveNode,
          currentStage: resolvedApproveNode,
          summary: isApprovingModelValidation
            ? "Advancing workflow to Model Validation stage"
            : isApprovingPreFlight
              ? "Advancing workflow to Pre Flight verification stage"
              : isApprovingModelTrainingCode
                ? "Advancing workflow to Model Training Code Generation"
                : isApprovingModelTrainingExec
                  ? "Advancing workflow to Model Training Execution"
                  : isApprovingTrainingConfig
                    ? "Advancing workflow to Training Configuration stage"
                    : (isApprovingModel ? "Advancing workflow to Model Selection stage" : `Advancing workflow to ${options?.step || "Feature Engineering"} stage`),
          message: approveMessage,
          ...(resolvedSplit ? { splitDate: resolvedSplit, splitEndDate: resolvedSplit } : {}),
          ...(options?.selectedModels && options.selectedModels.length > 0 ? { selectedModels: options.selectedModels } : {}),
        };

        if (resolvedSplit) {
          try {
            const pWs = await this.projectService.getProjectWithWorkspace(options.projectId);
            if (pWs && pWs.project) {
              await syncTrainingConfigSplitDate(
                pWs.workspaceName || "DefaultWorkspace",
                pWs.project.name,
                resolvedSplit,
                approvedAgentState,
                activeRunTimestamp
              );
            }
          } catch (syncErr) {
            console.warn("[Workflow] Error syncing training config split date on approve:", syncErr);
          }
        }

        try {
          await this.projectService.updateAgentState(options.projectId, approvedAgentState);
          console.info(`[Workflow] Updated project ${options.projectId} database agentState to running on approve.`);
        } catch (err) {
          console.warn("[Workflow] Failed to update project agent state on approve:", err);
        }
      }

      queue.push({
        connectorId,
        status: "In-Progress",
        summary: options?.action === "resume"
          ? `Resuming workflow at ${options.step || "inspect"} phase`
          : options?.action === "approve"
            ? (isApprovingTrainingConfig ? "Advancing workflow to Training Configuration stage" : isApprovingModel ? "Advancing workflow to Model Training & Validation stage" : `Advancing workflow to ${options.step || "Feature Engineering"}`)
            : "Workflow started. Initializing agent reasoning...",
        sessionId: threadId,
        requiresApproval: false,
        runTimestamp: activeRunTimestamp,
        stageStatuses: buildGroupedStageStatuses(normalizeFlatStageStatuses(initialStageStatuses)),
        currentNode: resolvedApproveNode,
        currentStage: resolvedApproveNode,
        steps: savedAgentState?.steps || [{ name: "Data Ingestion", status: "In-Progress", summary: "Data Ingestion node running..." }],
        stageOutputs: options?.action === "retry"
          ? clearRetryStageOutputs(savedAgentState?.stageOutputs, mapRetryStepToInterruptNode(options.step))
          : options?.action === "resume" && resumePredecessorNode === "__start__"
            ? {}
          : options?.action ? (savedAgentState?.stageOutputs || {}) : {},
        replaceStageOutputs: options?.action === "resume" && resumePredecessorNode === "__start__",
        message: options?.action === "approve"
          ? approveMessage
          : buildMessage([], "In-Progress", initialStageStatuses),
      });

      const executeWorkflowTask = async () => {
        try {
          const updateNodeStatuses = (nodeName: string, statuses: Record<string, string>): Record<string, string> => {
            const updated = { ...statuses };
            if (nodeName === "inspect") {
              updated.inspect = "Completed";
              if (!updated.profileData || updated.profileData === "Pending") {
                updated.profileData = "In-Progress";
              }
            } else if (nodeName === "profileData") {
              updated.inspect = "Completed";
              updated.profileData = "Completed";
              if (!updated.resolveSchema || updated.resolveSchema === "Pending") {
                updated.resolveSchema = "In-Progress";
              }
            } else if (nodeName === "resolveSchema") {
              updated.inspect = "Completed";
              updated.profileData = "Completed";
              updated.resolveSchema = "Completed";
            } else if (nodeName === "hierarchyMapperNode" || nodeName === "hierarchyMapper") {
              updated.hierarchyMapperNode = "Completed";
              if (!updated.featureArchitectNode || updated.featureArchitectNode === "Pending") {
                updated.featureArchitectNode = "In-Progress";
              }
            } else if (nodeName === "featureArchitectNode" || nodeName === "featureArchitect") {
              updated.featureArchitectNode = "Completed";
              updated.featureValidatorNode = "Completed";
              if (!updated.exogenous || updated.exogenous === "Pending") {
                updated.exogenous = "In-Progress";
              }
            } else if (nodeName === "exogenous" || nodeName === "exogenousScout") {
              updated.exogenous = "Completed";
              if (!updated.modelSelectionNode || updated.modelSelectionNode === "Pending") {
                updated.modelSelectionNode = "In-Progress";
              }
            } else if (nodeName === "modelSelection" || nodeName === "modelSelectionNode") {
              updated.modelSelectionNode = "Completed";
              updated.trainingConfigurationNode = "In-Progress";
              updated.preFlightNode = "Pending";
            } else if (nodeName === "trainingConfiguration" || nodeName === "trainingConfigurationNode") {
              updated.trainingConfigurationNode = "Completed";
              updated.preFlightNode = "In-Progress";
            } else if (nodeName === "preFlight" || nodeName === "preFlightNode") {
              updated.preFlightNode = "Completed";
              updated.modelTrainingCodeNode = "In-Progress";
            } else if (nodeName === "modelTrainingCodeNode" || nodeName === "modelTrainingCode") {
              updated.modelTrainingCodeNode = "Completed";
            } else if (nodeName === "modelTrainingExecNode" || nodeName === "modelTrainingExec" || nodeName === "modelTraining" || nodeName === "modelTrainingNode") {
              updated.modelTrainingExecNode = "Completed";
            } else if (nodeName === "modelValidation" || nodeName === "modelValidationNode") {
              updated.modelTrainingExecNode = "Completed";
            }
            return updated;
          };

          if (options?.projectId) {
            const projectId = options.projectId;
            let activeSubstep: string | undefined;

            if (options.action === "retry" && options.step) {
              const targetNode = mapRetryStepToInterruptNode(options.step);
              if (targetNode === "inspect") {
                activeSubstep = "Data Inspection";
                await this.agentThinkingService.clearProjectPipelineThinking(projectId, pipeline);
              } else if (targetNode === "hierarchyMapperNode") {
                activeSubstep = "Hierarchy Mapper";
                await this.agentThinkingService.deleteThinking(projectId, pipeline, "Hierarchy Mapper");
                await this.agentThinkingService.deleteThinking(projectId, pipeline, "Feature Architect");
                await this.agentThinkingService.deleteThinking(projectId, pipeline, "Feature Validator");
                await this.agentThinkingService.deleteThinking(projectId, pipeline, "Exogenous Scout");
                await this.agentThinkingService.deleteThinking(projectId, pipeline, "Feature Engineering");
                await this.agentThinkingService.deleteThinking(projectId, pipeline, "Model Selection");
                await this.agentThinkingService.deleteThinking(projectId, pipeline, "Training Configuration");
                await this.agentThinkingService.deleteThinking(projectId, pipeline, "Pre Flight");
                await this.agentThinkingService.deleteThinking(projectId, pipeline, "Model Training");
                await this.agentThinkingService.deleteThinking(projectId, pipeline, "Model Validation");
              } else {

                activeSubstep = "Model Selection";
                await this.agentThinkingService.deleteThinking(projectId, pipeline, "Model Selection");
                await this.agentThinkingService.deleteThinking(projectId, pipeline, "Training Configuration");
                await this.agentThinkingService.deleteThinking(projectId, pipeline, "Pre Flight");
                await this.agentThinkingService.deleteThinking(projectId, pipeline, "Model Training");
                await this.agentThinkingService.deleteThinking(projectId, pipeline, "Model Validation");
              }
            } else if (options.action === "approve") {
              const graphState = await workflow.getState(config);
              const nextNodes = Array.isArray(graphState?.next) ? graphState.next : [];
              if (nextNodes.includes("profileData")) {
                activeSubstep = "Data Profiling";
                await this.agentThinkingService.deleteThinking(projectId, pipeline, "Data Profiling");
                await this.agentThinkingService.deleteThinking(projectId, pipeline, "Schema Resolver");
                await this.agentThinkingService.deleteThinking(projectId, pipeline, "Hierarchy Mapper");
                await this.agentThinkingService.deleteThinking(projectId, pipeline, "Feature Architect");
                await this.agentThinkingService.deleteThinking(projectId, pipeline, "Feature Validator");
                await this.agentThinkingService.deleteThinking(projectId, pipeline, "Exogenous Scout");
                await this.agentThinkingService.deleteThinking(projectId, pipeline, "Feature Engineering");
              } else if (nextNodes.includes("resolveSchema")) {
                activeSubstep = "Schema Resolver";
                await this.agentThinkingService.deleteThinking(projectId, pipeline, "Schema Resolver");
                await this.agentThinkingService.deleteThinking(projectId, pipeline, "Hierarchy Mapper");
                await this.agentThinkingService.deleteThinking(projectId, pipeline, "Feature Architect");
                await this.agentThinkingService.deleteThinking(projectId, pipeline, "Feature Validator");
                await this.agentThinkingService.deleteThinking(projectId, pipeline, "Exogenous Scout");
              } else if (nextNodes.includes("hierarchyMapperNode") || nextNodes.includes("hierarchyMapper")) {
                activeSubstep = "Hierarchy Mapper";
                await this.agentThinkingService.deleteThinking(projectId, pipeline, "Hierarchy Mapper");
                await this.agentThinkingService.deleteThinking(projectId, pipeline, "Feature Architect");
                await this.agentThinkingService.deleteThinking(projectId, pipeline, "Feature Validator");
                await this.agentThinkingService.deleteThinking(projectId, pipeline, "Exogenous Scout");
                await this.agentThinkingService.deleteThinking(projectId, pipeline, "Feature Engineering");
              } else if (nextNodes.includes("featureArchitectNode") || nextNodes.includes("featureArchitect")) {
                activeSubstep = "Feature Architect";
                await this.agentThinkingService.deleteThinking(projectId, pipeline, "Feature Architect");
                await this.agentThinkingService.deleteThinking(projectId, pipeline, "Feature Validator");
                await this.agentThinkingService.deleteThinking(projectId, pipeline, "Exogenous Scout");
                await this.agentThinkingService.deleteThinking(projectId, pipeline, "Feature Engineering");
              } else if (nextNodes.includes("exogenous")) {
                activeSubstep = "Exogenous Scout";
                await this.agentThinkingService.deleteThinking(projectId, pipeline, "Exogenous Scout");
              } else if (nextNodes.includes("modelSelectionNode") || nextNodes.includes("modelSelection")) {
                activeSubstep = "Model Selection";
                await this.agentThinkingService.deleteThinking(projectId, pipeline, "Model Selection");
                await this.agentThinkingService.deleteThinking(projectId, pipeline, "Training Configuration");
                await this.agentThinkingService.deleteThinking(projectId, pipeline, "Model Training");
                await this.agentThinkingService.deleteThinking(projectId, pipeline, "Model Validation");
              } else if (nextNodes.includes("trainingConfigurationNode") || nextNodes.includes("trainingConfiguration")) {
                activeSubstep = "Training Configuration";
                await this.agentThinkingService.deleteThinking(projectId, pipeline, "Training Configuration");
                await this.agentThinkingService.deleteThinking(projectId, pipeline, "Model Training");
                await this.agentThinkingService.deleteThinking(projectId, pipeline, "Model Validation");
              }
            } else {
              activeSubstep = "Data Inspection";
              await this.agentThinkingService.clearProjectPipelineThinking(projectId, pipeline);

              const cleanInitialState = {
                connectorId,
                projectId: options.projectId,
                userPrompt: userPrompt ?? "",
                sessionId: threadId,
                runTimestamp: activeRunTimestamp,
                splitDate: options?.splitDate || options?.splitEndDate || "",
                splitEndDate: options?.splitEndDate || options?.splitDate || "",
                selectedModels: options?.selectedModels || [],
                predictionHorizon: options?.predictionHorizon ?? 12,
                predictionFrequency: options?.predictionFrequency || "Weekly",
                predictionObjectiveStartDate: options?.predictionObjectiveStartDate || "",
                batchedTables: [],
                inspection: {},
                dataProfile: {},
                schemaResolution: {},
                hierarchyMapper: {},
                featureArchitect: {},
                featureValidator: {},
                exogenousScout: {},
                modelSelection: {},
                trainingConfiguration: {},
                preFlight: {},
                modelTraining: {},
                modelValidation: {},
                status: "In-Progress",
                summary: "Ingestion workflow started",
                steps: [{ name: "Data Inspection", status: "In-Progress", summary: "Data Inspection node running..." }],
                stageOutputs: {},
                stageStatuses: {
                  ...INITIAL_STAGE_STATUSES,
                  inspect: "In-Progress",
                }
              };
              try {
                await this.projectService.updateAgentState(options.projectId, cleanInitialState, userPrompt, true);
              } catch (e) {
                console.warn("[Workflow] Failed to reset project agent state on new run:", e);
              }
            }

            if (activeSubstep) {
              const logs = SUBSTEP_THINKING_TEMPLATES[activeSubstep] || [];
              const currentGraphState = await workflow.getState(config).catch(() => null);
              const calculatedBase = buildResultFromGraphState(currentGraphState, threadId, connectorId);

              const isModelSubstep = activeSubstep === "Model Selection" || activeSubstep === "Training Configuration" || activeSubstep === "Pre Flight" || activeSubstep === "Model Training" || activeSubstep === "Model Validation" || activeSubstep === "Model Training & Validation";
              const isFESubstep = activeSubstep === "Hierarchy Mapper" || activeSubstep === "Feature Architect" || activeSubstep === "Feature Validator" || activeSubstep === "Exogenous Scout" || activeSubstep === "Feature Engineering";

              if (options?.projectId && isModelSubstep) {
                try {
                  const project = await this.projectService.getById(options.projectId);
                  const savedAgentState = project?.agentState as any;
                  if (savedAgentState) {
                    const modelSel = savedAgentState.stageOutputs?.modelSelectionNode || savedAgentState.modelSelection;
                    if (modelSel) {
                      calculatedBase.stageOutputs = {
                        ...(calculatedBase.stageOutputs || {}),
                        modelSelectionNode: modelSel,
                        modelSelection: modelSel,
                      };
                    }
                    const trainConfig = savedAgentState.stageOutputs?.trainingConfigurationNode || savedAgentState.trainingConfiguration;
                    if (trainConfig) {
                      calculatedBase.stageOutputs = {
                        ...(calculatedBase.stageOutputs || {}),
                        trainingConfigurationNode: trainConfig,
                        trainingConfiguration: trainConfig,
                      };
                    }
                  }
                } catch (err: any) {
                  console.warn("[Workflow] Could not read saved project state for initial calculatedBase:", err?.message || err);
                }
              }

              const inspectStatus = (activeSubstep === "Data Profiling" || activeSubstep === "Schema Resolver" || isFESubstep || isModelSubstep) ? "Completed" : "In-Progress";
              const profileStatus = (activeSubstep === "Schema Resolver" || isFESubstep || isModelSubstep) ? "Completed" : (activeSubstep === "Data Profiling" ? "In-Progress" : "Pending");
              const schemaStatus = (isFESubstep || isModelSubstep) ? "Completed" : (activeSubstep === "Schema Resolver" ? "In-Progress" : "Pending");

              const hierarchyStatus = isModelSubstep || activeSubstep === "Feature Architect" || activeSubstep === "Feature Validator" || activeSubstep === "Exogenous Scout" ? "Completed" : (activeSubstep === "Hierarchy Mapper" ? "In-Progress" : "Pending");
              const featureArchitectStatus = isModelSubstep || activeSubstep === "Feature Validator" || activeSubstep === "Exogenous Scout" ? "Completed" : (activeSubstep === "Feature Architect" || activeSubstep === "Feature Engineering" ? "In-Progress" : "Pending");
              const featureValidatorStatus = isModelSubstep || activeSubstep === "Exogenous Scout" ? "Completed" : (activeSubstep === "Feature Validator" ? "In-Progress" : "Pending");
              const exogenousStatus = isModelSubstep ? "Completed" : (activeSubstep === "Exogenous Scout" ? "In-Progress" : "Pending");

              const modelSelectionStatus = (activeSubstep === "Training Configuration" || activeSubstep === "Pre Flight" || activeSubstep === "Model Training" || activeSubstep === "Model Validation") ? "Completed" : (activeSubstep === "Model Selection" || activeSubstep === "Model Training & Validation" ? "In-Progress" : "Pending");
              const trainingConfigStatus = (activeSubstep === "Pre Flight" || activeSubstep === "Model Training" || activeSubstep === "Model Validation") ? "Completed" : (activeSubstep === "Training Configuration" ? "In-Progress" : "Pending");
              const preFlightStatus = (activeSubstep === "Model Training" || activeSubstep === "Model Validation") ? "Completed" : (activeSubstep === "Pre Flight" ? "In-Progress" : "Pending");
              const modelTrainingStatus = activeSubstep === "Model Validation" ? "Completed" : (activeSubstep === "Model Training" ? "In-Progress" : "Pending");
              const modelValidationStatus = activeSubstep === "Model Validation" ? "In-Progress" : "Pending";

              const mergedStageStatuses = {
                ...(calculatedBase.stageStatuses || {}),
                inspect: inspectStatus,
                profileData: profileStatus,
                resolveSchema: schemaStatus,
                hierarchyMapperNode: hierarchyStatus,
                featureArchitectNode: featureArchitectStatus,
                featureValidatorNode: featureValidatorStatus,
                exogenous: exogenousStatus,
                modelSelectionNode: modelSelectionStatus,
                trainingConfigurationNode: trainingConfigStatus,
                preFlightNode: preFlightStatus,
                modelTrainingCodeNode: modelTrainingStatus,
                modelTrainingExecNode: modelTrainingStatus,
              };

              const nodeKey = activeSubstep === "Data Inspection" ? "inspect"
                : activeSubstep === "Data Profiling" ? "profileData"
                  : activeSubstep === "Schema Resolver" ? "resolveSchema"
                    : activeSubstep === "Hierarchy Mapper" ? "hierarchyMapperNode"
                      : activeSubstep === "Feature Architect" ? "featureArchitectNode"
                        : activeSubstep === "Feature Validator" ? "featureValidatorNode"
                          : activeSubstep === "Exogenous Scout" ? "exogenous"
                            : (activeSubstep === "Model Selection" || activeSubstep === "Model Training & Validation") ? "modelSelectionNode"
                              : activeSubstep === "Training Configuration" ? "trainingConfigurationNode"
                                : activeSubstep === "Pre Flight" ? "preFlightNode"
                                  : activeSubstep === "Model Training" ? "modelTrainingExecNode"
                                    : activeSubstep === "Model Validation" ? "modelTrainingExecNode"
                                      : "inspect";

              const fullBaseResult: IngestionAgentRunResult = {
                ...calculatedBase,
                connectorId,
                status: "In-Progress",
                summary: `${activeSubstep} agent reasoning in progress`,
                message: buildMessage([nodeKey], "In-Progress", mergedStageStatuses),
                sessionId: threadId,
                requiresApproval: false,
                stageStatuses: mergedStageStatuses,
                currentNode: nodeKey,
                currentStage: nodeKey,
              };

              for await (const thinkingUpdate of this.streamThinking(projectId, pipeline, activeSubstep, fullBaseResult, logs, threadId)) {
                if (this.stoppedSessions.has(threadId)) break;
                agentJobEvents.emit(`job:update:${threadId}`, thinkingUpdate);
              }
            }
          }

          let stream: any;

          if (options?.action === "retry" && options.step) {
            const targetNode = mapRetryStepToInterruptNode(options.step);
            console.info(`[Workflow] Retry requested for step "${options.step}" → target node "${targetNode}", thread ${threadId}`);

            if (targetNode === "inspect") {
              this.checkpointer = new MemorySaver();
              workflow = createAgentGraph(this.checkpointer);
              const freshConfig = {
                configurable: {
                  thread_id: threadId,
                  services,
                },
                recursionLimit: 100,
              };
              if (options?.projectId) {
                await this.agentThinkingService.clearProjectPipelineThinking(options.projectId, pipeline);
              }
              if (options?.projectId) {
                const retryState = {
                  ...(savedAgentState || {}),
                  connectorId,
                  projectId: options.projectId,
                  userPrompt: savedAgentState?.userPrompt ?? userPrompt ?? "",
                  sessionId: threadId,
                  runTimestamp: activeRunTimestamp,
                  status: "In-Progress",
                  summary: "Retrying from inspect",
                  message: "Retrying workflow from Data Inspection.",
                  requiresApproval: false,
                  nextStep: undefined,
                  currentNode: "inspect",
                  currentStage: "inspect",
                  inspection: {},
                  dataProfile: {},
                  schemaResolution: {},
                  hierarchyMapper: {},
                  relationshipBuilder: {},
                  formBuilder: {},
                  featureArchitect: {},
                  featureValidator: {},
                  exogenousScout: {},
                  modelSelection: {},
                  trainingConfiguration: {},
                  preFlight: {},
                  modelTrainingCode: {},
                  modelTrainingExec: {},
                  modelTraining: {},
                  modelEvaluation: {},
                  modelValidation: {},
                  batchedTables: [],
                  steps: [],
                  stageOutputs: {},
                  stageStatuses: { ...INITIAL_STAGE_STATUSES, inspect: "In-Progress" },
                };
                await this.projectService.updateAgentState(options.projectId, retryState, undefined, true);
              }
              stream = await workflow.stream(
                {
                  connectorId,
                  projectId: options?.projectId ?? "",
                  userPrompt: meta.userPrompt,
                  status: "In-Progress",
                  summary: "Retrying from inspect",
                  inspection: {},
                  dataProfile: {},
                  schemaResolution: {},
                  batchedTables: [],
                  steps: [],
                  stageOutputs: {},
                  stageStatuses: { ...INITIAL_STAGE_STATUSES, inspect: "Pending" }
                },
                freshConfig
              );
            } else {
              let retryCheckpointId: string | undefined;
              try {
                for await (const snapshot of workflow.getStateHistory(config)) {
                  const snapshotNext = Array.isArray(snapshot.next) ? snapshot.next : [];
                  if (snapshotNext.includes(targetNode!)) {
                    retryCheckpointId = (snapshot.config as any)?.configurable?.checkpoint_id;
                    break;
                  }
                }
              } catch (historyError: any) {
                console.warn(`[Workflow] Failed to read state history for retry:`, historyError?.message);
              }

              if (retryCheckpointId) {
                console.info(`[Workflow] Retrying from in-memory checkpoint ${retryCheckpointId}`);
                const retryConfig = {
                  configurable: {
                    thread_id: threadId,
                    checkpoint_id: retryCheckpointId,
                    services,
                  },
                  recursionLimit: 100,
                  signal: sessionAbortController.signal,
                };

                const cleanMemUpdate: any = {
                  status: "In-Progress",
                  requiresApproval: false,
                  nextStep: undefined,
                  summary: `Retrying stage (${targetNode})`,
                };
                const checkpointState = await workflow.getState(retryConfig).catch(() => null);
                cleanMemUpdate.stageOutputs = clearRetryStageOutputs(
                  checkpointState?.values?.stageOutputs,
                  targetNode,
                  true
                );
                for (const key of getRetryStateOutputKeys(targetNode)) {
                  cleanMemUpdate[key] = { __resetOutput: true };
                }
                if (targetNode === "modelSelectionNode") {
                  cleanMemUpdate.stageStatuses = {
                    ...INITIAL_STAGE_STATUSES,
                    inspect: "Completed",
                    profileData: "Completed",
                    resolveSchema: "Completed",
                    hierarchyMapperNode: "Completed",
                    featureArchitectNode: "Completed",
                    featureValidatorNode: "Completed",
                    exogenous: "Completed",
                    modelSelectionNode: "In-Progress",
                  };
                } else if (targetNode === "hierarchyMapperNode") {
                  cleanMemUpdate.stageStatuses = {
                    ...INITIAL_STAGE_STATUSES,
                    inspect: "Completed",
                    profileData: "Completed",
                    resolveSchema: "Completed",
                    hierarchyMapperNode: "In-Progress",
                  };
                }
                await workflow.updateState(retryConfig, cleanMemUpdate);
                if (options?.projectId) {
                  const cleanedCheckpoint = await workflow.getState(retryConfig).catch(() => null);
                  if (cleanedCheckpoint?.values) {
                    await this.projectService.updateAgentState(
                      options.projectId,
                      cleanedCheckpoint.values as Record<string, unknown>,
                      undefined,
                      true
                    );
                  }
                }
                stream = await workflow.stream(null, retryConfig);
              } else {
                console.info(`[Workflow] No in-memory checkpoint found for retry target "${targetNode}". Restoring state from database for thread ${threadId}`);

                const predecessorNodeMap: Record<string, string> = {
                  profileData: "inspect",
                  resolveSchema: "profileData",
                  hierarchyMapperNode: "resolveSchema",
                  hierarchyMapper: "resolveSchema",
                  featureArchitectNode: "hierarchyMapperNode",
                  featureArchitect: "hierarchyMapperNode",
                  featureValidator: "hierarchyMapperNode",
                  featureValidatorNode: "hierarchyMapperNode",
                  exogenous: "featureArchitectNode",
                  exogenousScout: "featureArchitectNode",
                  modelSelection: "exogenous",
                  modelSelectionNode: "exogenous",
                  trainingConfiguration: "modelSelectionNode",
                  trainingConfigurationNode: "modelSelectionNode",
                  preFlight: "trainingConfigurationNode",
                  preFlightNode: "trainingConfigurationNode",
                  "Pre Flight": "trainingConfigurationNode",
                  modelTrainingCode: "preFlightNode",
                  modelTrainingCodeNode: "preFlightNode",
                  "Model Training Code Generation": "preFlightNode",
                  modelTrainingExec: "modelTrainingCodeNode",
                  modelTrainingExecNode: "modelTrainingCodeNode",
                  "Model Training Execution": "modelTrainingCodeNode",
                  modelTraining: "modelTrainingCodeNode",
                  modelTrainingNode: "modelTrainingCodeNode",
                  "Model Training": "modelTrainingCodeNode",
                  modelValidation: "modelTrainingExecNode",
                  modelValidationNode: "modelTrainingExecNode",
                };

                const predecessorNode = predecessorNodeMap[targetNode || ""] || predecessorNodeMap[options.step || ""];

                let stateToRestore: any = savedAgentState
                  ? {
                    ...savedAgentState,
                    stageStatuses: normalizeFlatStageStatuses(savedAgentState.stageStatuses),
                    stageOutputs: normalizeStageOutputs(savedAgentState.stageOutputs),
                  }
                  : null;
                if (!stateToRestore && options?.projectId) {
                  try {
                    const project = await this.projectService.getById(options.projectId);
                    const projectState = project?.agentState as any;
                    stateToRestore = projectState ? {
                      ...projectState,
                      stageStatuses: normalizeFlatStageStatuses(projectState.stageStatuses),
                      stageOutputs: normalizeStageOutputs(projectState.stageOutputs),
                    } : null;
                  } catch (fetchErr: any) {
                    console.warn(`[Workflow] Failed to fetch project for retry state restore:`, fetchErr?.message);
                  }
                }

                if (stateToRestore && predecessorNode) {
                  const cleanStageStatuses = { ...(stateToRestore.stageStatuses || {}) };
                  const cleanStageOutputs = { ...(stateToRestore.stageOutputs || {}) };

                  const stagesToReset: string[] = [];
                  if (targetNode === "modelSelectionNode" || targetNode === "modelSelection") {
                    stagesToReset.push(
                      "modelSelection", "modelSelectionNode",
                      "trainingConfiguration", "trainingConfigurationNode",
                      "datasetAnalyserAgent", "datasetAnalyserNode",
                      "preFlight", "preFlightNode",
                      "modelTrainingCode", "modelTrainingCodeNode",
                      "modelTrainingExec", "modelTrainingExecNode",
                      "modelTraining", "modelTrainingNode",
                      "modelEvaluation", "modelEvaluationNode",
                      "modelValidation", "modelValidationNode"
                    );
                    stateToRestore.nextStep = 'Model Selection';
                    stateToRestore.currentNode = 'modelSelectionNode';
                    stateToRestore.currentStage = 'modelSelectionNode';
                    stateToRestore.modelSelection = {};
                    stateToRestore.trainingConfiguration = {};
                    stateToRestore.datasetAnalyserAgent = {};
                    stateToRestore.preFlight = {};
                    stateToRestore.modelTrainingCode = {};
                    stateToRestore.modelTrainingExec = {};
                    stateToRestore.modelTraining = {};
                    stateToRestore.modelEvaluation = {};
                    stateToRestore.modelValidation = {};
                    stateToRestore.stageOutputs.modelSelectionNode = {};
                    stateToRestore.stageOutputs.trainingConfigurationNode = {};
                    stateToRestore.stageOutputs.preFlightNode = {};
                    stateToRestore.stageOutputs.modelTrainingCodeNode = {};
                    stateToRestore.stageOutputs.modelTrainingExecNode = {};
                    stateToRestore.stageStatuses.modelSelectionNode = "Pending";
                    stateToRestore.stageStatuses.trainingConfigurationNode = "Pending";
                    stateToRestore.stageStatuses.preFlightNode = "Pending";
                    stateToRestore.stageStatuses.modelTrainingCodeNode = "Pending";
                    stateToRestore.stageStatuses.modelTrainingExecNode = "Pending";
                  } else if (targetNode === "hierarchyMapperNode" || targetNode === "hierarchyMapper") {
                    stagesToReset.push(
                      "hierarchyMapper", "hierarchyMapperNode",
                      "featureArchitect", "featureArchitectNode",
                      "featureValidator", "featureValidatorNode",
                      "exogenousScout", "exogenous",
                      "modelSelection", "modelSelectionNode",
                      "trainingConfiguration", "trainingConfigurationNode",
                      "preFlight", "preFlightNode",
                      "modelTrainingCode", "modelTrainingCodeNode",
                      "modelTraining", "modelTrainingNode",
                      "modelValidation", "modelValidationNode"
                    );
                    stateToRestore.nextStep = 'Hierarchy Mapper';
                    stateToRestore.currentNode = 'hierarchyMapperNode';
                    stateToRestore.currentStage = 'hierarchyMapperNode';
                    stateToRestore.hierarchyMapper = {};
                    stateToRestore.formBuilder = {};
                    stateToRestore.relationshipBuilder = {};
                    stateToRestore.featureArchitect = {};
                    stateToRestore.featureValidator = {};
                    stateToRestore.exogenousScout = {};
                    stateToRestore.modelSelection = {};
                    stateToRestore.trainingConfiguration = {};
                    stateToRestore.preFlight = {};
                    stateToRestore.modelTraining = {};
                    stateToRestore.modelValidation = {};
                    stateToRestore.stageOutputs.hierarchyMapperNode = {};
                    stateToRestore.stageOutputs.featureArchitectNode = {};
                    stateToRestore.stageOutputs.featureValidatorNode = {};
                    stateToRestore.stageOutputs.exogenous = {};
                    stateToRestore.stageOutputs.modelSelectionNode = {};
                    stateToRestore.stageOutputs.trainingConfigurationNode = {};
                    stateToRestore.stageOutputs.preFlightNode = {};
                    stateToRestore.stageOutputs.modelTrainingCodeNode = {};
                    stateToRestore.stageOutputs.modelTrainingExecNode = {};
                    stateToRestore.stageStatuses.hierarchyMapperNode = "Pending";
                    stateToRestore.stageStatuses.featureArchitectNode = "Pending";
                    stateToRestore.stageStatuses.featureValidatorNode = "Pending";
                    stateToRestore.stageStatuses.exogenous = "Pending";
                    stateToRestore.stageStatuses.modelSelectionNode = "Pending";
                    stateToRestore.stageStatuses.trainingConfigurationNode = "Pending";
                    stateToRestore.stageStatuses.preFlightNode = "Pending";
                    stateToRestore.stageStatuses.modelTrainingCodeNode = "Pending";
                    stateToRestore.stageStatuses.modelTrainingExecNode = "Pending";
                  } else if (targetNode === "resolveSchema") {
                    stagesToReset.push("resolveSchema", "hierarchyMapper", "featureArchitect", "featureValidator", "exogenousScout", "modelSelection");
                    stateToRestore.schemaResolution = {};
                    stateToRestore.stageStatuses.resolveSchema = 'Pending';
                    stateToRestore.stageStatuses.resolveSchema = "Pending";
                    stateToRestore.stageOutputs.resolveSchema = {};
                  } else if (targetNode === "profileData") {
                    stagesToReset.push("profileData", "resolveSchema", "hierarchyMapper");
                    stateToRestore.dataProfile = {};
                    stateToRestore.stageStatuses.profileData = 'Pending';
                    stateToRestore.stageStatuses.profileData = "Pending";
                    stateToRestore.stageOutputs.profileData = {};
                  }

                  stateToRestore.stageOutputs = clearRetryStageOutputs(stateToRestore.stageOutputs, targetNode, true);
                  for (const key of getRetryStateOutputKeys(targetNode)) {
                    stateToRestore[key] = { __resetOutput: true };
                  }

                  const restoredState = {
                    ...stateToRestore
                  };

                  await workflow.updateState(config, restoredState, predecessorNode);
                  const graphState = await workflow.getState(config).catch(() => null);
                  if (options?.projectId && graphState?.values) {
                    await this.projectService.updateAgentState(
                      options.projectId,
                      graphState.values as Record<string, unknown>,
                      undefined,
                      true
                    );
                  }
                  console.info(`[Workflow] Restored graph state for retry. Next node to execute: [${graphState?.next?.join(", ")}]`);

                  stream = await workflow.stream(null, config);
                } else {
                  console.warn(`[Workflow] Cannot restore state for retry target "${targetNode}", restarting from beginning`);
                  stream = await workflow.stream(
                    {
                      connectorId,
                      projectId: options?.projectId ?? "",
                      userPrompt: userPrompt ?? meta.userPrompt ?? "",
                      runTimestamp: activeRunTimestamp,
                      status: "In-Progress",
                      summary: `Retrying from beginning for step ${options.step}`,
                      inspection: {},
                      dataProfile: {},
                      schemaResolution: {},
                      batchedTables: [],
                      steps: [],
                      stageOutputs: {},
                      stageStatuses: { ...INITIAL_STAGE_STATUSES, inspect: "Pending" }
                    },
                    config
                  );
                }
              }
            }
          } else if (options?.action === "approve") {
            console.info(`[Workflow] Approve — resuming thread ${threadId}`);

            let graphState = await workflow.getState(config).catch(() => null);
            let hasState = Array.isArray(graphState?.next) && graphState.next.length > 0;

            if (options?.projectId) {
              try {
                const project = await this.projectService.getById(options.projectId);
                const savedAgentState = project?.agentState as any;
                if (savedAgentState) {
                  if (hasState) {

                    const stateUpdates: Record<string, any> = {};
                    if (savedAgentState.modelSelection) {
                      stateUpdates.modelSelection = savedAgentState.modelSelection;
                    }
                    if (savedAgentState.trainingConfiguration) {
                      stateUpdates.trainingConfiguration = savedAgentState.trainingConfiguration;
                    }
                    if (savedAgentState.stageOutputs) {
                      stateUpdates.stageOutputs = {
                        ...(graphState?.values?.stageOutputs || {}),
                        ...savedAgentState.stageOutputs,
                      };
                    }
                    if (savedAgentState.userPrompt) {
                      stateUpdates.userPrompt = savedAgentState.userPrompt;
                    }
                    const effectiveDirection =
                      savedAgentState.direction ||
                      savedAgentState.modelSelection?.direction ||
                      savedAgentState.stageOutputs?.modelSelectionNode?.direction;
                    if (effectiveDirection) {
                      stateUpdates.direction = effectiveDirection;
                    }
                    const effectivePrimaryMetric =
                      savedAgentState.primaryMetric ||
                      savedAgentState.modelSelection?.primary_metric ||
                      savedAgentState.stageOutputs?.modelSelectionNode?.primary_metric;
                    if (effectivePrimaryMetric) {
                      stateUpdates.primaryMetric = effectivePrimaryMetric;
                    }
                    const effectiveTargetColumn =
                      savedAgentState.targetColumn ||
                      savedAgentState.modelSelection?.target_entity?.name ||
                      savedAgentState.stageOutputs?.modelSelectionNode?.target_entity?.name;
                    if (effectiveTargetColumn) {
                      stateUpdates.targetColumn = effectiveTargetColumn;
                    }
                    const effectiveProblemType =
                      savedAgentState.problemType ||
                      savedAgentState.modelSelection?.problem_type ||
                      savedAgentState.modelSelection?.task_type ||
                      savedAgentState.stageOutputs?.modelSelectionNode?.problem_type;
                    if (effectiveProblemType) {
                      stateUpdates.problemType = effectiveProblemType;
                    }
                    const effSplit = options?.splitEndDate || options?.splitDate || savedAgentState.splitEndDate || savedAgentState.splitDate;
                    if (effSplit) {
                      stateUpdates.splitDate = effSplit;
                      stateUpdates.splitEndDate = effSplit;
                      const existingTC = savedAgentState.trainingConfiguration || savedAgentState.stageOutputs?.trainingConfigurationNode;
                      if (existingTC) {
                        const updatedTC = {
                          ...existingTC,
                          splitDate: effSplit,
                          splitEndDate: effSplit,
                          configuration: {
                            ...(existingTC.configuration || {}),
                            splitDate: effSplit,
                            splitEndDate: effSplit,
                            split: {
                              ...(existingTC.configuration?.split || {}),
                              split_date: effSplit,
                            },
                          },
                        };
                        stateUpdates.trainingConfiguration = updatedTC;
                        if (stateUpdates.stageOutputs) {
                          stateUpdates.stageOutputs.trainingConfigurationNode = updatedTC;
                        }
                      }
                    }
                    if (options?.selectedModels && options.selectedModels.length > 0) {
                      stateUpdates.selectedModels = options.selectedModels;
                    } else if (savedAgentState.selectedModels && savedAgentState.selectedModels.length > 0) {
                      stateUpdates.selectedModels = savedAgentState.selectedModels;
                    }
                    if (options?.predictionHorizon !== undefined) {
                      stateUpdates.predictionHorizon = options.predictionHorizon;
                    }
                    if (options?.predictionFrequency) {
                      stateUpdates.predictionFrequency = options.predictionFrequency;
                    }
                    if (options?.predictionObjectiveStartDate) {
                      stateUpdates.predictionObjectiveStartDate = options.predictionObjectiveStartDate;
                    }
                    if (Object.keys(stateUpdates).length > 0) {
                      console.info(`[Workflow] Syncing project DB state into graph checkpointer for thread ${threadId}: ${Object.keys(stateUpdates).join(", ")}`);
                      await workflow.updateState(config, stateUpdates);
                      graphState = await workflow.getState(config).catch(() => null);
                    }
                  } else if (savedAgentState.schemaResolution || savedAgentState.stageOutputs) {
                    console.info(`[Workflow] Restoring graph checkpointer state from project database for thread ${threadId}`);

                    const predecessorNode = resolveSafePredecessorNode(options.step, savedAgentState);
                    const effSplit = options?.splitEndDate || options?.splitDate || savedAgentState.splitEndDate || savedAgentState.splitDate || "";
                    const restoredState = {
                      ...savedAgentState,
                      connectorId,
                      projectId: options.projectId,
                      userPrompt: userPrompt ?? meta.userPrompt ?? savedAgentState.userPrompt ?? "",
                      stageStatuses: normalizeFlatStageStatuses(savedAgentState.stageStatuses),
                      stageOutputs: normalizeStageOutputs(savedAgentState.stageOutputs),
                      runTimestamp: savedAgentState.runTimestamp || activeRunTimestamp,
                      status: "In-Progress",
                      requiresApproval: false,
                      nextStep: undefined,
                      summary: `Advancing to ${options.step || "Feature Engineering"}`,
                      splitDate: effSplit,
                      splitEndDate: effSplit,
                      ...(effSplit && (savedAgentState.trainingConfiguration || savedAgentState.stageOutputs?.trainingConfigurationNode) ? {
                        trainingConfiguration: {
                          ...(savedAgentState.trainingConfiguration || savedAgentState.stageOutputs?.trainingConfigurationNode || {}),
                          splitDate: effSplit,
                          splitEndDate: effSplit,
                          configuration: {
                            ...((savedAgentState.trainingConfiguration || savedAgentState.stageOutputs?.trainingConfigurationNode || {}).configuration || {}),
                            splitDate: effSplit,
                            splitEndDate: effSplit,
                            split: {
                              ...((savedAgentState.trainingConfiguration || savedAgentState.stageOutputs?.trainingConfigurationNode || {}).configuration?.split || {}),
                              split_date: effSplit,
                            },
                          },
                        },
                      } : {}),
                      ...(savedAgentState.stageOutputs ? {
                        stageOutputs: {
                          ...savedAgentState.stageOutputs,
                          ...(effSplit && savedAgentState.stageOutputs.trainingConfigurationNode ? {
                            trainingConfigurationNode: {
                              ...savedAgentState.stageOutputs.trainingConfigurationNode,
                              splitDate: effSplit,
                              splitEndDate: effSplit,
                              configuration: {
                                ...(savedAgentState.stageOutputs.trainingConfigurationNode.configuration || {}),
                                splitDate: effSplit,
                                splitEndDate: effSplit,
                                split: {
                                  ...(savedAgentState.stageOutputs.trainingConfigurationNode.configuration?.split || {}),
                                  split_date: effSplit,
                                },
                              },
                            },
                          } : {}),
                        },
                      } : {}),
                      selectedModels: options?.selectedModels || savedAgentState.selectedModels || [],
                      predictionHorizon: options?.predictionHorizon ?? savedAgentState.predictionHorizon ?? 12,
                      predictionFrequency: options?.predictionFrequency || savedAgentState.predictionFrequency || "Weekly",
                      predictionObjectiveStartDate: options?.predictionObjectiveStartDate || savedAgentState.predictionObjectiveStartDate || "",
                      direction: savedAgentState.direction || savedAgentState.modelSelection?.direction || savedAgentState.stageOutputs?.modelSelectionNode?.direction || "",
                      primaryMetric: savedAgentState.primaryMetric || savedAgentState.modelSelection?.primary_metric || savedAgentState.stageOutputs?.modelSelectionNode?.primary_metric || "",
                      targetColumn: savedAgentState.targetColumn || savedAgentState.modelSelection?.target_entity?.name || savedAgentState.stageOutputs?.modelSelectionNode?.target_entity?.name || "",
                      problemType: savedAgentState.problemType || savedAgentState.modelSelection?.problem_type || savedAgentState.modelSelection?.task_type || savedAgentState.stageOutputs?.modelSelectionNode?.problem_type || "",
                    };

                    await workflow.updateState(config, restoredState, predecessorNode);
                    graphState = await workflow.getState(config).catch(() => null);
                    hasState = Array.isArray(graphState?.next) && graphState.next.length > 0;
                    console.info(`[Workflow] Restored graph state. Next node to execute: [${graphState?.next?.join(", ")}]`);
                  }
                }
              } catch (restoreErr: any) {
                console.warn(`[Workflow] Failed to restore state from project:`, restoreErr?.message);
              }
            }

            if (hasState) {
              stream = await workflow.stream(null, config);
            } else {
              const approvingTrainingConfigPhase = options.step === "Training Configuration" || options.step === "trainingConfigurationNode" || options.step === "trainingConfiguration";
              const approvingModelPhase = approvingTrainingConfigPhase || options.step === "Model Training & Validation" || options.step === "modelSelection" || options.step === "modelSelectionNode" || options.step === "Model Selection";
              console.warn(`[Workflow] No checkpoint found for approve. Restoring the ${approvingTrainingConfigPhase ? "Model Selection" : approvingModelPhase ? "Feature Engineering" : "Data Ingestion"} boundary.`);
              const fallbackState = {
                connectorId,
                projectId: options?.projectId ?? "",
                userPrompt: userPrompt ?? "",
                runTimestamp: activeRunTimestamp,
                status: "In-Progress",
                requiresApproval: false,
                nextStep: undefined,
                summary: `Resuming workflow at ${approvingTrainingConfigPhase ? "Training Configuration" : approvingModelPhase ? "Model Training & Validation" : "Feature Engineering"}`,
                inspection: {},
                dataProfile: {},
                schemaResolution: {},
                batchedTables: [],
                steps: [],
                stageOutputs: {},
                stageStatuses: approvingTrainingConfigPhase
                  ? { ...INITIAL_STAGE_STATUSES, inspect: "Completed", profileData: "Completed", resolveSchema: "Completed", hierarchyMapperNode: "Completed", featureArchitectNode: "Completed", featureValidatorNode: "Completed", exogenous: "Completed", modelSelectionNode: "Completed", trainingConfigurationNode: "In-Progress" }
                  : approvingModelPhase
                    ? { ...INITIAL_STAGE_STATUSES, inspect: "Completed", profileData: "Completed", resolveSchema: "Completed", hierarchyMapperNode: "Completed", featureArchitectNode: "Completed", featureValidatorNode: "Completed", exogenous: "Completed", modelSelectionNode: "In-Progress" }
                    : { ...INITIAL_STAGE_STATUSES, inspect: "Completed", profileData: "Completed", resolveSchema: "Completed", hierarchyMapperNode: "In-Progress" }
              };
              await workflow.updateState(config, fallbackState, approvingTrainingConfigPhase ? "modelSelectionNode" : approvingModelPhase ? "exogenous" : "resolveSchema");
              stream = await workflow.stream(null, config);
            }
          } else if (options?.action === "resume") {
            const detectedPausedStep = findPausedStep(savedAgentState?.stageStatuses, savedAgentState?.currentNode);
            const targetStep = resumeTargetStep || detectedPausedStep;
            const predecessorNode = resumePredecessorNode || getStageRuleByNode(targetStep)?.predecessorNode;
            if (!targetStep || !predecessorNode) {
              throw new Error("Cannot resume workflow without a recognized paused step.");
            }
            console.info(`[Workflow] Resume — continuing from thread ${threadId} at phase ${targetStep} (detected paused: ${detectedPausedStep || "none"})`);

            let graphState = await workflow.getState(config).catch(() => null);
            let hasState = Array.isArray(graphState?.next) && graphState.next.length > 0;

            if (options?.projectId) {
              try {
                const project = await this.projectService.getById(options.projectId);
                const projectAgentState = project?.agentState as (typeof AgentState.State & Record<string, any>) | undefined;
                if (projectAgentState) {
                    savedAgentState = projectAgentState;
                    const resumedStageStatuses = applyResumeToStageStatuses(savedAgentState.stageStatuses, targetStep);
                    if (hasState) {
                      const stateUpdates: Record<string, any> = {
                        status: "In-Progress",
                        stageStatuses: normalizeFlatStageStatuses(resumedStageStatuses),
                      };
                      if (savedAgentState.modelSelection) {
                        stateUpdates.modelSelection = savedAgentState.modelSelection;
                      }
                      if (savedAgentState.trainingConfiguration) {
                        stateUpdates.trainingConfiguration = savedAgentState.trainingConfiguration;
                      }
                      if (savedAgentState.stageOutputs) {
                        stateUpdates.stageOutputs = {
                          ...(graphState?.values?.stageOutputs || {}),
                          ...savedAgentState.stageOutputs,
                        };
                      }
                      if (savedAgentState.userPrompt) {
                        stateUpdates.userPrompt = savedAgentState.userPrompt;
                      }
                      const resumeDirection =
                        savedAgentState.direction ||
                        savedAgentState.modelSelection?.direction ||
                        savedAgentState.stageOutputs?.modelSelectionNode?.direction;
                      if (resumeDirection) {
                        stateUpdates.direction = resumeDirection;
                      }
                      const resumePrimaryMetric =
                        savedAgentState.primaryMetric ||
                        savedAgentState.modelSelection?.primary_metric ||
                        savedAgentState.stageOutputs?.modelSelectionNode?.primary_metric;
                      if (resumePrimaryMetric) {
                        stateUpdates.primaryMetric = resumePrimaryMetric;
                      }
                      const resumeTargetColumn =
                        savedAgentState.targetColumn ||
                        savedAgentState.modelSelection?.target_entity?.name ||
                        savedAgentState.stageOutputs?.modelSelectionNode?.target_entity?.name;
                      if (resumeTargetColumn) {
                        stateUpdates.targetColumn = resumeTargetColumn;
                      }
                      const resumeProblemType =
                        savedAgentState.problemType ||
                        savedAgentState.modelSelection?.problem_type ||
                        savedAgentState.modelSelection?.task_type ||
                        savedAgentState.stageOutputs?.modelSelectionNode?.problem_type;
                      if (resumeProblemType) {
                        stateUpdates.problemType = resumeProblemType;
                      }
                      if (Object.keys(stateUpdates).length > 0) {
                        console.info(`[Workflow] Syncing project DB state into graph checkpointer for resume on thread ${threadId}: ${Object.keys(stateUpdates).join(", ")}`);
                        await workflow.updateState(config, stateUpdates);
                        graphState = await workflow.getState(config).catch(() => null);
                      }
                    } else {
                      console.info(`[Workflow] Restoring graph checkpointer state from project database for resume on thread ${threadId}`);

                      const restoredState = {
                        ...savedAgentState,
                        connectorId,
                        projectId: options.projectId,
                        userPrompt: userPrompt ?? meta.userPrompt ?? savedAgentState.userPrompt ?? "",
                        runTimestamp: savedAgentState.runTimestamp || activeRunTimestamp,
                        status: "In-Progress",
                        stageStatuses: normalizeFlatStageStatuses(resumedStageStatuses),
                        stageOutputs: normalizeStageOutputs(savedAgentState.stageOutputs),
                        summary: `Resuming from ${targetStep} phase`,
                        splitDate: options?.splitEndDate || options?.splitDate || savedAgentState.splitEndDate || savedAgentState.splitDate || "",
                        splitEndDate: options?.splitEndDate || options?.splitDate || savedAgentState.splitEndDate || savedAgentState.splitDate || "",
                        selectedModels: options?.selectedModels || savedAgentState.selectedModels || [],
                        direction: savedAgentState.direction || savedAgentState.modelSelection?.direction || savedAgentState.stageOutputs?.modelSelectionNode?.direction || "",
                        primaryMetric: savedAgentState.primaryMetric || savedAgentState.modelSelection?.primary_metric || savedAgentState.stageOutputs?.modelSelectionNode?.primary_metric || "",
                        targetColumn: savedAgentState.targetColumn || savedAgentState.modelSelection?.target_entity?.name || savedAgentState.stageOutputs?.modelSelectionNode?.target_entity?.name || "",
                        problemType: savedAgentState.problemType || savedAgentState.modelSelection?.problem_type || savedAgentState.modelSelection?.task_type || savedAgentState.stageOutputs?.modelSelectionNode?.problem_type || "",
                      };

                      if (predecessorNode !== "__start__") {
                        await workflow.updateState(config, restoredState, predecessorNode);
                        graphState = await workflow.getState(config).catch(() => null);
                        hasState = Array.isArray(graphState?.next) && graphState.next.length > 0;
                        console.info(`[Workflow] Resume state restored. Next nodes: [${Array.isArray(graphState?.next) ? graphState.next.join(", ") : "none"}]`);
                      }
                    }
                }
              } catch (e) {
                console.error("[Workflow] Failed to restore resume state from database:", e);
                throw Object.assign(new Error(
                  `Failed to restore workflow state for resume at ${targetStep}.`,
                ), { cause: e });
              }
            }

            if (!hasState && predecessorNode !== "__start__") {
              throw new Error(
                `Failed to restore workflow checkpoint before ${targetStep}; refusing to restart from the beginning.`
              );
            }

            // If the graph is currently halted at an approval gate (e.g. trainingConfigurationNode, hierarchyMapperNode, modelSelectionNode)
            // and the user sent generic "resume" (not "approve"):
            // We MUST NOT stream into the node (which advances execution past the approval gate).
            // Instead, we maintain the paused/approval state and notify the client!
            const nextNode = Array.isArray(graphState?.next) ? graphState.next[0] : undefined;
            const approvalTarget = nextNode === "hierarchyMapperNode"
              ? "Feature Engineering"
              : (nextNode === "modelSelectionNode" || nextNode === "modelSelection")
                ? "Model Training & Validation"
                : (nextNode === "trainingConfigurationNode" || nextNode === "trainingConfiguration")
                  ? "Training Configuration"
                  : undefined;

            const isAwaitingApprovalGate = Boolean(
              approvalTarget &&
              hasState &&
              savedAgentState?.status !== "Paused" &&
              (savedAgentState?.status === "Awaiting Approval" ||
                Boolean(savedAgentState?.requiresApproval))
            );

            if (isAwaitingApprovalGate) {
              console.info(`[Workflow] Thread ${threadId} is at approval gate before ${approvalTarget}. Maintaining paused state awaiting user confirmation/approval.`);
              const completedPhase = approvalTarget === "Feature Engineering"
                ? "Data Ingestion"
                : approvalTarget === "Training Configuration"
                  ? "Model Selection"
                  : "Feature Engineering";
              const pausedStatuses = { ...(latestGraphStateValues.stageStatuses || savedAgentState?.stageStatuses || {}) };
              if (approvalTarget === "Feature Engineering") {
                pausedStatuses.hierarchyMapperNode = "Pending";
              } else if (approvalTarget === "Model Training & Validation") {
                pausedStatuses.modelSelectionNode = "Pending";
              } else if (approvalTarget === "Training Configuration") {
                pausedStatuses.trainingConfigurationNode = "Pending";
                if (pausedStatuses.modelSelectionNode !== "Completed") {
                  pausedStatuses.modelSelectionNode = "Completed";
                }
              }
              const approvalSummary = approvalTarget === "Training Configuration"
                ? "Model Selection completed successfully. Please select candidate models and confirm for Training Configuration."
                : `${completedPhase} completed successfully. Approve to proceed to ${approvalTarget}.`;

              const pausedValues = {
                ...(savedAgentState || {}),
                ...(graphState?.values || {}),
                ...latestGraphStateValues,
                runTimestamp: latestGraphStateValues.runTimestamp || activeRunTimestamp,
                stageStatuses: pausedStatuses,
                status: "Awaiting Approval",
                requiresApproval: true,
                nextStep: approvalTarget,
                summary: approvalSummary,
                message: approvalSummary,
              };
              latestGraphStateValues = pausedValues;
              const pausedResult = buildResultFromGraphState({ values: pausedValues, next: graphState?.next }, threadId, connectorId);
              pausedResult.status = "Awaiting Approval";
              pausedResult.requiresApproval = true;
              pausedResult.nextStep = approvalTarget;
              pausedResult.stageStatuses = buildGroupedStageStatuses(normalizeFlatStageStatuses(pausedStatuses));
              if (options?.projectId) {
                await this.projectService.updateAgentState(options.projectId, pausedValues);
                pausedResult.agentThinking = await this.getAllProjectPipelineThinking(options.projectId, pipeline);
              }
              agentJobEvents.emit(`job:update:${threadId}`, pausedResult);
              return;
            }

            if (!hasState && predecessorNode === "__start__") {
              console.info(`[Workflow] Resuming thread ${threadId} from start at phase ${targetStep}`);
              if (!savedAgentState) {
                throw new Error(
                  `Cannot resume workflow at ${targetStep}: persisted project state is unavailable.`
                );
              }
              stream = await workflow.stream(
                {
                  ...savedAgentState,
                  connectorId,
                  projectId: options?.projectId ?? "",
                  userPrompt: userPrompt ?? meta.userPrompt ?? savedAgentState.userPrompt ?? "",
                  runTimestamp: savedAgentState.runTimestamp || activeRunTimestamp,
                  status: "In-Progress",
                  summary: `Resuming from ${targetStep} phase`,
                  stageOutputs: normalizeStageOutputs(savedAgentState.stageOutputs),
                  stageStatuses: normalizeFlatStageStatuses(
                    applyResumeToStageStatuses(savedAgentState.stageStatuses, targetStep)
                  ),
                },
                config
              );
            } else {
              stream = await workflow.stream(null, config);
            }
          } else {
            console.info(`[Workflow] Starting new workflow, thread ${threadId}, connectors: [${connectorId.join(", ")}]`);
            stream = await workflow.stream(
              {
                connectorId,
                projectId: options?.projectId ?? "",
                userPrompt: userPrompt ?? "",
                runTimestamp: activeRunTimestamp,
                splitDate: options?.splitEndDate || options?.splitDate || "",
                splitEndDate: options?.splitEndDate || options?.splitDate || "",
                selectedModels: options?.selectedModels || [],
                status: "In-Progress",
                summary: "Ingestion workflow started",
                inspection: {},
                dataProfile: {},
                schemaResolution: {},
                batchedTables: [],
                steps: [{ name: "Data Ingestion", status: "In-Progress", summary: "Data Ingestion node running..." }],
                stageOutputs: {},
                stageStatuses: { ...INITIAL_STAGE_STATUSES, inspect: "Pending" }
              },
              config
            );
          }

          for await (const chunk of stream) {
            if (this.stoppedSessions.has(threadId) || this.pausedSessions.has(threadId)) {
              console.info(`[Workflow] Initial stream loop interrupted for thread ${threadId} (paused: ${this.pausedSessions.has(threadId)}, stopped: ${this.stoppedSessions.has(threadId)})`);
              break;
            }

            const completedNodes = Object.keys(chunk || {});
            let currentStatuses = { ...(latestGraphStateValues.stageStatuses || {}) };
            for (const nodeName of completedNodes) {
              console.info(`[Workflow] Node [${nodeName}] completed`);
              currentStatuses = updateNodeStatuses(nodeName, currentStatuses);
            }
            currentStatuses = normalizeRuntimeStageStatuses(currentStatuses);

            const graphState = await workflow.getState(config);
            if (graphState?.values) {
              const prevModelSel = latestGraphStateValues.stageOutputs?.modelSelectionNode || latestGraphStateValues.modelSelection;
              const incomingModelSel = (graphState.values.stageOutputs as any)?.modelSelection || (graphState.values as any)?.modelSelection;
              const mergedModelSel = incomingModelSel ? {
                ...incomingModelSel,
                userSelection: incomingModelSel.userSelection || prevModelSel?.userSelection,
                selectedModelIds: incomingModelSel.selectedModelIds || prevModelSel?.selectedModelIds,
                models: incomingModelSel.models || prevModelSel?.models,
              } : prevModelSel;

              latestGraphStateValues = {
                ...latestGraphStateValues,
                ...graphState.values,
                runTimestamp: (graphState.values.runTimestamp as string) || latestGraphStateValues.runTimestamp || activeRunTimestamp,
                stageOutputs: {
                  ...(latestGraphStateValues.stageOutputs || {}),
                  ...(graphState.values.stageOutputs || {}),
                  ...(mergedModelSel ? { modelSelectionNode: mergedModelSel } : {}),
                },
                stageStatuses: { ...(graphState.values.stageStatuses || {}), ...currentStatuses }
              };
              if (mergedModelSel) {
                latestGraphStateValues.modelSelection = mergedModelSel;
              }
            } else {
              latestGraphStateValues.stageStatuses = currentStatuses;
            }
            latestGraphStateValues.runTimestamp = latestGraphStateValues.runTimestamp || activeRunTimestamp;
            const result = buildResultFromGraphState({ values: latestGraphStateValues, next: graphState?.next }, threadId, connectorId);
            if (result.status === "In-Progress") {
              result.requiresApproval = false;
            }
            if (options?.projectId) {
              result.agentThinking = await this.getAllProjectPipelineThinking(options.projectId, pipeline);
              await this.projectService.updateAgentState(options.projectId, latestGraphStateValues);
            }
            agentJobEvents.emit(`job:update:${threadId}`, result);
          }

          if (this.stoppedSessions.has(threadId)) {
            console.info(`[Workflow] Halting execution early: thread ${threadId} is stopped.`);
            const graphState = await workflow.getState(config).catch(() => null);
            const stoppedValues = {
              ...(graphState?.values || {}),
              status: "Stopped",
              summary: "Workflow stopped by user",
              message: "Workflow stopped by user.",
            };
            const stoppedResult = buildResultFromGraphState({ ...graphState, values: stoppedValues }, threadId, connectorId);
            stoppedResult.status = "Stopped";
            stoppedResult.summary = "Workflow stopped by user";
            stoppedResult.message = "Workflow stopped by user.";
            stoppedResult.requiresApproval = false;
            if (options?.projectId) {
              await this.projectService.updateAgentState(options.projectId, stoppedValues);
              stoppedResult.agentThinking = await this.getAllProjectPipelineThinking(options.projectId, pipeline);
            }
            agentJobEvents.emit(`job:update:${threadId}`, stoppedResult);
            return;
          }

          if (this.pausedSessions.has(threadId)) {
            console.info(`[Workflow] Halting execution early: thread ${threadId} is paused.`);
            const graphState = await workflow.getState(config).catch(() => null);
            const pausedStepCandidate =
              findPausedStep(latestGraphStateValues.stageStatuses) ||
              findPausedStep(graphState?.values?.stageStatuses) ||
              (latestGraphStateValues.currentNode && latestGraphStateValues.currentNode in NODE_CONFIG ? latestGraphStateValues.currentNode : undefined) ||
              (graphState?.next?.[0] && graphState.next[0] in NODE_CONFIG ? graphState.next[0] : undefined);
            const rawStatuses = {
              ...normalizeFlatStageStatuses(graphState?.values?.stageStatuses),
              ...normalizeFlatStageStatuses(latestGraphStateValues.stageStatuses),
            };
            const pausedStageStatuses = applyPauseToStageStatuses(rawStatuses, pausedStepCandidate);
            const pausedStepKey = findPausedStep(pausedStageStatuses, pausedStepCandidate) || "inspect";
            const pausedParentStage = NODE_CONFIG[pausedStepKey]?.stage;
            const pausedValues = {
              ...(graphState?.values || {}),
              ...latestGraphStateValues,
              status: "Paused",
              stageStatuses: pausedStageStatuses,
              currentNode: pausedStepKey,
              currentStage: pausedParentStage,
              summary: "Workflow paused by user",
              message: "Workflow paused by user.",
            };
            const pausedResult = buildResultFromGraphState({ ...graphState, values: pausedValues }, threadId, connectorId);
            pausedResult.status = "Paused";
            pausedResult.stageStatuses = pausedStageStatuses;
            pausedResult.currentNode = pausedStepKey;
            pausedResult.currentStage = pausedParentStage;
            pausedResult.summary = "Workflow paused by user";
            pausedResult.message = "Workflow paused by user.";
            pausedResult.requiresApproval = false;
            if (options?.projectId) {
              await this.projectService.updateAgentState(options.projectId, pausedValues);
              pausedResult.agentThinking = await this.getAllProjectPipelineThinking(options.projectId, pipeline);
            }
            agentJobEvents.emit(`job:update:${threadId}`, pausedResult);
            return;
          }

          let graphState = await workflow.getState(config);
          if (graphState?.values) {
            latestGraphStateValues = {
              ...latestGraphStateValues,
              ...graphState.values,
              stageOutputs: { ...(latestGraphStateValues.stageOutputs || {}), ...(graphState.values.stageOutputs || {}) },
              stageStatuses: { ...(latestGraphStateValues.stageStatuses || {}), ...(graphState.values.stageStatuses || {}) }
            };
          }

          const nextNode = Array.isArray(graphState?.next) ? graphState.next[0] : undefined;
          const gate = getApprovalGateForNode(nextNode);

          if (gate.isGate && nextNode) {
            console.info(`[Workflow] Pausing for user approval before ${gate.nextStep} (node: ${nextNode}).`);
            const pausedStatuses = { ...(latestGraphStateValues.stageStatuses || {}) };
            if (gate.rule) {
              pausedStatuses[gate.rule.id] = "Pending";
              if (gate.rule.id === "trainingConfigurationNode" || nextNode === "trainingConfigurationNode") {
                pausedStatuses.trainingConfigurationNode = "Pending";
                pausedStatuses.modelSelectionNode = "Completed";
                pausedStatuses.modelSelectionNode = "Completed";
              }
            }
            const stageOverrides: Partial<Record<StageKey, PipelineStepStatus>> = {};
            if (gate.nextStep === "Feature Engineering" || nextNode === "hierarchyMapperNode") {
              stageOverrides.dataIngestion = "Awaiting Approval";
            } else if (gate.nextStep === "Model Training & Validation" || nextNode === "modelSelectionNode") {
              stageOverrides.featureEngineering = "Awaiting Approval";
            } else {
              stageOverrides.modelTrainingValidation = "Awaiting Approval";
            }
            const groupedPausedStatuses = buildGroupedStageStatuses(normalizeFlatStageStatuses(pausedStatuses), stageOverrides);
            const pausedValues = {
              ...latestGraphStateValues,
              runTimestamp: latestGraphStateValues.runTimestamp || activeRunTimestamp,
              stageStatuses: groupedPausedStatuses,
              status: "Awaiting Approval",
              requiresApproval: true,
              nextStep: gate.nextStep,
              summary: gate.approvalPrompt,
              message: gate.approvalPrompt,
            };
            latestGraphStateValues = pausedValues;
            const pausedResult = buildResultFromGraphState({ values: pausedValues, next: graphState?.next }, threadId, connectorId);
            pausedResult.status = "Awaiting Approval";
            pausedResult.requiresApproval = true;
            pausedResult.nextStep = gate.nextStep;
            pausedResult.stageStatuses = groupedPausedStatuses;
            if (options?.projectId) {
              await this.projectService.updateAgentState(options.projectId, pausedValues);
              pausedResult.agentThinking = await this.getAllProjectPipelineThinking(options.projectId, pipeline);
            }
            agentJobEvents.emit(`job:update:${threadId}`, pausedResult);
            return;
          }

          while (
            Array.isArray(graphState?.next) &&
            graphState.next.length > 0 &&
            graphState?.values?.status !== "completed" &&
            graphState?.values?.status !== "failed" &&
            !this.stoppedSessions.has(threadId) &&
            !this.pausedSessions.has(threadId)
          ) {
            const nextNodes = graphState.next;
            const activeNodeName = nextNodes[0];
            const nodePipeline = getPipelineForSubstep(activeNodeName);
            services.pipeline = nodePipeline;
            pipeline = nodePipeline;
            console.info(`[Workflow] Node [${nextNodes.join(", ")}] started (pipeline: ${nodePipeline})`);
            const advanceStream = await workflow.stream(null, config);
            for await (const chunk of advanceStream) {
              if (this.stoppedSessions.has(threadId) || this.pausedSessions.has(threadId)) {
                console.info(`[Workflow] Advance stream loop interrupted for thread ${threadId} (paused: ${this.pausedSessions.has(threadId)}, stopped: ${this.stoppedSessions.has(threadId)})`);
                break;
              }

              const completedNodes = Object.keys(chunk || {});
              let currentStatuses = { ...(latestGraphStateValues.stageStatuses || {}) };
              for (const nodeName of completedNodes) {
                console.info(`[Workflow] Node [${nodeName}] completed`);
                currentStatuses = updateNodeStatuses(nodeName, currentStatuses);
              }
              currentStatuses = normalizeRuntimeStageStatuses(currentStatuses);

              const currentGraphState = await workflow.getState(config);
              if (currentGraphState?.values) {
                latestGraphStateValues = {
                  ...latestGraphStateValues,
                  ...currentGraphState.values,
                  runTimestamp: (currentGraphState.values.runTimestamp as string) || latestGraphStateValues.runTimestamp || activeRunTimestamp,
                  stageOutputs: { ...(latestGraphStateValues.stageOutputs || {}), ...(currentGraphState.values.stageOutputs || {}) },
                  stageStatuses: { ...currentStatuses, ...(currentGraphState.values.stageStatuses || {}) }
                };
              } else {
                latestGraphStateValues.stageStatuses = currentStatuses;
              }
              latestGraphStateValues.runTimestamp = latestGraphStateValues.runTimestamp || activeRunTimestamp;
              const result = buildResultFromGraphState({ values: latestGraphStateValues, next: currentGraphState?.next }, threadId, connectorId);
              if (result.status === "In-Progress") {
                result.requiresApproval = false;
              }
              if (options?.projectId) {
                result.agentThinking = await this.getAllProjectPipelineThinking(options.projectId, pipeline);
                await this.projectService.updateAgentState(options.projectId, latestGraphStateValues);
              }
              agentJobEvents.emit(`job:update:${threadId}`, result);
            }
            graphState = await workflow.getState(config);
            if (graphState?.values) {
              latestGraphStateValues = {
                ...latestGraphStateValues,
                ...graphState.values,
                runTimestamp: (graphState.values.runTimestamp as string) || latestGraphStateValues.runTimestamp || activeRunTimestamp,
                stageOutputs: { ...(latestGraphStateValues.stageOutputs || {}), ...(graphState.values.stageOutputs || {}) },
                stageStatuses: { ...(latestGraphStateValues.stageStatuses || {}), ...(graphState.values.stageStatuses || {}) }
              };
            }
            latestGraphStateValues.runTimestamp = latestGraphStateValues.runTimestamp || activeRunTimestamp;

            const loopNextNode = Array.isArray(graphState?.next) ? graphState.next[0] : undefined;
            const loopGate = getApprovalGateForNode(loopNextNode);

            if (loopGate.isGate && loopNextNode) {
              console.info(`[Workflow] Reached approval gate before ${loopGate.nextStep} (node: ${loopNextNode}). Halting advance stream loop.`);
              const pausedStatuses = { ...(latestGraphStateValues.stageStatuses || {}) };
              if (loopGate.rule) {
                pausedStatuses[loopGate.rule.id] = "Pending";
                if (loopGate.rule.id === "trainingConfigurationNode" || loopNextNode === "trainingConfigurationNode") {
                  pausedStatuses.trainingConfigurationNode = "Pending";
                  pausedStatuses.modelSelectionNode = "Completed";
                  pausedStatuses.modelSelectionNode = "Completed";
                }
              }
              const pausedValues = {
                ...latestGraphStateValues,
                runTimestamp: latestGraphStateValues.runTimestamp || activeRunTimestamp,
                stageStatuses: pausedStatuses,
                status: "Awaiting Approval",
                requiresApproval: true,
                nextStep: loopGate.nextStep,
                summary: loopGate.approvalPrompt,
                message: loopGate.approvalPrompt,
              };
              latestGraphStateValues = pausedValues;
              const pausedResult = buildResultFromGraphState({ values: pausedValues, next: graphState?.next }, threadId, connectorId);
              pausedResult.status = "Awaiting Approval";
              pausedResult.requiresApproval = true;
              pausedResult.nextStep = loopGate.nextStep;
              pausedResult.stageStatuses = buildGroupedStageStatuses(normalizeFlatStageStatuses(pausedStatuses));
              if (options?.projectId) {
                await this.projectService.updateAgentState(options.projectId, pausedValues);
                pausedResult.agentThinking = await this.getAllProjectPipelineThinking(options.projectId, pipeline);
              }
              agentJobEvents.emit(`job:update:${threadId}`, pausedResult);
              return;
            }
          }

          console.info(`[Workflow] State after invoke — next: [${Array.isArray(graphState?.next) ? graphState.next.join(", ") : "none"}], status: ${graphState?.values?.status || "unknown"}`);

          if (this.pausedSessions.has(threadId)) {
            const pausedStepCandidate =
              findPausedStep(latestGraphStateValues.stageStatuses) ||
              findPausedStep(graphState?.values?.stageStatuses) ||
              (latestGraphStateValues.currentNode && latestGraphStateValues.currentNode in NODE_CONFIG ? latestGraphStateValues.currentNode : undefined) ||
              (graphState?.next?.[0] && graphState.next[0] in NODE_CONFIG ? graphState.next[0] : undefined);
            const rawStatuses = {
              ...normalizeFlatStageStatuses(graphState?.values?.stageStatuses),
              ...normalizeFlatStageStatuses(latestGraphStateValues.stageStatuses),
            };
            const pausedStageStatuses = applyPauseToStageStatuses(rawStatuses, pausedStepCandidate);
            const pausedStepKey = findPausedStep(pausedStageStatuses, pausedStepCandidate) || "inspect";
            const pausedParentStage = NODE_CONFIG[pausedStepKey]?.stage;
            const pausedValues = {
              ...(graphState?.values || {}),
              ...latestGraphStateValues,
              status: "Paused",
              stageStatuses: pausedStageStatuses,
              currentNode: pausedStepKey,
              currentStage: pausedParentStage,
              summary: "Workflow paused by user",
              message: "Workflow paused by user.",
            };
            const pausedResult = buildResultFromGraphState({ ...graphState, values: pausedValues }, threadId, connectorId);
            pausedResult.status = "Paused";
            pausedResult.stageStatuses = pausedStageStatuses;
            pausedResult.currentNode = pausedStepKey;
            pausedResult.currentStage = pausedParentStage;
            pausedResult.summary = "Workflow paused by user";
            pausedResult.message = "Workflow paused by user.";
            pausedResult.requiresApproval = false;
            if (options?.projectId) {
              await this.projectService.updateAgentState(options.projectId, pausedValues);
              pausedResult.agentThinking = await this.getAllProjectPipelineThinking(options.projectId, pipeline);
            }
            agentJobEvents.emit(`job:update:${threadId}`, pausedResult);
            return;
          }

          if (this.stoppedSessions.has(threadId)) {
            const stoppedValues = {
              ...(graphState?.values || {}),
              status: "Stopped",
              summary: "Workflow stopped by user",
              message: "Workflow stopped by user.",
            };
            const stoppedResult = buildResultFromGraphState({ ...graphState, values: stoppedValues }, threadId, connectorId);
            stoppedResult.status = "Stopped";
            stoppedResult.summary = "Workflow stopped by user";
            stoppedResult.message = "Workflow stopped by user.";
            stoppedResult.requiresApproval = false;
            if (options?.projectId) {
              await this.projectService.updateAgentState(options.projectId, stoppedValues);
              stoppedResult.agentThinking = await this.getAllProjectPipelineThinking(options.projectId, pipeline);
            }
            agentJobEvents.emit(`job:update:${threadId}`, stoppedResult);
            return;
          }

          const result = buildResultFromGraphState(graphState, threadId, connectorId);
          if (result.status === "In-Progress" || options?.action === "approve") {
            result.requiresApproval = false;
          }

          if (options?.projectId) {
            try {
              const finalValuesToPersist = {
                ...(graphState?.values ?? {}),
                runTimestamp: (graphState?.values?.runTimestamp as string) || latestGraphStateValues.runTimestamp || activeRunTimestamp,
              };
              await this.projectService.updateAgentState(
                options.projectId,
                finalValuesToPersist,
                userPrompt ?? meta.userPrompt
              );
            } catch (persistError: any) {
              console.warn(`[Workflow] Failed to persist agent state for project ${options.projectId}:`, persistError?.message || persistError);
            }
          }

          if (traceSession) {
            await this.traceHelper.appendTraceEntry("workflow:end", "output", {
              connectorId,
              startedAt: runStartedAt,
              completedAt: new Date().toISOString(),
              status: result.status,
              summary: result.summary,
              nextStep: result.nextStep,
            });
          }

          if (options?.projectId) {
            result.agentThinking = await this.getAllProjectPipelineThinking(options.projectId, pipeline);
          }
          agentJobEvents.emit(`job:update:${threadId}`, result);
        } catch (err: any) {
          console.error(`[Workflow] Execution error:`, err?.message || err);
          if (options?.projectId) {
            try {
              const rawStatuses = latestGraphStateValues.stageStatuses;
              let failedStageStatuses = rawStatuses;
              if (rawStatuses && typeof rawStatuses === "object") {
                const updated: Record<string, any> = JSON.parse(JSON.stringify(rawStatuses));
                for (const stageKey of Object.keys(updated)) {
                  const stageObj = updated[stageKey];
                  if (stageObj && typeof stageObj === "object") {
                    let hasInProgress = false;
                    for (const stepKey of Object.keys(stageObj)) {
                      if (stageObj[stepKey] === "In-Progress") {
                        stageObj[stepKey] = "Failed";
                        hasInProgress = true;
                      }
                    }
                    if (hasInProgress || stageObj.status === "In-Progress") {
                      stageObj.status = "Failed";
                    }
                  }
                }
                failedStageStatuses = updated;
              }
              const failedValues = {
                ...latestGraphStateValues,
                status: "Failed",
                stageStatuses: failedStageStatuses,
                summary: `Execution failed: ${err?.message || String(err)}`,
                message: `Execution failed: ${err?.message || String(err)}`,
              };
              await this.projectService.updateAgentState(options.projectId, failedValues);
            } catch (pErr) {
              console.warn(`[Workflow] Failed to persist failed agent state for project ${options.projectId}:`, pErr);
            }
          }
          throw err;
        } finally {
          this.activeRuns.delete(threadId);
          this.sessionAbortControllers.delete(threadId);
          agentJobEvents.emit(`job:close:${threadId}`);
        }
      };

      const onJobUpdate = (result: any) => {
        queue.push(result);
      };

      const onJobClose = () => {
        queue.close();
      };

      agentJobEvents.on(`job:update:${threadId}`, onJobUpdate);
      agentJobEvents.once(`job:close:${threadId}`, onJobClose);

      this.queueService.enqueue(
        threadId,
        options?.projectId || "general",
        connectorId,
        userPrompt || meta?.userPrompt || "",
        executeWorkflowTask
      ).catch((err) => {
        console.error(`[Workflow] Failed to enqueue job ${threadId}:`, err);
        queue.push({
          connectorId,
          status: "failed",
          summary: `Enqueue failed: ${err.message || String(err)}`,
          sessionId: threadId,
        } as any);
        queue.close();
      });

      try {
        for await (const update of queue) {
          yield update;
        }
      } finally {
        agentJobEvents.off(`job:update:${threadId}`, onJobUpdate);
        agentJobEvents.off(`job:close:${threadId}`, onJobClose);
      }

    } catch (error: any) {
      console.error(`[Workflow] Run failed:`, error?.message || error);
      if (traceSession) {
        await this.traceHelper.appendTraceEntry("workflow:error", "error", {
          connectorId,
          error: error?.message || String(error),
        }).catch(() => { });
      }
      throw error;
    } finally {
      this.traceHelper.clearTraceSession();
    }
  }

  private async *streamThinking(
    projectId: string,
    pipeline: string,
    substep: string,
    baseResult: IngestionAgentRunResult,
    logs: string[],
    threadId?: string
  ): AsyncGenerator<IngestionAgentRunResult, void, unknown> {
    const thinkingLogs: Array<{ time: string; text: string; done: boolean }> = [];

    await this.agentThinkingService.deleteThinking(projectId, pipeline, substep);

    for (let i = 0; i < logs.length; i++) {
      if (threadId && this.stoppedSessions.has(threadId)) {
        console.info(`[Workflow] Aborting streamThinking for stopped thread ${threadId}`);
        return;
      }

      const now = new Date();
      const timeStr = now.toLocaleTimeString("en-US", { hour12: true, hour: "2-digit", minute: "2-digit", second: "2-digit" });

      for (const log of thinkingLogs) {
        log.done = true;
      }

      thinkingLogs.push({
        time: timeStr,
        text: logs[i],
        done: false,
      });

      await this.agentThinkingService.saveThinking(projectId, pipeline, substep, thinkingLogs);

      const allThinking = await this.getAllProjectPipelineThinking(projectId, pipeline);

      yield {
        ...baseResult,
        agentThinking: allThinking,
      };

      await new Promise((resolve) => setTimeout(resolve, 600));
    }

    if (thinkingLogs.length > 0) {
      thinkingLogs[thinkingLogs.length - 1].done = true;
      await this.agentThinkingService.saveThinking(projectId, pipeline, substep, thinkingLogs);

      const allThinking = await this.getAllProjectPipelineThinking(projectId, pipeline);
      yield {
        ...baseResult,
        agentThinking: allThinking,
      };
    }
  }

  private async getAllProjectPipelineThinking(projectId: string, _pipeline?: string): Promise<Record<string, Array<{ time: string; text: string; done: boolean }>>> {
    try {
      const allLogs = await this.agentThinkingService.getAllThinking(projectId);
      const map: Record<string, Array<{ time: string; text: string; done: boolean }>> = { ...allLogs };

      const aliasPairs: [string, string][] = [
        ["inspect", "Data Inspection"],
        ["profileData", "Data Profiling"],
        ["resolveSchema", "Schema Resolver"],
        ["hierarchyMapperNode", "Hierarchy Mapper"],
        ["hierarchyMapper", "Hierarchy Mapper"],
        ["relationshipBuilder", "Hierarchy Mapper"],
        ["formBuilder", "Hierarchy Mapper"],
        ["featureArchitectNode", "Feature Architect"],
        ["featureArchitect", "Feature Architect"],
        ["featureValidatorNode", "Feature Validator"],
        ["featureValidator", "Feature Validator"],
        ["exogenousScout", "Exogenous Scout"],
        ["exogenous", "Exogenous Scout"],
        ["modelSelectionNode", "Model Selection"],
        ["modelSelection", "Model Selection"],
        ["finalModelSelectionNode", "Model Selection"],
        ["trainingConfigurationNode", "Training Configuration"],
        ["trainingConfiguration", "Training Configuration"],
        ["preFlightNode", "Pre Flight"],
        ["preFlight", "Pre Flight"],
        ["modelTrainingCodeNode", "Model Training Code Generation"],
        ["modelTrainingCode", "Model Training Code Generation"],
        ["modelTrainingExecNode", "Model Training"],
        ["modelTrainingExec", "Model Training"],
        ["modelTrainingNode", "Model Training"],
        ["modelTraining", "Model Training"],
        ["modelEvaluationNode", "Model Training"],
        ["modelValidationNode", "Model Validation"],
        ["modelValidation", "Model Validation"],
      ];

      for (const [nodeId, title] of aliasPairs) {
        if (map[title] && !map[nodeId]) {
          map[nodeId] = map[title];
        } else if (map[nodeId] && !map[title]) {
          map[title] = map[nodeId];
        }
      }

      const faWorkers = [
        "featureSupervisor",
        "featureCreation",
        "featureTransformation",
        "buildDataset",
        "dataValidation",
        "featureExtraction",
        "featureSelection",
        "programRectifier",
        "Feature Engineering",
      ];
      const aggregatedFaLogs: Array<{ time: string; text: string; done: boolean }> = [
        ...(map["Feature Architect"] || []),
      ];

      for (const w of faWorkers) {
        if (map[w] && Array.isArray(map[w])) {
          for (const item of map[w]) {
            if (!aggregatedFaLogs.some((l) => l.text === item.text)) {
              aggregatedFaLogs.push(item);
            }
          }
        }
      }

      if (aggregatedFaLogs.length > 0) {
        map["Feature Architect"] = aggregatedFaLogs;
        map["featureArchitectNode"] = aggregatedFaLogs;
        map["featureArchitect"] = aggregatedFaLogs;
      }

      return map;
    } catch (err) {
      console.warn("Failed to retrieve agent thinking logs:", err);
      return {};
    }
  }

  async stop(sessionId?: string, projectId?: string): Promise<IngestionAgentRunResult | { success: boolean; message: string }> {
    const resolvedSessionId = sessionId || this.findSessionIdForProject(projectId);
    const targetProjectId = projectId || (resolvedSessionId ? this.sessionMeta.get(resolvedSessionId)?.projectId : undefined);

    if (resolvedSessionId) {
      this.stoppedSessions.add(resolvedSessionId);
      this.activeRuns.delete(resolvedSessionId);
      this.sessionAbortControllers.get(resolvedSessionId)?.abort();
      this.sessionAbortControllers.delete(resolvedSessionId);
      console.info(`[Workflow] Session ${resolvedSessionId} marked as stopped.`);
    } else {
      console.info(`[Workflow] Stop requested for project ${targetProjectId || "unknown"}`);
    }

    if (targetProjectId) {
      for (const [sId, r] of this.activeRuns.entries()) {
        if (r.projectId === targetProjectId) {
          this.activeRuns.delete(sId);
        }
      }
    }

    try {
      if (resolvedSessionId) {
        const workflow = createAgentGraph(this.checkpointer);
        const services = {
          connectorService: this.connectorService,
          connectionTester: this.connectionTester,
          fileService: this.fileService,
          projectService: this.projectService,
          traceHelper: this.traceHelper,
        };
        const config = {
          configurable: {
            thread_id: resolvedSessionId,
            services,
          }
        };
        const graphState = await workflow.getState(config).catch(() => null);
        const meta = this.sessionMeta.get(resolvedSessionId);
        const updatedValues = {
          ...(graphState?.values || {}),
          status: "Stopped",
          summary: "Workflow stopped by user",
          message: "Workflow stopped by user.",
        };

        const result = buildResultFromGraphState({ ...graphState, values: updatedValues }, resolvedSessionId, graphState?.values?.connectorId || meta?.connectorId || []);
        result.status = "Stopped";
        result.summary = "Workflow stopped by user";
        result.message = "Workflow stopped by user.";
        result.requiresApproval = false;

        if (targetProjectId) {
          await this.projectService.updateAgentState(targetProjectId, updatedValues);
          console.info(`[Workflow] Project ${targetProjectId} agent state successfully updated to stopped.`);
        }
        agentJobEvents.emit(`job:update:${resolvedSessionId}`, result);
        return result;
      } else if (targetProjectId) {
        const updatedValues = {
          status: "Stopped",
          summary: "Workflow stopped by user",
          message: "Workflow stopped by user.",
        };
        await this.projectService.updateAgentState(targetProjectId, updatedValues);
        console.info(`[Workflow] Project ${targetProjectId} agent state successfully updated to stopped.`);
      }
      return { success: true, message: "Workflow stopped" };
    } catch (err: any) {
      console.error(`[Workflow] Failed to update stopped state for session ${resolvedSessionId || "unknown"}:`, err?.message || err);
      throw err;
    }
  }

  async pause(sessionId?: string, projectId?: string): Promise<IngestionAgentRunResult | { success: boolean; message: string }> {
    const resolvedSessionId = sessionId || this.findSessionIdForProject(projectId);
    const targetProjectId = projectId || (resolvedSessionId ? this.sessionMeta.get(resolvedSessionId)?.projectId : undefined);

    if (resolvedSessionId) {
      this.pausedSessions.add(resolvedSessionId);
      this.stoppedSessions.add(resolvedSessionId);
      this.activeRuns.delete(resolvedSessionId);
      this.sessionAbortControllers.get(resolvedSessionId)?.abort();
      console.info(`[Workflow] Session ${resolvedSessionId} marked as paused.`);
    } else {
      console.info(`[Workflow] Pause requested for project ${targetProjectId || "unknown"}`);
    }

    if (targetProjectId) {
      for (const [sId, r] of this.activeRuns.entries()) {
        if (r.projectId === targetProjectId) {
          this.activeRuns.delete(sId);
        }
      }
    }

    try {
      if (resolvedSessionId) {
        const workflow = createAgentGraph(this.checkpointer);
        const services = {
          connectorService: this.connectorService,
          connectionTester: this.connectionTester,
          fileService: this.fileService,
          projectService: this.projectService,
          traceHelper: this.traceHelper,
        };
        const config = {
          configurable: {
            thread_id: resolvedSessionId,
            services,
          }
        };
        const graphState = await workflow.getState(config);
        const meta = this.sessionMeta.get(resolvedSessionId);
        let existingState: any = {};
        if (targetProjectId) {
          try {
            const proj = await this.projectService.getById(targetProjectId);
            existingState = (proj?.agentState as any) || {};
          } catch (error: any) {
            console.error(`[Workflow] Error getting existing state: ${error.message}`);
          }
        }

        if (existingState?.status === "stopped" || existingState?.status === "completed" || existingState?.status === "success") {
          console.info(`[Workflow] Project ${targetProjectId} is already in state '${existingState.status}', preserving terminal status.`);
          return { success: true, message: `Workflow already in status: ${existingState.status}` };
        }

        const pausedStepCandidate =
          findPausedStep(existingState?.stageStatuses) ||
          findPausedStep(graphState?.values?.stageStatuses) ||
          (existingState?.currentNode && existingState.currentNode in NODE_CONFIG ? existingState.currentNode : undefined) ||
          (graphState?.next?.[0] && graphState.next[0] in NODE_CONFIG ? graphState.next[0] : undefined);

        const rawStatuses = {
          ...normalizeFlatStageStatuses(graphState?.values?.stageStatuses),
          ...normalizeFlatStageStatuses(existingState?.stageStatuses),
        };
        const pausedStageStatuses = applyPauseToStageStatuses(rawStatuses, pausedStepCandidate);
        const pausedStepKey = findPausedStep(pausedStageStatuses, pausedStepCandidate) || "inspect";
        const pausedParentStage = NODE_CONFIG[pausedStepKey]?.stage;
        const summaryText = "Workflow paused by user";

        const pausedValues = {
          ...existingState,
          ...(graphState?.values || {}),
          status: "Paused",
          stageStatuses: pausedStageStatuses,
          currentNode: pausedStepKey,
          currentStage: pausedParentStage,
          summary: summaryText,
          message: summaryText,
          sessionId: resolvedSessionId,
          requiresApproval: false,
          nextStep: undefined,
        };

        const result = buildResultFromGraphState({ ...graphState, values: pausedValues }, resolvedSessionId, graphState?.values?.connectorId || meta?.connectorId || []);
        result.status = "Paused";
        result.stageStatuses = pausedStageStatuses;
        result.currentNode = pausedStepKey;
        result.currentStage = pausedParentStage;
        result.summary = summaryText;
        result.message = summaryText;
        result.requiresApproval = false;
        result.nextStep = undefined;

        if (targetProjectId) {
          await this.projectService.updateAgentState(targetProjectId, pausedValues);
          console.info(`[Workflow] Project ${targetProjectId} agent state updated to paused at step ${pausedStepKey}.`);
        }
        agentJobEvents.emit(`job:update:${resolvedSessionId}`, result);
        return result;
      } else if (targetProjectId) {
        let existingState: any = {};
        try {
          const proj = await this.projectService.getById(targetProjectId);
          existingState = (proj?.agentState as any) || {};
        } catch (_) { }

        if (existingState?.status === "Stopped" || existingState?.status === "stopped" || existingState?.status === "Completed" || existingState?.status === "completed" || existingState?.status === "success") {
          console.info(`[Workflow] Project ${targetProjectId} is already in state '${existingState.status}', preserving terminal status.`);
          return { success: true, message: `Workflow already in status: ${existingState.status}` };
        }

        const pausedStepCandidate =
          findPausedStep(existingState?.stageStatuses) ||
          (existingState?.currentNode && existingState.currentNode in NODE_CONFIG ? existingState.currentNode : undefined);
        const pausedStageStatuses = applyPauseToStageStatuses(existingState?.stageStatuses, pausedStepCandidate);
        const pausedStepKey = findPausedStep(pausedStageStatuses, pausedStepCandidate) || "inspect";
        const pausedParentStage = NODE_CONFIG[pausedStepKey]?.stage;

        await this.projectService.updateAgentState(targetProjectId, {
          ...existingState,
          status: "Paused",
          stageStatuses: pausedStageStatuses,
          currentNode: pausedStepKey,
          currentStage: pausedParentStage,
          summary: "Workflow paused by user",
          message: "Workflow paused by user.",
          requiresApproval: false,
          nextStep: undefined,
        });
        console.info(`[Workflow] Project ${targetProjectId} agent state updated to paused at step ${pausedStepKey}.`);
      }
      return { success: true, message: "Workflow paused" };
    } catch (err: any) {
      console.error(`[Workflow] Failed to update paused state for session ${resolvedSessionId || "unknown"}:`, err?.message || err);
      throw err;
    }
  }
}
