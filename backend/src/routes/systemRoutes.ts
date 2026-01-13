import { Router } from "express";
import { Pool } from "mysql2/promise";
import { requireAuth, requireRole } from "../middleware/auth";

export function systemRoutes(dbPool: Pool) {
  const router = Router();
  router.use(requireAuth, requireRole(["admin"]));

  router.get("/health", async (_req, res) => {
    try {
      await dbPool.query("SELECT 1");
      const [scheduleRows]: any = await dbPool.query(
        "SELECT COUNT(*) as total, SUM(is_active) as active, MAX(last_run_at) as lastRun FROM report_schedules"
      );
      res.json({
        ok: true,
        db: "connected",
        schedules: scheduleRows[0] || { total: 0, active: 0, lastRun: null },
      });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message || "Health check failed" });
    }
  });

  return router;
}
