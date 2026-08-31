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

    if (!projectId || !pipeline || !substep) {
      res.status(400).json({ success: false, message: "projectId, pipeline, and substep query parameters are required" });
      return;
    }

    try {
      const thinkingRecord = await this.agentThinkingService.getThinking(projectId, pipeline, substep);
      res.json({
        success: true,
        data: thinkingRecord ? { thinking: thinkingRecord.thinking } : null,
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
    } = req.body as {
      connectorId?: string[];
      userPrompt?: string;
      prompt?: string;
      sessionId?: string;
      action?: "approve" | "retry" | "resume";
      step?: string;
      projectId?: string;
    };
    // Disable socket timeouts for long-running AI workflow SSE streaming
    req.setTimeout(0);
    res.setTimeout(0);

    console.info(`[Workflow] Ingestion workflow requested — action: ${action || "start"}, projectId: ${projectId || "none"}, sessionId: ${sessionId || "none"}, connectors: [${connectorId?.join(", ") || ""}]`);

    if (!connectorId || !Array.isArray(connectorId) || connectorId.length === 0) {
      console.warn(`[Workflow] Ingestion workflow rejected: connectorId is required`);
      res.status(400).json({ success: false, message: "connectorId is required" });
      return;
    }

    // Set Server-Sent Events headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no"); // Prevents Nginx buffering streams
    res.flushHeaders();

    let clientDisconnected = false;
    req.on("close", () => {
      clientDisconnected = true;
    });

    // Heartbeat interval to keep SSE connection alive during long model processing
    const heartbeat = setInterval(() => {
      if (!res.writableEnded && !clientDisconnected) {
        res.write(": keep-alive\n\n");
      }
    }, 10000);

    try {
      const stream = this.ingestionAgentService.run(connectorId, userPrompt ?? prompt ?? "", {
        sessionId,
        action,
        step,
        projectId,
      });

      for await (const update of stream) {
        if (clientDisconnected) {
          console.info(`[Workflow] Client disconnected from SSE stream for session ${sessionId || "unknown"}`);
          break;
        }
        const canWrite = res.write(`data: ${JSON.stringify({ success: true, data: update })}\n\n`);
        if (!canWrite) {
          await new Promise<void>((resolve) => res.once("drain", resolve));
        }
      }

      if (!clientDisconnected && !res.writableEnded) {
        res.write("data: [DONE]\n\n");
        res.end();
      }
    } catch (error: any) {
      if (!clientDisconnected && !res.writableEnded) {
        res.write(`data: ${JSON.stringify({ success: false, message: error.message || "AI workflow failed" })}\n\n`);
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
}

