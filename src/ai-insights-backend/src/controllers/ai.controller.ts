import { Request, Response } from "express";
import { IIngestionAgentService } from "../services/ai/ingestion-agent/ingestionAgent.service.interface";
import { IAgentThinkingService } from "../services/ai/agent-thinking/agentThinking.service.interface";
import { getPipelineForSubstep } from "../agents/pipelineFlowConfig";

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
          res.status(400).json({ success: false, message: "pipeline query parameter is required when substep is provided" });
          return;
        }
        let thinkingRecord = await this.agentThinkingService.getThinking(projectId, pipeline, substep);
        if (!thinkingRecord) {
          const canonicalPipeline = getPipelineForSubstep(substep);
          if (canonicalPipeline && canonicalPipeline !== pipeline) {
            thinkingRecord = await this.agentThinkingService.getThinking(projectId, canonicalPipeline, substep);
          }
          if (!thinkingRecord && pipeline !== "Data Ingestion") {
            thinkingRecord = await this.agentThinkingService.getThinking(projectId, "Data Ingestion", substep);
          }
        }
        res.json({
          success: true,
          data: thinkingRecord ? { thinking: thinkingRecord.thinking } : null,
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
      splitStartDate,
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
      splitStartDate?: string;
      splitEndDate?: string;
      selectedModels?: string[];
      predictionHorizon?: number;
      predictionFrequency?: string;
      predictionObjectiveStartDate?: string;
    };
    // Disable socket timeouts for long-running AI workflow SSE streaming
    req.setTimeout(0);
    res.setTimeout(0);

    console.info(`[Workflow] Ingestion workflow requested — action: ${action || "start"}, projectId: ${projectId || "none"}, sessionId: ${sessionId || "none"}, splitStartDate: ${splitStartDate || "none"}, splitEndDate: ${splitEndDate || splitDate || "none"}, selectedModels: ${selectedModels?.join(",") || "none"}, connectors: [${connectorId?.join(", ") || ""}]`);

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

    // Set Server-Sent Events headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no"); // Prevents Nginx buffering streams
    res.flushHeaders();

    let clientDisconnected = false;
    res.on("close", () => {
      if (!res.writableEnded) {
        clientDisconnected = true;
      }
    });

    // Heartbeat interval to keep SSE connection alive during long model processing
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
        splitStartDate,
        splitEndDate: splitEndDate || splitDate,
        selectedModels,
        predictionHorizon,
        predictionFrequency,
        predictionObjectiveStartDate,
      });

      for await (const update of stream) {
        if (clientDisconnected || res.writableEnded || res.closed) {
          console.info(`[Workflow] Client disconnected from SSE stream for session ${sessionId || "unknown"}`);
          break;
        }
        const canWrite = res.write(`data: ${JSON.stringify({ success: true, data: update })}\n\n`);
        if (!canWrite) {
          await new Promise<void>((resolve) => res.once("drain", resolve));
        }
      }

      if (!clientDisconnected && !res.writableEnded && !res.closed) {
        res.write("data: [DONE]\n\n");
        res.end();
      }
    } catch (error: any) {
      if (!clientDisconnected && !res.writableEnded && !res.closed) {
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

  getActiveWorkflow = async (req: Request, res: Response): Promise<void> => {
    try {
      const active = this.ingestionAgentService.getActiveWorkflow();
      res.json({ success: true, data: active });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message || "Failed to check active workflow" });
    }
  };
}

