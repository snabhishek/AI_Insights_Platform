import { Request, Response } from "express";
import { IChatSuggestionService } from "../services/chat/chatSuggestion.service.interface";

export class ChatSuggestionController {
  constructor(private readonly chatSuggestionService: IChatSuggestionService) {}

  getSuggestions = async (req: Request, res: Response): Promise<void> => {
    try {
      const suggestions = await this.chatSuggestionService.getSuggestions();
      res.status(200).json({
        success: true,
        data: suggestions,
      });
    } catch (err: any) {
      console.error("[ChatSuggestionController] Failed to fetch suggestions:", err);
      res.status(500).json({
        success: false,
        message: err.message || "Failed to fetch chat suggestions",
      });
    }
  };
}
