import { Request, Response } from "express";
import { ISparrowChatService } from "../services/chat/sparrowChat.service.interface";

export class SparrowChatController {
  constructor(private readonly sparrowChatService: ISparrowChatService) {}

  public sendMessage = async (req: Request, res: Response): Promise<void> => {
    try {
      const { userQuery, message, text, projectId, conversationId, conversationHistory, executionState } = req.body;
      const rawQuery = userQuery || message || text;
      const effectiveQuery = typeof rawQuery === "string" ? rawQuery.trim() : "";

      if (!effectiveQuery) {
        res.status(400).json({ success: false, error: "Query or message is required." });
        return;
      }

      if (!projectId || typeof projectId !== "string" || projectId.trim().length === 0) {
        res.status(400).json({ success: false, error: "projectId is required." });
        return;
      }

      const response = await this.sparrowChatService.sendMessage({
        userQuery: effectiveQuery,
        projectId: projectId.trim(),
        conversationId,
        conversationHistory: Array.isArray(conversationHistory) ? conversationHistory : [],
        executionState: executionState && typeof executionState === "object" ? executionState : undefined,
      });

      res.json({
        success: true,
        data: response,
      });
    } catch (err: any) {
      console.error("[SparrowChatController] Error handling chat message:", err);
      res.status(500).json({
        success: false,
        error: err?.message || "Internal server error",
      });
    }
  };
}
