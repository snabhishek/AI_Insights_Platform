import { Request, Response } from "express";
import { ITrainingConfigService } from "../services/ai/training-config/trainingConfig.service.interface";

export class TrainingConfigController {
  constructor(private service: ITrainingConfigService) {}

  getContract = async (req: Request, res: Response): Promise<void> => {
    try {
      const projectId = String(req.params.projectId || "");
      const timestamp = req.query.timestamp ? String(req.query.timestamp) : undefined;

      if (!projectId) {
        res.status(400).json({ success: false, message: "projectId parameter is required" });
        return;
      }

      const result = await this.service.getContract(projectId, timestamp);
      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error: any) {
      console.error("[TrainingConfigController] getContract error:", error);
      res.status(500).json({
        success: false,
        message: error?.message || "Failed to fetch training configuration contract",
      });
    }
  };

  saveContract = async (req: Request, res: Response): Promise<void> => {
    try {
      const projectId = String(req.params.projectId || "");
      const { yamlContent, timestamp } = req.body || {};

      if (!projectId) {
        res.status(400).json({ success: false, message: "projectId parameter is required" });
        return;
      }

      if (!yamlContent || typeof yamlContent !== "string") {
        res.status(400).json({ success: false, message: "yamlContent string is required in request body" });
        return;
      }

      const result = await this.service.saveContract(projectId, yamlContent, timestamp);
      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error: any) {
      console.error("[TrainingConfigController] saveContract error:", error);
      res.status(400).json({
        success: false,
        message: error?.message || "Failed to save training configuration contract",
      });
    }
  };
}
