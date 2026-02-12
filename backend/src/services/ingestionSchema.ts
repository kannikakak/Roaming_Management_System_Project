import { Pool } from "mysql2/promise";

const columnExists = async (dbPool: Pool, tableName: string, columnName: string) => {
  const [rows]: any = await dbPool.query(
    `SELECT COUNT(*) AS total
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?`,
    [tableName, columnName]
  );
  return Number(rows?.[0]?.total || 0) > 0;
};

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

const ensureColumn = async (
  dbPool: Pool,
  tableName: string,
  columnName: string,
  definitionSql: string
) => {
  const exists = await columnExists(dbPool, tableName, columnName);
  if (exists) return;
  await dbPool.query(`ALTER TABLE ${tableName} ADD COLUMN ${definitionSql}`);
};

const ensureIndex = async (
  dbPool: Pool,
  tableName: string,
  indexName: string,
  definitionSql: string
) => {
  const exists = await indexExists(dbPool, tableName, indexName);
  if (exists) return;
  await dbPool.query(`ALTER TABLE ${tableName} ADD ${definitionSql}`);
};

export const ensureIngestionAgentSchema = async (dbPool: Pool) => {
  await ensureColumn(
    dbPool,
    "ingestion_sources",
    "template_rule",
    "template_rule VARCHAR(255) NULL AFTER file_pattern"
  );
  await ensureColumn(
    dbPool,
    "ingestion_sources",
    "agent_key_hash",
    "agent_key_hash CHAR(64) NULL AFTER enabled"
  );
  await ensureColumn(
    dbPool,
    "ingestion_sources",
    "agent_key_hint",
    "agent_key_hint VARCHAR(16) NULL AFTER agent_key_hash"
  );
  await ensureColumn(
    dbPool,
    "ingestion_sources",
    "last_agent_seen_at",
    "last_agent_seen_at DATETIME NULL AFTER agent_key_hint"
  );

  await ensureColumn(
    dbPool,
    "ingestion_files",
    "original_path",
    "original_path VARCHAR(1024) NULL AFTER remote_path"
  );
  await ensureColumn(
    dbPool,
    "ingestion_files",
    "uploaded_url",
    "uploaded_url VARCHAR(1024) NULL AFTER staging_path"
  );
  await ensureColumn(
    dbPool,
    "ingestion_files",
    "rows_imported",
    "rows_imported INT NOT NULL DEFAULT 0 AFTER uploaded_url"
  );
  await ensureIndex(
    dbPool,
    "ingestion_files",
    "idx_ingestion_files_source_checksum",
    "INDEX idx_ingestion_files_source_checksum (source_id, checksum_sha256)"
  );

  await ensureColumn(
    dbPool,
    "ingestion_jobs",
    "file_name",
    "file_name VARCHAR(255) NULL AFTER file_id"
  );
  await ensureColumn(
    dbPool,
    "ingestion_jobs",
    "file_hash",
    "file_hash CHAR(64) NULL AFTER file_name"
  );
  await ensureColumn(
    dbPool,
    "ingestion_jobs",
    "imported_file_id",
    "imported_file_id INT NULL AFTER file_hash"
  );
  await ensureColumn(
    dbPool,
    "ingestion_jobs",
    "status",
    "status VARCHAR(16) NOT NULL DEFAULT 'PENDING' AFTER imported_file_id"
  );
  await ensureColumn(
    dbPool,
    "ingestion_jobs",
    "rows_imported",
    "rows_imported INT NOT NULL DEFAULT 0 AFTER status"
  );
  await ensureColumn(
    dbPool,
    "ingestion_jobs",
    "error_message",
    "error_message TEXT NULL AFTER rows_imported"
  );
  await ensureColumn(
    dbPool,
    "ingestion_jobs",
    "created_at",
    "created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP AFTER logs_reference"
  );
  await ensureIndex(
    dbPool,
    "ingestion_jobs",
    "idx_ingestion_jobs_status",
    "INDEX idx_ingestion_jobs_status (status)"
  );
  await ensureIndex(
    dbPool,
    "ingestion_jobs",
    "idx_ingestion_jobs_created_at",
    "INDEX idx_ingestion_jobs_created_at (created_at)"
  );
};

