import { Request, Response } from "express";
import { IUserInputService } from "../services/ai/user-input/userInput.service.interface";
import { UserInputSubmissionSchema } from "../schemas/userInput.schema";

export class UserInputController {
  constructor(private service: IUserInputService) {}

  submitInput = async (req: Request, res: Response): Promise<void> => {
    try {
      const projectId = String(req.body.projectId || req.params.projectId || "");
      if (!projectId) {
        res.status(400).json({ success: false, message: "projectId is required" });
        return;
      }

      const parseResult = UserInputSubmissionSchema.safeParse(req.body);
      if (!parseResult.success) {
        res.status(400).json({
          success: false,
          message: "Invalid user input submission",
          errors: parseResult.error.issues,
        });
        return;
      }

      const result = await this.service.submitInput(projectId, parseResult.data);
      res.status(200).json(result);
    } catch (error: any) {
      console.error("[UserInputController] submitInput error:", error);
      const status = typeof error?.statusCode === "number" ? error.statusCode : 500;
      res.status(status).json({
        success: false,
        message: error?.message || "Failed to process user input",
      });
    }
  };

  getInputs = async (req: Request, res: Response): Promise<void> => {
    try {
      const projectId = String(req.params.projectId || "");
      if (!projectId) {
        res.status(400).json({ success: false, message: "projectId is required" });
        return;
      }

      const data = await this.service.getInputs(projectId);
      res.status(200).json({ success: true, data });
    } catch (error: any) {
      console.error("[UserInputController] getInputs error:", error);
      const status = typeof error?.statusCode === "number" ? error.statusCode : 500;
      res.status(status).json({
        success: false,
        message: error?.message || "Failed to retrieve user inputs",
      });
    }
  };
}
