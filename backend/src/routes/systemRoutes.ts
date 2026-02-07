import { Router } from "express";
import { Pool } from "mysql2/promise";
import { requireAuth, requireRole } from "../middleware/auth";
import { RetentionConfig, loadRetentionConfig, saveRetentionConfig } from "../services/dataRetention";

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

  router.get("/security-check", async (_req, res) => {
    try {
      const retention = await loadRetentionConfig(dbPool);
      const hasEncryptionKey = Boolean(
        (process.env.DATA_ENCRYPTION_KEY || process.env.ENCRYPTION_KEY || "").trim()
      );
      const nodeEnv = String(process.env.NODE_ENV || "").toLowerCase();
      const encryptionRequired =
        String(process.env.DATA_ENCRYPTION_REQUIRED || "").toLowerCase() === "true" ||
        nodeEnv === "production";
      const httpsEnforced = String(process.env.FORCE_HTTPS || "").toLowerCase() === "true";

      const authRateLimit = {
        windowMs: Number(process.env.AUTH_RATE_LIMIT_WINDOW_MS || 10 * 60 * 1000),
        max: Number(process.env.AUTH_RATE_LIMIT_MAX || 20),
      };
      const uploadRateLimit = {
        windowMs: Number(process.env.FILE_UPLOAD_RATE_LIMIT_WINDOW_MS || 10 * 60 * 1000),
        max: Number(process.env.FILE_UPLOAD_RATE_LIMIT_MAX || 30),
      };

      const uploadLimits = {
        maxFileSizeMb: Number(process.env.UPLOAD_MAX_FILE_SIZE_MB || 25),
        maxFiles: Number(process.env.UPLOAD_MAX_FILES || 10),
        maxRows: Number(process.env.UPLOAD_MAX_ROWS || 200000),
        maxColumns: Number(process.env.UPLOAD_MAX_COLUMNS || 200),
        rowBatchSize: Number(process.env.UPLOAD_ROW_BATCH_SIZE || 400),
      };

      const malwareScan = {
        enabled: String(process.env.MALWARE_SCAN_ENABLED || "true").toLowerCase() !== "false",
        command: process.env.MALWARE_SCAN_CMD || "clamscan",
        allowMissing:
          String(process.env.MALWARE_SCAN_ALLOW_MISSING || "").toLowerCase() === "true" ||
          nodeEnv !== "production",
      };

      res.json({
        ok: true,
        summary: {
          encryptionRequired,
          hasEncryptionKey,
          httpsEnforced,
          retentionEnabled: retention.enabled,
        },
        encryption: {
          required: encryptionRequired,
          hasKey: hasEncryptionKey,
        },
        https: {
          enforced: httpsEnforced,
        },
        rateLimit: {
          auth: authRateLimit,
          upload: uploadRateLimit,
        },
        upload: {
          limits: uploadLimits,
          malwareScan,
        },
        retention,
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      res.status(500).json({ ok: false, message: err.message || "Failed to load security check" });
    }
  });

  router.get("/retention", async (_req, res) => {
    try {
      const config = await loadRetentionConfig(dbPool);
      res.json({ ok: true, config });
    } catch (err: any) {
      res.status(500).json({ ok: false, message: err.message || "Failed to load retention settings" });
    }
  });

  router.put("/retention", async (req, res) => {
    try {
      const payload = req.body || {};
      const mode: RetentionConfig["mode"] = payload.mode === "archive" ? "archive" : "delete";
      const next: RetentionConfig = {
        enabled: Boolean(payload.enabled),
        days: Math.max(0, Number(payload.days) || 0),
        mode,
        deleteFiles: Boolean(payload.deleteFiles),
        intervalHours: Math.max(1, Number(payload.intervalHours) || 24),
      };
      await saveRetentionConfig(dbPool, next);
      res.json({ ok: true, config: next });
    } catch (err: any) {
      res.status(500).json({ ok: false, message: err.message || "Failed to save retention settings" });
    }
  });

  return router;
}
