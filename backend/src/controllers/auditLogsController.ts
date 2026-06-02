import { Request, Response } from 'express';
import { dbPool } from '../db';

const buildActorDisplayExpression = async () => {
  const [columns]: any = await dbPool.query("SHOW COLUMNS FROM users");
  const names = new Set(columns.map((column: any) => String(column.Field)));
  const fullNameExpr = names.has("full_name") ? "NULLIF(TRIM(u.full_name), '')" : null;
  const nameExpr = names.has("name") ? "NULLIF(TRIM(u.name), '')" : null;
  const options = [fullNameExpr, nameExpr, "NULLIF(TRIM(u.email), '')", "l.user"].filter(Boolean);
  return `COALESCE(${options.join(", ")}) AS actorDisplay`;
};

const listAuditLogsQuery = async () => {
  const actorDisplay = await buildActorDisplayExpression();
  return `
    SELECT l.id, l.timestamp, l.user, l.action, l.details, ${actorDisplay}
    FROM audit_logs l
    LEFT JOIN users u ON LOWER(TRIM(u.email)) = LOWER(TRIM(l.user))
    ORDER BY l.timestamp DESC
    LIMIT 500
  `;
};

const myAuditLogsQuery = async () => {
  const actorDisplay = await buildActorDisplayExpression();
  return `
    SELECT l.id, l.timestamp, l.user, l.action, l.details, ${actorDisplay}
    FROM audit_logs l
    LEFT JOIN users u ON LOWER(TRIM(u.email)) = LOWER(TRIM(l.user))
    WHERE LOWER(TRIM(l.user)) = LOWER(TRIM(?))
    ORDER BY l.timestamp DESC
  `;
};

export const createAuditLog = async (req: Request, res: Response) => {
  const { user, action, details } = req.body;
  const actor = user || req.user?.email || "unknown";
  if (!action) {
    return res.status(400).json({ error: 'Missing required field: action.' });
  }
  try {
    await dbPool.execute(
      'INSERT INTO audit_logs (user, action, details) VALUES (?, ?, ?)',
      [actor, action, JSON.stringify(details ?? null)]
    );
    res.status(201).json({ success: true });
  } catch (err: any) {
    console.error('Audit log insert error:', err);
    res.status(500).json({ error: 'Failed to save audit log.' });
  }
};

export const getAuditLogs = async (_req: Request, res: Response) => {
  try {
    const [rows] = await dbPool.query(await listAuditLogsQuery());
    res.json(rows);
  } catch (err: any) {
    console.error('Audit log fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch audit logs.' });
  }
};

export const getMyAuditLogs = async (req: Request, res: Response) => {
  try {
    const actor = req.user?.email;
    if (!actor) return res.status(401).json({ error: "Unauthorized" });
    const [rows] = await dbPool.query(await myAuditLogsQuery(), [actor]);
    res.json(rows);
  } catch (err: any) {
    console.error("Audit log fetch error:", err);
    res.status(500).json({ error: "Failed to fetch audit logs." });
  }
};
