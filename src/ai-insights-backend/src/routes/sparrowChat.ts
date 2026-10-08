import { Router } from "express";
import { SparrowChatController } from "../controllers/sparrowChat.controller";

export default function createSparrowChatRouter(controller: SparrowChatController): Router {
  const router = Router();
  router.post("/message", controller.sendMessage);
  router.get("/interaction", controller.getInteraction);
  return router;
}
