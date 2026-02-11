import { Pool, PoolConnection } from "mysql2/promise";
import fs from "fs/promises";
import path from "path";

export type BackupTriggerType = "manual" | "auto" | "restore";

type BackupFilePayload = {
  meta: {
    version: number;
    createdAt: string;
    triggerType: BackupTriggerType;
    tableCounts: Record<string, number>;
    recordsCount: number;
  };
  data: Record<string, Record<string, any>[]>;
};

type DeletedSourceBackupPayload = {
  meta: {
    version: number;
    createdAt: string;
    originalFileId: number;
    projectId: number;
    fileName: string;
    fileType: string;
    deletedBy: string;
  };
  data: {
    file: Record<string, any> | null;
    columns: Record<string, any>[];
    rows: Record<string, any>[];
    quality: Record<string, any> | null;
  };
};

const BACKUP_TABLES = [
  "users",
  "roles",
  "user_roles",
  "projects",
  "cards",
  "files",
  "file_columns",
  "file_rows",
  "data_quality_scores",
  "charts",
  "reports",
  "report_slides",
  "report_templates",
  "report_schedules",
  "notifications",
  "notification_settings",
  "alerts",
  "audit_logs",
  "collaboration_sessions",
  "ingestion_sources",
  "ingestion_files",
  "ingestion_jobs",
  "data_retention_settings",
  "refresh_tokens",
].map((name) => `\`${name}\``);

const backupTablesForJson = BACKUP_TABLES.map((name) => name.replace(/`/g, ""));

const backupDir = () => process.env.BACKUP_DIR || path.join(process.cwd(), "backups");

const resolveExistingTables = async (dbPool: Pool) => {
  const [rows]: any = await dbPool.query(
    `SELECT table_name as tableName
     FROM information_schema.tables
     WHERE table_schema = DATABASE()`
  );
  const existing = new Set(
    (Array.isArray(rows) ? rows : []).map((row: any) => String(row.tableName || ""))
  );
  return backupTablesForJson.filter((table) => existing.has(table));
};

const toSafeFileStamp = (date: Date) => {
  const yyyy = String(date.getFullYear());
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${yyyy}${mm}${dd}-${hh}${mi}${ss}`;
};

const serializeValue = (value: any): any => {
  if (Buffer.isBuffer(value)) {
    return {
      __riBackupType: "buffer",
      base64: value.toString("base64"),
    };
  }
  if (value instanceof Date) {
    return {
      __riBackupType: "date",
      iso: value.toISOString(),
    };
  }
  return value;
};

const deserializeValue = (value: any): any => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  if (value.__riBackupType === "buffer" && typeof value.base64 === "string") {
    return Buffer.from(value.base64, "base64");
  }
  if (value.__riBackupType === "date" && typeof value.iso === "string") {
    return value.iso;
  }
  return value;
};

const serializeRow = (row: Record<string, any>) => {
  const next: Record<string, any> = {};
  for (const [key, value] of Object.entries(row || {})) {
    next[key] = serializeValue(value);
  }
  return next;
};

const deserializeRow = (row: Record<string, any>) => {
  const next: Record<string, any> = {};
  for (const [key, value] of Object.entries(row || {})) {
    next[key] = deserializeValue(value);
  }
  return next;
};

const insertRowsBatch = async (
  connection: PoolConnection,
  table: string,
  rows: Record<string, any>[],
  batchSize: number
) => {
  if (!rows.length) return;
  const columns = Object.keys(rows[0]);
  if (!columns.length) return;
  const tableSql = `\`${table}\``;
  const columnSql = columns.map((col) => `\`${col}\``).join(", ");

  for (let start = 0; start < rows.length; start += batchSize) {
    const batch = rows.slice(start, start + batchSize);
    const placeholders = batch
      .map(() => `(${columns.map(() => "?").join(", ")})`)
      .join(", ");
    const values = batch.flatMap((row) => columns.map((column) => row[column] ?? null));
    await connection.query(`INSERT INTO ${tableSql} (${columnSql}) VALUES ${placeholders}`, values);
  }
};

export const ensureBackupHistoryTable = async (dbPool: Pool) => {
  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS backup_history (
      id INT AUTO_INCREMENT PRIMARY KEY,
      trigger_type VARCHAR(16) NOT NULL,
      status VARCHAR(24) NOT NULL DEFAULT 'success',
      file_name VARCHAR(255) NULL,
      file_path VARCHAR(1024) NULL,
      file_size BIGINT NULL,
      tables_count INT NOT NULL DEFAULT 0,
      records_count BIGINT NOT NULL DEFAULT 0,
      created_by VARCHAR(255) NULL,
      notes TEXT NULL,
      error_message TEXT NULL,
      restored_from_id INT NULL,
      restored_at DATETIME NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_backup_history_created_at (created_at),
      INDEX idx_backup_history_trigger_type (trigger_type),
      INDEX idx_backup_history_status (status)
    ) ENGINE=InnoDB
  `);
};

export const ensureDeletedFileBackupsTable = async (dbPool: Pool) => {
  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS deleted_file_backups (
      id INT AUTO_INCREMENT PRIMARY KEY,
      original_file_id INT NOT NULL,
      project_id INT NOT NULL,
      file_name VARCHAR(255) NOT NULL,
      file_type VARCHAR(32) NOT NULL,
      backup_file_name VARCHAR(255) NOT NULL,
      backup_file_path VARCHAR(1024) NOT NULL,
      backup_file_size BIGINT NOT NULL DEFAULT 0,
      rows_count INT NOT NULL DEFAULT 0,
      columns_count INT NOT NULL DEFAULT 0,
      deleted_by VARCHAR(255) NULL,
      status VARCHAR(24) NOT NULL DEFAULT 'available',
      restored_file_id INT NULL,
      restored_by VARCHAR(255) NULL,
      restored_at DATETIME NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_deleted_file_backups_project_id (project_id),
      INDEX idx_deleted_file_backups_original_file_id (original_file_id),
      INDEX idx_deleted_file_backups_status (status),
      INDEX idx_deleted_file_backups_created_at (created_at)
    ) ENGINE=InnoDB
  `);
};

export const getBackupConfig = () => ({
  enabled: String(process.env.BACKUP_SCHEDULER_ENABLED || "true").toLowerCase() !== "false",
  intervalHours: Math.max(1, Number(process.env.BACKUP_INTERVAL_HOURS || 24)),
  directory: backupDir(),
});

export const listBackups = async (dbPool: Pool, limit = 50) => {
  await ensureBackupHistoryTable(dbPool);
  const safeLimit = Math.max(1, Math.min(200, Number(limit) || 50));
  const [rows]: any = await dbPool.query(
    `SELECT id, trigger_type as triggerType, status, file_name as fileName, file_path as filePath,
            file_size as fileSize, tables_count as tablesCount, records_count as recordsCount,
            created_by as createdBy, notes, error_message as errorMessage, restored_from_id as restoredFromId,
            restored_at as restoredAt, created_at as createdAt
     FROM backup_history
     ORDER BY created_at DESC
     LIMIT ?`,
    [safeLimit]
  );
  return Array.isArray(rows) ? rows : [];
};

export const listDeletedSourceBackups = async (dbPool: Pool, limit = 100) => {
  await ensureDeletedFileBackupsTable(dbPool);
  const safeLimit = Math.max(1, Math.min(300, Number(limit) || 100));
  const [rows]: any = await dbPool.query(
    `SELECT id, original_file_id as originalFileId, project_id as projectId, file_name as fileName,
            file_type as fileType, backup_file_name as backupFileName, backup_file_path as backupFilePath,
            backup_file_size as backupFileSize, rows_count as rowsCount, columns_count as columnsCount,
            deleted_by as deletedBy, status, restored_file_id as restoredFileId, restored_by as restoredBy,
            restored_at as restoredAt, created_at as createdAt
     FROM deleted_file_backups
     ORDER BY created_at DESC
     LIMIT ?`,
    [safeLimit]
  );
  return Array.isArray(rows) ? rows : [];
};

const resolveUniqueRestoredFileName = async (dbPool: Pool, projectId: number, originalName: string) => {
  const ext = path.extname(originalName);
  const base = ext ? originalName.slice(0, -ext.length) : originalName;
  const candidates = [originalName];
  for (let i = 1; i <= 100; i += 1) {
    candidates.push(`${base} (restored${i === 1 ? "" : ` ${i}`})${ext}`);
  }

  for (const candidate of candidates) {
    const [rows]: any = await dbPool.query(
      "SELECT id FROM files WHERE project_id = ? AND name = ? LIMIT 1",
      [projectId, candidate]
    );
    if (!rows?.length) return candidate;
  }
  return `${base} (restored ${Date.now()})${ext}`;
};

export const createDeletedSourceFileBackup = async (
  dbPool: Pool,
  fileId: number,
  deletedBy: string
) => {
  await ensureDeletedFileBackupsTable(dbPool);
  const [fileRows]: any = await dbPool.query(
    "SELECT * FROM files WHERE id = ? LIMIT 1",
    [fileId]
  );
  const fileRow = fileRows?.[0];
  if (!fileRow) {
    throw new Error("File not found for source backup.");
  }

  const [columnRows]: any = await dbPool.query(
    "SELECT * FROM file_columns WHERE file_id = ? ORDER BY position ASC",
    [fileId]
  );
  const [rowRows]: any = await dbPool.query(
    "SELECT * FROM file_rows WHERE file_id = ? ORDER BY row_index ASC",
    [fileId]
  );
  const [qualityRows]: any = await dbPool.query(
    "SELECT * FROM data_quality_scores WHERE file_id = ? LIMIT 1",
    [fileId]
  );

  const now = new Date();
  const dir = path.join(backupDir(), "deleted-sources");
  await fs.mkdir(dir, { recursive: true });
  const fileName = `deleted-source-${toSafeFileStamp(now)}-file${fileId}.json`;
  const filePath = path.join(dir, fileName);

  const payload: DeletedSourceBackupPayload = {
    meta: {
      version: 1,
      createdAt: now.toISOString(),
      originalFileId: Number(fileRow.id),
      projectId: Number(fileRow.project_id),
      fileName: String(fileRow.name || `file_${fileId}`),
      fileType: String(fileRow.file_type || "unknown"),
      deletedBy: deletedBy || "system",
    },
    data: {
      file: serializeRow(fileRow as Record<string, any>),
      columns: (Array.isArray(columnRows) ? columnRows : []).map((row) =>
        serializeRow(row as Record<string, any>)
      ),
      rows: (Array.isArray(rowRows) ? rowRows : []).map((row) =>
        serializeRow(row as Record<string, any>)
      ),
      quality: qualityRows?.[0] ? serializeRow(qualityRows[0] as Record<string, any>) : null,
    },
  };

  await fs.writeFile(filePath, JSON.stringify(payload), "utf8");
  const stat = await fs.stat(filePath);

  const [result]: any = await dbPool.query(
    `INSERT INTO deleted_file_backups
     (original_file_id, project_id, file_name, file_type, backup_file_name, backup_file_path, backup_file_size,
      rows_count, columns_count, deleted_by, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'available')`,
    [
      Number(fileRow.id),
      Number(fileRow.project_id),
      String(fileRow.name || `file_${fileId}`),
      String(fileRow.file_type || "unknown"),
      fileName,
      filePath,
      Number(stat.size || 0),
      Array.isArray(rowRows) ? rowRows.length : 0,
      Array.isArray(columnRows) ? columnRows.length : 0,
      deletedBy || "system",
    ]
  );

  return {
    id: Number(result?.insertId || 0),
    originalFileId: Number(fileRow.id),
    projectId: Number(fileRow.project_id),
    fileName: String(fileRow.name || `file_${fileId}`),
    backupFileName: fileName,
    backupFilePath: filePath,
    backupFileSize: Number(stat.size || 0),
    rowsCount: Array.isArray(rowRows) ? rowRows.length : 0,
    columnsCount: Array.isArray(columnRows) ? columnRows.length : 0,
    createdAt: now.toISOString(),
  };
};

export const restoreDeletedSourceFileBackup = async (
  dbPool: Pool,
  backupId: number,
  restoredBy: string
) => {
  await ensureDeletedFileBackupsTable(dbPool);
  const [rows]: any = await dbPool.query(
    "SELECT * FROM deleted_file_backups WHERE id = ? LIMIT 1",
    [backupId]
  );
  const backup = rows?.[0];
  if (!backup) {
    throw new Error("Deleted source backup not found.");
  }
  if (!backup.backup_file_path) {
    throw new Error("Backup file path is missing.");
  }

  const raw = await fs.readFile(String(backup.backup_file_path), "utf8");
  const parsed = JSON.parse(raw) as DeletedSourceBackupPayload;
  if (!parsed || typeof parsed !== "object" || !parsed.data || !parsed.data.file) {
    throw new Error("Invalid deleted source backup file.");
  }

  const file = deserializeRow(parsed.data.file);
  const projectId = Number(file.project_id || backup.project_id);
  const [projectRows]: any = await dbPool.query(
    "SELECT id FROM projects WHERE id = ? LIMIT 1",
    [projectId]
  );
  if (!projectRows?.length) {
    throw new Error("Cannot restore: target project no longer exists.");
  }

  const nextName = await resolveUniqueRestoredFileName(
    dbPool,
    projectId,
    String(file.name || backup.file_name || `restored_file_${backup.original_file_id}`)
  );

  const connection = await dbPool.getConnection();
  try {
    await connection.beginTransaction();

    const [insertFileResult]: any = await connection.query(
      `INSERT INTO files (project_id, name, file_type, storage_path, text_content, uploaded_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        projectId,
        nextName,
        String(file.file_type || backup.file_type || "unknown"),
        file.storage_path ?? null,
        file.text_content ?? null,
        file.uploaded_at ?? new Date(),
      ]
    );
    const restoredFileId = Number(insertFileResult?.insertId || 0);

    const columns = Array.isArray(parsed.data.columns) ? parsed.data.columns : [];
    for (const rawColumn of columns) {
      const column = deserializeRow(rawColumn as Record<string, any>);
      await connection.query(
        "INSERT INTO file_columns (file_id, name, position) VALUES (?, ?, ?)",
        [restoredFileId, column.name ?? "", Number(column.position ?? 0)]
      );
    }

    const rawRows = Array.isArray(parsed.data.rows) ? parsed.data.rows : [];
    const restoredRows = rawRows.map((rawRow) => deserializeRow(rawRow as Record<string, any>));
    const rowBatchSize = Math.max(
      100,
      Math.min(2000, Number(process.env.BACKUP_RESTORE_BATCH_SIZE || 500))
    );
    await insertRowsBatch(
      connection,
      "file_rows",
      restoredRows.map((row) => ({
        file_id: restoredFileId,
        row_index: Number(row.row_index ?? 0),
        data_json: row.data_json ?? null,
      })),
      rowBatchSize
    );

    const quality = parsed.data.quality ? deserializeRow(parsed.data.quality as Record<string, any>) : null;
    if (quality) {
      await connection.query(
        `INSERT INTO data_quality_scores
         (file_id, score, trust_level, missing_rate, duplicate_rate, invalid_rate, schema_inconsistency_rate, total_rows, total_columns, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
        [
          restoredFileId,
          Number(quality.score || 0),
          String(quality.trust_level || "Low"),
          Number(quality.missing_rate || 0),
          Number(quality.duplicate_rate || 0),
          Number(quality.invalid_rate || 0),
          Number(quality.schema_inconsistency_rate || 0),
          Number(quality.total_rows || restoredRows.length),
          Number(quality.total_columns || columns.length),
        ]
      );
    }

    await connection.query(
      `UPDATE deleted_file_backups
       SET status = 'restored', restored_file_id = ?, restored_by = ?, restored_at = NOW()
       WHERE id = ?`,
      [restoredFileId, restoredBy || "system", backupId]
    );

    await connection.commit();
    return {
      backupId,
      restoredFileId,
      projectId,
      restoredFileName: nextName,
      restoredRows: restoredRows.length,
      restoredColumns: columns.length,
      restoredAt: new Date().toISOString(),
    };
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
};

export const createBackup = async (
  dbPool: Pool,
  options: { triggerType: BackupTriggerType; createdBy?: string; notes?: string }
) => {
  await ensureBackupHistoryTable(dbPool);

  const now = new Date();
  const dir = backupDir();
  await fs.mkdir(dir, { recursive: true });

  const fileName = `backup-${toSafeFileStamp(now)}-${options.triggerType}.json`;
  const filePath = path.join(dir, fileName);

  const payload: BackupFilePayload = {
    meta: {
      version: 1,
      createdAt: now.toISOString(),
      triggerType: options.triggerType,
      tableCounts: {},
      recordsCount: 0,
    },
    data: {},
  };

  const existingTables = await resolveExistingTables(dbPool);

  try {
    for (const table of existingTables) {
      const tableSql = `\`${table}\``;
      const [rows]: any = await dbPool.query(`SELECT * FROM ${tableSql}`);
      const serializedRows = (Array.isArray(rows) ? rows : []).map((row) =>
        serializeRow(row as Record<string, any>)
      );
      payload.data[table] = serializedRows;
      payload.meta.tableCounts[table] = serializedRows.length;
      payload.meta.recordsCount += serializedRows.length;
    }

    await fs.writeFile(filePath, JSON.stringify(payload), "utf8");
    const stat = await fs.stat(filePath);

    const [result]: any = await dbPool.query(
      `INSERT INTO backup_history
       (trigger_type, status, file_name, file_path, file_size, tables_count, records_count, created_by, notes)
       VALUES (?, 'success', ?, ?, ?, ?, ?, ?, ?)`,
      [
        options.triggerType,
        fileName,
        filePath,
        Number(stat.size || 0),
        existingTables.length,
        payload.meta.recordsCount,
        options.createdBy || "system",
        options.notes || null,
      ]
    );

    return {
      id: Number(result?.insertId || 0),
      fileName,
      filePath,
      fileSize: Number(stat.size || 0),
      tablesCount: existingTables.length,
      recordsCount: payload.meta.recordsCount,
      createdAt: now.toISOString(),
      triggerType: options.triggerType,
    };
  } catch (err: any) {
    await dbPool.query(
      `INSERT INTO backup_history
       (trigger_type, status, file_name, file_path, file_size, tables_count, records_count, created_by, notes, error_message)
       VALUES (?, 'failed', ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        options.triggerType,
        fileName,
        filePath,
        0,
        0,
        0,
        options.createdBy || "system",
        options.notes || null,
        err?.message || String(err),
      ]
    );
    throw err;
  }
};

export const restoreBackup = async (
  dbPool: Pool,
  backupId: number,
  restoredBy: string
) => {
  await ensureBackupHistoryTable(dbPool);
  const [rows]: any = await dbPool.query(
    "SELECT * FROM backup_history WHERE id = ? LIMIT 1",
    [backupId]
  );
  const record = rows?.[0];
  if (!record) {
    throw new Error("Backup record not found.");
  }
  if (!record.file_path) {
    throw new Error("Backup file path is missing.");
  }

  const raw = await fs.readFile(String(record.file_path), "utf8");
  const parsed = JSON.parse(raw) as BackupFilePayload;
  if (!parsed || typeof parsed !== "object" || !parsed.data) {
    throw new Error("Invalid backup file.");
  }

  const existingTables = new Set(await resolveExistingTables(dbPool));
  const tablesToRestore = backupTablesForJson.filter(
    (table) => existingTables.has(table) && Array.isArray(parsed.data[table])
  );

  const connection = await dbPool.getConnection();
  const batchSize = Math.max(100, Math.min(2000, Number(process.env.BACKUP_RESTORE_BATCH_SIZE || 500)));
  let restoredRows = 0;
  try {
    await connection.beginTransaction();
    await connection.query("SET FOREIGN_KEY_CHECKS = 0");

    for (const tableSql of tablesToRestore.map((table) => `\`${table}\``)) {
      await connection.query(`DELETE FROM ${tableSql}`);
    }

    for (const table of tablesToRestore) {
      const rowsForTable = Array.isArray(parsed.data[table]) ? parsed.data[table] : [];
      if (!rowsForTable.length) continue;
      const deserialized = rowsForTable.map((row) => deserializeRow(row as Record<string, any>));
      await insertRowsBatch(connection, table, deserialized, batchSize);
      restoredRows += deserialized.length;
    }

    await connection.query("SET FOREIGN_KEY_CHECKS = 1");
    await connection.commit();

    await dbPool.query(
      `INSERT INTO backup_history
       (trigger_type, status, file_name, file_path, file_size, tables_count, records_count, created_by, notes, restored_from_id, restored_at)
       VALUES ('restore', 'restored', ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        record.file_name,
        record.file_path,
        Number(record.file_size || 0),
        tablesToRestore.length,
        restoredRows,
        restoredBy || "system",
        `Restored backup #${backupId}`,
        backupId,
      ]
    );

    return {
      restoredFromId: backupId,
      restoredRows,
      tablesCount: tablesToRestore.length,
      restoredAt: new Date().toISOString(),
    };
  } catch (err) {
    try {
      await connection.query("SET FOREIGN_KEY_CHECKS = 1");
    } catch {
      // ignore
    }
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
};
