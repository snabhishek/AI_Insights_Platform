import { Request, Response } from "express";
import { IIngestionAgentService } from "../services/ai/ingestion-agent/ingestionAgent.service.interface";
import { IAgentThinkingService } from "../services/ai/agent-thinking/agentThinking.service.interface";

export class AIController {
  constructor(
    private ingestionAgentService: IIngestionAgentService,
    private agentThinkingService: IAgentThinkingService
  ) { }

  getThinking = async (req: Request, res: Response): Promise<void> => {
    const { projectId, pipeline, substep } = req.query as {
      projectId?: string;
      pipeline?: string;
      substep?: string;
    };

    if (!projectId) {
      res.status(400).json({ success: false, message: "projectId query parameter is required" });
      return;
    }

    try {
      if (substep) {
        if (!pipeline) {
          res.status(400).json({ success: false, message: "pipeline query parameter is required for subprocess logs" });
          return;
        }
        const thinkingRecord = await this.agentThinkingService.getThinking(projectId, pipeline, substep);
        res.json({
          success: true,
          data: { thinking: thinkingRecord ? thinkingRecord.thinking : [] },
        });
        return;
      }

      const allThinking = await this.agentThinkingService.getAllThinking(projectId, pipeline);
      res.json({
        success: true,
        data: { agentThinking: allThinking },
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: error.message || "Failed to fetch agent thinking logs",
      });
    }
  };

  runIngestionWorkflow = async (req: Request, res: Response): Promise<void> => {
    const {
      connectorId,
      userPrompt,
      prompt,
      sessionId,
      action,
      step,
      projectId,
      splitDate,
      splitEndDate,
      selectedModels,
      predictionHorizon,
      predictionFrequency,
      predictionObjectiveStartDate,
    } = req.body as {
      connectorId?: string[];
      userPrompt?: string;
      prompt?: string;
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
    };

    req.setTimeout(0);
    res.setTimeout(0);

    console.info(`[Workflow] Ingestion workflow requested — action: ${action || "start"}, projectId: ${projectId || "none"}, sessionId: ${sessionId || "none"}, splitEndDate: ${splitEndDate || splitDate || "none"}, selectedModels: ${selectedModels?.join(",") || "none"}, connectors: [${connectorId?.join(", ") || ""}]`);

    if (!connectorId || !Array.isArray(connectorId) || connectorId.length === 0) {
      console.warn(`[Workflow] Ingestion workflow rejected: connectorId is required`);
      res.status(400).json({ success: false, message: "connectorId is required" });
      return;
    }

    const activeWorkflow = this.ingestionAgentService.getActiveWorkflow();
    if (activeWorkflow.active && activeWorkflow.projectId && activeWorkflow.projectId !== projectId) {
      console.warn(`[Workflow] Ingestion rejected: another project (${activeWorkflow.projectId}) is currently running`);
      res.status(409).json({
        success: false,
        message: "Another pipeline is currently running and wait until the current progress is completed to run the workflow.",
        activeProject: activeWorkflow,
      });
      return;
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const streamId = crypto.randomUUID();
    let clientDisconnected = false;
    let isStreamCompleted = false;
    let runningSessionId = sessionId;

    this.ingestionAgentService.setActiveStream?.(streamId, sessionId, projectId);

    res.on("close", () => {
      clientDisconnected = true;
      console.info(`[Workflow] Client disconnected from SSE stream for session ${runningSessionId || sessionId || "unknown"}, project ${projectId || "unknown"}. Workflow continues running in backend.`);
    });

    const heartbeat = setInterval(() => {
      if (!res.writableEnded && !clientDisconnected && !res.closed) {
        try {
          res.write(": keep-alive\n\n");
        } catch {
          clientDisconnected = true;
        }
      }
    }, 10000);

    try {
      const stream = this.ingestionAgentService.run(connectorId, userPrompt ?? prompt ?? "", {
        sessionId,
        action,
        step,
        projectId,
        splitDate: splitDate || splitEndDate,
        splitEndDate: splitEndDate || splitDate,
        selectedModels,
        predictionHorizon,
        predictionFrequency,
        predictionObjectiveStartDate,
        streamId,
      });

      for await (const update of stream) {
        if (!runningSessionId && update?.sessionId) {
          runningSessionId = update.sessionId;
        }

        if (clientDisconnected || res.writableEnded || res.closed) {
          console.info(`[Workflow] Stream socket closed for session ${runningSessionId || sessionId || "unknown"}. Workflow continues running in backend.`);
          break;
        }
        const canWrite = res.write(`data: ${JSON.stringify({ success: true, data: update })}\n\n`);
        if (!canWrite) {
          await new Promise<void>((resolve) => res.once("drain", resolve));
        }
      }

      if (!clientDisconnected && !res.writableEnded && !res.closed) {
        isStreamCompleted = true;
        res.write("data: [DONE]\n\n");
        res.end();
      }
    } catch (error: any) {
      if (!clientDisconnected && !res.writableEnded && !res.closed) {
        isStreamCompleted = true;
        res.write(`data: ${JSON.stringify({ success: false, message: error.message || "AI workflow failed" })}\n\n`);
        res.end();
      }
    } finally {
      clearInterval(heartbeat);
    }
  };

  attachIngestionStream = async (req: Request, res: Response): Promise<void> => {
    const projectId = (req.query.projectId || req.body?.projectId) as string | undefined;
    const sessionId = (req.query.sessionId || req.body?.sessionId) as string | undefined;

    if (!projectId && !sessionId) {
      console.warn(`[Workflow] Attach stream rejected: projectId or sessionId is required`);
      res.status(400).json({ success: false, message: "projectId or sessionId is required" });
      return;
    }

    req.setTimeout(0);
    res.setTimeout(0);

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    let clientDisconnected = false;
    let isStreamCompleted = false;

    res.on("close", () => {
      clientDisconnected = true;
      console.info(`[Workflow] Client disconnected from attached SSE stream for project ${projectId || "unknown"}`);
    });

    const heartbeat = setInterval(() => {
      if (!res.writableEnded && !clientDisconnected && !res.closed) {
        try {
          res.write(": keep-alive\n\n");
        } catch {
          clientDisconnected = true;
        }
      }
    }, 10000);

    try {
      if (!this.ingestionAgentService.attachStream) {
        throw new Error("attachStream is not supported by ingestionAgentService");
      }
      const stream = this.ingestionAgentService.attachStream(projectId!, sessionId);
      for await (const update of stream) {
        if (clientDisconnected || res.writableEnded || res.closed) {
          console.info(`[Workflow] Attached SSE stream closed by client for project ${projectId || "unknown"}`);
          break;
        }
        const canWrite = res.write(`data: ${JSON.stringify({ success: true, data: update })}\n\n`);
        if (!canWrite) {
          await new Promise<void>((resolve) => res.once("drain", resolve));
        }
      }

      if (!clientDisconnected && !res.writableEnded && !res.closed) {
        isStreamCompleted = true;
        res.write("data: [DONE]\n\n");
        res.end();
      }
    } catch (error: any) {
      if (!clientDisconnected && !res.writableEnded && !res.closed) {
        isStreamCompleted = true;
        res.write(`data: ${JSON.stringify({ success: false, message: error.message || "Failed to attach stream" })}\n\n`);
        res.end();
      }
    } finally {
      clearInterval(heartbeat);
    }
  };

  pauseIngestionWorkflow = async (req: Request, res: Response): Promise<void> => {
    const { sessionId, projectId } = req.body as { sessionId?: string; projectId?: string };
    console.info(`[Workflow] Pause requested for session: ${sessionId || "unknown"}, project: ${projectId || "unknown"}`);
    try {
      const data = await this.ingestionAgentService.pause(sessionId, projectId);
      res.json({ success: true, message: "Workflow paused successfully", data });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message || "Failed to pause workflow" });
    }
  };

  stopIngestionWorkflow = async (req: Request, res: Response): Promise<void> => {
    const { sessionId, projectId } = req.body as { sessionId?: string; projectId?: string };
    console.info(`[Workflow] Stop requested for session: ${sessionId || "unknown"}, project: ${projectId || "unknown"}`);
    try {
      const data = await this.ingestionAgentService.stop(sessionId, projectId);
      res.json({ success: true, message: "Workflow stopped successfully", data });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message || "Failed to stop workflow" });
    }
  };

  getActiveWorkflow = async (req: Request, res: Response): Promise<void> => {
    try {
      const active = this.ingestionAgentService.getActiveWorkflow();
      res.json({ success: true, data: active });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message || "Failed to check active workflow" });
    }
  };
}
