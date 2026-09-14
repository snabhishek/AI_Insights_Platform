import { Router } from "express";
import { ModelSelectionController } from "../controllers/modelSelection.controller";

export default function createModelSelectionRouter(controller: ModelSelectionController): Router {
  const router = Router();

  router.post("/analyze", controller.analyze);
  router.get("/registry/models", controller.getRegistryModels);
  router.get("/project/:projectId", controller.getProjectDecision);
  router.get("/:id", controller.getDecision);
  router.post("/:id/select", controller.selectModels);

  return router;
}
