import { Router } from "express";
import { Pool } from "mysql2/promise";
import { requireAuth, requireRole } from "../middleware/auth";

type SessionPayload = {
  type: string;
  state?: any;
};

export function collabRoutes(dbPool: Pool) {
  const router = Router();
  router.use(requireAuth);

  router.post("/", requireRole(["admin", "analyst"]), async (req, res) => {
    try {
      const payload = req.body as SessionPayload;
      if (!payload?.type || typeof payload.type !== "string") {
        return res.status(400).send("type is required");
      }
      const stateJson = JSON.stringify(payload.state ?? {});
      const [result] = await dbPool.query<any>(
        "INSERT INTO collaboration_sessions (type, state, created_by) VALUES (?, ?, ?)",
        [payload.type, stateJson, req.user?.id ?? null]
      );
      res.json({ id: result.insertId });
    } catch (err: any) {
      res.status(500).send(err.message || "Failed to create session");
    }
  });

  router.get("/:id", async (req, res) => {
    try {
      const sessionId = Number(req.params.id);
      const [rows] = await dbPool.query<any[]>(
        "SELECT id, type, state, created_at, updated_at FROM collaboration_sessions WHERE id = ?",
        [sessionId]
      );
      if (!rows.length) return res.status(404).send("Session not found");
      const row = rows[0];
      let parsedState = {};
      try {
        parsedState = row.state ? JSON.parse(row.state) : {};
      } catch {
        parsedState = {};
      }
      res.json({
        id: row.id,
        type: row.type,
        state: parsedState,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      });
    } catch (err: any) {
      res.status(500).send(err.message || "Failed to load session");
    }
  });

  router.put("/:id", requireRole(["admin", "analyst"]), async (req, res) => {
    try {
      const sessionId = Number(req.params.id);
      const payload = req.body as SessionPayload;
      if (!payload?.state) {
        return res.status(400).send("state is required");
      }
      const stateJson = JSON.stringify(payload.state ?? {});
      await dbPool.execute(
        "UPDATE collaboration_sessions SET state = ?, updated_at = NOW() WHERE id = ?",
        [stateJson, sessionId]
      );
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).send(err.message || "Failed to update session");
    }
  });

  router.delete("/:id", requireRole(["admin", "analyst"]), async (req, res) => {
    try {
      const sessionId = Number(req.params.id);
      await dbPool.execute("DELETE FROM collaboration_sessions WHERE id = ?", [sessionId]);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).send(err.message || "Failed to delete session");
    }
  });

  return router;
}
