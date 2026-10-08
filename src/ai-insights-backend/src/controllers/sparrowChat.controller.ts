import { Request, Response } from "express";
import { ISparrowChatService } from "../services/chat/sparrowChat.service.interface";

export class SparrowChatController {
  constructor(private readonly sparrowChatService: ISparrowChatService) {}

  public sendMessage = async (req: Request, res: Response): Promise<void> => {
    try {
      const { userQuery, message, text, projectId, conversationId, conversationHistory, executionState, interactionId } = req.body;
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
      if (interactionId !== undefined && (typeof interactionId !== "string" || !interactionId.trim() || interactionId.length > 100)) {
        res.status(400).json({ success: false, error: "interactionId must be a nonempty string." });
        return;
      }

      const response = await this.sparrowChatService.sendMessage({
        userQuery: effectiveQuery,
        projectId: projectId.trim(),
        conversationId,
        interactionId,
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

  public getInteraction = async (req: Request, res: Response): Promise<void> => {
    const { projectId, conversationId } = req.query;
    if (typeof projectId !== "string" || !projectId.trim() || typeof conversationId !== "string") {
      res.status(400).json({ success: false, error: "projectId and conversationId are required." });
      return;
    }
    try {
      const data = await this.sparrowChatService.getInteraction({ projectId, conversationId });
      res.json({ success: true, data });
    } catch (error) {
      res.status(409).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  };
}
