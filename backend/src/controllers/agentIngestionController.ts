import crypto from "crypto";
import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";
import { Request, Response } from "express";
import { Pool } from "mysql2/promise";
import * as XLSX from "xlsx";
import { parse as csvParse } from "csv-parse";
import { ingestFilesFromDisk } from "./fileController";
import { getUploadConfig } from "../utils/uploadValidation";
import { readAgentKeyFromRequest, hashAgentKey } from "../utils/agentKey";
import { upsertAlert } from "../services/alerts";
import { writeAuditLog } from "../utils/auditLogger";

const uploadConfig = getUploadConfig();

type ParsedTemplateRule = {
  fileNamePattern: string | null;
  requiredColumns: string[];
};

const toSafeNumber = (value: unknown, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const computeFileHash = (filePath: string) => {
  const hash = crypto.createHash("sha256");
  const stream = fs.createReadStream(filePath);
  return new Promise<string>((resolve, reject) => {
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
};

const isAllowedUploadExt = (fileName: string) => {
  const lower = String(fileName || "").toLowerCase();
  return lower.endsWith(".csv") || lower.endsWith(".xlsx") || lower.endsWith(".xls");
};

const toIsoString = (value: unknown) => {
  if (!value) return null;
  try {
    return new Date(String(value)).toISOString();
  } catch {
    return null;
  }
};

const normalizeRemotePath = (value: unknown) =>
  String(value || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.?\//, "")
    .replace(/\/{2,}/g, "/");

const loadFolderSyncSource = async (dbPool: Pool, sourceId: number) => {
  const [sourceRows]: any = await dbPool.query(
    `SELECT id, name, type, enabled, project_id as projectId, template_rule as templateRule,
            agent_key_hash as agentKeyHash
     FROM ingestion_sources WHERE id = ? LIMIT 1`,
    [sourceId]
  );
  return sourceRows?.[0] || null;
};

const toRegex = (pattern: string) => {
  const escaped = pattern.replace(/[-/\\^$+?.()|[\]{}]/g, "\\$&");
  const regex = escaped.replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${regex}$`, "i");
};

const matchesFilePattern = (fileName: string, pattern: string | null) => {
  if (!pattern || pattern.trim() === "" || pattern.trim() === "*") return true;
  const parts = pattern.split(/[;,]/).map((part) => part.trim()).filter(Boolean);
  if (!parts.length) return true;
  return parts.some((part) => toRegex(part).test(fileName));
};

const normalizeHeader = (value: string) =>
  String(value || "")
    .trim()
    .toLowerCase();

const readHeaderColumns = async (filePath: string, originalName: string) => {
  const ext = path.extname(originalName || "").toLowerCase();

  if (ext === ".csv") {
    const content = await fsPromises.readFile(filePath, "utf8");
    const records = await new Promise<any[]>((resolve, reject) => {
      csvParse(
        content,
        {
          bom: true,
          to_line: 1,
          trim: true,
          relax_column_count: true,
          skip_empty_lines: true,
        },
        (err, rows) => {
          if (err) return reject(err);
          return resolve(Array.isArray(rows) ? rows : []);
        }
      );
    });

    const firstRow = Array.isArray(records[0]) ? records[0] : [];
    return firstRow
      .map((column: any) => String(column || "").trim())
      .filter((column) => Boolean(column));
  }

  if (ext === ".xlsx" || ext === ".xls") {
    const workbook = XLSX.readFile(filePath, { cellDates: true });
    const firstSheetName = workbook.SheetNames[0];
    const firstSheet = workbook.Sheets[firstSheetName];
    const rows = XLSX.utils.sheet_to_json(firstSheet, { header: 1, blankrows: false });
    const firstRow = Array.isArray(rows[0]) ? rows[0] : [];
    return firstRow
      .map((column: any) => String(column || "").trim())
      .filter((column) => Boolean(column));
  }

  return [];
};

const parseTemplateRule = (rawRule: unknown): ParsedTemplateRule => {
  if (!rawRule) {
    return {
      fileNamePattern: null,
      requiredColumns: [],
    };
  }

  let parsed: any = rawRule;
  if (typeof rawRule === "string") {
    const trimmed = rawRule.trim();
    if (!trimmed) {
      return {
        fileNamePattern: null,
        requiredColumns: [],
      };
    }

    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return {
        fileNamePattern: trimmed,
        requiredColumns: [],
      };
    }
  }

  if (!parsed || typeof parsed !== "object") {
    return {
      fileNamePattern: null,
      requiredColumns: [],
    };
  }

  const rawPattern =
    parsed.fileNamePattern ??
    parsed.filenamePattern ??
    parsed.pattern ??
    null;
  const fileNamePattern = rawPattern ? String(rawPattern).trim() : null;

  const rawColumns =
    parsed.requiredColumns ??
    parsed.columns ??
    parsed.headers ??
    [];

  const requiredColumns = Array.isArray(rawColumns)
    ? rawColumns
        .map((column: any) => String(column || "").trim())
        .filter(Boolean)
    : String(rawColumns || "")
        .split(/[;,]/)
        .map((column) => column.trim())
        .filter(Boolean);

  return {
    fileNamePattern,
    requiredColumns,
  };
};

const formatTemplateValidationError = (
  fileName: string,
  rule: ParsedTemplateRule,
  headers: string[]
) => {
  if (rule.fileNamePattern && !matchesFilePattern(fileName, rule.fileNamePattern)) {
    return `Template rule mismatch: file name '${fileName}' does not match pattern '${rule.fileNamePattern}'.`;
  }

  if (!rule.requiredColumns.length) return null;

  const headerSet = new Set(headers.map((column) => normalizeHeader(column)));
  const missingColumns = rule.requiredColumns.filter(
    (required) => !headerSet.has(normalizeHeader(required))
  );

  if (missingColumns.length === 0) return null;

  return `Template rule mismatch: missing required column(s): ${missingColumns.join(", ")}.`;
};

const safeAuditLog = async (
  dbPool: Pool,
  payload: Parameters<typeof writeAuditLog>[1]
) => {
  try {
    await writeAuditLog(dbPool, payload);
  } catch (error: any) {
    // eslint-disable-next-line no-console
    console.warn("[agent-ingest] audit logging failed", error?.message || error);
  }
};

const createFailedIngestionRecord = async (
  dbPool: Pool,
  input: {
    sourceId: number;
    originalPath: string;
    fileName: string;
    fileSize: number;
    fileHash: string;
    stagingPath: string;
    errorMessage: string;
  }
) => {
  const [fileInsert]: any = await dbPool.query(
    `INSERT INTO ingestion_files
      (source_id, remote_path, original_path, file_name, file_size, last_modified, checksum_sha256, staging_path, uploaded_url, status, error_message, processed_at)
     VALUES (?, ?, ?, ?, ?, NOW(), ?, ?, ?, 'FAILED', ?, NOW())`,
    [
      input.sourceId,
      input.originalPath,
      input.originalPath,
      input.fileName,
      input.fileSize,
      input.fileHash,
      input.stagingPath,
      input.stagingPath,
      input.errorMessage,
    ]
  );

  const ingestionFileId = Number(fileInsert?.insertId || 0);

  const [jobInsert]: any = await dbPool.query(
    `INSERT INTO ingestion_jobs
      (source_id, file_id, file_name, file_hash, status, rows_imported, error_message, attempt, started_at, finished_at, result)
     VALUES (?, ?, ?, ?, 'FAILED', 0, ?, 1, NOW(), NOW(), 'FAILED')`,
    [
      input.sourceId,
      ingestionFileId,
      input.fileName,
      input.fileHash,
      input.errorMessage,
    ]
  );

  return {
    ingestionFileId,
    ingestionJobId: Number(jobInsert?.insertId || 0),
  };
};

export const agentUpload = (dbPool: Pool) => async (req: Request, res: Response) => {
  const sourceId = toSafeNumber(req.body?.sourceId, 0);
  const uploaded = req.file as Express.Multer.File | undefined;
  if (!sourceId || !uploaded) {
    return res.status(400).json({ message: "sourceId and file are required." });
  }

  if (uploaded.size > uploadConfig.maxFileSizeBytes) {
    return res.status(400).json({
      message: `File too large. Max ${Math.round(uploadConfig.maxFileSizeBytes / 1024 / 1024)} MB.`,
    });
  }

  const source = await loadFolderSyncSource(dbPool, sourceId);
  if (!source) {
    return res.status(404).json({ message: "Source not found." });
  }
  if (!source.enabled) {
    return res.status(400).json({ message: "Source is inactive." });
  }
  if (String(source.type || "").toLowerCase() !== "folder_sync") {
    return res.status(400).json({ message: "Source type is not folder_sync." });
  }

  const providedKey = readAgentKeyFromRequest(req);
  if (!providedKey) {
    return res.status(401).json({ message: "Missing agent API key." });
  }
  const providedHash = hashAgentKey(providedKey);
  if (!source.agentKeyHash || source.agentKeyHash !== providedHash) {
    return res.status(401).json({ message: "Invalid agent API key." });
  }

  const fileHash = await computeFileHash(uploaded.path);
  const originalPath = normalizeRemotePath(req.body?.originalPath || uploaded.originalname);

  if (!isAllowedUploadExt(uploaded.originalname)) {
    const typeError = "Only CSV/XLSX/XLS files are allowed.";
    const failedRecord = await createFailedIngestionRecord(dbPool, {
      sourceId,
      originalPath: originalPath || uploaded.originalname,
      fileName: uploaded.originalname,
      fileSize: uploaded.size,
      fileHash,
      stagingPath: uploaded.path,
      errorMessage: typeError,
    });

    await dbPool.query(
      "UPDATE ingestion_sources SET last_agent_seen_at = NOW(), last_scan_at = NOW(), last_error = ? WHERE id = ?",
      [typeError, sourceId]
    );

    await upsertAlert(dbPool, {
      fingerprint: `agent_ingestion_invalid_type|source:${sourceId}|hash:${fileHash}`,
      alertType: "ingestion_failed",
      severity: "low",
      title: `Invalid file type blocked: ${uploaded.originalname}`,
      message: typeError,
      source: "agent_upload",
      projectId: Number(source.projectId || 0) || null,
      payload: {
        sourceId,
        sourceName: source.name,
        ingestionJobId: failedRecord.ingestionJobId,
        ingestionFileId: failedRecord.ingestionFileId,
        fileName: uploaded.originalname,
        fileHash,
      },
    });

    await safeAuditLog(dbPool, {
      actor: `agent:${sourceId}`,
      action: "agent_ingestion_invalid_type",
      details: {
        sourceId,
        sourceName: source.name,
        ingestionJobId: failedRecord.ingestionJobId,
        ingestionFileId: failedRecord.ingestionFileId,
        fileName: uploaded.originalname,
        fileHash,
      },
    });

    return res.status(400).json({
      ok: false,
      message: typeError,
      sourceId,
      ingestionJobId: failedRecord.ingestionJobId,
      ingestionFileId: failedRecord.ingestionFileId,
      fileHash,
    });
  }

  const templateRule = parseTemplateRule(source.templateRule);
  const shouldValidateTemplate =
    Boolean(templateRule.fileNamePattern) || templateRule.requiredColumns.length > 0;

  if (shouldValidateTemplate) {
    try {
      const headers = await readHeaderColumns(uploaded.path, uploaded.originalname);
      const validationError = formatTemplateValidationError(
        uploaded.originalname,
        templateRule,
        headers
      );
      if (validationError) {
        const failedRecord = await createFailedIngestionRecord(dbPool, {
          sourceId,
          originalPath: originalPath || uploaded.originalname,
          fileName: uploaded.originalname,
          fileSize: uploaded.size,
          fileHash,
          stagingPath: uploaded.path,
          errorMessage: validationError,
        });

        await dbPool.query(
          "UPDATE ingestion_sources SET last_agent_seen_at = NOW(), last_scan_at = NOW(), last_error = ? WHERE id = ?",
          [validationError, sourceId]
        );

        await upsertAlert(dbPool, {
          fingerprint: `agent_ingestion_template_failed|source:${sourceId}|hash:${fileHash}`,
          alertType: "ingestion_failed",
          severity: "medium",
          title: `Template mismatch: ${uploaded.originalname}`,
          message: validationError,
          source: "agent_upload",
          projectId: Number(source.projectId || 0) || null,
          payload: {
            sourceId,
            sourceName: source.name,
            ingestionJobId: failedRecord.ingestionJobId,
            ingestionFileId: failedRecord.ingestionFileId,
            fileName: uploaded.originalname,
            fileHash,
            templateRule,
          },
        });

        await safeAuditLog(dbPool, {
          actor: `agent:${sourceId}`,
          action: "agent_ingestion_template_failed",
          details: {
            sourceId,
            sourceName: source.name,
            ingestionJobId: failedRecord.ingestionJobId,
            ingestionFileId: failedRecord.ingestionFileId,
            fileName: uploaded.originalname,
            fileHash,
            error: validationError,
            templateRule,
          },
        });

        return res.status(400).json({
          ok: false,
          message: validationError,
          sourceId,
          ingestionJobId: failedRecord.ingestionJobId,
          ingestionFileId: failedRecord.ingestionFileId,
          fileHash,
        });
      }
    } catch (templateError: any) {
      return res.status(400).json({
        ok: false,
        message: templateError?.message || "Failed to validate template rule.",
      });
    }
  }

  const [duplicateRows]: any = await dbPool.query(
    `SELECT id
     FROM ingestion_files
     WHERE source_id = ? AND checksum_sha256 = ? AND status = 'SUCCESS'
     ORDER BY id DESC
     LIMIT 1`,
    [sourceId, fileHash]
  );
  const duplicateFile = duplicateRows?.[0];
  if (duplicateFile?.id) {
    const [jobResult]: any = await dbPool.query(
      `INSERT INTO ingestion_jobs
        (source_id, file_id, file_name, file_hash, status, rows_imported, error_message, attempt, started_at, finished_at, result)
       VALUES (?, ?, ?, ?, 'SKIPPED', 0, ?, 1, NOW(), NOW(), 'SKIPPED')`,
      [sourceId, duplicateFile.id, uploaded.originalname, fileHash, "Duplicate hash, already imported"]
    );
    await dbPool.query(
      "UPDATE ingestion_sources SET last_agent_seen_at = NOW(), last_scan_at = NOW(), last_error = NULL WHERE id = ?",
      [sourceId]
    );

    await safeAuditLog(dbPool, {
      actor: `agent:${sourceId}`,
      action: "agent_ingestion_duplicate_skipped",
      details: {
        sourceId,
        sourceName: source.name,
        fileId: duplicateFile.id,
        fileName: uploaded.originalname,
        fileHash,
      },
    });

    return res.json({
      ok: true,
      duplicate: true,
      sourceId,
      fileHash,
      fileId: duplicateFile.id,
      jobId: Number(jobResult?.insertId || 0),
      message: "Duplicate file hash, ingestion skipped.",
    });
  }

  const [fileInsert]: any = await dbPool.query(
    `INSERT INTO ingestion_files
      (source_id, remote_path, original_path, file_name, file_size, last_modified, checksum_sha256, staging_path, uploaded_url, status)
     VALUES (?, ?, ?, ?, ?, NOW(), ?, ?, ?, 'PROCESSING')`,
    [sourceId, originalPath || uploaded.originalname, originalPath || null, uploaded.originalname, uploaded.size, fileHash, uploaded.path, uploaded.path]
  );
  const ingestionFileId = Number(fileInsert?.insertId || 0);

  const [jobInsert]: any = await dbPool.query(
    `INSERT INTO ingestion_jobs
      (source_id, file_id, file_name, file_hash, status, attempt, started_at)
     VALUES (?, ?, ?, ?, 'PROCESSING', 1, NOW())`,
    [sourceId, ingestionFileId, uploaded.originalname, fileHash]
  );
  const ingestionJobId = Number(jobInsert?.insertId || 0);

  try {
    const ingestResult = await ingestFilesFromDisk(dbPool, Number(source.projectId), [
      { path: uploaded.path, originalname: uploaded.originalname },
    ]);
    const rowsImported = Number(ingestResult?.metrics?.files?.[0]?.rows || 0);
    const importedFileId = Number(ingestResult?.files?.[0]?.id || 0) || null;

    await dbPool.query(
      "UPDATE ingestion_files SET status = 'SUCCESS', processed_at = NOW(), rows_imported = ?, error_message = NULL WHERE id = ?",
      [rowsImported, ingestionFileId]
    );
    await dbPool.query(
      `UPDATE ingestion_jobs
       SET status = 'SUCCESS', rows_imported = ?, imported_file_id = ?, error_message = NULL,
           finished_at = NOW(), result = 'SUCCESS'
       WHERE id = ?`,
      [rowsImported, importedFileId, ingestionJobId]
    );
    await dbPool.query(
      "UPDATE ingestion_sources SET last_agent_seen_at = NOW(), last_scan_at = NOW(), last_error = NULL WHERE id = ?",
      [sourceId]
    );

    await safeAuditLog(dbPool, {
      actor: `agent:${sourceId}`,
      action: "agent_ingestion_success",
      details: {
        sourceId,
        sourceName: source.name,
        ingestionJobId,
        ingestionFileId,
        importedFileId,
        rowsImported,
        fileName: uploaded.originalname,
        fileHash,
      },
    });

    return res.json({
      ok: true,
      sourceId,
      sourceName: source.name,
      ingestionJobId,
      ingestionFileId,
      importedFileId,
      rowsImported,
      fileHash,
    });
  } catch (err: any) {
    const message = err?.message || "Ingestion failed";
    await dbPool.query(
      "UPDATE ingestion_files SET status = 'FAILED', processed_at = NOW(), error_message = ? WHERE id = ?",
      [message, ingestionFileId]
    );
    await dbPool.query(
      "UPDATE ingestion_jobs SET status = 'FAILED', error_message = ?, finished_at = NOW(), result = 'FAILED' WHERE id = ?",
      [message, ingestionJobId]
    );
    await dbPool.query(
      "UPDATE ingestion_sources SET last_agent_seen_at = NOW(), last_scan_at = NOW(), last_error = ? WHERE id = ?",
      [message, sourceId]
    );

    await upsertAlert(dbPool, {
      fingerprint: `agent_ingestion_failed|source:${sourceId}|hash:${fileHash}`,
      alertType: "ingestion_failed",
      severity: "medium",
      title: `Agent ingestion failed: ${uploaded.originalname}`,
      message,
      source: "agent_upload",
      projectId: Number(source.projectId || 0) || null,
      payload: {
        sourceId,
        sourceName: source.name,
        ingestionJobId,
        ingestionFileId,
        fileName: uploaded.originalname,
        fileHash,
      },
    });

    await safeAuditLog(dbPool, {
      actor: `agent:${sourceId}`,
      action: "agent_ingestion_failed",
      details: {
        sourceId,
        sourceName: source.name,
        ingestionJobId,
        ingestionFileId,
        fileName: uploaded.originalname,
        fileHash,
        error: message,
      },
    });

    return res.status(400).json({
      ok: false,
      message,
      sourceId,
      ingestionJobId,
      ingestionFileId,
      fileHash,
    });
  }
};

export const agentDelete = (dbPool: Pool) => async (req: Request, res: Response) => {
  const sourceId = toSafeNumber(req.body?.sourceId, 0);
  const remotePath = normalizeRemotePath(
    req.body?.originalPath || req.body?.remotePath || req.body?.filePath
  );
  if (!sourceId || !remotePath) {
    return res.status(400).json({ message: "sourceId and originalPath are required." });
  }

  const source = await loadFolderSyncSource(dbPool, sourceId);
  if (!source) {
    return res.status(404).json({ message: "Source not found." });
  }
  if (!source.enabled) {
    return res.status(400).json({ message: "Source is inactive." });
  }
  if (String(source.type || "").toLowerCase() !== "folder_sync") {
    return res.status(400).json({ message: "Source type is not folder_sync." });
  }

  const providedKey = readAgentKeyFromRequest(req);
  if (!providedKey) {
    return res.status(401).json({ message: "Missing agent API key." });
  }
  const providedHash = hashAgentKey(providedKey);
  if (!source.agentKeyHash || source.agentKeyHash !== providedHash) {
    return res.status(401).json({ message: "Invalid agent API key." });
  }

  try {
    const [latestRows]: any = await dbPool.query(
      `SELECT id, file_name as fileName
       FROM ingestion_files
       WHERE source_id = ? AND remote_path = ?
       ORDER BY id DESC
       LIMIT 1`,
      [sourceId, remotePath]
    );

    const latestFile = latestRows?.[0];
    const fileName = latestFile?.fileName || path.basename(remotePath) || "deleted_file";

    let ingestionFileId = Number(latestFile?.id || 0);
    if (!ingestionFileId) {
      const [fileInsert]: any = await dbPool.query(
        `INSERT INTO ingestion_files
          (source_id, remote_path, original_path, file_name, file_size, last_modified, checksum_sha256, staging_path, uploaded_url, rows_imported, status, error_message, first_seen_at, processed_at)
         VALUES (?, ?, ?, ?, 0, NOW(), NULL, NULL, NULL, 0, 'DELETED', ?, NOW(), NOW())`,
        [sourceId, remotePath, remotePath, fileName, "Deleted from source drive"]
      );
      ingestionFileId = Number(fileInsert?.insertId || 0);
    } else {
      await dbPool.query(
        `UPDATE ingestion_files
         SET status = 'DELETED', processed_at = NOW(), error_message = ?, rows_imported = 0
         WHERE source_id = ? AND remote_path = ?`,
        ["Deleted from source drive", sourceId, remotePath]
      );
    }

    const [importRows]: any = await dbPool.query(
      `SELECT DISTINCT j.imported_file_id as importedFileId
       FROM ingestion_jobs j
       INNER JOIN ingestion_files f ON f.id = j.file_id
       WHERE j.source_id = ? AND f.remote_path = ? AND j.imported_file_id IS NOT NULL`,
      [sourceId, remotePath]
    );
    const importedFileIds = (Array.isArray(importRows) ? importRows : [])
      .map((row: any) => Number(row.importedFileId || 0))
      .filter((value: number) => Number.isFinite(value) && value > 0);
    const uniqueImportedFileIds = Array.from(new Set(importedFileIds));

    if (uniqueImportedFileIds.length > 0) {
      const chunkSize = 100;
      for (let index = 0; index < uniqueImportedFileIds.length; index += chunkSize) {
        const chunk = uniqueImportedFileIds.slice(index, index + chunkSize);
        const placeholders = chunk.map(() => "?").join(", ");
        await dbPool.query(`DELETE FROM files WHERE id IN (${placeholders})`, chunk);
      }
    }

    const [jobInsert]: any = await dbPool.query(
      `INSERT INTO ingestion_jobs
        (source_id, file_id, file_name, file_hash, status, rows_imported, error_message, attempt, started_at, finished_at, result)
       VALUES (?, ?, ?, NULL, 'DELETED', 0, ?, 1, NOW(), NOW(), 'DELETED')`,
      [sourceId, ingestionFileId, fileName, `Deleted from source drive: ${remotePath}`]
    );
    const ingestionJobId = Number(jobInsert?.insertId || 0);

    await dbPool.query(
      "UPDATE ingestion_sources SET last_agent_seen_at = NOW(), last_scan_at = NOW(), last_error = NULL WHERE id = ?",
      [sourceId]
    );

    await safeAuditLog(dbPool, {
      actor: `agent:${sourceId}`,
      action: "agent_ingestion_source_file_deleted",
      details: {
        sourceId,
        sourceName: source.name,
        remotePath,
        ingestionFileId,
        ingestionJobId,
        deletedImportedCount: uniqueImportedFileIds.length,
      },
    });

    return res.json({
      ok: true,
      sourceId,
      sourceName: source.name,
      remotePath,
      ingestionFileId,
      ingestionJobId,
      deletedImportedCount: uniqueImportedFileIds.length,
    });
  } catch (err: any) {
    const message = err?.message || "Failed to sync deleted source file.";

    await dbPool.query(
      "UPDATE ingestion_sources SET last_agent_seen_at = NOW(), last_scan_at = NOW(), last_error = ? WHERE id = ?",
      [message, sourceId]
    );

    await safeAuditLog(dbPool, {
      actor: `agent:${sourceId}`,
      action: "agent_ingestion_source_file_delete_failed",
      details: {
        sourceId,
        sourceName: source.name,
        remotePath,
        error: message,
      },
    });

    return res.status(400).json({
      ok: false,
      message,
      sourceId,
      remotePath,
    });
  }
};

export const listIngestionHistory = (dbPool: Pool) => async (req: Request, res: Response) => {
  try {
    const sourceId = toSafeNumber(req.query.sourceId, 0);
    const limit = Math.max(1, Math.min(500, toSafeNumber(req.query.limit, 200)));

    const autoParams: any[] = [];
    let autoWhere = "";
    if (sourceId > 0) {
      autoWhere = "WHERE j.source_id = ?";
      autoParams.push(sourceId);
    }

    const [autoRows]: any = await dbPool.query(
      `SELECT j.id, j.source_id as sourceId, s.name as sourceName, s.type as sourceType,
              j.file_id as ingestionFileId, COALESCE(j.file_name, f.file_name) as fileName,
              COALESCE(j.file_hash, f.checksum_sha256) as fileHash,
              COALESCE(NULLIF(j.status, ''), COALESCE(j.result, 'PENDING')) as status,
              COALESCE(j.rows_imported, f.rows_imported, 0) as rowsImported,
              COALESCE(j.error_message, f.error_message) as errorMessage,
              j.imported_file_id as importedFileId,
              j.created_at as createdAt,
              j.started_at as startedAt,
              j.finished_at as finishedAt
       FROM ingestion_jobs j
       LEFT JOIN ingestion_files f ON f.id = j.file_id
       LEFT JOIN ingestion_sources s ON s.id = j.source_id
       ${autoWhere}
       ORDER BY j.id DESC
       LIMIT ?`,
      [...autoParams, limit]
    );

    let manualRows: any[] = [];
    if (sourceId <= 0) {
      const [rows]: any = await dbPool.query(
        `SELECT f.id as fileId, f.name as fileName, f.uploaded_at as uploadedAt,
                COALESCE(fr.rowsCount, 0) as rowsImported
         FROM files f
         LEFT JOIN (
            SELECT file_id as fileId, COUNT(*) as rowsCount
            FROM file_rows
            GROUP BY file_id
         ) fr ON fr.fileId = f.id
         LEFT JOIN ingestion_jobs j ON j.imported_file_id = f.id
         WHERE j.id IS NULL
         ORDER BY f.uploaded_at DESC
         LIMIT ?`,
        [limit]
      );
      manualRows = Array.isArray(rows)
        ? rows.map((row: any) => ({
            id: `manual-${row.fileId}`,
            sourceId: null,
            sourceName: "Manual Upload",
            sourceType: "manual",
            ingestionFileId: null,
            fileName: row.fileName,
            fileHash: null,
            status: "SUCCESS",
            rowsImported: Number(row.rowsImported || 0),
            errorMessage: null,
            importedFileId: row.fileId,
            createdAt: toIsoString(row.uploadedAt),
            startedAt: null,
            finishedAt: toIsoString(row.uploadedAt),
          }))
        : [];
    }

    const normalizedAuto = (Array.isArray(autoRows) ? autoRows : []).map((row: any) => ({
      id: `auto-${row.id}`,
      sourceId: Number(row.sourceId || 0) || null,
      sourceName: row.sourceName || "Auto source",
      sourceType: row.sourceType || "folder_sync",
      ingestionFileId: Number(row.ingestionFileId || 0) || null,
      fileName: row.fileName || "Unknown file",
      fileHash: row.fileHash || null,
      status: String(row.status || "PENDING").toUpperCase(),
      rowsImported: Number(row.rowsImported || 0),
      errorMessage: row.errorMessage || null,
      importedFileId: Number(row.importedFileId || 0) || null,
      createdAt: toIsoString(row.createdAt || row.startedAt || row.finishedAt),
      startedAt: toIsoString(row.startedAt),
      finishedAt: toIsoString(row.finishedAt),
    }));

    const combined = [...normalizedAuto, ...manualRows]
      .sort((a, b) => {
        const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return bTime - aTime;
      })
      .slice(0, limit);

    return res.json({
      items: combined,
      total: combined.length,
    });
  } catch (err: any) {
    return res.status(500).json({ message: "Failed to load ingestion history.", error: err?.message || err });
  }
};

export const clearIngestionHistory = (dbPool: Pool) => async (req: Request, res: Response) => {
  try {
    const sourceId = toSafeNumber(req.query.sourceId ?? req.body?.sourceId, 0);
    const mode = String(req.query.mode ?? req.body?.mode ?? "deleted").trim().toLowerCase();
    if (mode !== "deleted" && mode !== "all") {
      return res.status(400).json({ message: "mode must be 'deleted' or 'all'." });
    }

    const whereClauses: string[] = [];
    const params: any[] = [];

    if (sourceId > 0) {
      whereClauses.push("source_id = ?");
      params.push(sourceId);
    }
    if (mode === "deleted") {
      whereClauses.push("status = 'DELETED'");
    }

    const whereSql = whereClauses.length ? `WHERE ${whereClauses.join(" AND ")}` : "";
    const [fileRows]: any = await dbPool.query(
      `SELECT id FROM ingestion_files ${whereSql}`,
      params
    );
    const fileIds = (Array.isArray(fileRows) ? fileRows : [])
      .map((row: any) => Number(row.id || 0))
      .filter((value: number) => Number.isFinite(value) && value > 0);

    if (!fileIds.length) {
      return res.json({
        ok: true,
        mode,
        sourceId: sourceId > 0 ? sourceId : null,
        deletedFiles: 0,
        deletedJobs: 0,
      });
    }

    let deletedJobs = 0;
    let deletedFiles = 0;
    const chunkSize = 500;

    for (let index = 0; index < fileIds.length; index += chunkSize) {
      const chunk = fileIds.slice(index, index + chunkSize);
      const placeholders = chunk.map(() => "?").join(", ");

      const [jobDeleteResult]: any = await dbPool.query(
        `DELETE FROM ingestion_jobs WHERE file_id IN (${placeholders})`,
        chunk
      );
      if (jobDeleteResult?.affectedRows && Number.isFinite(jobDeleteResult.affectedRows)) {
        deletedJobs += Number(jobDeleteResult.affectedRows);
      }

      const [fileDeleteResult]: any = await dbPool.query(
        `DELETE FROM ingestion_files WHERE id IN (${placeholders})`,
        chunk
      );
      deletedFiles += Number(fileDeleteResult?.affectedRows || 0);
    }

    return res.json({
      ok: true,
      mode,
      sourceId: sourceId > 0 ? sourceId : null,
      deletedFiles,
      deletedJobs,
    });
  } catch (err: any) {
    return res.status(500).json({
      message: "Failed to clear ingestion history.",
      error: err?.message || err,
    });
  }
};
