import { Router } from "express";
import { WorkspaceController } from "../controllers/workspace.controller";

export default function createWorkspaceRouter(controller: WorkspaceController): Router {
  const router = Router();

  router.get("/", controller.getAllWorkspaces);
  router.post("/", controller.createWorkspace);
  router.delete("/:id", controller.deleteWorkspace);

  router.get("/:id/projects", controller.getProjectsByWorkspace);
  router.post("/:id/projects", controller.createProject);
  router.put("/:id/projects/:pid", controller.updateProject);
  router.get("/:id/projects/:pid/runs", controller.getProjectRuns);
  router.delete("/:id/projects/:pid", controller.deleteProject);

  return router;
}
