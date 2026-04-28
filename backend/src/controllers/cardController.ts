import { Request, Response } from 'express';
import { Pool } from 'mysql2/promise';

export const getCardById = (dbPool: Pool) => async (req: Request, res: Response) => {
  const { cardId } = req.params;
  try {
    const [rows] = await dbPool.query('SELECT * FROM cards WHERE id = ?', [cardId]);
    if (!Array.isArray(rows) || rows.length === 0)
      return res.status(404).json({ message: 'Card not found' });
    res.json(rows[0]);
  } catch {
    res.status(500).json({ message: 'Database error.' });
  }
};

export const getCardsByProject = (dbPool: Pool) => async (req: Request, res: Response) => {
  const { projectId } = req.params;
  try {
    const [rows] = await dbPool.query(
      'SELECT * FROM cards WHERE project_id = ? ORDER BY created_at DESC',
      [projectId]
    );
    res.json(rows);
  } catch {
    res.status(500).json({ message: 'Database error.' });
  }
};

export const createCard = (dbPool: Pool) => async (req: Request, res: Response) => {
  const { projectId, title } = req.body;
  if (!projectId || !title?.trim())
    return res.status(400).json({ message: 'projectId and title are required.' });
  try {
    const [result]: any = await dbPool.query(
      'INSERT INTO cards (project_id, title) VALUES (?, ?)',
      [projectId, title.trim()]
    );
    const [rows] = await dbPool.query('SELECT * FROM cards WHERE id = ?', [result.insertId]);
    res.status(201).json((rows as any[])[0]);
  } catch {
    res.status(500).json({ message: 'Database error.' });
  }
};

export const updateCard = (dbPool: Pool) => async (req: Request, res: Response) => {
  const { cardId } = req.params;
  const { title } = req.body;
  if (!title?.trim())
    return res.status(400).json({ message: 'title is required.' });
  try {
    const [result]: any = await dbPool.query(
      'UPDATE cards SET title = ? WHERE id = ?',
      [title.trim(), cardId]
    );
    if (result.affectedRows === 0)
      return res.status(404).json({ message: 'Card not found.' });
    const [rows] = await dbPool.query('SELECT * FROM cards WHERE id = ?', [cardId]);
    res.json((rows as any[])[0]);
  } catch {
    res.status(500).json({ message: 'Database error.' });
  }
};

export const deleteCard = (dbPool: Pool) => async (req: Request, res: Response) => {
  const { cardId } = req.params;
  try {
    const [result]: any = await dbPool.query('DELETE FROM cards WHERE id = ?', [cardId]);
    if (result.affectedRows === 0)
      return res.status(404).json({ message: 'Card not found.' });
    res.json({ message: 'Card deleted.' });
  } catch {
    res.status(500).json({ message: 'Database error.' });
  }
};
