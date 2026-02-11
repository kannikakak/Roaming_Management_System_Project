import { Request } from "express";
import { Pool } from "mysql2/promise";

type AuditLogInput = {
  action: string;
  details?: unknown;
  req?: Request;
  actor?: string;
};

const normalizeActor = (input?: string) => {
  const trimmed = String(input || "").trim();
  return trimmed || "system";
};

export const getAuditActor = (req?: Request, fallback?: string) => {
  if (req?.user?.email) return normalizeActor(req.user.email);
  if (req?.user?.id) return `user:${req.user.id}`;
  return normalizeActor(fallback);
};

export async function writeAuditLog(dbPool: Pool, input: AuditLogInput) {
  const action = String(input.action || "").trim();
  if (!action) return;

  const actor = getAuditActor(input.req, input.actor);
  const payload =
    input.details === undefined || input.details === null
      ? null
      : JSON.stringify(input.details);

  try {
    await dbPool.execute(
      "INSERT INTO audit_logs (user, action, details) VALUES (?, ?, ?)",
      [actor, action, payload]
    );
  } catch (err: any) {
    console.error(
      `Failed to write audit log [${action}] for ${actor}:`,
      err?.message || err
    );
  }
}
