import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import { Pool } from "mysql2/promise";
import { ingestFilesFromDisk } from "../controllers/fileController";
import { getNotificationSettings } from "./notificationSettings";

type IngestionSourceRow = {
  id: number;
  name: string;
  type: string;
  connectionConfig: any;
  filePattern: string | null;
  pollIntervalMinutes: number;
  enabled: number;
  projectId: number;
  lastScanAt: string | null;
};

const STAGING_DIR =
  process.env.INGEST_STAGING_DIR || path.join(process.cwd(), "uploads", "ingest-staging");
const STABLE_SECONDS = Number(process.env.INGEST_STABLE_SECONDS || 60);

const toRegex = (pattern: string) => {
  const escaped = pattern.replace(/[-/\\^$+?.()|[\]{}]/g, "\\$&");
  const regex = escaped.replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${regex}$`, "i");
};

const matchesPattern = (fileName: string, pattern: string | null) => {
  if (!pattern || pattern.trim() === "" || pattern.trim() === "*") return true;
  const parts = pattern.split(/[;,]/).map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return true;
  return parts.some((p) => toRegex(p).test(fileName));
};

const ensureStagingDir = async () => {
  await fs.mkdir(STAGING_DIR, { recursive: true });
};

const computeChecksum = async (filePath: string) => {
  const hash = crypto.createHash("sha256");
  const stream = (await import("fs")).createReadStream(filePath);
  return new Promise<string>((resolve, reject) => {
    stream.on("data", (data) => hash.update(data));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
};

const isStableFile = (stat: { mtimeMs: number }) => {
  if (!Number.isFinite(stat.mtimeMs)) return false;
  const ageMs = Date.now() - stat.mtimeMs;
  return ageMs >= STABLE_SECONDS * 1000;
};

const getEnabledSources = async (dbPool: Pool) => {
  const [rows]: any = await dbPool.query(
    `SELECT id, name, type, connection_config as connectionConfig, file_pattern as filePattern,
            poll_interval_minutes as pollIntervalMinutes, enabled, project_id as projectId,
            last_scan_at as lastScanAt
     FROM ingestion_sources
     WHERE enabled = 1`
  );
  return rows as IngestionSourceRow[];
};

const shouldScanSource = (source: IngestionSourceRow) => {
  if (!source.lastScanAt) return true;
  const last = new Date(source.lastScanAt).getTime();
  if (!Number.isFinite(last)) return true;
  const intervalMs = (source.pollIntervalMinutes || 5) * 60 * 1000;
  return Date.now() - last >= intervalMs;
};

const updateSourceScanStatus = async (dbPool: Pool, sourceId: number, error: string | null) => {
  await dbPool.query(
    "UPDATE ingestion_sources SET last_scan_at = NOW(), last_error = ? WHERE id = ?",
    [error, sourceId]
  );
};

const recordAudit = async (dbPool: Pool, action: string, details: Record<string, any>) => {
  await dbPool.query(
    "INSERT INTO audit_logs (user, action, details) VALUES (?, ?, ?)",
    ["system", action, JSON.stringify(details)]
  );
};

const notify = async (dbPool: Pool, type: string, message: string, metadata: Record<string, any>) => {
  const settings = await getNotificationSettings(dbPool);
  if (!settings.in_app_enabled) return;
  await dbPool.query(
    "INSERT INTO notifications (type, channel, message, metadata) VALUES (?, ?, ?, ?)",
    [type, "system", message, JSON.stringify(metadata)]
  );
};

const ensureFileRecord = async (
  dbPool: Pool,
  sourceId: number,
  remotePath: string,
  fileName: string,
  fileSize: number,
  lastModified: Date | null,
  checksum: string
) => {
  const [rows]: any = await dbPool.query(
    `SELECT id, status
     FROM ingestion_files
     WHERE source_id = ? AND remote_path = ? AND checksum_sha256 = ?
     LIMIT 1`,
    [sourceId, remotePath, checksum]
  );
  if (rows?.length) {
    return { id: rows[0].id as number, status: rows[0].status as string, created: false };
  }

  const [result]: any = await dbPool.query(
    `INSERT INTO ingestion_files
      (source_id, remote_path, file_name, file_size, last_modified, checksum_sha256, status)
     VALUES (?, ?, ?, ?, ?, ?, 'NEW')`,
    [sourceId, remotePath, fileName, fileSize, lastModified, checksum]
  );
  return { id: result.insertId as number, status: "NEW", created: true };
};

const enqueueJob = async (dbPool: Pool, sourceId: number, fileId: number) => {
  await dbPool.query(
    "INSERT INTO ingestion_jobs (source_id, file_id, attempt) VALUES (?, ?, 1)",
    [sourceId, fileId]
  );
  await dbPool.query("UPDATE ingestion_files SET status = 'QUEUED' WHERE id = ?", [fileId]);
};

const scanLocalSource = async (dbPool: Pool, source: IngestionSourceRow) => {
  const config =
    typeof source.connectionConfig === "string"
      ? JSON.parse(source.connectionConfig)
      : source.connectionConfig;
  const directory = config?.path as string | undefined;
  if (!directory) {
    await updateSourceScanStatus(dbPool, source.id, "Missing connection_config.path");
    return { discovered: 0, queued: 0, skipped: 0 };
  }

  try {
    const entries = await fs.readdir(directory);
    let discovered = 0;
    let queued = 0;
    let skipped = 0;

    for (const entry of entries) {
      if (!matchesPattern(entry, source.filePattern || "*")) {
        skipped += 1;
        continue;
      }
      const fullPath = path.join(directory, entry);
      const stat = await fs.stat(fullPath);
      if (!stat.isFile()) {
        skipped += 1;
        continue;
      }
      if (!isStableFile(stat)) {
        skipped += 1;
        continue;
      }

      const checksum = await computeChecksum(fullPath);
      const record = await ensureFileRecord(
        dbPool,
        source.id,
        fullPath,
        entry,
        stat.size,
        new Date(stat.mtimeMs),
        checksum
      );
      if (!record.created) {
        skipped += 1;
        continue;
      }
      discovered += 1;
      await enqueueJob(dbPool, source.id, record.id);
      queued += 1;
    }

    await updateSourceScanStatus(dbPool, source.id, null);
    return { discovered, queued, skipped };
  } catch (err: any) {
    await updateSourceScanStatus(dbPool, source.id, err?.message || String(err));
    return { discovered: 0, queued: 0, skipped: 0 };
  }
};

const processQueuedJobs = async (dbPool: Pool, limit = 3) => {
  const [rows]: any = await dbPool.query(
    `SELECT j.id as jobId, j.source_id as sourceId, j.file_id as fileId,
            f.remote_path as remotePath, f.file_name as fileName,
            s.project_id as projectId
     FROM ingestion_jobs j
     JOIN ingestion_files f ON f.id = j.file_id
     JOIN ingestion_sources s ON s.id = j.source_id
     WHERE j.result IS NULL AND j.started_at IS NULL
     ORDER BY j.id ASC
     LIMIT ?`,
    [limit]
  );

  await ensureStagingDir();

  for (const job of rows) {
    const claimed = await dbPool.query(
      "UPDATE ingestion_jobs SET started_at = NOW() WHERE id = ? AND started_at IS NULL",
      [job.jobId]
    );
    const affected = (claimed as any)?.[0]?.affectedRows ?? 0;
    if (!affected) continue;

    try {
      await dbPool.query("UPDATE ingestion_files SET status = 'PROCESSING' WHERE id = ?", [job.fileId]);
      const stagingPath = path.join(STAGING_DIR, `${job.fileId}-${job.fileName}`);
      await fs.copyFile(job.remotePath, stagingPath);
      await dbPool.query("UPDATE ingestion_files SET staging_path = ? WHERE id = ?", [
        stagingPath,
        job.fileId,
      ]);

      await ingestFilesFromDisk(dbPool, job.projectId, [
        { path: stagingPath, originalname: job.fileName },
      ]);

      await dbPool.query(
        "UPDATE ingestion_files SET status = 'SUCCESS', processed_at = NOW(), error_message = NULL WHERE id = ?",
        [job.fileId]
      );
      await dbPool.query(
        "UPDATE ingestion_jobs SET finished_at = NOW(), result = 'SUCCESS' WHERE id = ?",
        [job.jobId]
      );

      await notify(dbPool, "ingestion_success", `Ingested ${job.fileName}`, {
        sourceId: job.sourceId,
        fileId: job.fileId,
      });
      await recordAudit(dbPool, "ingestion_success", {
        sourceId: job.sourceId,
        fileId: job.fileId,
        fileName: job.fileName,
      });
    } catch (err: any) {
      const message = err?.message || String(err);
      await dbPool.query(
        "UPDATE ingestion_files SET status = 'FAILED', processed_at = NOW(), error_message = ? WHERE id = ?",
        [message, job.fileId]
      );
      await dbPool.query(
        "UPDATE ingestion_jobs SET finished_at = NOW(), result = 'FAILED' WHERE id = ?",
        [job.jobId]
      );
      await notify(dbPool, "ingestion_failed", `Failed to ingest ${job.fileName}`, {
        sourceId: job.sourceId,
        fileId: job.fileId,
        error: message,
      });
      await recordAudit(dbPool, "ingestion_failed", {
        sourceId: job.sourceId,
        fileId: job.fileId,
        fileName: job.fileName,
        error: message,
      });
    }
  }
};

export const runIngestionCycle = async (dbPool: Pool) => {
  const sources = await getEnabledSources(dbPool);
  for (const source of sources) {
    if (!shouldScanSource(source)) continue;
    if (source.type === "local") {
      await scanLocalSource(dbPool, source);
    } else {
      await updateSourceScanStatus(dbPool, source.id, "Unsupported source type");
    }
  }
  await processQueuedJobs(dbPool);
};

export const runIngestionScanOnce = async (dbPool: Pool, sourceId: number) => {
  const [[source]]: any = await dbPool.query(
    `SELECT id, name, type, connection_config as connectionConfig, file_pattern as filePattern,
            poll_interval_minutes as pollIntervalMinutes, enabled, project_id as projectId,
            last_scan_at as lastScanAt
     FROM ingestion_sources WHERE id = ?`,
    [sourceId]
  );
  if (!source) {
    throw new Error("Source not found");
  }
  if (source.type !== "local") {
    throw new Error("Only local sources are supported right now.");
  }
  return scanLocalSource(dbPool, source as IngestionSourceRow);
};
