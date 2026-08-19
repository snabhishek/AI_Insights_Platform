import { Router } from "express";
import { ConnectorController } from "../controllers/connector.controller";

export default function createConnectorRouter(controller: ConnectorController): Router {
  const router = Router();

  router.get("/", controller.getAll);
  router.get("/filter-options", controller.getFilterOptions);
  router.post("/test", controller.testConnection);
  router.post("/", controller.add);
  router.get("/:id/schema", controller.getSchema);
  router.get("/:id/preview", controller.getPreview);
  router.post("/:id/sync", controller.sync);
  router.post("/:id/disconnect", controller.disconnect);
  router.post("/sync-all", controller.syncAll);
  router.get("/:id/health", controller.getHealth);
  router.get("/:id", controller.getById);
  router.delete("/:id", controller.delete);
  router.post("/:id/connect", controller.connect);
  router.put("/:id", controller.update);

  return router;
}
