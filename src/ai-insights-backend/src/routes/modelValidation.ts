import { Router } from "express";
import { ModelValidationController } from "../controllers/modelValidation.controller";

export default function createModelValidationRouter(controller: ModelValidationController): Router {
  const router = Router();

  router.post("/validate", controller.validateModels);
  router.get("/:projectId", controller.getValidationResults);
  router.get("/:projectId/candidates", controller.getValidationCandidates);

  return router;
}
