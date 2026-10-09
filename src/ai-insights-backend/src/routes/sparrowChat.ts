import { Router } from "express";
import { SparrowChatController } from "../controllers/sparrowChat.controller";

export default function createSparrowChatRouter(controller: SparrowChatController): Router {
  const router = Router();
  router.post("/message", controller.sendMessage);
  router.post("/stop", controller.stop);
  router.get("/sessions", controller.listSessions);
  router.post("/sessions/import", controller.importSessions);
  router.patch("/sessions/:id", controller.updateSession);
  router.delete("/sessions/:id", controller.deleteSession);
  router.get("/interaction", controller.getInteraction);
  return router;
}
