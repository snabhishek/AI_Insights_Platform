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
      "SELECT * FROM projects WHERE workspace_id = $1 ORDER BY created_at DESC",
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
  const { name, role = "OWNER", dataSources = [], initials = "US" } = req.body;

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

  const projectId = `proj-${uuidv4()}`;
  try {
    const result = await query(
      `INSERT INTO projects (id, name, role, data_sources, initials, workspace_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       RETURNING *`,
      [projectId, name.trim(), role, dataSources, initials, workspaceId]
    );
    res.status(201).json(mapProject(result.rows[0]));
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
