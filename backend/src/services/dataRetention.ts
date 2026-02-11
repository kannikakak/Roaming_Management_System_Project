import { Pool, PoolConnection } from "mysql2/promise";
import fs from "fs/promises";
import path from "path";

type RetentionMode = "delete" | "archive";

export type RetentionConfig = {
  enabled: boolean;
  days: number;
  mode: RetentionMode;
  deleteFiles: boolean;
  intervalHours: number;
};

export type RetentionRunResult = {
  enabled: boolean;
  dryRun: boolean;
  skippedReason?: string;
  cutoff: string;
  mode: RetentionMode;
  deleteFiles: boolean;
  filesFound: number;
  filesDeleted: number;
  filesArchived: number;
  rowsArchived: number;
  columnsArchived: number;
  qualityArchived: number;
  profilesArchived: number;
  diskFilesDeleted: number;
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

const tableExists = async (connection: PoolConnection, tableName: string) => {
  const [rows]: any = await connection.query("SHOW TABLES LIKE ?", [tableName]);
  return Array.isArray(rows) && rows.length > 0;
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

  await connection.query(
    `CREATE TABLE IF NOT EXISTS file_columns_archive (
      id INT AUTO_INCREMENT PRIMARY KEY,
      file_id INT NOT NULL,
      name VARCHAR(255) NOT NULL,
      position INT NOT NULL,
      archived_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_file_columns_archive_file_id (file_id)
    ) ENGINE=InnoDB`
  );

  await connection.query(
    `CREATE TABLE IF NOT EXISTS data_quality_scores_archive (
      id INT AUTO_INCREMENT PRIMARY KEY,
      file_id INT NOT NULL,
      score DECIMAL(5,2) NOT NULL,
      trust_level VARCHAR(16) NOT NULL,
      missing_rate DECIMAL(6,4) NOT NULL DEFAULT 0,
      duplicate_rate DECIMAL(6,4) NOT NULL DEFAULT 0,
      invalid_rate DECIMAL(6,4) NOT NULL DEFAULT 0,
      schema_inconsistency_rate DECIMAL(6,4) NOT NULL DEFAULT 0,
      total_rows INT NOT NULL DEFAULT 0,
      total_columns INT NOT NULL DEFAULT 0,
      archived_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_data_quality_scores_archive_file_id (file_id)
    ) ENGINE=InnoDB`
  );

  await connection.query(
    `CREATE TABLE IF NOT EXISTS file_profiles_archive (
      id INT AUTO_INCREMENT PRIMARY KEY,
      file_id INT NOT NULL,
      profile_json LONGTEXT NOT NULL,
      row_count INT NOT NULL DEFAULT 0,
      column_count INT NOT NULL DEFAULT 0,
      archived_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_file_profiles_archive_file_id (file_id)
    ) ENGINE=InnoDB`
  );
};

export async function runDataRetention(
  dbPool: Pool,
  options: { dryRun?: boolean; now?: Date } = {}
): Promise<RetentionRunResult> {
  const config = await loadRetentionConfig(dbPool);
  const now = options.now || new Date();
  const cutoffDate = new Date(now.getTime() - config.days * 24 * 60 * 60 * 1000);

  const baseResult: RetentionRunResult = {
    enabled: config.enabled,
    dryRun: Boolean(options.dryRun),
    cutoff: cutoffDate.toISOString(),
    mode: config.mode,
    deleteFiles: config.deleteFiles,
    filesFound: 0,
    filesDeleted: 0,
    filesArchived: 0,
    rowsArchived: 0,
    columnsArchived: 0,
    qualityArchived: 0,
    profilesArchived: 0,
    diskFilesDeleted: 0,
  };

  if (!config.enabled) {
    return { ...baseResult, skippedReason: "Retention is disabled" };
  }
  if (!Number.isFinite(config.days) || config.days <= 0) {
    return { ...baseResult, skippedReason: "Retention period is not configured" };
  }

  const [rows]: any = await dbPool.query(
    "SELECT id, storage_path FROM files WHERE uploaded_at < ?",
    [cutoffDate]
  );

  const files = Array.isArray(rows) ? rows : [];
  const fileIds = files
    .map((row: any) => Number(row.id))
    .filter((id: number) => Number.isFinite(id) && id > 0);

  const result: RetentionRunResult = {
    ...baseResult,
    filesFound: fileIds.length,
  };

  if (fileIds.length === 0) {
    return result;
  }

  if (options.dryRun) {
    return result;
  }

  const connection = await dbPool.getConnection();
  try {
    await connection.beginTransaction();

    if (config.mode === "archive") {
      await ensureArchiveTables(connection);

      const [archivedFiles]: any = await connection.query(
        "INSERT IGNORE INTO files_archive (id, project_id, name, file_type, storage_path, uploaded_at, archived_at) SELECT id, project_id, name, file_type, storage_path, uploaded_at, NOW() FROM files WHERE id IN (?)",
        [fileIds]
      );
      result.filesArchived = Number(archivedFiles?.affectedRows || 0);

      const [archivedRows]: any = await connection.query(
        "INSERT INTO file_rows_archive (file_id, row_index, data_json, archived_at) SELECT file_id, row_index, data_json, NOW() FROM file_rows WHERE file_id IN (?)",
        [fileIds]
      );
      result.rowsArchived = Number(archivedRows?.affectedRows || 0);

      const [archivedColumns]: any = await connection.query(
        "INSERT INTO file_columns_archive (file_id, name, position, archived_at) SELECT file_id, name, position, NOW() FROM file_columns WHERE file_id IN (?)",
        [fileIds]
      );
      result.columnsArchived = Number(archivedColumns?.affectedRows || 0);

      const qualityExists = await tableExists(connection, "data_quality_scores");
      if (qualityExists) {
        const [archivedQuality]: any = await connection.query(
          "INSERT INTO data_quality_scores_archive (file_id, score, trust_level, missing_rate, duplicate_rate, invalid_rate, schema_inconsistency_rate, total_rows, total_columns, archived_at) SELECT file_id, score, trust_level, missing_rate, duplicate_rate, invalid_rate, schema_inconsistency_rate, total_rows, total_columns, NOW() FROM data_quality_scores WHERE file_id IN (?)",
          [fileIds]
        );
        result.qualityArchived = Number(archivedQuality?.affectedRows || 0);
      }

      const profileExists = await tableExists(connection, "file_profiles");
      if (profileExists) {
        const [archivedProfiles]: any = await connection.query(
          "INSERT INTO file_profiles_archive (file_id, profile_json, row_count, column_count, archived_at) SELECT file_id, profile_json, row_count, column_count, NOW() FROM file_profiles WHERE file_id IN (?)",
          [fileIds]
        );
        result.profilesArchived = Number(archivedProfiles?.affectedRows || 0);
      }
    }

    const [deletedFiles]: any = await connection.query("DELETE FROM files WHERE id IN (?)", [fileIds]);
    result.filesDeleted = Number(deletedFiles?.affectedRows || 0);

    await connection.commit();
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }

  if (config.deleteFiles) {
    const deleteResults = await Promise.all(
      files
        .map((row: any) => row.storage_path)
        .filter(Boolean)
        .map((filePath: string) => {
          const resolvedPath = path.isAbsolute(filePath)
            ? filePath
            : path.join(process.cwd(), filePath);
          return fs.unlink(resolvedPath).then(() => true).catch(() => false);
        })
    );
    result.diskFilesDeleted = deleteResults.filter(Boolean).length;
  }

  return result;
}
