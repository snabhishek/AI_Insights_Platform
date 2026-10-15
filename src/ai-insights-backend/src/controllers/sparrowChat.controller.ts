import { Request, Response } from "express";
import { ISparrowChatService } from "../services/chat/sparrowChat.service.interface";
import { SparrowThinkingStep } from "../agents/sparrow/types";
import { z } from "zod";

const idSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);

export class SparrowChatController {
  constructor(private readonly sparrowChatService: ISparrowChatService) {}

  public sendMessage = async (req: Request, res: Response): Promise<void> => {
    let streaming = false;
    let disconnected = false;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let progressTimer: ReturnType<typeof setTimeout> | undefined;
    let pendingThinking: SparrowThinkingStep[] | undefined;
    let lastProgressAt = 0;
    let backpressured = false;
    const sendEvent = (event: object) => {
      if (!disconnected && !res.writableEnded) backpressured = res.write(`data: ${JSON.stringify(event)}\n\n`) === false;
    };
    const flushThinking = () => {
      if (progressTimer) clearTimeout(progressTimer);
      progressTimer = undefined;
      if (pendingThinking) {
        sendEvent({ type: "thinking", thinking: pendingThinking });
        pendingThinking = undefined;
        lastProgressAt = Date.now();
      }
    };
    const streamThinking = (thinking: SparrowThinkingStep[]) => {
      // Coalesce rapid Docker output; every line remains in durable execution logs.
      pendingThinking = thinking;
      if (backpressured || disconnected) return;
      if (Date.now() - lastProgressAt >= 100) flushThinking();
      else if (!progressTimer) progressTimer = setTimeout(flushThinking, 100);
    };
    try {
      const { userQuery, message, text, projectId, conversationId, conversationHistory, executionState, interactionId,
        requestId, messageId, userMessageId, userContent, session } = req.body;
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
      for (const id of [requestId, messageId, userMessageId, conversationId]) {
        if (id !== undefined && !idSchema.safeParse(id).success) { res.status(400).json({ success: false, error: "Invalid chat identifier." }); return; }
      }

      streaming = req.headers?.accept?.includes("text/event-stream") === true;
      if (streaming) {
        res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache, no-transform");
        res.setHeader("Connection", "keep-alive");
        res.setHeader("X-Accel-Buffering", "no");
        res.flushHeaders();
        res.on("close", () => { disconnected = true; if (heartbeat) clearInterval(heartbeat); if (progressTimer) clearTimeout(progressTimer); });
        res.on("drain", () => { backpressured = false; flushThinking(); });
        sendEvent({ type: "thinking", thinking: [{ time: new Date().toLocaleTimeString("en-GB", { hour12: false }), timestamp: new Date().toISOString(), text: "Connected to Sparrow; loading the conversation.", done: false }] });
        heartbeat = setInterval(() => { if (!disconnected && !res.writableEnded) res.write(": heartbeat\n\n"); }, 10000);
      }
      const response = await this.sparrowChatService.sendMessage({
        userQuery: effectiveQuery,
        projectId: projectId.trim(),
        conversationId,
        interactionId,
        conversationHistory: Array.isArray(conversationHistory) ? conversationHistory : [],
        executionState: executionState && typeof executionState === "object" ? executionState : undefined,
        onThinkingUpdate: streaming ? streamThinking : undefined,
        requestId, messageId, userMessageId, userContent, session,
      });

      if (streaming) {
        flushThinking();
        sendEvent({ type: "result", data: response });
        res.end();
        return;
      }

      res.json({
        success: true,
        data: response,
      });
    } catch (err: any) {
      console.error("[SparrowChatController] Error handling chat message:", err);
      if (streaming) {
        flushThinking();
        sendEvent({ type: "error", error: err?.message || "Internal server error" });
        res.end();
        return;
      }
      res.status(500).json({
        success: false,
        error: err?.message || "Internal server error",
      });
    } finally {
      if (heartbeat) clearInterval(heartbeat);
      if (progressTimer) clearTimeout(progressTimer);
    }
  };

  public stop = async (req: Request, res: Response): Promise<void> => {
    try {
      const input = z.object({ projectId: z.string().trim().min(1).max(50), conversationId: idSchema, requestId: idSchema, messageId: idSchema,
        userMessageId: idSchema.optional(), userQuery: z.string().trim().min(1).max(12000), userContent: z.string().max(16000).optional(), session: z.record(z.string(), z.unknown()).optional() }).parse(req.body);
      const data = await this.sparrowChatService.stop(input);
      res.json({ success: true, data });
    } catch (error: any) { res.status(error instanceof z.ZodError ? 400 : 409).json({ success: false, error: error.message }); }
  };
  public listSessions = async (req: Request, res: Response): Promise<void> => {
    try {
      const projects = z.array(z.string().min(1).max(50)).max(200).parse(typeof req.query.projectIds === "string" ? req.query.projectIds.split(",").filter(Boolean) : []);
      res.json({ success: true, data: await this.sparrowChatService.listSessions(projects) });
    } catch (error: any) { res.status(400).json({ success: false, error: error.message }); }
  };
  public updateSession = async (req: Request, res: Response): Promise<void> => {
    try {
      await this.sparrowChatService.updateSession(z.string().min(1).max(50).parse(req.body.projectId), idSchema.parse(req.params.id), req.body.metadata);
      res.json({ success: true });
    } catch (error: any) { res.status(400).json({ success: false, error: error.message }); }
  };
  public deleteSession = async (req: Request, res: Response): Promise<void> => {
    try {
      await this.sparrowChatService.deleteSession(z.string().min(1).max(50).parse(req.query.projectId), idSchema.parse(req.params.id));
      res.json({ success: true });
    } catch (error: any) { res.status(400).json({ success: false, error: error.message }); }
  };
  public importSessions = async (req: Request, res: Response): Promise<void> => {
    try { await this.sparrowChatService.importSessions(req.body.sessions); res.json({ success: true }); }
    catch (error: any) { res.status(400).json({ success: false, error: error.message }); }
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
