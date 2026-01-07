import { Pool, RowDataPacket } from 'mysql2/promise';
import { Request, Response } from 'express';

// Get all projects
export const getProjects = (dbPool: Pool) => async (req: Request, res: Response) => {
  const user_id = req.query.user_id;
  const [rows] = await dbPool.query<RowDataPacket[]>('SELECT * FROM projects WHERE user_id = ?', [user_id]);
  res.json(rows);
};

// Create a new project
export const createProject = (dbPool: Pool) => async (req: Request, res: Response) => {
  const { name, description, user_id } = req.body;
  const [result]: any = await dbPool.query(
    'INSERT INTO projects (name, description, user_id, created_at, updated_at) VALUES (?, ?, ?, NOW(), NOW())',
    [name, description, user_id]
  );
  const [rows] = await dbPool.query<RowDataPacket[]>('SELECT * FROM projects WHERE id = ?', [result.insertId]);
  res.json(rows[0]);
};

// Update a project
export const updateProject = (dbPool: Pool) => async (req: Request, res: Response) => {
  const { name, description } = req.body;
  const { id } = req.params;
  await dbPool.query(
    'UPDATE projects SET name = ?, description = ?, updated_at = NOW() WHERE id = ?',
    [name, description, id]
  );
  const [rows] = await dbPool.query<RowDataPacket[]>('SELECT * FROM projects WHERE id = ?', [id]);
  res.json(rows[0]);
};

// Delete a project
export const deleteProject = (dbPool: Pool) => async (req: Request, res: Response) => {
  const { id } = req.params;
  await dbPool.query('DELETE FROM projects WHERE id = ?', [id]);
  res.json({ success: true });
};