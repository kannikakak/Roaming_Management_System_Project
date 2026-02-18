import { Pool } from "mysql2/promise";

const indexExists = async (dbPool: Pool, tableName: string, indexName: string) => {
  const [rows]: any = await dbPool.query(
    `SELECT COUNT(*) AS total
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND INDEX_NAME = ?`,
    [tableName, indexName]
  );
  return Number(rows?.[0]?.total || 0) > 0;
};

const ensureIndex = async (
  dbPool: Pool,
  tableName: string,
  indexName: string,
  definitionSql: string
) => {
  const exists = await indexExists(dbPool, tableName, indexName);
  if (exists) return;
  try {
    await dbPool.query(`ALTER TABLE ${tableName} ADD ${definitionSql}`);
  } catch (error: any) {
    if (String(error?.code || "") === "ER_NO_SUCH_TABLE") {
      console.warn(`[analytics-schema] skipped ${indexName}: table ${tableName} not found`);
      return;
    }
    throw error;
  }
};

export const ensureAnalyticsSchema = async (dbPool: Pool) => {
  await ensureIndex(
    dbPool,
    "files",
    "idx_files_project_uploaded",
    "INDEX idx_files_project_uploaded (project_id, uploaded_at)"
  );
  await ensureIndex(
    dbPool,
    "files",
    "idx_files_uploaded_project",
    "INDEX idx_files_uploaded_project (uploaded_at, project_id)"
  );
  await ensureIndex(
    dbPool,
    "file_rows",
    "idx_file_rows_file_row_index",
    "INDEX idx_file_rows_file_row_index (file_id, row_index)"
  );
  await ensureIndex(
    dbPool,
    "alerts",
    "idx_alerts_project_detected_status_partner",
    "INDEX idx_alerts_project_detected_status_partner (project_id, last_detected_at, status, partner)"
  );
};
