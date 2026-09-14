import { Request, Response } from "express";
import { IModelSelectionService } from "../services/ai/model-selection/modelSelection.service.interface";

export class ModelSelectionController {
  constructor(private service: IModelSelectionService) {}

  analyze = async (req: Request, res: Response): Promise<void> => {
    try {
      const { projectId, ...inputContext } = req.body || {};
      const record = await this.service.analyze(inputContext, projectId);
      res.status(200).json({
        success: true,
        data: record,
      });
    } catch (error: any) {
      console.error("[ModelSelectionController] analyze error:", error);
      res.status(500).json({
        success: false,
        message: error?.message || "Model Selection analysis failed",
      });
    }
  };

  getDecision = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = String(req.params.id || "");
      if (!id) {
        res.status(400).json({ success: false, message: "id parameter is required" });
        return;
      }
      const record = await this.service.getDecision(id);
      if (!record) {
        res.status(404).json({ success: false, message: `Model selection decision "${id}" not found` });
        return;
      }
      res.status(200).json({
        success: true,
        data: record,
      });
    } catch (error: any) {
      console.error("[ModelSelectionController] getDecision error:", error);
      res.status(500).json({
        success: false,
        message: error?.message || "Failed to fetch model selection decision",
      });
    }
  };

  getProjectDecision = async (req: Request, res: Response): Promise<void> => {
    try {
      const projectId = String(req.params.projectId || "");
      if (!projectId) {
        res.status(400).json({ success: false, message: "projectId parameter is required" });
        return;
      }
      const record = await this.service.getLatestProjectDecision(projectId);
      if (!record) {
        res.status(404).json({ success: false, message: `No model selection decision found for project "${projectId}"` });
        return;
      }
      res.status(200).json({
        success: true,
        data: record,
      });
    } catch (error: any) {
      console.error("[ModelSelectionController] getProjectDecision error:", error);
      res.status(500).json({
        success: false,
        message: error?.message || "Failed to fetch project model selection decision",
      });
    }
  };

  selectModels = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = String(req.params.id || "");
      const { selectedModelIds } = req.body || {};

      if (!id) {
        res.status(400).json({ success: false, message: "id parameter is required" });
        return;
      }

      if (!Array.isArray(selectedModelIds) || selectedModelIds.length === 0) {
        res.status(400).json({
          success: false,
          message: "selectedModelIds array is required and must contain at least one model ID",
        });
        return;
      }

      const updatedRecord = await this.service.recordUserSelection(id, selectedModelIds);
      res.status(200).json({
        success: true,
        data: updatedRecord,
      });
    } catch (error: any) {
      console.error("[ModelSelectionController] selectModels error:", error);
      res.status(400).json({
        success: false,
        message: error?.message || "Failed to record user model selection",
      });
    }
  };

  getRegistryModels = async (_req: Request, res: Response): Promise<void> => {
    try {
      const models = this.service.getRegistry().getAllModels();
      res.status(200).json({
        success: true,
        data: models,
      });
    } catch (error: any) {
      console.error("[ModelSelectionController] getRegistryModels error:", error);
      res.status(500).json({
        success: false,
        message: error?.message || "Failed to retrieve model registry",
      });
    }
  };
}
