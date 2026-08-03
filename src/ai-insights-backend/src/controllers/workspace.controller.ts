import { Request, Response } from "express";
import { WorkspaceService } from "../services/project/workspace.service";

export class WorkspaceController {
  constructor(private workspaceService: WorkspaceService) {}

  getAllWorkspaces = async (req: Request, res: Response): Promise<void> => {
    try {
      const workspaces = await this.workspaceService.getAllWorkspaces();
      res.json(workspaces);
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message || "Failed to list workspaces" });
    }
  };

  createWorkspace = async (req: Request, res: Response): Promise<void> => {
    const { name } = req.body;
    if (!name || !name.trim()) {
      res.status(400).json({ success: false, message: "Workspace name is required." });
      return;
    }

    try {
      const result = await this.workspaceService.createWorkspace(name);
      if (!result.success) {
        if (result.reason === "DUPLICATE") {
          res.status(409).json({ success: false, message: result.message });
        } else {
          res.status(400).json({ success: false, message: result.message });
        }
        return;
      }

      res.status(201).json(result.data);
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message || "Failed to create workspace" });
    }
  };

  deleteWorkspace = async (req: Request, res: Response): Promise<void> => {
    const id = req.params.id as string;
    try {
      const result = await this.workspaceService.deleteWorkspace(id);
      if (!result.success) {
        if (result.reason === "NOT_FOUND") {
          res.status(404).json({ success: false, message: result.message });
        } else if (result.reason === "FORBIDDEN") {
          res.status(403).json({ success: false, message: result.message });
        } else {
          res.status(400).json({ success: false, message: result.message });
        }
        return;
      }

      res.json({ success: true, message: "Workspace deleted." });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message || "Failed to delete workspace" });
    }
  };

  getProjectsByWorkspace = async (req: Request, res: Response): Promise<void> => {
    const id = req.params.id as string;
    try {
      const projects = await this.workspaceService.getProjectsByWorkspace(id);
      res.json(projects);
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message || "Failed to list projects" });
    }
  };

  createProject = async (req: Request, res: Response): Promise<void> => {
    const workspaceId = req.params.id as string;
    const { name, role, dataSources, initials, useCase, domain, subDomain } = req.body;

    if (!name || !name.trim()) {
      res.status(400).json({ success: false, message: "Project name is required." });
      return;
    }

    try {
      const result = await this.workspaceService.createProject(workspaceId, {
        name,
        role,
        dataSources,
        initials,
        useCase,
        domain,
        subDomain,
      });

      if (!result.success) {
        if (result.reason === "WORKSPACE_NOT_FOUND") {
          res.status(404).json({ success: false, message: result.message });
        } else if (result.reason === "DUPLICATE") {
          res.status(409).json({ success: false, message: result.message });
        } else {
          res.status(400).json({ success: false, message: result.message });
        }
        return;
      }

      res.status(201).json(result.data);
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message || "Failed to create project" });
    }
  };

  updateProject = async (req: Request, res: Response): Promise<void> => {
    const pid = req.params.pid as string;
    const { name, useCase, dataSources, agentState } = req.body;

    try {
      const result = await this.workspaceService.updateProject(pid, {
        name,
        useCase,
        dataSources,
        agentState,
      });

      if (!result.success) {
        res.status(404).json({ success: false, message: result.message });
        return;
      }

      res.json(result.data);
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message || "Failed to update project" });
    }
  };

  getProjectRuns = async (req: Request, res: Response): Promise<void> => {
    const pid = req.params.pid as string;
    try {
      const runs = await this.workspaceService.getProjectRuns(pid);
      res.json(runs);
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message || "Failed to list project runs" });
    }
  };

  deleteProject = async (req: Request, res: Response): Promise<void> => {
    const pid = req.params.pid as string;
    try {
      const result = await this.workspaceService.deleteProject(pid);
      if (!result.success) {
        res.status(404).json({ success: false, message: result.message });
        return;
      }
      res.json({ success: true, message: "Project deleted." });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message || "Failed to delete project" });
    }
  };
}
