import { Router } from "express";
import { AIController } from "../controllers/ai.controller";

export default function createAIRouter(controller: AIController): Router {
  const router = Router();

  router.post("/ingestion", controller.runIngestionWorkflow);
  router.post("/ingestion/pause", controller.pauseIngestionWorkflow);
  router.post("/ingestion/stop", controller.stopIngestionWorkflow);
  router.get("/thinking", controller.getThinking);

  return router;
}
