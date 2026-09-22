import { Router } from "express";
import { TrainingConfigController } from "../controllers/trainingConfig.controller";

export default function createTrainingConfigRouter(controller: TrainingConfigController): Router {
  const router = Router();

  router.get("/:projectId", controller.getContract);
  router.put("/:projectId", controller.saveContract);
  router.post("/:projectId", controller.saveContract);

  return router;
}
