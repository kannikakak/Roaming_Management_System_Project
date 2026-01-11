import { Request, Response } from 'express';
import { dbPool } from '../db';

export const createAuditLog = async (req: Request, res: Response) => {
  const { user, action, details } = req.body;
  if (!user || !action || !details) {
    return res.status(400).json({ error: 'Missing required fields: user, action, details.' });
  }
  try {
    await dbPool.execute(
      'INSERT INTO audit_logs (user, action, details) VALUES (?, ?, ?)',
      [user, action, JSON.stringify(details)]
    );
    res.status(201).json({ success: true });
  } catch (err: any) {
    console.error('Audit log insert error:', err);
    res.status(500).json({ error: 'Failed to save audit log.' });
  }
};

export const getAuditLogs = async (_req: Request, res: Response) => {
  try {
    const [rows] = await dbPool.query('SELECT * FROM audit_logs ORDER BY timestamp DESC');
    res.json(rows);
  } catch (err: any) {
    console.error('Audit log fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch audit logs.' });
  }
};