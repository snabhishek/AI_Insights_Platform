import { Router } from "express";
import { ModelExportController } from "../controllers/modelExport.controller";

export default function createModelExportRouter(controller: ModelExportController): Router {
  const router = Router();
  router.get("/:projectId/models/:modelId", controller.handle);
  return router;
}
