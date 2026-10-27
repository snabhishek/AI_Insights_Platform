import { Router } from "express";
import { ModelLifecycleController } from "../controllers/modelLifecycle.controller";

export default function createModelLifecycleRouter(controller: ModelLifecycleController): Router {
  const router = Router();
  router.post("/:projectId/approval", controller.approvePending);
  router.get("/:projectId/:stage", controller.getResult);
  return router;
}
