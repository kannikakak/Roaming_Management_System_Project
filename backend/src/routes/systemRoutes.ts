import { Router } from "express";
import { Pool } from "mysql2/promise";
import fs from "fs/promises";
import path from "path";
import { requireAuth, requireRole } from "../middleware/auth";
import { RetentionConfig, loadRetentionConfig, runDataRetention, saveRetentionConfig } from "../services/dataRetention";
import { getSecurityComplianceSnapshot } from "../utils/securityCompliance";
import {
  createBackup,
  getBackupConfig,
  listBackups,
  listDeletedSourceBackups,
  restoreBackup,
  restoreDeletedSourceFileBackup,
} from "../services/backupRecovery";
import { writeAuditLog } from "../utils/auditLogger";

const getDirectorySizeBytes = async (targetPath: string): Promise<number> => {
  try {
    const stats = await fs.stat(targetPath);
    if (!stats.isDirectory()) return stats.size;
  } catch {
    return 0;
  }

  let total = 0;
  const entries = await fs.readdir(targetPath, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(targetPath, entry.name);
    if (entry.isDirectory()) {
      total += await getDirectorySizeBytes(entryPath);
      continue;
    }
    if (entry.isFile()) {
      try {
        const fileStats = await fs.stat(entryPath);
        total += fileStats.size;
      } catch {
        // ignore inaccessible files
      }
    }
  }
  return total;
};

export function systemRoutes(dbPool: Pool) {
  const router = Router();
  router.use(requireAuth, requireRole(["admin"]));

  router.get("/health", async (_req, res) => {
    try {
      await dbPool.query("SELECT 1");
      const [scheduleRows]: any = await dbPool.query(
        "SELECT COUNT(*) as total, SUM(is_active) as active, MAX(last_run_at) as lastRun FROM report_schedules"
      );
      const [[activeUsersRow]]: any = await dbPool.query(
        "SELECT COUNT(DISTINCT user_id) as total FROM refresh_tokens WHERE revoked_at IS NULL AND expires_at > NOW()"
      );
      const [[filesProcessedTodayRow]]: any = await dbPool.query(
        "SELECT COUNT(*) as total FROM files WHERE uploaded_at >= CURDATE()"
      );
      const [[avgProcessingRow]]: any = await dbPool.query(
        `SELECT AVG(TIMESTAMPDIFF(MICROSECOND, started_at, finished_at)) / 1000 as avgProcessingMs
         FROM ingestion_jobs
         WHERE started_at >= CURDATE()
           AND started_at IS NOT NULL
           AND finished_at IS NOT NULL`
      );
      const [[failedIngestionJobsRow]]: any = await dbPool.query(
        `SELECT COUNT(*) as total
         FROM ingestion_jobs
         WHERE COALESCE(finished_at, started_at) >= CURDATE()
           AND UPPER(COALESCE(result, '')) IN ('FAILED', 'FAIL', 'ERROR')`
      );
      const [[failedScheduleJobsRow]]: any = await dbPool.query(
        `SELECT COUNT(*) as total
         FROM audit_logs
         WHERE timestamp >= CURDATE()
           AND action = 'schedule_run_failed'`
      );
      const [[dbStorageRow]]: any = await dbPool.query(
        `SELECT COALESCE(SUM(data_length + index_length), 0) as totalBytes
         FROM information_schema.tables
         WHERE table_schema = DATABASE()`
      );

      const uploadsPath = path.join(process.cwd(), "uploads");
      const uploadsBytes = await getDirectorySizeBytes(uploadsPath);
      const dbBytes = Number(dbStorageRow?.totalBytes || 0);
      const failedJobs =
        Number(failedIngestionJobsRow?.total || 0) + Number(failedScheduleJobsRow?.total || 0);

      res.json({
        ok: true,
        db: "connected",
        schedules: scheduleRows[0] || { total: 0, active: 0, lastRun: null },
        metrics: {
          activeUsers: Number(activeUsersRow?.total || 0),
          filesProcessedToday: Number(filesProcessedTodayRow?.total || 0),
          avgProcessingTimeMs: Math.round(Number(avgProcessingRow?.avgProcessingMs || 0)),
          failedJobs,
          storageUsageBytes: dbBytes + uploadsBytes,
          storageBreakdown: {
            databaseBytes: dbBytes,
            uploadsBytes,
          },
        },
      });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message || "Health check failed" });
    }
  });

  router.get("/security-check", async (_req, res) => {
    try {
      const retention = await loadRetentionConfig(dbPool);
      const snapshot = getSecurityComplianceSnapshot();

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
          snapshot.nodeEnv !== "production",
      };

      res.json({
        ok: true,
        summary: {
          encryptionRequired: snapshot.encryption.required,
          hasEncryptionKey: snapshot.encryption.hasKey,
          strongEncryptionKey: snapshot.encryption.strongKey,
          aes256Mode: snapshot.encryption.aes256Mode,
          httpsEnforced: snapshot.https.enforced,
          dbTlsEnabled: snapshot.dbTls.enabled,
          retentionEnabled: retention.enabled,
        },
        checks: snapshot.checks,
        encryption: {
          required: snapshot.encryption.required,
          hasKey: snapshot.encryption.hasKey,
          strongKey: snapshot.encryption.strongKey,
          keyLength: snapshot.encryption.keyLength,
          blockMode: snapshot.encryption.blockMode,
          aes256Mode: snapshot.encryption.aes256Mode,
        },
        https: snapshot.https,
        dbTls: snapshot.dbTls,
        secrets: snapshot.secrets,
        rateLimit: {
          auth: {
            windowMs: snapshot.rateLimit.authWindowMs,
            max: snapshot.rateLimit.authMax,
          },
          upload: {
            windowMs: snapshot.rateLimit.uploadWindowMs,
            max: snapshot.rateLimit.uploadMax,
          },
          ingestion: {
            windowMs: Number(process.env.INGESTION_RATE_LIMIT_WINDOW_MS || 10 * 60 * 1000),
            max: Number(process.env.INGESTION_RATE_LIMIT_MAX || 20),
          },
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

  router.post("/retention/run", async (req, res) => {
    try {
      const dryRunRaw = req.query.dryRun ?? req.body?.dryRun;
      const dryRun = String(dryRunRaw || "").toLowerCase() === "true";
      const summary = await runDataRetention(dbPool, { dryRun });
      res.json({ ok: true, summary });
    } catch (err: any) {
      res.status(500).json({ ok: false, message: err.message || "Failed to run retention policy" });
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

  router.get("/backups/config", async (_req, res) => {
    try {
      res.json({ ok: true, config: getBackupConfig() });
    } catch (err: any) {
      res.status(500).json({ ok: false, message: err.message || "Failed to load backup config" });
    }
  });

  router.get("/backups", async (req, res) => {
    try {
      const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 50));
      const items = await listBackups(dbPool, limit);
      res.json({ ok: true, items });
    } catch (err: any) {
      res.status(500).json({ ok: false, message: err.message || "Failed to load backup history" });
    }
  });

  router.get("/backups/deleted-files", async (req, res) => {
    try {
      const limit = Math.max(1, Math.min(300, Number(req.query.limit) || 100));
      const items = await listDeletedSourceBackups(dbPool, limit);
      res.json({ ok: true, items });
    } catch (err: any) {
      res.status(500).json({ ok: false, message: err.message || "Failed to load deleted source backups" });
    }
  });

  router.post("/backups/manual", async (req, res) => {
    try {
      const createdBy = req.user?.email || `user:${req.user?.id || "unknown"}`;
      const result = await createBackup(dbPool, {
        triggerType: "manual",
        createdBy,
        notes: "Manual backup from admin panel",
      });
      await writeAuditLog(dbPool, {
        req,
        action: "backup_created_manual",
        details: result,
      });
      res.json({ ok: true, backup: result });
    } catch (err: any) {
      res.status(500).json({ ok: false, message: err.message || "Failed to create backup" });
    }
  });

  router.post("/backups/restore/:id", async (req, res) => {
    try {
      const backupId = Number(req.params.id);
      if (!Number.isFinite(backupId)) {
        return res.status(400).json({ ok: false, message: "Invalid backup id" });
      }
      const restoredBy = req.user?.email || `user:${req.user?.id || "unknown"}`;
      const result = await restoreBackup(dbPool, backupId, restoredBy);
      await writeAuditLog(dbPool, {
        req,
        action: "backup_restored",
        details: result,
      });
      return res.json({ ok: true, result });
    } catch (err: any) {
      return res.status(500).json({ ok: false, message: err.message || "Failed to restore backup" });
    }
  });

  router.post("/backups/deleted-files/:id/restore", async (req, res) => {
    try {
      const backupId = Number(req.params.id);
      if (!Number.isFinite(backupId)) {
        return res.status(400).json({ ok: false, message: "Invalid backup id" });
      }
      const restoredBy = req.user?.email || `user:${req.user?.id || "unknown"}`;
      const result = await restoreDeletedSourceFileBackup(dbPool, backupId, restoredBy);
      await writeAuditLog(dbPool, {
        req,
        action: "deleted_source_file_restored",
        details: result,
      });
      return res.json({ ok: true, result });
    } catch (err: any) {
      return res.status(500).json({ ok: false, message: err.message || "Failed to restore deleted source file" });
    }
  });

  return router;
}
