import { Request, Response } from "express";
import { IModelValidationService } from "../services/ai/model-validation/modelValidation.service.interface";
import { VALIDATION_ERROR_MESSAGES } from "../constants/modelValidation.constants";

export class ModelValidationController {
  constructor(private readonly modelValidationService: IModelValidationService) {}

  public validateModels = async (req: Request, res: Response): Promise<void> => {

    req.setTimeout(0);
    res.setTimeout(0);

    const {
      projectId,
      predictionObjectiveStartDate,
      predictionHorizon,
      predictionFrequency,
      selectedModels,
      filters,
    } = req.body as {
      projectId?: string;
      predictionObjectiveStartDate?: string;
      predictionHorizon?: number;
      predictionFrequency?: string;
      selectedModels?: string[];
      filters?: Record<string, any>;
    };

    if (!projectId || typeof projectId !== "string" || projectId.trim().length === 0) {
      res.status(400).json({
        success: false,
        message: VALIDATION_ERROR_MESSAGES.MISSING_PROJECT_ID,
      });
      return;
    }

    if (
      !predictionObjectiveStartDate ||
      typeof predictionObjectiveStartDate !== "string" ||
      predictionObjectiveStartDate.trim().length === 0
    ) {
      res.status(400).json({
        success: false,
        message: VALIDATION_ERROR_MESSAGES.MISSING_START_DATE,
      });
      return;
    }

    if (
      predictionHorizon === undefined ||
      predictionHorizon === null ||
      typeof predictionHorizon !== "number" ||
      predictionHorizon <= 0
    ) {
      res.status(400).json({
        success: false,
        message: VALIDATION_ERROR_MESSAGES.INVALID_HORIZON,
      });
      return;
    }

    if (!predictionFrequency || typeof predictionFrequency !== "string") {
      res.status(400).json({
        success: false,
        message: VALIDATION_ERROR_MESSAGES.MISSING_FREQUENCY,
      });
      return;
    }

    if (!selectedModels || !Array.isArray(selectedModels) || selectedModels.length === 0) {
      res.status(400).json({
        success: false,
        message: VALIDATION_ERROR_MESSAGES.MISSING_SELECTED_MODELS,
      });
      return;
    }

    try {
      const result = await this.modelValidationService.validateModels({
        projectId: projectId.trim(),
        predictionObjectiveStartDate: predictionObjectiveStartDate.trim(),
        predictionHorizon: Number(predictionHorizon),
        predictionFrequency: predictionFrequency.trim(),
        selectedModels,
        filters,
      });

      res.json({
        success: true,
        data: result,
      });
    } catch (error: any) {
      res.status(400).json({
        success: false,
        message: error.message || VALIDATION_ERROR_MESSAGES.VALIDATION_EXECUTION_FAILED,
      });
    }
  };

  public getValidationResults = async (req: Request, res: Response): Promise<void> => {
    const { projectId } = req.params as { projectId?: string };
    const effectiveProjectId = projectId || (req.query.projectId as string);

    if (!effectiveProjectId) {
      res.status(400).json({
        success: false,
        message: VALIDATION_ERROR_MESSAGES.MISSING_PROJECT_ID,
      });
      return;
    }

    try {
      const result = await this.modelValidationService.getValidationResults(effectiveProjectId.trim());
      res.json({
        success: true,
        data: result,
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: error.message || "Failed to retrieve validation results",
      });
    }
  };

  public getValidationCandidates = async (req: Request, res: Response): Promise<void> => {
    const { projectId } = req.params as { projectId?: string };
    const effectiveProjectId = projectId || (req.query.projectId as string);

    if (!effectiveProjectId) {
      res.status(400).json({
        success: false,
        message: VALIDATION_ERROR_MESSAGES.MISSING_PROJECT_ID,
      });
      return;
    }

    try {
      const result = await this.modelValidationService.getValidationCandidates(effectiveProjectId.trim());
      res.json({
        success: true,
        data: result,
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: error.message || "Failed to retrieve validation candidates",
      });
    }
  };
}
