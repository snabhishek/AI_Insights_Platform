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

export class IngestionAgentService implements IIngestionAgentService {
  private checkpointer = new MemorySaver();
  private sessionMeta = new Map<string, WorkflowSessionMeta>();
  private stoppedSessions = new Set<string>();
  private traceHelper = new AgentTraceHelper();

  constructor(
    private connectorService: ConnectorService,
    private connectionTester: ConnectionTesterService,
    private fileService: IFileService,
    private projectService: ProjectService
  ) { }

  async run(
    connectorId: string[], 
    userPrompt?: string, 
    options?: { sessionId?: string; action?: "approve" | "retry"; step?: string; projectId?: string }
  ): Promise<IngestionAgentRunResult> {
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
      let threadId: string = options?.sessionId ?? "";
      let meta = threadId ? this.sessionMeta.get(threadId) : undefined;

      if (!meta) {
        threadId = `workflow-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        meta = { threadId, connectorId, userPrompt: userPrompt ?? "" };
        this.sessionMeta.set(threadId, meta);
      }

      // Populate services dependencies context to pass inside LangGraph config
      const services = {
        connectorService: this.connectorService,
        connectionTester: this.connectionTester,
        fileService: this.fileService,
        projectService: this.projectService,
        traceHelper: this.traceHelper,
      };

      const config = { 
        configurable: { 
          thread_id: threadId,
          services,
        } 
      };

      this.stoppedSessions.delete(threadId);

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
          await workflow.invoke(
            { connectorId, projectId: options?.projectId ?? "", userPrompt: meta.userPrompt, status: "queued", summary: "Retrying from inspect" },
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
            await workflow.invoke(null, retryConfig);
          } else {
            console.warn(`[Workflow] No checkpoint found for retry target "${targetNode}", resuming from current position`);
            await workflow.invoke(null, config);
          }
        }
      } else if (options?.action === "approve") {
        // Approve: resume from the current interrupt
        console.info(`[Workflow] Approve — resuming thread ${threadId}`);
        await workflow.invoke(null, config);
      } else {
        // New workflow: first invocation
        console.info(`[Workflow] Starting new workflow, thread ${threadId}, connectors: [${connectorId.join(", ")}]`);
        await workflow.invoke(
          { connectorId, projectId: options?.projectId ?? "", userPrompt: userPrompt ?? "", status: "queued", summary: "Ingestion workflow started" },
          config
        );
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
        await workflow.invoke(null, config);
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
        }
        return stoppedResult;
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

      return result;
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

  async stop(sessionId: string, projectId?: string): Promise<IngestionAgentRunResult | { success: boolean; message: string }> {
    this.stoppedSessions.add(sessionId);
    console.info(`[Workflow] Session ${sessionId} marked as stopped.`);

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

      const result = buildResultFromGraphState({ ...graphState, values: updatedValues }, sessionId, graphState?.values?.connectorId || []);
      result.status = "failed";
      result.summary = "Workflow stopped by user";
      result.message = "Workflow stopped by user.";
      result.requiresApproval = false;

      if (projectId) {
        await this.projectService.updateAgentState(projectId, updatedValues);
      }
      return result;
    } catch (err: any) {
      console.warn(`[Workflow] Failed to update stopped state for session ${sessionId}:`, err?.message || err);
      return { success: true, message: "Workflow stopped" };
    }
  }
}
