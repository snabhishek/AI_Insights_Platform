import { Router } from "express";
import { ChatSuggestionController } from "../controllers/chatSuggestion.controller";

export default function createChatSuggestionRouter(controller: ChatSuggestionController): Router {
  const router = Router();
  router.get("/", controller.getSuggestions);
  return router;
}
