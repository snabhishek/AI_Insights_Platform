import { Router } from "express";
import { ConfigController } from "../controllers/config.controller";

export default function createConfigRouter(controller: ConfigController): Router {
  const router = Router();

  router.get("/", controller.getConfig);
  router.post("/discover-models", controller.discoverModels);
  router.post("/provider", controller.saveProvider);
  router.post("/test", controller.testConnection);
  router.post("/active-model", controller.setActiveModel);
  router.delete("/model/:id", controller.deleteModel);

  return router;
}
