import { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { Request, Response } from "express";

type ProjectRow = RowDataPacket & {
  id: number;
  name: string;
  description: string | null;
  user_id: number;
  created_at: string; // mysql can return string or Date depending on pool settings
  updated_at: string;
};

// Helpers
const toInt = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const isNonEmptyString = (v: unknown) =>
  typeof v === "string" && v.trim().length > 0;

// Get all projects
export const getProjects = (dbPool: Pool) => async (req: Request, res: Response) => {
  try {
    const user_id = toInt(req.query.user_id);

    if (user_id === null) {
      return res.status(400).json({ error: "user_id is required and must be a number" });
    }

    const [rows] = await dbPool.query<ProjectRow[]>(
      "SELECT * FROM projects WHERE user_id = ? ORDER BY updated_at DESC",
      [user_id]
    );

    return res.json(rows);
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Internal server error" });
  }
};

// Create a new project
export const createProject = (dbPool: Pool) => async (req: Request, res: Response) => {
  try {
    // If express.json() is missing, req.body can be undefined
    if (!req.body) {
      return res.status(400).json({
        error: "Missing JSON body. Make sure Express has: app.use(express.json())",
      });
    }

    const { name, description, user_id } = req.body;

    if (!isNonEmptyString(name)) {
      return res.status(400).json({ error: "name is required" });
    }

    const uid = toInt(user_id);
    if (uid === null) {
      return res.status(400).json({ error: "user_id is required and must be a number" });
    }

    // Ensure user exists (avoid FK constraint failure)
    const [urows] = await dbPool.query<RowDataPacket[]>(
      "SELECT id FROM users WHERE id = ? LIMIT 1",
      [uid]
    );
    if (urows.length === 0) {
      return res.status(400).json({ error: `User ${uid} does not exist` });
    }

    const cleanDesc =
      typeof description === "string" ? description : description == null ? null : String(description);

    const [result] = await dbPool.query<ResultSetHeader>(
      "INSERT INTO projects (name, description, user_id, created_at, updated_at) VALUES (?, ?, ?, NOW(), NOW())",
      [name.trim(), cleanDesc, uid]
    );

    const [rows] = await dbPool.query<ProjectRow[]>(
      "SELECT * FROM projects WHERE id = ? LIMIT 1",
      [result.insertId]
    );

    return res.status(201).json(rows[0]);
  } catch (err: any) {
    // Friendly message for FK constraints
    if (err?.code === "ER_NO_REFERENCED_ROW_2") {
      return res.status(400).json({ error: "Invalid user_id (foreign key constraint failed)" });
    }
    return res.status(500).json({ error: err.message || "Internal server error" });
  }
};

// Update a project
export const updateProject = (dbPool: Pool) => async (req: Request, res: Response) => {
  try {
    if (!req.body) {
      return res.status(400).json({
        error: "Missing JSON body. Make sure Express has: app.use(express.json())",
      });
    }

    const id = toInt(req.params.id);
    if (id === null) {
      return res.status(400).json({ error: "id must be a number" });
    }

    const { name, description } = req.body;

    if (!isNonEmptyString(name)) {
      return res.status(400).json({ error: "name is required" });
    }

    const cleanDesc =
      typeof description === "string" ? description : description == null ? null : String(description);

    const [result] = await dbPool.query<ResultSetHeader>(
      "UPDATE projects SET name = ?, description = ?, updated_at = NOW() WHERE id = ?",
      [name.trim(), cleanDesc, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Project not found" });
    }

    const [rows] = await dbPool.query<ProjectRow[]>(
      "SELECT * FROM projects WHERE id = ? LIMIT 1",
      [id]
    );

    return res.json(rows[0]);
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Internal server error" });
  }
};

// Delete a project
export const deleteProject = (dbPool: Pool) => async (req: Request, res: Response) => {
  try {
    const id = toInt(req.params.id);
    if (id === null) {
      return res.status(400).json({ error: "id must be a number" });
    }

    const [result] = await dbPool.query<ResultSetHeader>(
      "DELETE FROM projects WHERE id = ?",
      [id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Project not found" });
    }

    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Internal server error" });
  }
};
