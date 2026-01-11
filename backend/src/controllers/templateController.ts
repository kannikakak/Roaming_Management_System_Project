import { Request, Response } from 'express';
import { Pool } from 'mysql2/promise';

export const createTemplate = (dbPool: Pool) => async (req: Request, res: Response) => {
  const { name, layout, created_by } = req.body;
  if (!name || !layout) {
    return res.status(400).json({ message: 'Name and layout are required.' });
  }
  try {
    await dbPool.execute(
      'INSERT INTO report_templates (name, layout, created_by) VALUES (?, ?, ?)',
      [name, JSON.stringify(layout), created_by || null]
    );
    res.status(201).json({ message: 'Template created.' });
  } catch (err: any) {
    res.status(500).json({ message: 'Database error.', error: err.message });
  }
};

export const getTemplates = (dbPool: Pool) => async (_req: Request, res: Response) => {
  try {
    const [rows] = await dbPool.query('SELECT * FROM report_templates ORDER BY created_at DESC');
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ message: 'Database error.', error: err.message });
  }
};

export const getTemplateById = (dbPool: Pool) => async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const [rows]: any = await dbPool.query('SELECT * FROM report_templates WHERE id = ?', [id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Template not found.' });
    res.json(rows[0]);
  } catch (err: any) {
    res.status(500).json({ message: 'Database error.', error: err.message });
  }
};

export const updateTemplate = (dbPool: Pool) => async (req: Request, res: Response) => {
  const { id } = req.params;
  const { name, layout } = req.body;
  try {
    await dbPool.execute(
      'UPDATE report_templates SET name = ?, layout = ? WHERE id = ?',
      [name, JSON.stringify(layout), id]
    );
    res.json({ message: 'Template updated.' });
  } catch (err: any) {
    res.status(500).json({ message: 'Database error.', error: err.message });
  }
};

export const deleteTemplate = (dbPool: Pool) => async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    await dbPool.execute('DELETE FROM report_templates WHERE id = ?', [id]);
    res.json({ message: 'Template deleted.' });
  } catch (err: any) {
    res.status(500).json({ message: 'Database error.', error: err.message });
  }
};