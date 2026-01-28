import { Pool, PoolConnection } from "mysql2/promise";
import fs from "fs/promises";

type RetentionMode = "delete" | "archive";

export type RetentionConfig = {
  enabled: boolean;
  days: number;
  mode: RetentionMode;
  deleteFiles: boolean;
  intervalHours: number;
};

const toNumber = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const getRetentionConfig = (): RetentionConfig => {
  const enabled = String(process.env.DATA_RETENTION_ENABLED || "").toLowerCase() === "true";
  const days = Math.floor(toNumber(process.env.DATA_RETENTION_DAYS, 0));
  const mode = (process.env.DATA_RETENTION_MODE || "delete").toLowerCase() as RetentionMode;
  const deleteFiles = String(process.env.DATA_RETENTION_DELETE_FILES || "true").toLowerCase() !== "false";
  const intervalHours = Math.max(1, Math.floor(toNumber(process.env.DATA_RETENTION_CHECK_HOURS, 24)));
  return { enabled, days, mode, deleteFiles, intervalHours };
};

const ensureRetentionTable = async (connection: PoolConnection) => {
  await connection.query(
    `CREATE TABLE IF NOT EXISTS data_retention_settings (
      id INT PRIMARY KEY,
      enabled TINYINT(1) NOT NULL DEFAULT 0,
      retention_days INT NOT NULL DEFAULT 0,
      mode VARCHAR(16) NOT NULL DEFAULT 'delete',
      delete_files TINYINT(1) NOT NULL DEFAULT 1,
      interval_hours INT NOT NULL DEFAULT 24,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB`
  );
};

export const loadRetentionConfig = async (dbPool: Pool): Promise<RetentionConfig> => {
  const connection = await dbPool.getConnection();
  try {
    await ensureRetentionTable(connection);
    const [rows]: any = await connection.query(
      "SELECT enabled, retention_days, mode, delete_files, interval_hours FROM data_retention_settings WHERE id = 1"
    );
    const row = rows?.[0];
    if (!row) {
      const envConfig = getRetentionConfig();
      await connection.query(
        "INSERT INTO data_retention_settings (id, enabled, retention_days, mode, delete_files, interval_hours) VALUES (1, ?, ?, ?, ?, ?)",
        [
          envConfig.enabled ? 1 : 0,
          envConfig.days,
          envConfig.mode,
          envConfig.deleteFiles ? 1 : 0,
          envConfig.intervalHours,
        ]
      );
      return envConfig;
    }
    return {
      enabled: Boolean(row.enabled),
      days: Number(row.retention_days) || 0,
      mode: row.mode === "archive" ? "archive" : "delete",
      deleteFiles: Boolean(row.delete_files),
      intervalHours: Math.max(1, Number(row.interval_hours) || 24),
    };
  } finally {
    connection.release();
  }
};

export const saveRetentionConfig = async (dbPool: Pool, next: RetentionConfig) => {
  const connection = await dbPool.getConnection();
  try {
    await ensureRetentionTable(connection);
    await connection.query(
      `INSERT INTO data_retention_settings
        (id, enabled, retention_days, mode, delete_files, interval_hours)
       VALUES (1, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
        enabled = VALUES(enabled),
        retention_days = VALUES(retention_days),
        mode = VALUES(mode),
        delete_files = VALUES(delete_files),
        interval_hours = VALUES(interval_hours),
        updated_at = CURRENT_TIMESTAMP`,
      [
        next.enabled ? 1 : 0,
        next.days,
        next.mode,
        next.deleteFiles ? 1 : 0,
        next.intervalHours,
      ]
    );
  } finally {
    connection.release();
  }
};

const ensureArchiveTables = async (connection: PoolConnection) => {
  await connection.query(
    `CREATE TABLE IF NOT EXISTS files_archive (
      id INT PRIMARY KEY,
      project_id INT NOT NULL,
      name VARCHAR(255) NOT NULL,
      file_type VARCHAR(16) NOT NULL,
      storage_path VARCHAR(512) NULL,
      uploaded_at TIMESTAMP NULL,
      archived_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB`
  );

  await connection.query(
    `CREATE TABLE IF NOT EXISTS file_rows_archive (
      id INT AUTO_INCREMENT PRIMARY KEY,
      file_id INT NOT NULL,
      row_index INT NOT NULL,
      data_json LONGBLOB NOT NULL,
      archived_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_file_rows_archive_file_id (file_id)
    ) ENGINE=InnoDB`
  );
};

export async function runDataRetention(dbPool: Pool) {
  const config = await loadRetentionConfig(dbPool);
  if (!config.enabled || !Number.isFinite(config.days) || config.days <= 0) return;

  const cutoff = new Date(Date.now() - config.days * 24 * 60 * 60 * 1000);
  const [rows]: any = await dbPool.query(
    "SELECT id, storage_path FROM files WHERE uploaded_at < ?",
    [cutoff]
  );

  const files = Array.isArray(rows) ? rows : [];
  if (files.length === 0) return;

  const fileIds = files.map((row: any) => row.id).filter(Boolean);
  if (fileIds.length === 0) return;

  const connection = await dbPool.getConnection();
  try {
    await connection.beginTransaction();

    if (config.mode === "archive") {
      await ensureArchiveTables(connection);
      await connection.query(
        "INSERT INTO files_archive (id, project_id, name, file_type, storage_path, uploaded_at, archived_at) SELECT id, project_id, name, file_type, storage_path, uploaded_at, NOW() FROM files WHERE id IN (?)",
        [fileIds]
      );
      await connection.query(
        "INSERT INTO file_rows_archive (file_id, row_index, data_json, archived_at) SELECT file_id, row_index, data_json, NOW() FROM file_rows WHERE file_id IN (?)",
        [fileIds]
      );
    }

    await connection.query("DELETE FROM files WHERE id IN (?)", [fileIds]);
    await connection.commit();
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }

  if (config.deleteFiles) {
    await Promise.all(
      files
        .map((row: any) => row.storage_path)
        .filter(Boolean)
        .map((filePath: string) => fs.unlink(filePath).catch(() => undefined))
    );
  }
}
