import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import { Pool } from "mysql2/promise";
import { ingestFilesFromDisk } from "../controllers/fileController";
import { getNotificationSettings } from "./notificationSettings";
import { upsertAlert } from "./alerts";
import {
  downloadGoogleDriveFile,
  GoogleDriveFile,
  listGoogleDriveFiles,
  normalizeGoogleDriveSourceConfig,
} from "./googleDrive";

type IngestionSourceRow = {
  id: number;
  name: string;
  type: string;
  connectionConfig: any;
  filePattern: string | null;
  templateRule: string | null;
  pollIntervalMinutes: number;
  enabled: number;
  projectId: number;
  lastScanAt: string | null;
};

const STAGING_DIR =
  process.env.INGEST_STAGING_DIR || path.join(process.cwd(), "uploads", "ingest-staging");
const STABLE_SECONDS = Number(process.env.INGEST_STABLE_SECONDS || 60);
const DEFAULT_MAX_DEPTH = Number(process.env.INGEST_MAX_DEPTH || 6);
const DEFAULT_MAX_FILES = Number(process.env.INGEST_MAX_FILES || 5000);
const DEFAULT_ALLOWED_EXTENSIONS = [".csv", ".xlsx", ".xls"];

const toPositiveInt = (value: any, fallback: number) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
};

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

const parseConnectionConfig = (raw: any) => {
  if (!raw) return {};
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return { path: raw };
    }
  }
  return raw;
};

const normalizeList = (value: any) => {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(/[\r\n;,]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
};

export const normalizeLocalSourceConfig = (rawConfig: any) => {
  const config = parseConnectionConfig(rawConfig);
  const single = typeof config?.path === "string" ? normalizeList(config.path) : [];
  const many = normalizeList(config?.paths);
  const directories = Array.from(new Set([...single, ...many].map((p) => p.trim()).filter(Boolean)));

  const recursive = config?.recursive !== false;
  const maxDepth = toPositiveInt(config?.maxDepth, DEFAULT_MAX_DEPTH);
  const maxFiles = toPositiveInt(config?.maxFiles, DEFAULT_MAX_FILES);
  const extensionCandidates = normalizeList(config?.extensions ?? config?.allowedExtensions);
  const allowedExtensions = (
    extensionCandidates.length ? extensionCandidates : DEFAULT_ALLOWED_EXTENSIONS
  ).map((ext) => {
    const cleaned = String(ext || "").trim().toLowerCase();
    if (!cleaned) return "";
    return cleaned.startsWith(".") ? cleaned : `.${cleaned}`;
  }).filter(Boolean);

  return {
    directories,
    recursive,
    maxDepth,
    maxFiles,
    allowedExtensions,
  };
};

const normalizeGoogleRemotePath = (fileId: string) => `google-drive:${String(fileId || "").trim()}`;

const sanitizeForStaging = (fileName: string) =>
  String(fileName || "file")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120) || "file";

const computeDriveChecksum = (file: GoogleDriveFile) => {
  if (file.md5Checksum) return String(file.md5Checksum).toLowerCase();
  return crypto
    .createHash("sha256")
    .update(`${file.id}|${file.modifiedTime || ""}|${file.size || 0}`)
    .digest("hex");
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

const isAllowedExtension = (fileName: string, allowedExtensions: string[]) => {
  const ext = path.extname(fileName || "").toLowerCase();
  if (!ext) return false;
  if (!allowedExtensions.length) return true;
  return allowedExtensions.includes(ext);
};

const collectFiles = async (
  rootDir: string,
  recursive: boolean,
  maxDepth: number,
  maxFiles: number
) => {
  const files: string[] = [];
  const queue: Array<{ dir: string; depth: number }> = [{ dir: rootDir, depth: 0 }];

  while (queue.length > 0 && files.length < maxFiles) {
    const current = queue.shift()!;
    const entries = await fs.readdir(current.dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(current.dir, entry.name);
      if (entry.isFile()) {
        files.push(fullPath);
        if (files.length >= maxFiles) break;
        continue;
      }

      if (entry.isDirectory() && recursive && current.depth < maxDepth) {
        queue.push({ dir: fullPath, depth: current.depth + 1 });
      }
    }
  }

  return files;
};

const getEnabledSources = async (dbPool: Pool) => {
  const [rows]: any = await dbPool.query(
    `SELECT id, name, type, connection_config as connectionConfig, file_pattern as filePattern,
            template_rule as templateRule,
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
  const [latestRows]: any = await dbPool.query(
    `SELECT id, status, checksum_sha256 as checksum
     FROM ingestion_files
     WHERE source_id = ? AND remote_path = ?
     ORDER BY id DESC
     LIMIT 1`,
    [sourceId, remotePath]
  );

  const latest = latestRows?.[0];
  if (latest && String(latest.checksum || "") === checksum) {
    return {
      id: latest.id as number,
      status: latest.status as string,
      created: false,
      updated: false,
    };
  }

  const [result]: any = await dbPool.query(
    `INSERT INTO ingestion_files
      (source_id, remote_path, file_name, file_size, last_modified, checksum_sha256, status)
     VALUES (?, ?, ?, ?, ?, ?, 'NEW')`,
    [sourceId, remotePath, fileName, fileSize, lastModified, checksum]
  );
  return {
    id: result.insertId as number,
    status: "NEW",
    created: true,
    updated: Boolean(latest),
    checksum,
  };
};

const enqueueJob = async (
  dbPool: Pool,
  sourceId: number,
  fileId: number,
  fileName: string,
  fileHash: string
) => {
  await dbPool.query(
    "INSERT INTO ingestion_jobs (source_id, file_id, file_name, file_hash, status, attempt) VALUES (?, ?, ?, ?, 'PENDING', 1)",
    [sourceId, fileId, fileName, fileHash]
  );
  await dbPool.query("UPDATE ingestion_files SET status = 'QUEUED' WHERE id = ?", [fileId]);
};

const deleteImportedFilesForRemotePath = async (
  dbPool: Pool,
  sourceId: number,
  remotePath: string
) => {
  const [rows]: any = await dbPool.query(
    `SELECT DISTINCT j.imported_file_id as importedFileId
     FROM ingestion_jobs j
     INNER JOIN ingestion_files f ON f.id = j.file_id
     WHERE j.source_id = ? AND f.remote_path = ? AND j.imported_file_id IS NOT NULL`,
    [sourceId, remotePath]
  );
  const importedIds = (Array.isArray(rows) ? rows : [])
    .map((row: any) => Number(row.importedFileId || 0))
    .filter((id: number) => Number.isFinite(id) && id > 0);
  const uniqueIds = Array.from(new Set(importedIds));
  if (!uniqueIds.length) return 0;

  const chunkSize = 100;
  for (let index = 0; index < uniqueIds.length; index += chunkSize) {
    const chunk = uniqueIds.slice(index, index + chunkSize);
    const placeholders = chunk.map(() => "?").join(", ");
    await dbPool.query(`DELETE FROM files WHERE id IN (${placeholders})`, chunk);
  }

  return uniqueIds.length;
};

const markRemoteFileDeleted = async (
  dbPool: Pool,
  source: IngestionSourceRow,
  remotePath: string,
  fileName: string
) => {
  const [latestRows]: any = await dbPool.query(
    `SELECT id, status
     FROM ingestion_files
     WHERE source_id = ? AND remote_path = ?
     ORDER BY id DESC
     LIMIT 1`,
    [source.id, remotePath]
  );
  const latest = latestRows?.[0];
  if (!latest?.id) return false;
  if (String(latest.status || "").toUpperCase() === "DELETED") return false;

  await dbPool.query(
    `UPDATE ingestion_files
     SET status = 'DELETED', processed_at = NOW(), error_message = ?, rows_imported = 0
     WHERE source_id = ? AND remote_path = ?`,
    [`Deleted from source drive: ${fileName}`, source.id, remotePath]
  );

  const deletedImportedCount = await deleteImportedFilesForRemotePath(dbPool, source.id, remotePath);
  await dbPool.query(
    `INSERT INTO ingestion_jobs
      (source_id, file_id, file_name, file_hash, status, rows_imported, error_message, attempt, started_at, finished_at, result)
     VALUES (?, ?, ?, NULL, 'DELETED', 0, ?, 1, NOW(), NOW(), 'DELETED')`,
    [source.id, latest.id, fileName, `Deleted from source drive: ${remotePath}`]
  );

  await recordAudit(dbPool, "ingestion_remote_deleted", {
    sourceId: source.id,
    sourceName: source.name,
    remotePath,
    fileName,
    deletedImportedCount,
  });

  return true;
};

const scanLocalSource = async (dbPool: Pool, source: IngestionSourceRow) => {
  const config = normalizeLocalSourceConfig(source.connectionConfig);
  if (!config.directories.length) {
    await updateSourceScanStatus(dbPool, source.id, "Missing connection_config.path");
    return { discovered: 0, queued: 0, skipped: 0, updated: 0 };
  }

  try {
    let discovered = 0;
    let queued = 0;
    let skipped = 0;
    let updated = 0;
    let remainingBudget = config.maxFiles;
    const directoryErrors: string[] = [];

    for (const directory of config.directories) {
      if (remainingBudget <= 0) break;
      let files: string[] = [];
      try {
        files = await collectFiles(directory, config.recursive, config.maxDepth, remainingBudget);
      } catch (err: any) {
        directoryErrors.push(`${directory}: ${err?.message || String(err)}`);
        continue;
      }

      remainingBudget -= files.length;

      for (const fullPath of files) {
        const entry = path.basename(fullPath);
        if (!matchesPattern(entry, source.filePattern || "*")) {
          skipped += 1;
          continue;
        }
        if (!isAllowedExtension(entry, config.allowedExtensions)) {
          skipped += 1;
          continue;
        }

        let stat: Awaited<ReturnType<typeof fs.stat>>;
        try {
          stat = await fs.stat(fullPath);
        } catch {
          skipped += 1;
          continue;
        }

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

        if (record.updated) updated += 1;
        discovered += 1;
        await enqueueJob(dbPool, source.id, record.id, entry, checksum);
        queued += 1;
      }
    }

    const errorSummary = directoryErrors.length ? directoryErrors.join(" | ") : null;
    await updateSourceScanStatus(dbPool, source.id, errorSummary);
    return { discovered, queued, skipped, updated };
  } catch (err: any) {
    await updateSourceScanStatus(dbPool, source.id, err?.message || String(err));
    return { discovered: 0, queued: 0, skipped: 0, updated: 0 };
  }
};

const scanGoogleDriveSource = async (dbPool: Pool, source: IngestionSourceRow) => {
  const config = normalizeGoogleDriveSourceConfig(source.connectionConfig);
  if (!config.folderId) {
    await updateSourceScanStatus(dbPool, source.id, "Missing connection_config.folderId");
    return { discovered: 0, queued: 0, skipped: 0, updated: 0, failed: 0, deleted: 0 };
  }

  try {
    await ensureStagingDir();
    const driveFiles = await listGoogleDriveFiles(config);
    const activeRemotePaths = new Set<string>();

    let discovered = 0;
    let queued = 0;
    let skipped = 0;
    let updated = 0;
    let failed = 0;

    for (const file of driveFiles) {
      if (!file?.id) {
        skipped += 1;
        continue;
      }
      if (!isAllowedExtension(file.name, config.allowedExtensions)) {
        skipped += 1;
        continue;
      }
      if (!matchesPattern(file.name, source.filePattern || "*")) {
        skipped += 1;
        continue;
      }

      const remotePath = normalizeGoogleRemotePath(file.id);
      activeRemotePaths.add(remotePath);
      const checksum = computeDriveChecksum(file);
      const record = await ensureFileRecord(
        dbPool,
        source.id,
        remotePath,
        file.name,
        Number(file.size || 0),
        file.modifiedTime ? new Date(file.modifiedTime) : null,
        checksum
      );

      if (!record.created) {
        skipped += 1;
        continue;
      }

      if (record.updated) updated += 1;
      discovered += 1;

      const stagingPath = path.join(
        STAGING_DIR,
        `gdrive-${source.id}-${file.id}-${Date.now()}-${sanitizeForStaging(file.name)}`
      );

      try {
        await downloadGoogleDriveFile(config, file.id, stagingPath);
        await dbPool.query(
          "UPDATE ingestion_files SET staging_path = ?, uploaded_url = ?, status = 'NEW', error_message = NULL WHERE id = ?",
          [stagingPath, `drive://${file.id}`, record.id]
        );
        await enqueueJob(dbPool, source.id, record.id, file.name, checksum);
        queued += 1;
      } catch (downloadErr: any) {
        failed += 1;
        const message = downloadErr?.message || "Failed to download Google Drive file.";
        await dbPool.query(
          "UPDATE ingestion_files SET status = 'FAILED', processed_at = NOW(), error_message = ? WHERE id = ?",
          [message, record.id]
        );
        await dbPool.query(
          `INSERT INTO ingestion_jobs
            (source_id, file_id, file_name, file_hash, status, rows_imported, error_message, attempt, started_at, finished_at, result)
           VALUES (?, ?, ?, ?, 'FAILED', 0, ?, 1, NOW(), NOW(), 'FAILED')`,
          [source.id, record.id, file.name, checksum, message]
        );
        await upsertAlert(dbPool, {
          fingerprint: `ingestion_gdrive_download_failed|source:${source.id}|file:${file.id}`,
          alertType: "ingestion_failed",
          severity: "medium",
          title: `Google Drive download failed: ${file.name}`,
          message,
          source: "google_drive_ingestion",
          projectId: Number(source.projectId || 0) || null,
          payload: {
            sourceId: source.id,
            sourceName: source.name,
            fileId: file.id,
            fileName: file.name,
          },
        });
      }
    }

    let deleted = 0;
    const [latestRows]: any = await dbPool.query(
      `SELECT f.id, f.remote_path as remotePath, f.file_name as fileName, f.status as status
       FROM ingestion_files f
       INNER JOIN (
         SELECT remote_path, MAX(id) as latestId
         FROM ingestion_files
         WHERE source_id = ?
         GROUP BY remote_path
       ) latest ON latest.latestId = f.id
       WHERE f.source_id = ? AND f.remote_path LIKE 'google-drive:%'`,
      [source.id, source.id]
    );

    const latestFiles = Array.isArray(latestRows) ? latestRows : [];
    for (const row of latestFiles) {
      const remotePath = String(row.remotePath || "");
      if (!remotePath || activeRemotePaths.has(remotePath)) continue;
      if (String(row.status || "").toUpperCase() === "DELETED") continue;

      const deletedNow = await markRemoteFileDeleted(
        dbPool,
        source,
        remotePath,
        String(row.fileName || remotePath)
      );
      if (deletedNow) deleted += 1;
    }

    await updateSourceScanStatus(dbPool, source.id, null);
    return { discovered, queued, skipped, updated, failed, deleted };
  } catch (err: any) {
    await updateSourceScanStatus(dbPool, source.id, err?.message || String(err));
    return { discovered: 0, queued: 0, skipped: 0, updated: 0, failed: 0, deleted: 0 };
  }
};

const processQueuedJobs = async (dbPool: Pool, limit = 3) => {
  const [rows]: any = await dbPool.query(
    `SELECT j.id as jobId, j.source_id as sourceId, j.file_id as fileId,
            f.remote_path as remotePath, f.file_name as fileName,
            f.staging_path as stagingPath,
            f.checksum_sha256 as fileHash,
            s.project_id as projectId,
            s.type as sourceType
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
      "UPDATE ingestion_jobs SET started_at = NOW(), status = 'PROCESSING' WHERE id = ? AND started_at IS NULL",
      [job.jobId]
    );
    const affected = (claimed as any)?.[0]?.affectedRows ?? 0;
    if (!affected) continue;

    let stagingPath = String(job.stagingPath || "").trim();
    try {
      await dbPool.query("UPDATE ingestion_files SET status = 'PROCESSING' WHERE id = ?", [job.fileId]);
      const sourceType = String(job.sourceType || "").toLowerCase();

      if (!stagingPath) {
        stagingPath = path.join(STAGING_DIR, `${job.fileId}-${job.fileName}`);
      }

      if (sourceType === "local") {
        await fs.copyFile(job.remotePath, stagingPath);
        await dbPool.query("UPDATE ingestion_files SET staging_path = ? WHERE id = ?", [
          stagingPath,
          job.fileId,
        ]);
      } else {
        try {
          await fs.access(stagingPath);
        } catch {
          throw new Error(`Staging file not found for source type '${sourceType}'`);
        }
      }

      const ingestResult = await ingestFilesFromDisk(dbPool, job.projectId, [
        { path: stagingPath, originalname: job.fileName },
      ]);
      const rowsImported = Number(ingestResult?.metrics?.files?.[0]?.rows || 0);
      const importedFileId = Number(ingestResult?.files?.[0]?.id || 0) || null;

      await dbPool.query(
        "UPDATE ingestion_files SET status = 'SUCCESS', processed_at = NOW(), rows_imported = ?, error_message = NULL WHERE id = ?",
        [rowsImported, job.fileId]
      );
      await dbPool.query(
        "UPDATE ingestion_jobs SET finished_at = NOW(), result = 'SUCCESS', status = 'SUCCESS', rows_imported = ?, imported_file_id = ?, error_message = NULL WHERE id = ?",
        [rowsImported, importedFileId, job.jobId]
      );

      await notify(dbPool, "ingestion_success", `Ingested ${job.fileName}`, {
        sourceId: job.sourceId,
        fileId: job.fileId,
      });
      await recordAudit(dbPool, "ingestion_success", {
        sourceId: job.sourceId,
        fileId: job.fileId,
        fileName: job.fileName,
        importedFileId,
        rowsImported,
      });
    } catch (err: any) {
      const message = err?.message || String(err);
      await dbPool.query(
        "UPDATE ingestion_files SET status = 'FAILED', processed_at = NOW(), error_message = ? WHERE id = ?",
        [message, job.fileId]
      );
      await dbPool.query(
        "UPDATE ingestion_jobs SET finished_at = NOW(), result = 'FAILED', status = 'FAILED', error_message = ? WHERE id = ?",
        [message, job.jobId]
      );
      await notify(dbPool, "ingestion_failed", `Failed to ingest ${job.fileName}`, {
        sourceId: job.sourceId,
        fileId: job.fileId,
        error: message,
      });
      await upsertAlert(dbPool, {
        fingerprint: `ingestion_failed|source:${job.sourceId}|hash:${job.fileHash || job.fileId}`,
        alertType: "ingestion_failed",
        severity: "medium",
        title: `Ingestion failed: ${job.fileName}`,
        message,
        source: "ingestion_runner",
        projectId: Number(job.projectId || 0) || null,
        payload: {
          sourceId: job.sourceId,
          fileId: job.fileId,
          fileName: job.fileName,
          error: message,
        },
      });
      await recordAudit(dbPool, "ingestion_failed", {
        sourceId: job.sourceId,
        fileId: job.fileId,
        fileName: job.fileName,
        error: message,
      });
    } finally {
      const sourceType = String(job.sourceType || "").toLowerCase();
      if (sourceType === "google_drive" && stagingPath) {
        await fs.unlink(stagingPath).catch(() => undefined);
      }
    }
  }
};

export const runIngestionCycle = async (dbPool: Pool) => {
  const sources = await getEnabledSources(dbPool);
  for (const source of sources) {
    if (!shouldScanSource(source)) continue;
    if (source.type === "local") {
      await scanLocalSource(dbPool, source);
    } else if (source.type === "google_drive") {
      await scanGoogleDriveSource(dbPool, source);
    } else if (source.type === "folder_sync") {
      // Folder sync sources are pushed by local agents and do not require
      // server-side path scans.
      await updateSourceScanStatus(dbPool, source.id, null);
    } else {
      await updateSourceScanStatus(dbPool, source.id, "Unsupported source type");
    }
  }
  await processQueuedJobs(dbPool);
};

export const runIngestionScanOnce = async (dbPool: Pool, sourceId: number) => {
  const [[source]]: any = await dbPool.query(
    `SELECT id, name, type, connection_config as connectionConfig, file_pattern as filePattern,
            template_rule as templateRule,
            poll_interval_minutes as pollIntervalMinutes, enabled, project_id as projectId,
            last_scan_at as lastScanAt
     FROM ingestion_sources WHERE id = ?`,
    [sourceId]
  );
  if (!source) {
    throw new Error("Source not found");
  }
  if (source.type === "local") {
    return scanLocalSource(dbPool, source as IngestionSourceRow);
  }
  if (source.type === "google_drive") {
    return scanGoogleDriveSource(dbPool, source as IngestionSourceRow);
  }
  throw new Error("Only local and google_drive sources support manual server-side scan.");
};
