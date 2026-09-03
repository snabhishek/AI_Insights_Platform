import { MemorySaver } from "@langchain/langgraph";
import { ConnectorService } from "../../connector/connector.service";
import { ConnectionTesterService } from "../../connector/connectionTester.service";
import { IIngestionAgentService, IngestionAgentRunResult } from "./ingestionAgent.service.interface";
import { IFileService } from "../../file/file.service.interface";
import { ProjectService } from "../../project/project.service";
import { createAgentGraph } from "../../../agents/graph";
import {
  AgentTraceHelper,
  buildResultFromGraphState,
  mapRetryStepToInterruptNode
} from "../../../agents/utils/agentUtils";
import { WorkflowSessionMeta } from "../../../agents/state";
import { IAgentThinkingService } from "../agent-thinking/agentThinking.service.interface";
import { QueueService } from "../../queue/queue.service";
import { agentJobEvents } from "../../queue/queueEvents";
import { generateDateTimeStamp, ensureProjectRunFolder } from "../../../agents/tools/helpers";

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
    "Running anomaly detection (outliers, formatting errors)...",
    "Deriving rule-based preprocessing and transformation steps..."
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

  private findSessionIdForProject(projectId?: string): string | undefined {
    if (!projectId) return undefined;
    for (const [sessionId, meta] of this.sessionMeta.entries()) {
      if (meta.projectId === projectId && !this.stoppedSessions.has(sessionId)) {
        return sessionId;
      }
    }
    return undefined;
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
    options?: { sessionId?: string; action?: "approve" | "retry" | "resume"; step?: string; projectId?: string }
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
      const workflow = createAgentGraph(this.checkpointer);

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

      if (!meta) {
        meta = { threadId, connectorId, userPrompt: userPrompt ?? "", projectId: options?.projectId };
        this.sessionMeta.set(threadId, meta);
      } else if (options?.projectId && !meta.projectId) {
        meta.projectId = options.projectId;
        this.sessionMeta.set(threadId, meta);
      }

      const queue = new PushQueue<IngestionAgentRunResult>();

      let latestGraphStateValues: any = {
        status: "running",
        summary: "Ingestion workflow running",
        inspection: {},
        dataProfile: {},
        schemaResolution: {},
        preprocessing: {},
        batchedTables: [],
        steps: [{ name: "Data Ingestion", status: "running", summary: "Data Ingestion node running..." }],
        stageOutputs: {},
        stageStatuses: { inspect: "Running", profileData: "Pending", preprocess: "Pending", resolveSchema: "Pending" }
      };

      let savedAgentState: any = null;
      let pWs: any = null;
      if (options?.projectId) {
        try {
          pWs = await this.projectService.getProjectWithWorkspace(options.projectId);
          savedAgentState = pWs?.project?.agentState;
          if (savedAgentState && (options?.action === "resume" || options?.action === "retry" || options?.action === "approve")) {
            latestGraphStateValues = {
              ...savedAgentState,
              status: "running",
              summary: `Resuming workflow at ${options.step || "inspect"} phase`,
            };
          }
        } catch (e) {
          console.warn("[Workflow] Failed to lookup project with workspace:", e);
        }
      }

      // Determine the single unified runTimestamp for this execution
      const activeRunTimestamp =
        options?.action === "approve" ||
        options?.action === "retry" ||
        (options?.step && options.step !== "Data Inspection" && options.step !== "inspect")
          ? savedAgentState?.runTimestamp || generateDateTimeStamp()
          : generateDateTimeStamp();

      // Ensure the unified project run folder exists before workflow execution begins
      if (pWs && pWs.project && pWs.workspaceName) {
        try {
          await ensureProjectRunFolder(pWs.workspaceName, pWs.project.name, activeRunTimestamp);
        } catch (folderErr) {
          console.warn("[Workflow] Warning ensuring project run folder:", folderErr);
        }
      }

      this.stoppedSessions.delete(threadId);
      this.pausedSessions.delete(threadId);
      const sessionAbortController = new AbortController();
      this.sessionAbortControllers.set(threadId, sessionAbortController);

      // Populate services dependencies context to pass inside LangGraph config
      const services = {
        connectorService: this.connectorService,
        connectionTester: this.connectionTester,
        fileService: this.fileService,
        projectService: this.projectService,
        duckDBService: this.duckDBService,
        traceHelper: this.traceHelper,
        agentThinkingService: this.agentThinkingService,
        projectId: options?.projectId,
        pipeline: "Data Ingestion",
        runTimestamp: activeRunTimestamp,
        isCancelled: () => this.stoppedSessions.has(threadId) || this.pausedSessions.has(threadId),
        abortSignal: sessionAbortController.signal,
        onThinkingUpdate: async (substep: string) => {
          if (this.stoppedSessions.has(threadId) || this.pausedSessions.has(threadId)) return;
          try {
            const allThinking = options?.projectId
              ? await this.getAllProjectPipelineThinking(options.projectId, "Data Ingestion")
              : {};

            const currentStageStatuses = { ...(latestGraphStateValues.stageStatuses || {}) };
            let currentNode = "inspect";
            let currentStage = "inspect";

            if (substep === "Data Inspection" || substep === "Data Ingestion" || substep === "inspect") {
              currentNode = "inspect";
              currentStage = "inspect";
              currentStageStatuses.inspect = "In Progress";
            } else if (substep === "Data Profiling" || substep === "profileData") {
              currentNode = "profileData";
              currentStage = "profileData";
              currentStageStatuses.inspect = "Completed";
              currentStageStatuses.profileData = "In Progress";
            } else if (substep === "preprocess") {
              currentNode = "preprocess";
              currentStage = "preprocess";
              currentStageStatuses.inspect = "Completed";
              currentStageStatuses.profileData = "In Progress";
            } else if (substep === "Schema Resolver" || substep === "resolveSchema") {
              currentNode = "resolveSchema";
              currentStage = "resolveSchema";
              currentStageStatuses.inspect = "Completed";
              currentStageStatuses.profileData = "Completed";
              currentStageStatuses.preprocess = "Completed";
              currentStageStatuses.resolveSchema = "In Progress";
            } else if (substep === "Hierarchy Mapper" || substep === "hierarchyMapper" || substep === "hierarchyMapperNode" || substep === "relationshipBuilder" || substep === "formBuilder") {
              currentNode = "hierarchyMapperNode";
              currentStage = "hierarchyMapperNode";
              currentStageStatuses.inspect = "Completed";
              currentStageStatuses.profileData = "Completed";
              currentStageStatuses.preprocess = "Completed";
              currentStageStatuses.resolveSchema = "Completed";
              currentStageStatuses.hierarchyMapper = "In Progress";
            } else if (substep === "Feature Architect" || substep === "featureArchitect" || substep === "featureArchitectNode" || substep === "featureSupervisor" || substep === "featureCreation" || substep === "featureTransformation" || substep === "featureExtraction" || substep === "featureSelection") {
              currentNode = "featureArchitectNode";
              currentStage = "featureArchitectNode";
              currentStageStatuses.inspect = "Completed";
              currentStageStatuses.profileData = "Completed";
              currentStageStatuses.preprocess = "Completed";
              currentStageStatuses.resolveSchema = "Completed";
              currentStageStatuses.hierarchyMapper = "Completed";
              currentStageStatuses.featureArchitect = "In Progress";
            } else if (substep === "Feature Validator" || substep === "featureValidator" || substep === "featureValidatorNode") {
              currentNode = "featureArchitectNode";
              currentStage = "featureArchitectNode";
              currentStageStatuses.inspect = "Completed";
              currentStageStatuses.profileData = "Completed";
              currentStageStatuses.preprocess = "Completed";
              currentStageStatuses.resolveSchema = "Completed";
              currentStageStatuses.hierarchyMapper = "Completed";
              currentStageStatuses.featureArchitect = "Completed";
              currentStageStatuses.featureValidator = "In Progress";
            } else if (substep === "Exogenous Scout" || substep === "exogenous") {
              currentNode = "exogenousScout";
              currentStage = "exogenousScout";
              currentStageStatuses.inspect = "Completed";
              currentStageStatuses.profileData = "Completed";
              currentStageStatuses.preprocess = "Completed";
              currentStageStatuses.resolveSchema = "Completed";
              currentStageStatuses.hierarchyMapper = "Completed";
              currentStageStatuses.featureArchitect = "Completed";
              currentStageStatuses.featureValidator = "Completed";
              currentStageStatuses.exogenousScout = "In Progress";
            }

            const mergedValues = {
              ...latestGraphStateValues,
              stageStatuses: currentStageStatuses,
            };

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
      };

      const pipeline = "Data Ingestion";
      if (options?.projectId) {
        const projectId = options.projectId;
        let activeSubstep: string | undefined;

        if (options.action === "retry" && options.step) {
          const stepMap: Record<string, string> = {
            inspect: "Data Inspection",
            profileData: "Data Profiling",
            preprocess: "Data Profiling",
            resolveSchema: "Schema Resolver",
            hierarchyMapper: "Hierarchy Mapper",
            hierarchyMapperNode: "Hierarchy Mapper",
            "Hierarchy Mapper": "Hierarchy Mapper",
            featureArchitect: "Feature Architect",
            featureArchitectNode: "Feature Architect",
            "Feature Architect": "Feature Architect",
            featureValidator: "Feature Validator",
            featureValidatorNode: "Feature Validator",
            "Feature Validator": "Feature Validator",
            exogenous: "Exogenous Scout",
            exogenousScout: "Exogenous Scout",
            "Exogenous Scout": "Exogenous Scout",
            "Data Ingestion": "Data Ingestion",
            "Data Profiling": "Data Profiling",
            "Schema Resolver": "Schema Resolver",
            "Feature Engineering": "Hierarchy Mapper"
          };
          const substep = stepMap[options.step];
          if (substep) {
            activeSubstep = substep;
            if (substep === "Data Inspection" || substep === "Data Ingestion") {
              await this.agentThinkingService.deleteThinking(projectId, pipeline, "Data Inspection");
              await this.agentThinkingService.deleteThinking(projectId, pipeline, "Data Ingestion");
              await this.agentThinkingService.deleteThinking(projectId, pipeline, "Data Profiling");
              await this.agentThinkingService.deleteThinking(projectId, pipeline, "Schema Resolver");
              await this.agentThinkingService.deleteThinking(projectId, pipeline, "Hierarchy Mapper");
              await this.agentThinkingService.deleteThinking(projectId, pipeline, "Feature Architect");
              await this.agentThinkingService.deleteThinking(projectId, pipeline, "Feature Validator");
              await this.agentThinkingService.deleteThinking(projectId, pipeline, "Exogenous Scout");
              await this.agentThinkingService.deleteThinking(projectId, pipeline, "Feature Engineering");
            } else if (substep === "Data Profiling") {
              await this.agentThinkingService.deleteThinking(projectId, pipeline, "Data Profiling");
              await this.agentThinkingService.deleteThinking(projectId, pipeline, "Schema Resolver");
              await this.agentThinkingService.deleteThinking(projectId, pipeline, "Hierarchy Mapper");
              await this.agentThinkingService.deleteThinking(projectId, pipeline, "Feature Architect");
              await this.agentThinkingService.deleteThinking(projectId, pipeline, "Feature Validator");
              await this.agentThinkingService.deleteThinking(projectId, pipeline, "Exogenous Scout");
              await this.agentThinkingService.deleteThinking(projectId, pipeline, "Feature Engineering");
            } else if (substep === "Schema Resolver") {
              await this.agentThinkingService.deleteThinking(projectId, pipeline, "Schema Resolver");
              await this.agentThinkingService.deleteThinking(projectId, pipeline, "Hierarchy Mapper");
              await this.agentThinkingService.deleteThinking(projectId, pipeline, "Feature Architect");
              await this.agentThinkingService.deleteThinking(projectId, pipeline, "Feature Validator");
              await this.agentThinkingService.deleteThinking(projectId, pipeline, "Exogenous Scout");
            } else if (substep === "Hierarchy Mapper") {
              await this.agentThinkingService.deleteThinking(projectId, pipeline, "Hierarchy Mapper");
              await this.agentThinkingService.deleteThinking(projectId, pipeline, "Feature Architect");
              await this.agentThinkingService.deleteThinking(projectId, pipeline, "Feature Validator");
              await this.agentThinkingService.deleteThinking(projectId, pipeline, "Exogenous Scout");
              await this.agentThinkingService.deleteThinking(projectId, pipeline, "Feature Engineering");
            } else if (substep === "Feature Architect") {
              await this.agentThinkingService.deleteThinking(projectId, pipeline, "Feature Architect");
              await this.agentThinkingService.deleteThinking(projectId, pipeline, "Feature Validator");
              await this.agentThinkingService.deleteThinking(projectId, pipeline, "Exogenous Scout");
              await this.agentThinkingService.deleteThinking(projectId, pipeline, "Feature Engineering");
            } else if (substep === "Feature Validator") {
              await this.agentThinkingService.deleteThinking(projectId, pipeline, "Feature Validator");
              await this.agentThinkingService.deleteThinking(projectId, pipeline, "Exogenous Scout");
              await this.agentThinkingService.deleteThinking(projectId, pipeline, "Feature Engineering");
            } else if (substep === "Exogenous Scout") {
              await this.agentThinkingService.deleteThinking(projectId, pipeline, "Exogenous Scout");
            } else if (substep === "Feature Engineering") {
              await this.agentThinkingService.deleteThinking(projectId, pipeline, "Feature Engineering");
            }
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
          }
        } else {
          activeSubstep = "Data Inspection";
          await this.agentThinkingService.clearProjectPipelineThinking(projectId, pipeline);

          const cleanInitialState = {
            connectorId,
            projectId: options.projectId,
            userPrompt: userPrompt ?? "",
            runTimestamp: activeRunTimestamp,
            batchedTables: [],
            inspection: {},
            dataProfile: {},
            preprocess: {},
            schemaResolution: {},
            hierarchyMapper: {},
            featureArchitect: {},
            featureValidator: {},
            exogenousScout: {},
            status: "running",
            summary: "Ingestion workflow started",
            steps: [{ name: "Data Inspection", status: "running", summary: "Data Inspection node running..." }],
            stageOutputs: {},
            stageStatuses: {
              inspect: "In Progress",
              profileData: "Pending",
              preprocess: "Pending",
              resolveSchema: "Pending",
              hierarchyMapper: "Pending",
              featureArchitect: "Pending",
              featureValidator: "Pending",
              exogenousScout: "Pending"
            }
          };
          try {
            await this.projectService.updateAgentState(options.projectId, cleanInitialState, userPrompt);
          } catch (e) {
            console.warn("[Workflow] Failed to reset project agent state on new run:", e);
          }
        }

        if (activeSubstep) {
          const logs = SUBSTEP_THINKING_TEMPLATES[activeSubstep] || [];
          const currentGraphState = await workflow.getState(config).catch(() => null);
          const calculatedBase = buildResultFromGraphState(currentGraphState, threadId, connectorId);

          const inspectStatus = (activeSubstep === "Data Profiling" || activeSubstep === "Schema Resolver" || activeSubstep === "Hierarchy Mapper" || activeSubstep === "Feature Architect" || activeSubstep === "Feature Validator" || activeSubstep === "Exogenous Scout" || activeSubstep === "Feature Engineering") ? "Completed" : "In Progress";
          const profileStatus = (activeSubstep === "Schema Resolver" || activeSubstep === "Hierarchy Mapper" || activeSubstep === "Feature Architect" || activeSubstep === "Feature Validator" || activeSubstep === "Exogenous Scout" || activeSubstep === "Feature Engineering") ? "Completed" : (activeSubstep === "Data Profiling" ? "In Progress" : "Pending");
          const preprocessStatus = (activeSubstep === "Schema Resolver" || activeSubstep === "Hierarchy Mapper" || activeSubstep === "Feature Architect" || activeSubstep === "Feature Validator" || activeSubstep === "Exogenous Scout" || activeSubstep === "Feature Engineering") ? "Completed" : (activeSubstep === "Data Profiling" ? "In Progress" : "Pending");
          const schemaStatus = (activeSubstep === "Hierarchy Mapper" || activeSubstep === "Feature Architect" || activeSubstep === "Feature Validator" || (activeSubstep === "Exogenous Scout") || activeSubstep === "Feature Engineering") ? "Completed" : (activeSubstep === "Schema Resolver" ? "In Progress" : "Pending");
          const hierarchyStatus = (activeSubstep === "Feature Architect" || activeSubstep === "Feature Validator" || activeSubstep === "Exogenous Scout") ? "Completed" : (activeSubstep === "Hierarchy Mapper" ? "In Progress" : "Pending");
          const featureArchitectStatus = (activeSubstep === "Feature Validator" || activeSubstep === "Exogenous Scout") ? "Completed" : (activeSubstep === "Feature Architect" || activeSubstep === "Feature Engineering" ? "In Progress" : "Pending");
          const featureValidatorStatus = activeSubstep === "Exogenous Scout" ? "Completed" : (activeSubstep === "Feature Validator" ? "In Progress" : "Pending");
          const exogenousStatus = activeSubstep === "Exogenous Scout" ? "In Progress" : "Pending";

          const mergedStageStatuses = {
            ...(calculatedBase.stageStatuses || {}),
            inspect: inspectStatus,
            profileData: profileStatus,
            preprocess: preprocessStatus,
            resolveSchema: schemaStatus,
            hierarchyMapper: hierarchyStatus,
            featureArchitect: featureArchitectStatus,
            featureValidator: featureValidatorStatus,
            exogenousScout: exogenousStatus,
          };

          const nodeKey = activeSubstep === "Data Inspection" ? "inspect" : activeSubstep === "Data Profiling" ? "profileData" : activeSubstep === "Schema Resolver" ? "resolveSchema" : activeSubstep === "Hierarchy Mapper" ? "hierarchyMapperNode" : activeSubstep === "Feature Architect" ? "featureArchitectNode" : activeSubstep === "Feature Validator" ? "featureArchitectNode" : "exogenousScout";

          const fullBaseResult: IngestionAgentRunResult = {
            ...calculatedBase,
            connectorId,
            status: "running",
            summary: `${activeSubstep} agent reasoning in progress`,
            sessionId: threadId,
            requiresApproval: false,
            stageStatuses: mergedStageStatuses,
            currentNode: nodeKey,
            currentStage: nodeKey,
          };

          for await (const thinkingUpdate of this.streamThinking(projectId, pipeline, activeSubstep, fullBaseResult, logs, threadId)) {
            if (this.stoppedSessions.has(threadId)) break;
            queue.push(thinkingUpdate);
          }
        }
      }

      let stream: any;

      if (options?.action === "retry" && options.step) {
        const targetNode = mapRetryStepToInterruptNode(options.step);
        console.info(`[Workflow] Retry requested for step "${options.step}" → target node "${targetNode}", thread ${threadId}`);

        if (targetNode === "inspect") {
          // Retry inspect = start fresh with a new thread
          threadId = `workflow-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          meta = { threadId, connectorId, userPrompt: userPrompt ?? meta.userPrompt ?? "", projectId: options?.projectId };
          this.sessionMeta.set(threadId, meta);
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
          stream = await workflow.stream(
            {
              connectorId,
              projectId: options?.projectId ?? "",
              userPrompt: meta.userPrompt,
              status: "queued",
              summary: "Retrying from inspect",
              inspection: {},
              dataProfile: {},
              schemaResolution: {},
              preprocessing: {},
              batchedTables: [],
              steps: [],
              stageOutputs: {},
              stageStatuses: { inspect: "Pending", profileData: "Pending", preprocess: "Pending", resolveSchema: "Pending" }
            },
            freshConfig
          );
        } else {
          // For profileData or resolveSchema retry: find the checkpoint where that node is next
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
            console.info(`[Workflow] Retrying from checkpoint ${retryCheckpointId}`);
            const retryConfig = {
              configurable: {
                thread_id: threadId,
                checkpoint_id: retryCheckpointId,
                services,
              },
              recursionLimit: 100,
            };
            stream = await workflow.stream(null, retryConfig);
          } else {
            console.warn(`[Workflow] No checkpoint found for retry target "${targetNode}", resuming from current position`);
            stream = await workflow.stream(null, config);
          }
        }
      } else if (options?.action === "approve") {
        // Approve: resume from the current interrupt
        console.info(`[Workflow] Approve — resuming thread ${threadId}`);

        let graphState = await workflow.getState(config).catch(() => null);
        let hasState = Array.isArray(graphState?.next) && graphState.next.length > 0;

        // If checkpointer has no state (e.g. server restart or fresh MemorySaver instance),
        // restore state from project's persisted agentState in PostgreSQL!
        if (!hasState && options?.projectId) {
          try {
            const project = await this.projectService.getById(options.projectId);
            const savedAgentState = project?.agentState as any;
            if (savedAgentState && (savedAgentState.schemaResolution || savedAgentState.stageOutputs)) {
              console.info(`[Workflow] Restoring graph checkpointer state from project database for thread ${threadId}`);

              const predecessorNode = options.step === "Model Training & Validation" || options.step === "modelSelection" ? "exogenous" : "resolveSchema";
              const restoredState = {
                ...savedAgentState,
                connectorId,
                projectId: options.projectId,
                userPrompt: userPrompt ?? meta.userPrompt ?? savedAgentState.userPrompt ?? "",
                runTimestamp: savedAgentState.runTimestamp || activeRunTimestamp,
                status: "running",
                summary: `Advancing to ${options.step || "Feature Engineering"}`,
              };

              await workflow.updateState(config, restoredState, predecessorNode);
              graphState = await workflow.getState(config).catch(() => null);
              hasState = Array.isArray(graphState?.next) && graphState.next.length > 0;
              console.info(`[Workflow] Restored graph state. Next node to execute: [${graphState?.next?.join(", ")}]`);
            }
          } catch (restoreErr: any) {
            console.warn(`[Workflow] Failed to restore state from project:`, restoreErr?.message);
          }
        }

        if (hasState) {
          stream = await workflow.stream(null, config);
        } else {
          const approvingModelPhase = options.step === "Model Training & Validation" || options.step === "modelSelection";
          console.warn(`[Workflow] No checkpoint found for approve. Restoring the ${approvingModelPhase ? "Feature Engineering" : "Data Ingestion"} boundary.`);
          const fallbackState = {
            connectorId,
            projectId: options?.projectId ?? "",
            userPrompt: userPrompt ?? "",
            runTimestamp: activeRunTimestamp,
            status: "running",
            summary: `Resuming workflow at ${approvingModelPhase ? "Model Training & Validation" : "Feature Engineering"}`,
            inspection: {},
            dataProfile: {},
            schemaResolution: {},
            preprocessing: {},
            batchedTables: [],
            steps: [],
            stageOutputs: {},
            stageStatuses: approvingModelPhase
              ? { inspect: "Completed", profileData: "Completed", preprocess: "Completed", resolveSchema: "Completed", hierarchyMapper: "Completed", featureArchitect: "Completed", featureValidator: "Completed", exogenousScout: "Completed", modelTraining: "In Progress" }
              : { inspect: "Completed", profileData: "Completed", preprocess: "Completed", resolveSchema: "Completed", hierarchyMapper: "In Progress", featureArchitect: "Pending", exogenousScout: "Pending" }
          };
          await workflow.updateState(config, fallbackState, approvingModelPhase ? "exogenous" : "resolveSchema");
          stream = await workflow.stream(null, config);
        }
      } else if (options?.action === "resume") {
        // Resume: continue from the paused phase (mid-execution checkpoint)
        const targetStep = options.step || "inspect";
        console.info(`[Workflow] Resume — continuing from thread ${threadId} at phase ${targetStep}`);

        // Predecessor mapping: which node should be marked as completed so the next node is targetStep
        const predecessorNodeMap: Record<string, string> = {
          "inspect": "__start__",
          "Data Inspection": "__start__",
          "profileData": "inspect",
          "Data Profiling": "inspect",
          "preprocess": "inspect",
          "resolveSchema": "profileData",
          "Schema Resolver": "profileData",
          "hierarchyMapperNode": "resolveSchema",
          "hierarchyMapper": "resolveSchema",
          "Hierarchy Mapper": "resolveSchema",
          "featureArchitectNode": "hierarchyMapperNode",
          "featureArchitect": "hierarchyMapperNode",
          "Feature Architect": "hierarchyMapperNode",
          "featureValidator": "featureArchitectNode",
          "Feature Validator": "featureArchitectNode",
          "exogenousScout": "featureArchitectNode",
          "exogenous": "featureArchitectNode",
          "Exogenous Scout": "featureArchitectNode",
        };
        const predecessorNode = predecessorNodeMap[targetStep] || "__start__";

        let graphState = await workflow.getState(config).catch(() => null);
        let hasState = Array.isArray(graphState?.next) && graphState.next.length > 0;

        // If checkpointer has no state, restore from project's persisted agentState
        if (!hasState && options?.projectId) {
          try {
            const project = await this.projectService.getById(options.projectId);
            const savedAgentState = project?.agentState as any;
            if (savedAgentState) {
              console.info(`[Workflow] Restoring graph checkpointer state from project database for resume on thread ${threadId}`);

              const restoredState = {
                ...savedAgentState,
                connectorId,
                projectId: options.projectId,
                userPrompt: userPrompt ?? meta.userPrompt ?? savedAgentState.userPrompt ?? "",
                runTimestamp: savedAgentState.runTimestamp || activeRunTimestamp,
                status: "running",
                summary: `Resuming from ${targetStep} phase`,
              };

              if (predecessorNode !== "__start__") {
                await workflow.updateState(config, restoredState, predecessorNode);
                graphState = await workflow.getState(config).catch(() => null);
                hasState = Array.isArray(graphState?.next) && graphState.next.length > 0;
                console.info(`[Workflow] Resume state restored. Next nodes: [${Array.isArray(graphState?.next) ? graphState.next.join(", ") : "none"}]`);
              }
            }
          } catch (e) {
            console.warn("[Workflow] Failed to restore resume state from database:", e);
          }
        }

        if (predecessorNode === "__start__" || !hasState) {
          console.info(`[Workflow] Resuming thread ${threadId} from start at phase ${targetStep}`);
          stream = await workflow.stream(
            {
              connectorId,
              projectId: options?.projectId ?? "",
              userPrompt: userPrompt ?? "",
              runTimestamp: activeRunTimestamp,
              status: "running",
              summary: `Resuming from ${targetStep} phase`,
              inspection: savedAgentState?.inspection || {},
              dataProfile: savedAgentState?.dataProfile || {},
              schemaResolution: savedAgentState?.schemaResolution || {},
              preprocessing: savedAgentState?.preprocessing || {},
              batchedTables: savedAgentState?.batchedTables || [],
              steps: savedAgentState?.steps || [{ name: "Data Ingestion", status: "running", summary: "Data Ingestion node running..." }],
              stageOutputs: savedAgentState?.stageOutputs || {},
              stageStatuses: { inspect: "In Progress", profileData: "Pending", preprocess: "Pending", resolveSchema: "Pending", exogenousScout: "Pending", featureArchitect: "Pending" }
            },
            config
          );
        } else {
          stream = await workflow.stream(null, config);
        }
      } else {
        // New workflow: first invocation / re-run
        console.info(`[Workflow] Starting new workflow, thread ${threadId}, connectors: [${connectorId.join(", ")}]`);
        stream = await workflow.stream(
          {
            connectorId,
            projectId: options?.projectId ?? "",
            userPrompt: userPrompt ?? "",
            runTimestamp: activeRunTimestamp,
            status: "queued",
            summary: "Ingestion workflow started",
            inspection: {},
            dataProfile: {},
            schemaResolution: {},
            preprocessing: {},
            batchedTables: [],
            steps: [{ name: "Data Ingestion", status: "running", summary: "Data Ingestion node running..." }],
            stageOutputs: {},
            stageStatuses: { inspect: "Pending", profileData: "Pending", preprocess: "Pending", resolveSchema: "Pending", exogenousScout: "Pending", featureArchitect: "Pending" }
          },
          config
        );
      }

      const initialStageStatuses = (options?.action === "resume" || options?.action === "retry") && savedAgentState?.stageStatuses
        ? { ...savedAgentState.stageStatuses, [options.step || "inspect"]: "In Progress" }
        : { inspect: "Queued", profileData: "Pending", preprocess: "Pending", resolveSchema: "Pending", exogenousScout: "Pending", featureArchitect: "Pending" };

      // 1. Push initial queued/resumed status to client immediately
      queue.push({
        connectorId,
        status: "running",
        summary: options?.action === "resume" ? `Resuming workflow at ${options.step || "inspect"} phase` : "Workflow task has been queued. Waiting for resources...",
        sessionId: threadId,
        requiresApproval: false,
        stageStatuses: initialStageStatuses,
        currentNode: options?.step || "inspect",
        currentStage: options?.step || "inspect",
        steps: savedAgentState?.steps || [],
        inspection: savedAgentState?.inspection || {},
        schemaResolution: savedAgentState?.schemaResolution || {},
        dataProfile: savedAgentState?.dataProfile || {},
        preprocessing: savedAgentState?.preprocessing || {},
        stageOutputs: savedAgentState?.stageOutputs || {},
      });

      // 2. Define the background task to be run inside the QueueService
      const executeWorkflowTask = async () => {
        try {
          const updateNodeStatuses = (nodeName: string, statuses: Record<string, string>): Record<string, string> => {
            const updated = { ...statuses };
            if (nodeName === "inspect") {
              updated.inspect = "Completed";
              if (!updated.profileData || updated.profileData === "Pending") {
                updated.profileData = "In Progress";
              }
            } else if (nodeName === "profileData") {
              updated.inspect = "Completed";
              updated.profileData = "Completed";
              if (!updated.resolveSchema || updated.resolveSchema === "Pending") {
                updated.resolveSchema = "In Progress";
              }
            } else if (nodeName === "resolveSchema") {
              updated.inspect = "Completed";
              updated.profileData = "Completed";
              updated.resolveSchema = "Completed";
            } else if (nodeName === "hierarchyMapperNode" || nodeName === "hierarchyMapper") {
              updated.hierarchyMapper = "Completed";
              if (!updated.featureArchitect || updated.featureArchitect === "Pending") {
                updated.featureArchitect = "In Progress";
              }
            } else if (nodeName === "featureArchitectNode" || nodeName === "featureArchitect") {
              updated.featureArchitect = "Completed";
              updated.featureValidator = "Completed";
              if (!updated.exogenousScout || updated.exogenousScout === "Pending") {
                updated.exogenousScout = "In Progress";
              }
            } else if (nodeName === "exogenous" || nodeName === "exogenousScout") {
              updated.exogenousScout = "Completed";
            } else if (nodeName === "modelTraining") {
              updated.modelTraining = "Completed";
              updated.modelEvaluation = "In Progress";
            } else if (nodeName === "modelEvaluation") {
              updated.modelEvaluation = "Completed";
              updated.modelValidation = "In Progress";
            } else if (nodeName === "modelValidation") {
              updated.modelValidation = "Completed";
              updated.modelSelection = "In Progress";
            } else if (nodeName === "modelSelection") {
              updated.modelSelection = "Completed";
            }
            return updated;
          };

          // Stream updates from initial execution segment
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

            const graphState = await workflow.getState(config);
            if (graphState?.values) {
              latestGraphStateValues = {
                ...latestGraphStateValues,
                ...graphState.values,
                stageOutputs: { ...(latestGraphStateValues.stageOutputs || {}), ...(graphState.values.stageOutputs || {}) },
                stageStatuses: { ...currentStatuses, ...(graphState.values.stageStatuses || {}) }
              };
            } else {
              latestGraphStateValues.stageStatuses = currentStatuses;
            }
            const result = buildResultFromGraphState({ values: latestGraphStateValues, next: graphState?.next }, threadId, connectorId);
            if (options?.projectId) {
              result.agentThinking = await this.getAllProjectPipelineThinking(options.projectId, pipeline);
            }
            agentJobEvents.emit(`job:update:${threadId}`, result);
          }

          if (this.stoppedSessions.has(threadId)) {
            console.info(`[Workflow] Halting execution early: thread ${threadId} is stopped.`);
            const graphState = await workflow.getState(config).catch(() => null);
            const stoppedValues = {
              ...(graphState?.values || {}),
              status: "failed",
              summary: "Workflow stopped by user",
              message: "Workflow stopped by user.",
            };
            const stoppedResult = buildResultFromGraphState({ ...graphState, values: stoppedValues }, threadId, connectorId);
            stoppedResult.status = "failed";
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
            const pausedValues = {
              ...(graphState?.values || {}),
              ...latestGraphStateValues,
              status: "paused",
              summary: "Workflow paused by user",
              message: "Workflow paused by user.",
            };
            const pausedResult = buildResultFromGraphState({ ...graphState, values: pausedValues }, threadId, connectorId);
            pausedResult.status = "paused";
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

          // Check if workflow reached an approval gate between pipeline stages
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
          const approvalTarget = nextNode === "hierarchyMapperNode"
            ? "Feature Engineering"
            : nextNode === "modelSelection"
              ? "Model Training & Validation"
              : undefined;
          const isAtApprovalGate = Boolean(approvalTarget);

          if (isAtApprovalGate) {
            console.info(`[Workflow] Pausing for user approval before ${approvalTarget}.`);
            const completedPhase = approvalTarget === "Feature Engineering" ? "Data Ingestion" : "Feature Engineering";
            const pausedValues = {
              ...latestGraphStateValues,
              status: "paused",
              requiresApproval: true,
              summary: `${completedPhase} completed successfully. Approve to proceed to ${approvalTarget}.`,
              message: `${completedPhase} completed successfully. Approve to proceed to ${approvalTarget}.`,
            };
            latestGraphStateValues = pausedValues;
            const pausedResult = buildResultFromGraphState({ values: pausedValues, next: graphState?.next }, threadId, connectorId);
            pausedResult.status = "paused";
            pausedResult.requiresApproval = true;
            pausedResult.nextStep = approvalTarget;
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
            console.info(`[Workflow] Node [${nextNodes.join(", ")}] started`);
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

              const currentGraphState = await workflow.getState(config);
              if (currentGraphState?.values) {
                latestGraphStateValues = {
                  ...latestGraphStateValues,
                  ...currentGraphState.values,
                  stageOutputs: { ...(latestGraphStateValues.stageOutputs || {}), ...(currentGraphState.values.stageOutputs || {}) },
                  stageStatuses: { ...currentStatuses, ...(currentGraphState.values.stageStatuses || {}) }
                };
              } else {
                latestGraphStateValues.stageStatuses = currentStatuses;
              }
              const result = buildResultFromGraphState({ values: latestGraphStateValues, next: currentGraphState?.next }, threadId, connectorId);
              if (options?.projectId) {
                result.agentThinking = await this.getAllProjectPipelineThinking(options.projectId, pipeline);
              }
              agentJobEvents.emit(`job:update:${threadId}`, result);
            }
            graphState = await workflow.getState(config);
            if (graphState?.values) {
              latestGraphStateValues = {
                ...latestGraphStateValues,
                ...graphState.values,
                stageOutputs: { ...(latestGraphStateValues.stageOutputs || {}), ...(graphState.values.stageOutputs || {}) },
                stageStatuses: { ...(latestGraphStateValues.stageStatuses || {}), ...(graphState.values.stageStatuses || {}) }
              };
            }
          }

          console.info(`[Workflow] State after invoke — next: [${Array.isArray(graphState?.next) ? graphState.next.join(", ") : "none"}], status: ${graphState?.values?.status || "unknown"}`);

          if (this.pausedSessions.has(threadId)) {
            const pausedValues = {
              ...(graphState?.values || {}),
              ...latestGraphStateValues,
              status: "paused",
              summary: "Workflow paused by user",
              message: "Workflow paused by user.",
            };
            const pausedResult = buildResultFromGraphState({ ...graphState, values: pausedValues }, threadId, connectorId);
            pausedResult.status = "paused";
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
              status: "failed",
              summary: "Workflow stopped by user",
            };
            const stoppedResult = buildResultFromGraphState({ ...graphState, values: stoppedValues }, threadId, connectorId);
            stoppedResult.status = "failed";
            stoppedResult.summary = "Workflow stopped by user";
            stoppedResult.requiresApproval = false;
            if (options?.projectId) {
              await this.projectService.updateAgentState(options.projectId, stoppedValues);
              stoppedResult.agentThinking = await this.getAllProjectPipelineThinking(options.projectId, pipeline);
            }
            agentJobEvents.emit(`job:update:${threadId}`, stoppedResult);
            return;
          }

          const result = buildResultFromGraphState(graphState, threadId, connectorId);
          if (options?.action === "approve") {
            result.requiresApproval = false;
            result.message = "Data Ingestion approved. Moving to Feature Engineering stage.";
          }

          if (options?.projectId) {
            try {
              await this.projectService.updateAgentState(
                options.projectId,
                graphState?.values ?? {},
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
          throw err;
        } finally {
          agentJobEvents.emit(`job:close:${threadId}`);
        }
      };

      // 3. Register the task in the Concurrency/Memory QueueService
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

      // 4. Setup listeners to feed queue events into the PushQueue for SSE response stream
      const onJobUpdate = (result: any) => {
        queue.push(result);
      };

      const onJobClose = () => {
        queue.close();
      };

      agentJobEvents.on(`job:update:${threadId}`, onJobUpdate);
      agentJobEvents.once(`job:close:${threadId}`, onJobClose);

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

    // Delete existing thinking for this substep first
    await this.agentThinkingService.deleteThinking(projectId, pipeline, substep);

    for (let i = 0; i < logs.length; i++) {
      if (threadId && this.stoppedSessions.has(threadId)) {
        console.info(`[Workflow] Aborting streamThinking for stopped thread ${threadId}`);
        return;
      }

      const now = new Date();
      const timeStr = now.toLocaleTimeString("en-US", { hour12: true, hour: "2-digit", minute: "2-digit", second: "2-digit" });

      // Mark previous logs as done
      for (const log of thinkingLogs) {
        log.done = true;
      }

      // Add current log as not done
      thinkingLogs.push({
        time: timeStr,
        text: logs[i],
        done: false,
      });

      // Save to database
      await this.agentThinkingService.saveThinking(projectId, pipeline, substep, thinkingLogs);

      // Fetch all logs to pass down the full state
      const allThinking = await this.getAllProjectPipelineThinking(projectId, pipeline);

      // Yield with updated thinking
      yield {
        ...baseResult,
        agentThinking: allThinking,
      };

      // Small delay to simulate real-time thinking
      await new Promise((resolve) => setTimeout(resolve, 600));
    }

    // Mark the last one as done and save
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

  private async getAllProjectPipelineThinking(projectId: string, pipeline: string): Promise<Record<string, Array<{ time: string; text: string; done: boolean }>>> {
    const map: Record<string, Array<{ time: string; text: string; done: boolean }>> = {};
    try {
      const allSubsteps = [
        "Data Inspection",
        "Data Ingestion",
        "Data Profiling",
        "Schema Resolver",
        "Hierarchy Mapper",
        "Relationship Builder",
        "Form Builder",
        "Feature Architect",
        "Feature Validator",
        "Exogenous Scout",
        "Feature Engineering",
        "featureSupervisor",
        "featureCreation",
        "featureTransformation",
        "buildDataset",
        "dataValidation",
        "featureExtraction",
        "featureSelection",
        "programRectifier",
      ];

      for (const substep of allSubsteps) {
        const entry =
          (await this.agentThinkingService.getThinking(projectId, "Feature Engineering", substep)) ||
          (await this.agentThinkingService.getThinking(projectId, "Data Ingestion", substep)) ||
          (await this.agentThinkingService.getThinking(projectId, pipeline, substep));

        if (entry && Array.isArray(entry.thinking) && entry.thinking.length > 0) {
          map[substep] = entry.thinking;
        }
      }

      // Aggregate sub-worker thinking logs into canonical "Feature Architect" step
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
      }
    } catch (err) {
      console.warn("Failed to retrieve agent thinking logs:", err);
    }
    return map;
  }

  async stop(sessionId?: string, projectId?: string): Promise<IngestionAgentRunResult | { success: boolean; message: string }> {
    const resolvedSessionId = sessionId || this.findSessionIdForProject(projectId);
    const targetProjectId = projectId || (resolvedSessionId ? this.sessionMeta.get(resolvedSessionId)?.projectId : undefined);

    if (resolvedSessionId) {
      this.stoppedSessions.add(resolvedSessionId);
      this.sessionAbortControllers.get(resolvedSessionId)?.abort();
      this.sessionAbortControllers.delete(resolvedSessionId);
      console.info(`[Workflow] Session ${resolvedSessionId} marked as stopped.`);
    } else {
      console.info(`[Workflow] Stop requested for project ${targetProjectId || "unknown"}`);
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
          status: "failed",
          summary: "Workflow stopped by user",
          message: "Workflow stopped by user.",
        };

        const result = buildResultFromGraphState({ ...graphState, values: updatedValues }, resolvedSessionId, graphState?.values?.connectorId || meta?.connectorId || []);
        result.status = "failed";
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
        await this.projectService.updateAgentState(targetProjectId, {
          status: "failed",
          summary: "Workflow stopped by user",
          message: "Workflow stopped by user.",
        });
        console.info(`[Workflow] Project ${targetProjectId} agent state successfully updated to stopped.`);
      }
      return { success: true, message: "Workflow stopped" };
    } catch (err: any) {
      console.warn(`[Workflow] Failed to update stopped state for session ${resolvedSessionId || "unknown"}:`, err?.message || err);
      if (targetProjectId) {
        try {
          await this.projectService.updateAgentState(targetProjectId, {
            status: "failed",
            summary: "Workflow stopped by user",
          });
        } catch (_) { }
      }
      return { success: true, message: "Workflow stopped" };
    }
  }

  async pause(sessionId?: string, projectId?: string): Promise<IngestionAgentRunResult | { success: boolean; message: string }> {
    const resolvedSessionId = sessionId || this.findSessionIdForProject(projectId);
    const targetProjectId = projectId || (resolvedSessionId ? this.sessionMeta.get(resolvedSessionId)?.projectId : undefined);

    if (resolvedSessionId) {
      this.pausedSessions.add(resolvedSessionId);
      this.stoppedSessions.add(resolvedSessionId);
      this.sessionAbortControllers.get(resolvedSessionId)?.abort();
      console.info(`[Workflow] Session ${resolvedSessionId} marked as paused.`);
    } else {
      console.info(`[Workflow] Pause requested for project ${targetProjectId || "unknown"}`);
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

        const pausedValues = {
          ...(graphState?.values || {}),
          status: "paused",
          summary: "Workflow paused by user",
          message: "Workflow paused by user.",
          sessionId: resolvedSessionId,
        };

        const result = buildResultFromGraphState({ ...graphState, values: pausedValues }, resolvedSessionId, graphState?.values?.connectorId || meta?.connectorId || []);
        result.status = "paused";
        result.summary = "Workflow paused by user";
        result.message = "Workflow paused by user.";
        result.requiresApproval = false;

        if (targetProjectId) {
          await this.projectService.updateAgentState(targetProjectId, pausedValues);
          console.info(`[Workflow] Project ${targetProjectId} agent state updated to paused.`);
        }
        agentJobEvents.emit(`job:update:${resolvedSessionId}`, result);
        return result;
      } else if (targetProjectId) {
        await this.projectService.updateAgentState(targetProjectId, {
          status: "paused",
          summary: "Workflow paused by user",
          message: "Workflow paused by user.",
        });
        console.info(`[Workflow] Project ${targetProjectId} agent state updated to paused.`);
      }
      return { success: true, message: "Workflow paused" };
    } catch (err: any) {
      console.warn(`[Workflow] Failed to update paused state for session ${resolvedSessionId || "unknown"}:`, err?.message || err);
      if (targetProjectId) {
        try {
          await this.projectService.updateAgentState(targetProjectId, {
            status: "paused",
            summary: "Workflow paused by user",
          });
        } catch (_) { }
      }
      return { success: true, message: "Workflow paused" };
    }
  }
}

