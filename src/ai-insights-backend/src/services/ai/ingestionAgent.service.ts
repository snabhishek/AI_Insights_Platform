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
  ]
};


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

      if (isNewRun || !meta) {
        threadId = `workflow-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        meta = { threadId, connectorId, userPrompt: userPrompt ?? "", projectId: options?.projectId };
        this.sessionMeta.set(threadId, meta);
      } else if (options?.projectId && !meta.projectId) {
        meta.projectId = options.projectId;
        this.sessionMeta.set(threadId, meta);
      }

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
      };

      const config = { 
        configurable: { 
          thread_id: threadId,
          services,
        } 
      };

      this.stoppedSessions.delete(threadId);

      const pipeline = "Data Ingestion";
      if (options?.projectId) {
        const projectId = options.projectId;
        let activeSubstep: string | undefined;

        if (options.action === "retry" && options.step) {
          const stepMap: Record<string, string> = {
            inspect: "Data Ingestion",
            profileData: "Data Profiling",
            preprocess: "Data Profiling",
            resolveSchema: "Schema Resolver",
            "Data Ingestion": "Data Ingestion",
            "Data Profiling": "Data Profiling",
            "Schema Resolver": "Schema Resolver"
          };
          const substep = stepMap[options.step];
          if (substep) {
            activeSubstep = substep;
            if (substep === "Data Ingestion") {
              await this.agentThinkingService.deleteThinking(projectId, pipeline, "Data Ingestion");
              await this.agentThinkingService.deleteThinking(projectId, pipeline, "Data Profiling");
              await this.agentThinkingService.deleteThinking(projectId, pipeline, "Schema Resolver");
            } else if (substep === "Data Profiling") {
              await this.agentThinkingService.deleteThinking(projectId, pipeline, "Data Profiling");
              await this.agentThinkingService.deleteThinking(projectId, pipeline, "Schema Resolver");
            } else if (substep === "Schema Resolver") {
              await this.agentThinkingService.deleteThinking(projectId, pipeline, "Schema Resolver");
            }
          }
        } else if (options.action === "approve") {
          const graphState = await workflow.getState(config);
          const nextNodes = Array.isArray(graphState?.next) ? graphState.next : [];
          if (nextNodes.includes("profileData")) {
            activeSubstep = "Data Profiling";
            await this.agentThinkingService.deleteThinking(projectId, pipeline, "Data Profiling");
            await this.agentThinkingService.deleteThinking(projectId, pipeline, "Schema Resolver");
          } else if (nextNodes.includes("resolveSchema")) {
            activeSubstep = "Schema Resolver";
            await this.agentThinkingService.deleteThinking(projectId, pipeline, "Schema Resolver");
          }
        } else {
          activeSubstep = "Data Ingestion";
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
            status: "running",
            summary: "Ingestion workflow started",
            steps: [{ name: "Data Ingestion", status: "running", summary: "Data Ingestion node running..." }],
            stageOutputs: {},
            stageStatuses: { inspect: "Pending", profileData: "Pending", preprocess: "Pending", resolveSchema: "Pending" }
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

          const inspectStatus = (activeSubstep === "Data Profiling" || activeSubstep === "Schema Resolver") ? "Completed" : "In Progress";
          const profileStatus = activeSubstep === "Schema Resolver" ? "Completed" : (activeSubstep === "Data Profiling" ? "In Progress" : "Pending");
          const preprocessStatus = activeSubstep === "Schema Resolver" ? "Completed" : (activeSubstep === "Data Profiling" ? "In Progress" : "Pending");
          const schemaStatus = activeSubstep === "Schema Resolver" ? "In Progress" : "Pending";

          const mergedStageStatuses = {
            inspect: inspectStatus,
            profileData: profileStatus,
            preprocess: preprocessStatus,
            resolveSchema: schemaStatus,
            ...(calculatedBase.stageStatuses || {}),
          };

          const fullBaseResult: IngestionAgentRunResult = {
            ...calculatedBase,
            connectorId,
            status: "running",
            summary: `${activeSubstep} agent reasoning in progress`,
            sessionId: threadId,
            requiresApproval: false,
            stageStatuses: mergedStageStatuses,
            currentNode: activeSubstep === "Data Ingestion" ? "inspect" : activeSubstep === "Data Profiling" ? "profileData" : "resolveSchema",
            currentStage: activeSubstep === "Data Ingestion" ? "inspect" : activeSubstep === "Data Profiling" ? "profileData" : "resolveSchema",
          };

          for await (const thinkingUpdate of this.streamThinking(projectId, pipeline, activeSubstep, fullBaseResult, logs, threadId)) {
            if (this.stoppedSessions.has(threadId)) break;
            yield thinkingUpdate;
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
          meta = { threadId, connectorId, userPrompt: userPrompt ?? meta.userPrompt ?? "" };
          this.sessionMeta.set(threadId, meta);
          const freshConfig = { 
            configurable: { 
              thread_id: threadId,
              services,
            } 
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
              } 
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
            stageStatuses: { inspect: "Pending", profileData: "Pending", preprocess: "Pending", resolveSchema: "Pending" }
          },
          config
        );
      }

      // Stream updates from initial execution segment
      for await (const _ of stream) {
        if (this.stoppedSessions.has(threadId)) break;
        const graphState = await workflow.getState(config);
        const result = buildResultFromGraphState(graphState, threadId, connectorId);
        if (options?.projectId) {
          result.agentThinking = await this.getAllProjectPipelineThinking(options.projectId, pipeline);
        }
        yield result;
      }

      // Auto-advance through interrupt gates to run all nodes through to schema resolution unless stopped
      let graphState = await workflow.getState(config);
      while (
        Array.isArray(graphState?.next) &&
        graphState.next.length > 0 &&
        graphState?.values?.status !== "completed" &&
        graphState?.values?.status !== "failed" &&
        !this.stoppedSessions.has(threadId)
      ) {
        console.info(`[Workflow] Auto-advancing node [${graphState.next.join(", ")}], thread ${threadId}`);
        const advanceStream = await workflow.stream(null, config);
        for await (const _ of advanceStream) {
          if (this.stoppedSessions.has(threadId)) break;
          const currentGraphState = await workflow.getState(config);
          const result = buildResultFromGraphState(currentGraphState, threadId, connectorId);
          if (options?.projectId) {
            result.agentThinking = await this.getAllProjectPipelineThinking(options.projectId, pipeline);
          }
          yield result;
        }
        graphState = await workflow.getState(config);
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
        yield stoppedResult;
        return;
      }

      const result = buildResultFromGraphState(graphState, threadId, connectorId);

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
      yield result;
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
      const substeps = ["Data Ingestion", "Data Profiling", "Schema Resolver"];
      for (const substep of substeps) {
        const entry = await this.agentThinkingService.getThinking(projectId, pipeline, substep);
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
