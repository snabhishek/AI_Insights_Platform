import { Router } from "express";
import { AIController } from "../controllers/ai.controller";

export default function createAIRouter(controller: AIController): Router {
  const router = Router();

  router.post("/ingestion", controller.runIngestionWorkflow);
  router.post("/ingestion/stop", controller.stopIngestionWorkflow);

  return router;
}
