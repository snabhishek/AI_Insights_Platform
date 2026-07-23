import { Router, Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { query } from "../db";

const router = Router();

// ─── Workspace Types ────────────────────────────────────────────────────────────

interface Workspace {
  id: string;
  name: string;
  isDefault: boolean;
  createdAt: string;
}

interface Project {
  id: string;
  name: string;
  role: "OWNER" | "MEMBER";
  dataSources: string[];
  initials: string;
  workspaceId: string;
  createdAt: string;
  useCase?: string;
  agentState?: Record<string, unknown>;
}

function mapWorkspace(row: any): Workspace {
  return {
    id: row.id,
    name: row.name,
    isDefault: row.is_default,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  };
}

function mapProject(row: any): Project {
  return {
    id: row.id,
    name: row.name,
    role: row.role as "OWNER" | "MEMBER",
    dataSources: Array.isArray(row.data_sources) ? row.data_sources : [],
    initials: row.initials,
    workspaceId: row.workspace_id,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    useCase: row.use_case || "",
    agentState: row.agent_state ?? {},
  };
}

// ─── GET /api/workspaces — List all workspaces ──────────────────────────────────
router.get("/", async (req: Request, res: Response) => {
  try {
    const result = await query("SELECT * FROM workspaces ORDER BY is_default DESC, created_at ASC");
    res.json(result.rows.map(mapWorkspace));
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── POST /api/workspaces — Create a new workspace ─────────────────────────────
router.post("/", async (req: Request, res: Response) => {
  const { name } = req.body;
  if (!name || !name.trim()) {
    res.status(400).json({ success: false, message: "Workspace name is required." });
    return;
  }

  const id = `ws-${uuidv4()}`;
  try {
    const result = await query(
      `INSERT INTO workspaces (id, name, is_default, created_at)
       VALUES ($1, $2, FALSE, NOW())
       RETURNING *`,
      [id, name.trim()]
    );
    res.status(201).json(mapWorkspace(result.rows[0]));
  } catch (err: any) {
    if (err.code === "23505") {
      res.status(409).json({ success: false, message: `Workspace named "${name}" already exists.` });
    } else {
      res.status(500).json({ success: false, message: err.message });
    }
  }
});

// ─── DELETE /api/workspaces/:id — Delete a workspace ───────────────────────────
router.delete("/:id", async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    // Guard: prevent deleting the default workspace
    const ws = await query("SELECT * FROM workspaces WHERE id = $1", [id]);
    if (ws.rows.length === 0) {
      res.status(404).json({ success: false, message: "Workspace not found." });
      return;
    }
    if (ws.rows[0].is_default) {
      res.status(403).json({ success: false, message: "The Default Workspace cannot be deleted." });
      return;
    }

    // Cascade delete handled by DB ON DELETE CASCADE for projects and connectors
    await query("DELETE FROM workspaces WHERE id = $1", [id]);
    res.json({ success: true, message: "Workspace deleted." });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── GET /api/workspaces/:id/projects — List projects in a workspace ───────────
router.get("/:id/projects", async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const result = await query(
      `SELECT p.*, r.agent_state
       FROM projects p
       LEFT JOIN LATERAL (
         SELECT agent_state
         FROM project_runs
         WHERE project_id = p.id
         ORDER BY created_at DESC
         LIMIT 1
       ) r ON true
       WHERE p.workspace_id = $1
       ORDER BY p.created_at DESC`,
      [id]
    );
    res.json(result.rows.map(mapProject));
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── POST /api/workspaces/:id/projects — Create a project ──────────────────────
router.post("/:id/projects", async (req: Request, res: Response) => {
  const { id: workspaceId } = req.params;
  const { name, role = "OWNER", dataSources = [], initials = "US", useCase = "" } = req.body;

  if (!name || !name.trim()) {
    res.status(400).json({ success: false, message: "Project name is required." });
    return;
  }

  // Verify workspace exists
  const ws = await query("SELECT id FROM workspaces WHERE id = $1", [workspaceId]);
  if (ws.rows.length === 0) {
    res.status(404).json({ success: false, message: "Workspace not found." });
    return;
  }

  // Check for project name + selected sources duplicates in this workspace
  try {
    const existingProj = await query(
      "SELECT name, data_sources FROM projects WHERE workspace_id = $1",
      [workspaceId]
    );
    const areSourceArraysEqual = (arr1: string[], arr2: string[]) => {
      if (arr1.length !== arr2.length) return false;
      const sorted1 = [...arr1].sort();
      const sorted2 = [...arr2].sort();
      return sorted1.every((val, index) => val === sorted2[index]);
    };
    const isDuplicate = existingProj.rows.some(
      (p: any) =>
        p.name.toLowerCase() === name.trim().toLowerCase() &&
        areSourceArraysEqual(p.data_sources || [], dataSources)
    );
    if (isDuplicate) {
      res.status(409).json({
        success: false,
        message: `A project with name "${name}" and the same selected data sources already exists in this workspace.`
      });
      return;
    }
  } catch (dbErr: any) {
    res.status(500).json({ success: false, message: dbErr.message });
    return;
  }

  const projectId = `proj-${uuidv4()}`;
  try {
    const result = await query(
      `INSERT INTO projects (id, name, role, data_sources, initials, workspace_id, use_case, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       RETURNING *`,
      [projectId, name.trim(), role, dataSources, initials, workspaceId, useCase]
    );
    res.status(201).json(mapProject(result.rows[0]));
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── PUT /api/workspaces/:id/projects/:pid — Update a project ─────────────────
router.put("/:id/projects/:pid", async (req: Request, res: Response) => {
  const { pid } = req.params;
  const { name, useCase, dataSources, agentState } = req.body;

  try {
    const existing = await query("SELECT * FROM projects WHERE id = $1", [pid]);
    if (existing.rows.length === 0) {
      res.status(404).json({ success: false, message: "Project not found." });
      return;
    }

    const updatedName = typeof name === "string" && name.trim() ? name.trim() : existing.rows[0].name;
    const updatedUseCase = useCase !== undefined ? useCase : existing.rows[0].use_case;
    const updatedSources = Array.isArray(dataSources) ? dataSources : existing.rows[0].data_sources;

    const result = await query(
      `UPDATE projects
       SET name = $1, use_case = $2, data_sources = $3
       WHERE id = $4
       RETURNING *`,
      [updatedName, updatedUseCase, updatedSources, pid]
    );

    const projectObj = mapProject(result.rows[0]);
    if (agentState !== undefined) {
      projectObj.agentState = agentState;
    } else {
      const latestRun = await query(
        "SELECT agent_state FROM project_runs WHERE project_id = $1 ORDER BY created_at DESC LIMIT 1",
        [pid]
      );
      if (latestRun.rows.length > 0) {
        projectObj.agentState = latestRun.rows[0].agent_state;
      }
    }

    res.json(projectObj);
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── GET /api/workspaces/:id/projects/:pid/runs — Get project run history ────
router.get("/:id/projects/:pid/runs", async (req: Request, res: Response) => {
  const { pid } = req.params;
  try {
    const result = await query(
      "SELECT * FROM project_runs WHERE project_id = $1 ORDER BY created_at DESC",
      [pid]
    );
    const runs = result.rows.map((row) => ({
      id: row.id,
      projectId: row.project_id,
      useCase: row.use_case || "",
      agentState: row.agent_state ?? {},
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    }));
    res.json(runs);
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── DELETE /api/workspaces/:id/projects/:pid — Delete a project ───────────────
router.delete("/:id/projects/:pid", async (req: Request, res: Response) => {
  const { pid } = req.params;
  try {
    const result = await query("DELETE FROM projects WHERE id = $1 RETURNING id", [pid]);
    if (result.rows.length === 0) {
      res.status(404).json({ success: false, message: "Project not found." });
      return;
    }
    res.json({ success: true, message: "Project deleted." });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;

