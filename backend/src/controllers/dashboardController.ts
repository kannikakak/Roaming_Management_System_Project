import { Request, Response } from 'express';
import { Pool } from 'mysql2/promise';
// Optional: Define a Dashboard type for better type safety
type Dashboard = {
  id: number;
  user_id: number;
  title: string;
  description: string;
  created_at: string;
  updated_at: string;
};

export const getDashboards = (dbPool: Pool) => async (req: Request, res: Response) => {
  const { user_id } = req.query;
  try {
    const [rows] = await dbPool.query('SELECT * FROM dashboards WHERE user_id = ?', [user_id]);
    res.json(rows);
  } catch {
    res.status(500).json({ message: 'Database error.' });
  }
};

export const createDashboard = (dbPool: Pool) => async (req: Request, res: Response) => {
  const { user_id, title, description } = req.body;
  try {
    const [result]: any = await dbPool.query(
      'INSERT INTO dashboards (user_id, title, description) VALUES (?, ?, ?)',
      [user_id, title, description]
    );
    const [dashboardRows] = await dbPool.query('SELECT * FROM dashboards WHERE id = ?', [result.insertId]);
    res.json((dashboardRows as Dashboard[])[0]);
  } catch {
    res.status(500).json({ message: 'Database error.' });
  }
};

export const updateDashboard = (dbPool: Pool) => async (req: Request, res: Response) => {
  const { id } = req.params;
  const { title, description } = req.body;
  try {
    await dbPool.query(
      'UPDATE dashboards SET title = ?, description = ? WHERE id = ?',
      [title, description, id]
    );
    const [dashboardRows] = await dbPool.query('SELECT * FROM dashboards WHERE id = ?', [id]);
    res.json((dashboardRows as Dashboard[])[0]);
  } catch {
    res.status(500).json({ message: 'Database error.' });
  }
};

export const deleteDashboard = (dbPool: Pool) => async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    await dbPool.query('DELETE FROM dashboards WHERE id = ?', [id]);
    res.json({ message: 'Deleted' });
  } catch {
    res.status(500).json({ message: 'Database error.' });
  }
};