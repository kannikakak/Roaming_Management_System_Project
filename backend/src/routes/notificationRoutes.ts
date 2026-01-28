import { Router } from "express";
import { Pool } from "mysql2/promise";
import { requireAuth } from "../middleware/auth";

export function notificationRoutes(dbPool: Pool) {
  const router = Router();
  router.use(requireAuth);

  router.get("/", async (_req, res) => {
    try {
      const [rows] = await dbPool.query(
        "SELECT * FROM notifications ORDER BY created_at DESC"
      );
      res.json(rows);
    } catch (err: any) {
      res.status(500).send(err.message || "Failed to list notifications");
    }
  });

  router.post("/:id/read", async (req, res) => {
    try {
      const id = Number(req.params.id);
      await dbPool.execute("UPDATE notifications SET read_at = NOW() WHERE id = ?", [id]);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).send(err.message || "Failed to mark read");
    }
  });

  router.post("/read-all", async (_req, res) => {
    try {
      const [result]: any = await dbPool.execute(
        "UPDATE notifications SET read_at = NOW() WHERE read_at IS NULL"
      );
      res.json({ ok: true, affectedRows: result?.affectedRows ?? 0 });
    } catch (err: any) {
      res.status(500).send(err.message || "Failed to mark all read");
    }
  });

  return router;
}
