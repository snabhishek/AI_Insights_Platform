import { Request, Response } from "express";
import { ModelLifecycleService } from "../services/ai/model-lifecycle/modelLifecycle.service";

export class ModelLifecycleController {
  constructor(private readonly lifecycleService: ModelLifecycleService) {}

  approvePending = async (req: Request, res: Response): Promise<void> => {
    req.setTimeout(0);
    res.setTimeout(0);
    const { projectId } = req.params;
    const body = req.body as { approved?: unknown };
    if (typeof projectId !== "string" || !projectId.trim() || typeof body.approved !== "boolean") {
      res.status(400).json({
        success: false,
        message: "A valid project ID and approval decision are required.",
      });
      return;
    }
    try {
      const result = await this.lifecycleService.approvePending(projectId.trim(), body.approved);
      res.json({
        success: true,
        data: result
          ? { approved: true, result }
          : { approved: false, status: "Paused", summary: "Approval declined. The lifecycle remains paused." },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to process model lifecycle approval.";
      res.status(message.includes("was not found") ? 404 : 409).json({ success: false, message });
    }
  };

  getResult = async (req: Request, res: Response): Promise<void> => {
    const { projectId, stage } = req.params;
    if (typeof projectId !== "string" || !projectId.trim() ||
        (stage !== "training" && stage !== "validation")) {
      res.status(400).json({ success: false, message: "A valid project ID and lifecycle stage are required." });
      return;
    }
    try {
      const result = await this.lifecycleService.getResult(projectId.trim(), stage);
      res.json({ success: true, data: result });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : "Failed to retrieve model lifecycle result.",
      });
    }
  };

}
