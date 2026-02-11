import { Router } from "express";
import { Pool } from "mysql2/promise";
import { requireAuth, requireRole } from "../middleware/auth";
import {
  getAlertSummary,
  listAlerts,
  reopenAlert,
  resolveAlert,
  runAlertDetections,
} from "../services/alerts";
import { writeAuditLog } from "../utils/auditLogger";

const toPositiveInt = (value: unknown, fallback: number) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.floor(parsed));
};

const toOptionalNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const toTrimmed = (value: unknown) => {
  const next = String(value || "").trim();
  return next || undefined;
};

export function alertRoutes(dbPool: Pool) {
  const router = Router();
  router.use(requireAuth);

  router.get("/", async (req, res) => {
    try {
      const status = toTrimmed(req.query.status);
      const severity = toTrimmed(req.query.severity);
      const partner = toTrimmed(req.query.partner);
      const alertType = toTrimmed(req.query.alertType);
      const q = toTrimmed(req.query.q);
      const projectId = toOptionalNumber(req.query.projectId);
      const limit = toPositiveInt(req.query.limit, 100);
      const offset = Math.max(0, Number(req.query.offset) || 0);

      const result = await listAlerts(dbPool, {
        status,
        severity,
        partner,
        alertType,
        q,
        projectId,
        limit,
        offset,
      });

      res.json({
        items: result.items,
        total: result.total,
        limit,
        offset,
      });
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed to list alerts" });
    }
  });

  router.get("/summary", async (_req, res) => {
    try {
      const summary = await getAlertSummary(dbPool);

      const [projects]: any = await dbPool.query(
        `SELECT DISTINCT project_id as id, project_name as name
         FROM alerts
         WHERE project_id IS NOT NULL
         ORDER BY project_name ASC`
      );
      const [partners]: any = await dbPool.query(
        `SELECT DISTINCT partner
         FROM alerts
         WHERE partner IS NOT NULL AND partner <> ''
         ORDER BY partner ASC`
      );
      const [types]: any = await dbPool.query(
        `SELECT DISTINCT alert_type as alertType
         FROM alerts
         ORDER BY alert_type ASC`
      );

      res.json({
        summary,
        filters: {
          projects: Array.isArray(projects) ? projects : [],
          partners: Array.isArray(partners) ? partners.map((row: any) => row.partner) : [],
          alertTypes: Array.isArray(types) ? types.map((row: any) => row.alertType) : [],
        },
      });
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed to load alert summary" });
    }
  });

  router.post("/detect", requireRole(["admin", "analyst"]), async (req, res) => {
    try {
      const result = await runAlertDetections(dbPool);
      await writeAuditLog(dbPool, {
        req,
        action: "alert_detection_run",
        details: result,
      });
      res.json({ ok: true, result });
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed to run alert detections" });
    }
  });

  router.post("/:id/resolve", requireRole(["admin", "analyst"]), async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) {
        return res.status(400).json({ message: "Invalid alert id" });
      }
      await resolveAlert(dbPool, id, req.user?.email || "system");
      await writeAuditLog(dbPool, {
        req,
        action: "alert_resolved",
        details: { alertId: id },
      });
      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ message: err?.message || "Failed to resolve alert" });
    }
  });

  router.post("/:id/reopen", requireRole(["admin", "analyst"]), async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) {
        return res.status(400).json({ message: "Invalid alert id" });
      }
      await reopenAlert(dbPool, id);
      await writeAuditLog(dbPool, {
        req,
        action: "alert_reopened",
        details: { alertId: id },
      });
      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ message: err?.message || "Failed to reopen alert" });
    }
  });

  return router;
}
