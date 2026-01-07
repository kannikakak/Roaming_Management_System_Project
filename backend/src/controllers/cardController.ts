import { Request, Response } from 'express';
import { Pool } from 'mysql2/promise';

// Get card by ID
export const getCardById = (dbPool: Pool) => async (req: Request, res: Response) => {
  const { cardId } = req.params;
  try {
    const [rows] = await dbPool.query('SELECT * FROM cards WHERE id = ?', [cardId]);
    if (!Array.isArray(rows) || rows.length === 0) return res.status(404).json({ message: 'Card not found' });
    res.json(rows[0]);
  } catch {
    res.status(500).json({ message: 'Database error.' });
  }
};