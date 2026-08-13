import { MemorySaver } from "@langchain/langgraph";
import { ConnectorService } from "../connector/connector.service";
import { ConnectionTesterService } from "../connector/connectionTester.service";
import { IIngestionAgentService, IngestionAgentRunResult } from "./ingestionAgent.service.interface";
import { IFileService } from "../file/file.service.interface";
import { ProjectService } from "../project/project.service";
import { createAgentGraph } from "../../agents/graph";
import { 
  AgentTraceHelper, 
  buildResultFromGraphState, 
  mapRetryStepToInterruptNode 
} from "../../agents/utils/agentUtils";
import { WorkflowSessionMeta } from "../../agents/state";
import { IAgentThinkingService } from "./agentThinking.service.interface";

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
  "Exogenous Scout": [
    "Analyzing internal dataset schemas and domain context...",
    "Searching web for relevant external APIs, public datasets, and economic indicators...",
    "Scouting and ranking exogenous feature candidates by predictive power..."
  ],
  "Exogenous Scout": [
    "Analyzing internal dataset schemas and domain context...",
    "Searching web for relevant external APIs, public datasets, and economic indicators...",
    "Scouting and ranking exogenous feature candidates by predictive power..."
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
  private traceHelper = new AgentTraceHelper();

  constructor(
    private connectorService: ConnectorService,
    private connectionTester: ConnectionTesterService,
    private fileService: IFileService,
    private projectService: ProjectService,
    private agentThinkingService: IAgentThinkingService
  ) { }

  async *run(
    connectorId: string[], 
    userPrompt?: string, 
    options?: { sessionId?: string; action?: "approve" | "retry"; step?: string; projectId?: string }
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
      let threadId: string = isNewRun ? "" : (options?.sessionId ?? "");
      let meta = threadId ? this.sessionMeta.get(threadId) : undefined;

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
          try { global.gc(); } catch {}
        }
      }

      if (isNewRun || !meta) {
        threadId = `workflow-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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

      // Populate services dependencies context to pass inside LangGraph config
      const services = {
        connectorService: this.connectorService,
        connectionTester: this.connectionTester,
        fileService: this.fileService,
        projectService: this.projectService,
        traceHelper: this.traceHelper,
        agentThinkingService: this.agentThinkingService,
        projectId: options?.projectId,
        pipeline: "Data Ingestion",
        onThinkingUpdate: async (substep: string) => {
          if (this.stoppedSessions.has(threadId)) return;
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
              currentStageStatuses.inspect = "Running";
            } else if (substep === "Data Profiling" || substep === "profileData") {
              currentNode = "profileData";
              currentStage = "profileData";
              currentStageStatuses.inspect = "Completed";
              currentStageStatuses.profileData = "Running";
            } else if (substep === "preprocess") {
              currentNode = "preprocess";
              currentStage = "preprocess";
              currentStageStatuses.inspect = "Completed";
              currentStageStatuses.profileData = "Completed";
              currentStageStatuses.preprocess = "Running";
            } else if (substep === "Schema Resolver" || substep === "resolveSchema") {
              currentNode = "resolveSchema";
              currentStage = "resolveSchema";
              currentStageStatuses.inspect = "Completed";
              currentStageStatuses.profileData = "Completed";
              currentStageStatuses.preprocess = "Completed";
              currentStageStatuses.resolveSchema = "Running";
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

      this.stoppedSessions.delete(threadId);

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
            exogenous: "Exogenous Scout",
            exogenousScout: "Exogenous Scout",
            exogenous: "Exogenous Scout",
            exogenousScout: "Exogenous Scout",
            "Data Ingestion": "Data Ingestion",
            "Data Profiling": "Data Profiling",
            "Schema Resolver": "Schema Resolver",
            "Exogenous Scout": "Exogenous Scout",
            "Feature Engineering": "Exogenous Scout"
            "Schema Resolver": "Schema Resolver",
            "Exogenous Scout": "Exogenous Scout",
            "Feature Engineering": "Exogenous Scout"
          };
          const substep = stepMap[options.step];
          if (substep) {
            activeSubstep = substep;
            if (substep === "Data Inspection" || substep === "Data Ingestion") {
              await this.agentThinkingService.deleteThinking(projectId, pipeline, "Data Inspection");
              await this.agentThinkingService.deleteThinking(projectId, pipeline, "Data Ingestion");
              await this.agentThinkingService.deleteThinking(projectId, pipeline, "Data Profiling");
              await this.agentThinkingService.deleteThinking(projectId, pipeline, "Schema Resolver");
              await this.agentThinkingService.deleteThinking(projectId, pipeline, "Exogenous Scout");
              await this.agentThinkingService.deleteThinking(projectId, pipeline, "Exogenous Scout");
            } else if (substep === "Data Profiling") {
              await this.agentThinkingService.deleteThinking(projectId, pipeline, "Data Profiling");
              await this.agentThinkingService.deleteThinking(projectId, pipeline, "Schema Resolver");
              await this.agentThinkingService.deleteThinking(projectId, pipeline, "Exogenous Scout");
              await this.agentThinkingService.deleteThinking(projectId, pipeline, "Exogenous Scout");
            } else if (substep === "Schema Resolver") {
              await this.agentThinkingService.deleteThinking(projectId, pipeline, "Schema Resolver");
              await this.agentThinkingService.deleteThinking(projectId, pipeline, "Exogenous Scout");
            } else if (substep === "Exogenous Scout") {
              await this.agentThinkingService.deleteThinking(projectId, pipeline, "Exogenous Scout");
              await this.agentThinkingService.deleteThinking(projectId, pipeline, "Exogenous Scout");
            } else if (substep === "Exogenous Scout") {
              await this.agentThinkingService.deleteThinking(projectId, pipeline, "Exogenous Scout");
            }
          }
        } else if (options.action === "approve") {
          const graphState = await workflow.getState(config);
          const nextNodes = Array.isArray(graphState?.next) ? graphState.next : [];
          if (nextNodes.includes("profileData")) {
            activeSubstep = "Data Profiling";
            await this.agentThinkingService.deleteThinking(projectId, pipeline, "Data Profiling");
            await this.agentThinkingService.deleteThinking(projectId, pipeline, "Schema Resolver");
            await this.agentThinkingService.deleteThinking(projectId, pipeline, "Exogenous Scout");
            await this.agentThinkingService.deleteThinking(projectId, pipeline, "Exogenous Scout");
          } else if (nextNodes.includes("resolveSchema")) {
            activeSubstep = "Schema Resolver";
            await this.agentThinkingService.deleteThinking(projectId, pipeline, "Schema Resolver");
            await this.agentThinkingService.deleteThinking(projectId, pipeline, "Exogenous Scout");
          } else if (nextNodes.includes("exogenous")) {
            activeSubstep = "Exogenous Scout";
            await this.agentThinkingService.deleteThinking(projectId, pipeline, "Exogenous Scout");
            await this.agentThinkingService.deleteThinking(projectId, pipeline, "Exogenous Scout");
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
            batchedTables: [],
            inspection: {},
            dataProfile: {},
            preprocess: {},
            schemaResolution: {},
            exogenousScout: {},
            exogenousScout: {},
            status: "running",
            summary: "Ingestion workflow started",
            steps: [{ name: "Data Inspection", status: "running", summary: "Data Inspection node running..." }],
            stageOutputs: {},
            stageStatuses: { inspect: "In Progress", profileData: "Pending", preprocess: "Pending", resolveSchema: "Pending", exogenousScout: "Pending" }
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

          const inspectStatus = (activeSubstep === "Data Profiling" || activeSubstep === "Schema Resolver" || activeSubstep === "Exogenous Scout") ? "Completed" : "In Progress";
          const profileStatus = (activeSubstep === "Schema Resolver" || activeSubstep === "Exogenous Scout") ? "Completed" : (activeSubstep === "Data Profiling" ? "In Progress" : "Pending");
          const preprocessStatus = (activeSubstep === "Schema Resolver" || activeSubstep === "Exogenous Scout") ? "Completed" : (activeSubstep === "Data Profiling" ? "In Progress" : "Pending");
          const schemaStatus = activeSubstep === "Exogenous Scout" ? "Completed" : (activeSubstep === "Schema Resolver" ? "In Progress" : "Pending");
          const exogenousStatus = activeSubstep === "Exogenous Scout" ? "In Progress" : "Pending";
          const inspectStatus = (activeSubstep === "Data Profiling" || activeSubstep === "Schema Resolver" || activeSubstep === "Exogenous Scout") ? "Completed" : "In Progress";
          const profileStatus = (activeSubstep === "Schema Resolver" || activeSubstep === "Exogenous Scout") ? "Completed" : (activeSubstep === "Data Profiling" ? "In Progress" : "Pending");
          const preprocessStatus = (activeSubstep === "Schema Resolver" || activeSubstep === "Exogenous Scout") ? "Completed" : (activeSubstep === "Data Profiling" ? "In Progress" : "Pending");
          const schemaStatus = activeSubstep === "Exogenous Scout" ? "Completed" : (activeSubstep === "Schema Resolver" ? "In Progress" : "Pending");
          const exogenousStatus = activeSubstep === "Exogenous Scout" ? "In Progress" : "Pending";

          const mergedStageStatuses = {
            ...(calculatedBase.stageStatuses || {}),
            inspect: inspectStatus,
            profileData: profileStatus,
            preprocess: preprocessStatus,
            resolveSchema: schemaStatus,
            exogenousScout: exogenousStatus,
            exogenousScout: exogenousStatus,
            ...(calculatedBase.stageStatuses || {}),
          };

          const nodeKey = activeSubstep === "Data Ingestion" ? "inspect" : activeSubstep === "Data Profiling" ? "profileData" : activeSubstep === "Schema Resolver" ? "resolveSchema" : "exogenousScout";

          const nodeKey = activeSubstep === "Data Ingestion" ? "inspect" : activeSubstep === "Data Profiling" ? "profileData" : activeSubstep === "Schema Resolver" ? "resolveSchema" : "exogenousScout";

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
        stream = await workflow.stream(null, config);
      } else {
        // New workflow: first invocation / re-run
        console.info(`[Workflow] Starting new workflow, thread ${threadId}, connectors: [${connectorId.join(", ")}]`);
        stream = await workflow.stream(
          { 
            connectorId, 
            projectId: options?.projectId ?? "", 
            userPrompt: userPrompt ?? "", 
            status: "queued", 
            summary: "Ingestion workflow started",
            inspection: {},
            dataProfile: {},
            schemaResolution: {},
            preprocessing: {},
            batchedTables: [],
            steps: [{ name: "Data Ingestion", status: "running", summary: "Data Ingestion node running..." }],
            stageOutputs: {},
            stageStatuses: { inspect: "Pending", profileData: "Pending", preprocess: "Pending", resolveSchema: "Pending", exogenousScout: "Pending" }
            stageStatuses: { inspect: "Pending", profileData: "Pending", preprocess: "Pending", resolveSchema: "Pending", exogenousScout: "Pending" }
          },
          config
        );
      }

      // Execute graph in background task pushing updates to queue
      (async () => {
        try {
          // Stream updates from initial execution segment
          for await (const chunk of stream) {
            if (this.stoppedSessions.has(threadId)) break;

            const completedNodes = Object.keys(chunk || {});
            for (const nodeName of completedNodes) {
              console.info(`[Workflow] Node [${nodeName}] completed`);
            }

            const graphState = await workflow.getState(config);
            if (graphState?.values) {
              latestGraphStateValues = {
                ...latestGraphStateValues,
                ...graphState.values,
                stageOutputs: { ...(latestGraphStateValues.stageOutputs || {}), ...(graphState.values.stageOutputs || {}) },
                stageStatuses: { ...(latestGraphStateValues.stageStatuses || {}), ...(graphState.values.stageStatuses || {}) }
              };
            }
            const result = buildResultFromGraphState(graphState, threadId, connectorId);
            if (options?.projectId) {
              result.agentThinking = await this.getAllProjectPipelineThinking(options.projectId, pipeline);
            }
            queue.push(result);
          }

          // Auto-advance through interrupt gates to run all nodes through to schema resolution unless stopped
          let graphState = await workflow.getState(config);
          if (graphState?.values) {
            latestGraphStateValues = {
              ...latestGraphStateValues,
              ...graphState.values,
              stageOutputs: { ...(latestGraphStateValues.stageOutputs || {}), ...(graphState.values.stageOutputs || {}) },
              stageStatuses: { ...(latestGraphStateValues.stageStatuses || {}), ...(graphState.values.stageStatuses || {}) }
            };
          }
          while (
            Array.isArray(graphState?.next) &&
            graphState.next.length > 0 &&
            graphState?.values?.status !== "completed" &&
            graphState?.values?.status !== "failed" &&
            !this.stoppedSessions.has(threadId)
          ) {
            const nextNodes = graphState.next;
            console.info(`[Workflow] Node [${nextNodes.join(", ")}] started`);
            const advanceStream = await workflow.stream(null, config);
            for await (const chunk of advanceStream) {
              if (this.stoppedSessions.has(threadId)) break;

              const completedNodes = Object.keys(chunk || {});
              for (const nodeName of completedNodes) {
                console.info(`[Workflow] Node [${nodeName}] completed`);
              }

              const currentGraphState = await workflow.getState(config);
              if (currentGraphState?.values) {
                latestGraphStateValues = {
                  ...latestGraphStateValues,
                  ...currentGraphState.values,
                  stageOutputs: { ...(latestGraphStateValues.stageOutputs || {}), ...(currentGraphState.values.stageOutputs || {}) },
                  stageStatuses: { ...(latestGraphStateValues.stageStatuses || {}), ...(currentGraphState.values.stageStatuses || {}) }
                };
              }
              const result = buildResultFromGraphState(currentGraphState, threadId, connectorId);
              if (options?.projectId) {
                result.agentThinking = await this.getAllProjectPipelineThinking(options.projectId, pipeline);
              }
              queue.push(result);
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
            queue.push(stoppedResult);
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
          queue.push(result);
        } catch (err: any) {
          console.error(`[Workflow] Execution error:`, err?.message || err);
        } finally {
          queue.close();
        }
      })();

      for await (const update of queue) {
        yield update;
      }
    } catch (error: any) {
      console.error(`[Workflow] Run failed:`, error?.message || error);
      if (traceSession) {
        await this.traceHelper.appendTraceEntry("workflow:error", "error", {
          connectorId,
          error: error?.message || String(error),
        }).catch(() => {});
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
      const substeps = ["Data Inspection", "Data Ingestion", "Data Profiling", "Schema Resolver", "Exogenous Scout", "Feature Engineering"];
      for (const substep of substeps) {
        const entry = await this.agentThinkingService.getThinking(projectId, pipeline, substep)
          || await this.agentThinkingService.getThinking(projectId, "Feature Engineering", substep);        
        if (entry) {
          map[substep] = entry.thinking;
        }
      }
    } catch (err) {
      console.warn("Failed to retrieve agent thinking logs:", err);
    }
    return map;
  }

  async stop(sessionId: string, projectId?: string): Promise<IngestionAgentRunResult | { success: boolean; message: string }> {
    this.stoppedSessions.add(sessionId);
    console.info(`[Workflow] Session ${sessionId} marked as stopped.`);

    const meta = this.sessionMeta.get(sessionId);
    const targetProjectId = projectId || meta?.projectId;

    try {
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
          thread_id: sessionId,
          services,
        } 
      };
      const graphState = await workflow.getState(config);

      const updatedValues = {
        ...(graphState?.values || {}),
        status: "failed",
        summary: "Workflow stopped by user",
      };

      const result = buildResultFromGraphState({ ...graphState, values: updatedValues }, sessionId, graphState?.values?.connectorId || meta?.connectorId || []);
      result.status = "failed";
      result.summary = "Workflow stopped by user";
      result.message = "Workflow stopped by user.";
      result.requiresApproval = false;

      if (targetProjectId) {
        await this.projectService.updateAgentState(targetProjectId, updatedValues);
        console.info(`[Workflow] Project ${targetProjectId} agent state updated to stopped/failed.`);
      }
      return result;
    } catch (err: any) {
      console.warn(`[Workflow] Failed to update stopped state for session ${sessionId}:`, err?.message || err);
      if (targetProjectId) {
        try {
          await this.projectService.updateAgentState(targetProjectId, {
            status: "failed",
            summary: "Workflow stopped by user",
          });
        } catch (_) {}
      }
      return { success: true, message: "Workflow stopped" };
    }
  }
}
