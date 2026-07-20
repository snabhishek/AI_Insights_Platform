import { Request, Response } from "express";
import { IIngestionAgentService } from "../services/ai/ingestionAgent.service.interface";

export class AIController {
  constructor(private ingestionAgentService: IIngestionAgentService) {}

  runIngestionWorkflow = async (req: Request, res: Response): Promise<void> => {
    const {
      connectorId,
      userPrompt,
      prompt,
      sessionId,
      action,
      step,
    } = req.body as {
      connectorId?: string[];
      userPrompt?: string;
      prompt?: string;
      sessionId?: string;
      action?: "approve" | "retry";
      step?: string;
    };
    // AI model calls with batched inspection can take several minutes
    req.setTimeout(300000);

    if (!connectorId || !Array.isArray(connectorId) || connectorId.length === 0) {
      res.status(400).json({ success: false, message: "connectorId is required" });
      return;
    }

    try {
      const result = await this.ingestionAgentService.run(connectorId, userPrompt ?? prompt ?? "", {
        sessionId,
        action,
        step,
      });
      res.json({ success: true, data: result });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message || "AI workflow failed" });
    }
  };
}
