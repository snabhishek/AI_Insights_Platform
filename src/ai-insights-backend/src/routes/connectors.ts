import { Router } from "express";
import { ConnectorController } from "../controllers/connector.controller";

export default function createConnectorRouter(controller: ConnectorController): Router {
  const router = Router();

  router.get("/", controller.getAll);
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
  router.get("/", async (req: Request, res: Response) => {
    try {
      const workspaceId = (req.query.workspaceId as string) || null;
      const list = await db.getAll(workspaceId);
      res.json(list);
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message || "Failed to list connectors" });
    }
  });
  
  router.post("/", async (req: Request, res: Response) => {
    const { name, type, subtext, config, workspaceId } = req.body;

    if (!name || !type || !subtext) {
      res.status(400).json({ success: false, message: "Missing required fields (name, type, subtext)" });
      return;
    }

    // Default to default workspace if not provided
    const targetWorkspaceId: string = workspaceId || "default";

    try {
      // Perform one final connection validation before saving
      const test = await testConnection(type, config || {});
      if (!test.success) {
        res.status(400).json({ success: false, message: `Validation failed: ${test.message}` });
        return;
      }

      const newConnector = await db.add(name, type, subtext, config || {}, targetWorkspaceId);
      res.status(201).json(newConnector);
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message || "Failed to add connector" });
    }
  });

  
  return router;
}
