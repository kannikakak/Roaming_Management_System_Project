import { Request, Response } from "express";
import { Pool } from "mysql2/promise";
import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";
import * as XLSX from "xlsx";
import { parse as csvParse } from "csv-parse";
import {
  getUploadConfig,
  resolveUploadSchema,
  sanitizeFileName,
  validateAndNormalizeData,
  scanFileForMalware,
  UploadConfig,
} from "../utils/uploadValidation";
import { buildDataJsonExpr, buildEncryptedValue, buildKeyParams, getEncryptionKey } from "../utils/dbEncryption";
import { getNotificationSettings } from "../services/notificationSettings";
import { buildFileProfile, ensureFileProfileTable, saveFileProfile, FileProfile } from "../services/fileProfile";

type ParsedFile = {
  columns: string[];
  rows: any[];
};

type FileTimings = {
  parseMs: number;
  validateMs: number;
  qualityMs: number;
  dbMs: number;
  totalMs: number;
};

type QualityMetrics = {
  score: number;
  trustLevel: "High" | "Medium" | "Low";
  missingRate: number;
  duplicateRate: number;
  invalidRate: number;
  schemaInconsistencyRate: number;
  totalRows: number;
  totalColumns: number;
};

type IngestFileInput = Pick<Express.Multer.File, "path" | "originalname"> &
  Partial<Pick<Express.Multer.File, "mimetype" | "size" | "filename" | "destination" | "fieldname" | "encoding">>;

const hasAnyRole = (req: Request, roles: string[]) => {
  const primary = req.user?.role;
  const list = Array.isArray(req.user?.roles)
    ? req.user!.roles
    : primary
      ? [primary]
      : [];
  return list.some((r) => roles.includes(r));
};

const canAccessAnyProject = (req: Request) => hasAnyRole(req, ["admin", "analyst"]);

async function requireProjectAccess(dbPool: Pool, projectId: number, req: Request) {
  const authUserId = req.user?.id;
  if (!authUserId) {
    return { ok: false as const, status: 401, message: "Unauthorized" };
  }

  const [rows]: any = await dbPool.query(
    "SELECT user_id FROM projects WHERE id = ? LIMIT 1",
    [projectId]
  );
  if (!rows?.length) {
    return { ok: false as const, status: 404, message: "Project not found" };
  }

  const ownerId = Number(rows[0].user_id);
  if (!Number.isFinite(ownerId)) {
    return { ok: false as const, status: 500, message: "Invalid project owner" };
  }

  if (ownerId !== authUserId && !canAccessAnyProject(req)) {
    return { ok: false as const, status: 403, message: "Forbidden" };
  }

  return { ok: true as const, ownerId };
}

async function requireFileAccess(dbPool: Pool, rawFileId: string, req: Request) {
  const authUserId = req.user?.id;
  if (!authUserId) {
    return { ok: false as const, status: 401, message: "Unauthorized" };
  }

  const fileId = Number(rawFileId);
  if (!Number.isFinite(fileId)) {
    return { ok: false as const, status: 400, message: "Invalid fileId" };
  }

  const [rows]: any = await dbPool.query(
    `SELECT f.id as fileId, f.project_id as projectId, p.user_id as ownerId
     FROM files f
     INNER JOIN projects p ON p.id = f.project_id
     WHERE f.id = ?
     LIMIT 1`,
    [fileId]
  );

  if (!rows?.length) {
    return { ok: false as const, status: 404, message: "File not found" };
  }

  const ownerId = Number(rows[0].ownerId);
  if (!Number.isFinite(ownerId)) {
    return { ok: false as const, status: 500, message: "Invalid file owner" };
  }

  if (ownerId !== authUserId && !canAccessAnyProject(req)) {
    return { ok: false as const, status: 403, message: "Forbidden" };
  }

  return {
    ok: true as const,
    fileId,
    projectId: Number(rows[0].projectId),
    ownerId,
  };
}

const parseCsvStream = (filePath: string, fileName: string, config: UploadConfig) =>
  new Promise<ParsedFile>((resolve, reject) => {
    const rows: any[] = [];
    let columns: string[] = [];
    let rowCount = 0;
    let settled = false;

    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      if (err) reject(err);
      else resolve({ columns, rows });
    };

    const stream = fs.createReadStream(filePath);
    const parser = csvParse({
      columns: true,
      bom: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
    });

    stream.on("error", (err) => finish(err));
    parser.on("error", (err) => finish(err instanceof Error ? err : new Error(String(err))));

    parser.on("data", (record: Record<string, any>) => {
      if (!columns.length) {
        columns = Object.keys(record || {});
      }
      rowCount += 1;
      if (rowCount > config.maxRows) {
        const err = new Error(`Too many rows (max ${config.maxRows}).`);
        stream.destroy(err);
        parser.destroy(err);
        return;
      }
      rows.push(record);
    });

    parser.on("end", () => finish());

    stream.pipe(parser);
  });

const parseFile = async (
  file: Express.Multer.File,
  uploadConfig: UploadConfig
): Promise<ParsedFile> => {
  const ext = path.extname(file.originalname).toLowerCase();

  if (ext === ".csv") {
    return parseCsvStream(file.path, file.originalname, uploadConfig);
  }

  if (ext === ".xlsx" || ext === ".xls") {
    const workbook = XLSX.readFile(file.path);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(worksheet, { defval: "-" });
    const headerRow = XLSX.utils.sheet_to_json(worksheet, { header: 1 })[0] as string[] | undefined;
    const columns = headerRow || (rows[0] ? Object.keys(rows[0] as Record<string, unknown>) : []);
    return { columns, rows };
  }

  throw new Error(`Unsupported file type: ${file.originalname}`);
};

const normalizeValue = (value: any) => {
  if (value === null || value === undefined) return "";
  const str = String(value).trim();
  if (!str || str === "-" || str.toLowerCase() === "null" || str.toLowerCase() === "nan") {
    return "";
  }
  return str;
};

const isNumeric = (value: string) => /^-?\d+(\.\d+)?$/.test(value);

const computeQualityMetrics = (columns: string[], rows: any[]): QualityMetrics => {
  const totalRows = rows.length;
  const totalColumns = columns.length;
  if (totalRows === 0 || totalColumns === 0) {
    return {
      score: 0,
      trustLevel: "Low",
      missingRate: 1,
      duplicateRate: 0,
      invalidRate: 0,
      schemaInconsistencyRate: 0,
      totalRows,
      totalColumns,
    };
  }

  let missingCount = 0;
  let duplicateCount = 0;
  let extraKeyRows = 0;
  const signatures = new Map<string, number>();

  const numericStats = columns.map(() => ({ numeric: 0, nonMissing: 0, invalid: 0 }));

  for (const row of rows) {
    const rowObj = row && typeof row === "object" ? row : {};
    const keys = Object.keys(rowObj);
    if (keys.some((k) => !columns.includes(k))) {
      extraKeyRows += 1;
    }

    const signatureParts: string[] = [];
    columns.forEach((col, idx) => {
      const value = normalizeValue(rowObj[col]);
      signatureParts.push(value);
      if (!value) {
        missingCount += 1;
        return;
      }
      numericStats[idx].nonMissing += 1;
      if (isNumeric(value)) {
        numericStats[idx].numeric += 1;
      }
    });

    const signature = signatureParts.join("|");
    const prev = signatures.get(signature) || 0;
    signatures.set(signature, prev + 1);
  }

  signatures.forEach((count) => {
    if (count > 1) duplicateCount += count - 1;
  });

  let invalidCount = 0;
  let numericCells = 0;
  for (let i = 0; i < columns.length; i++) {
    const stat = numericStats[i];
    if (stat.nonMissing === 0) continue;
    const numericRatio = stat.numeric / stat.nonMissing;
    if (numericRatio >= 0.7) {
      numericCells += stat.nonMissing;
    }
  }

  if (numericCells > 0) {
    for (const row of rows) {
      const rowObj = row && typeof row === "object" ? row : {};
      columns.forEach((col, idx) => {
        const stat = numericStats[idx];
        if (stat.nonMissing === 0) return;
        const numericRatio = stat.numeric / stat.nonMissing;
        if (numericRatio < 0.7) return;
        const value = normalizeValue(rowObj[col]);
        if (!value) return;
        if (!isNumeric(value)) invalidCount += 1;
      });
    }
  }

  const missingRate = totalRows && totalColumns ? missingCount / (totalRows * totalColumns) : 0;
  const duplicateRate = totalRows ? duplicateCount / totalRows : 0;
  const invalidRate = numericCells ? invalidCount / numericCells : 0;
  const schemaInconsistencyRate = totalRows ? extraKeyRows / totalRows : 0;

  const penalty =
    missingRate * 40 +
    duplicateRate * 20 +
    invalidRate * 20 +
    schemaInconsistencyRate * 20;
  const score = Math.max(0, Math.min(100, Math.round((100 - penalty * 100) * 10) / 10));
  const trustLevel = score >= 80 ? "High" : score >= 50 ? "Medium" : "Low";

  return {
    score,
    trustLevel,
    missingRate,
    duplicateRate,
    invalidRate,
    schemaInconsistencyRate,
    totalRows,
    totalColumns,
  };
};

const ensureQualityTable = async (dbPool: Pool) => {
  await dbPool.query(
    `CREATE TABLE IF NOT EXISTS data_quality_scores (
      id INT AUTO_INCREMENT PRIMARY KEY,
      file_id INT NOT NULL UNIQUE,
      score DECIMAL(5,2) NOT NULL,
      trust_level VARCHAR(16) NOT NULL,
      missing_rate DECIMAL(6,4) NOT NULL DEFAULT 0,
      duplicate_rate DECIMAL(6,4) NOT NULL DEFAULT 0,
      invalid_rate DECIMAL(6,4) NOT NULL DEFAULT 0,
      schema_inconsistency_rate DECIMAL(6,4) NOT NULL DEFAULT 0,
      total_rows INT NOT NULL DEFAULT 0,
      total_columns INT NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
    ) ENGINE=InnoDB`
  );
};

const toPositiveInt = (value: string | undefined, fallback: number) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
};

const insertRowsInBatches = async (
  connection: any,
  fileId: number,
  rows: any[],
  encryptionKey: string | null
) => {
  if (!rows.length) return;

  const batchSize = toPositiveInt(process.env.UPLOAD_ROW_BATCH_SIZE, 400);
  for (let start = 0; start < rows.length; start += batchSize) {
    const end = Math.min(rows.length, start + batchSize);
    const chunk = rows.slice(start, end);

    const valuesSql: string[] = [];
    const params: any[] = [];

    for (let i = 0; i < chunk.length; i += 1) {
      const rowIndex = start + i;
      const rowJson = JSON.stringify(chunk[i]);

      if (encryptionKey) {
        valuesSql.push("(?, ?, AES_ENCRYPT(?, ?))");
        params.push(fileId, rowIndex, rowJson, encryptionKey);
      } else {
        valuesSql.push("(?, ?, ?)");
        params.push(fileId, rowIndex, rowJson);
      }
    }

    const sql = `INSERT INTO file_rows (file_id, row_index, data_json) VALUES ${valuesSql.join(", ")}`;
    await connection.query(sql, params);
  }
};

const ingestFiles = async (
  dbPool: Pool,
  projectId: number,
  files: IngestFileInput[],
  uploadSchema: ReturnType<typeof resolveUploadSchema>,
  options: { emitNotifications?: boolean } = {}
) => {
  if (!files || files.length === 0) {
    throw new Error("Missing files");
  }

  const uploadConfig = getUploadConfig();
  const encryptionKey = getEncryptionKey();
  const overallStart = Date.now();
  const createdFiles: any[] = [];
  const emitNotifications = options.emitNotifications !== false;
  const settings = emitNotifications ? await getNotificationSettings(dbPool) : null;
  await ensureQualityTable(dbPool);

  const committedPaths = new Set<string>();
  const usedNames = new Set<string>();
  const resolveUniqueName = async (
    connection: any,
    projectIdArg: number,
    desired: string
  ): Promise<string> => {
    const normalized = desired.trim();
    if (!usedNames.has(normalized)) {
      const [[existing]]: any = await connection.query(
        "SELECT id FROM files WHERE project_id = ? AND name = ? LIMIT 1",
        [projectIdArg, normalized]
      );
      if (!existing?.id) {
        usedNames.add(normalized);
        return normalized;
      }
    }

    const ext = path.extname(normalized);
    const base = ext ? normalized.slice(0, -ext.length) : normalized;
    for (let i = 2; i <= 50; i += 1) {
      const candidate = `${base} (${i})${ext}`;
      if (usedNames.has(candidate)) continue;
      const [[existing]]: any = await connection.query(
        "SELECT id FROM files WHERE project_id = ? AND name = ? LIMIT 1",
        [projectIdArg, candidate]
      );
      if (!existing?.id) {
        usedNames.add(candidate);
        return candidate;
      }
    }
    throw new Error(`File name already exists: ${normalized}`);
  };

  try {
    const prepared: Array<{
      file: IngestFileInput;
      safeName: string;
      fileType: string;
      columns: string[];
      rows: any[];
      quality: QualityMetrics;
      profile: FileProfile;
      timings: FileTimings;
    }> = [];

    for (const file of files) {
      const fileStart = Date.now();
      const safeName = sanitizeFileName(file.originalname);
      const fileType = path.extname(safeName).replace(".", "").toLowerCase() || "unknown";

      const scanResult = await scanFileForMalware(file.path, uploadConfig);
      if (!scanResult.clean) {
        await fsPromises.unlink(file.path).catch(() => undefined);
        throw new Error(scanResult.error || "Malware scan failed");
      }

      const parsed = await parseFile(file as Express.Multer.File, uploadConfig);
      const parseMs = Date.now() - fileStart;
      const normalized = validateAndNormalizeData(parsed.columns, parsed.rows, uploadSchema, uploadConfig);
      const validateMs = Date.now() - fileStart - parseMs;
      const quality = computeQualityMetrics(normalized.columns, normalized.rows);
      const profile = buildFileProfile(normalized.columns, normalized.rows);
      const qualityMs = Date.now() - fileStart - parseMs - validateMs;
      const totalMs = Date.now() - fileStart;
      console.log(
        `[ingest] parsed ${file.originalname} rows=${normalized.rows.length} cols=${normalized.columns.length} ` +
          `parse=${parseMs}ms validate=${validateMs}ms quality=${qualityMs}ms`
      );
      prepared.push({
        file,
        safeName,
        fileType,
        columns: normalized.columns,
        rows: normalized.rows,
        quality,
        profile,
        timings: {
          parseMs,
          validateMs,
          qualityMs,
          dbMs: 0,
          totalMs,
        },
      });
    }

    const metricsByFile: Array<{
      fileName: string;
      rows: number;
      columns: number;
      timings: FileTimings;
    }> = [];

    for (const entry of prepared) {
      const commitStart = Date.now();
      const connection = await dbPool.getConnection();
      let uniqueNameForMetrics = entry.safeName;
      try {
        await connection.beginTransaction();

        const uniqueName = await resolveUniqueName(connection, projectId, entry.safeName);
        uniqueNameForMetrics = uniqueName;

        const [fileResult]: any = await connection.query(
          "INSERT INTO files (project_id, name, file_type, storage_path, text_content, uploaded_at) VALUES (?, ?, ?, ?, ?, NOW())",
          [projectId, uniqueName, entry.fileType, entry.file.path, null]
        );
        const fileId = fileResult.insertId as number;

        if (entry.columns.length > 0) {
          for (let i = 0; i < entry.columns.length; i++) {
            await connection.query(
              "INSERT INTO file_columns (file_id, name, position) VALUES (?, ?, ?)",
              [fileId, entry.columns[i], i]
            );
          }
        }

        if (entry.rows.length > 0) {
          await insertRowsInBatches(connection, fileId, entry.rows, encryptionKey);
        }

        await connection.query(
          `INSERT INTO data_quality_scores
            (file_id, score, trust_level, missing_rate, duplicate_rate, invalid_rate, schema_inconsistency_rate, total_rows, total_columns)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
            score = VALUES(score),
            trust_level = VALUES(trust_level),
            missing_rate = VALUES(missing_rate),
            duplicate_rate = VALUES(duplicate_rate),
            invalid_rate = VALUES(invalid_rate),
            schema_inconsistency_rate = VALUES(schema_inconsistency_rate),
            total_rows = VALUES(total_rows),
            total_columns = VALUES(total_columns),
            updated_at = CURRENT_TIMESTAMP`,
          [
            fileId,
            entry.quality.score,
            entry.quality.trustLevel,
            entry.quality.missingRate,
            entry.quality.duplicateRate,
            entry.quality.invalidRate,
            entry.quality.schemaInconsistencyRate,
            entry.quality.totalRows,
            entry.quality.totalColumns,
          ]
        );

        await ensureFileProfileTable(dbPool);
        await saveFileProfile(connection, fileId, entry.profile);

        await connection.commit();
        committedPaths.add(entry.file.path);

        createdFiles.push({
          id: fileId,
          name: uniqueName,
          fileType: entry.fileType,
          uploadedAt: new Date().toISOString(),
          qualityScore: entry.quality.score,
          trustLevel: entry.quality.trustLevel,
        });

        if (settings?.in_app_enabled) {
          await connection.query(
            "INSERT INTO notifications (type, channel, message, metadata) VALUES (?, ?, ?, ?)",
            [
              "upload_success",
              "system",
              `File uploaded: ${uniqueName}`,
              JSON.stringify({ fileId, fileName: uniqueName, projectId }),
            ]
          );
        }
      } catch (err) {
        await connection.rollback();
        throw err;
      } finally {
        connection.release();
      }
      const commitMs = Date.now() - commitStart;
      entry.timings.dbMs = commitMs;
      entry.timings.totalMs += commitMs;
      console.log(
        `[ingest] committed ${entry.safeName} rows=${entry.rows.length} cols=${entry.columns.length} db=${commitMs}ms`
      );
      metricsByFile.push({
        fileName: uniqueNameForMetrics,
        rows: entry.rows.length,
        columns: entry.columns.length,
        timings: entry.timings,
      });
    }

    const totalMs = Date.now() - overallStart;
    console.log(
      `[ingest] upload complete files=${prepared.length} created=${createdFiles.length} total=${totalMs}ms`
    );
    return {
      files: createdFiles,
      metrics: {
        totalMs,
        files: metricsByFile,
      },
    };
  } catch (err: any) {
    console.error("Upload error:", err);
    await Promise.all(
      files.map((file) => {
        if (committedPaths.has(file.path)) return Promise.resolve();
        return fsPromises.unlink(file.path).catch(() => undefined);
      })
    );
    if (settings?.in_app_enabled) {
      try {
        await dbPool.execute(
          "INSERT INTO notifications (type, channel, message, metadata) VALUES (?, ?, ?, ?)",
          [
            "upload_error",
            "system",
            "File upload failed",
            JSON.stringify({ error: err?.message || String(err) }),
          ]
        );
      } catch {
        // ignore notification failure
      }
    }
    const message = err?.message || String(err);
    const isValidationError =
      /invalid|missing|unexpected|unsupported|malware|scan|clamscan|enoent|too many/i.test(message);
    const error: any = new Error(message);
    (error as any).statusCode = isValidationError ? 400 : 500;
    throw error;
  }
};

// List files for a project (GET /api/files?projectId=...)
export const listFiles = (dbPool: Pool) => async (req: Request, res: Response) => {
  const rawProjectId = req.query.projectId as string | undefined;
  const rawCardId = req.query.cardId as string | undefined;

  // Resolve projectId; many callers pass cardId by mistake
  let projectIdNum: number | null = null;
  try {
    if (rawProjectId) {
      const n = Number(rawProjectId);
      projectIdNum = Number.isFinite(n) ? n : null;
    } else if (rawCardId) {
      const cardNum = Number(rawCardId);
      if (Number.isFinite(cardNum)) {
        const [rows]: any = await dbPool.query(
          "SELECT project_id FROM cards WHERE id = ? LIMIT 1",
          [cardNum]
        );
        projectIdNum = rows?.[0]?.project_id ?? null;
      }
    }

    if (!projectIdNum) {
      return res.status(400).json({ message: "Missing or invalid projectId/cardId" });
    }

    const access = await requireProjectAccess(dbPool, projectIdNum, req);
    if (!access.ok) {
      return res.status(access.status).json({ message: access.message });
    }

    await ensureQualityTable(dbPool);
    const [rows]: any = await dbPool.query(
      `SELECT f.id, f.name, f.file_type as fileType, f.uploaded_at as uploadedAt,
              q.score as qualityScore, q.trust_level as trustLevel
       FROM files f
       LEFT JOIN data_quality_scores q ON q.file_id = f.id
       WHERE f.project_id = ?
       ORDER BY f.uploaded_at DESC`,
      [projectIdNum]
    );
    res.json({ files: rows });
  } catch {
    res.status(500).json({ message: "Database error." });
  }
};

// Upload files (POST /api/files/upload)
export const uploadFiles = (dbPool: Pool) => async (req: Request, res: Response) => {
  const authUserId = req.user?.id;
  if (!authUserId) return res.status(401).json({ message: "Unauthorized" });

  const { projectId: rawProjectId, cardId: rawCardId } = req.body || {};
  const uploadSchema = resolveUploadSchema(req.body || {});

  // Accept either projectId or cardId; resolve to projectId
  let projectId: number | null = null;
  if (rawProjectId != null) {
    const n = Number(rawProjectId);
    projectId = Number.isFinite(n) ? n : null;
  } else if (rawCardId != null) {
    const cardNum = Number(rawCardId);
    if (Number.isFinite(cardNum)) {
      try {
        const [rows]: any = await dbPool.query(
          "SELECT project_id FROM cards WHERE id = ? LIMIT 1",
          [cardNum]
        );
        projectId = rows?.[0]?.project_id ?? null;
      } catch {
        projectId = null;
      }
    }
  }

  if (!req.files || !Array.isArray(req.files) || !projectId) {
    return res.status(400).json({ message: "Missing files or projectId/cardId" });
  }

  try {
    const access = await requireProjectAccess(dbPool, projectId, req);
    if (!access.ok) {
      return res.status(access.status).json({ message: access.message });
    }
    const result = await ingestFiles(dbPool, projectId, req.files as Express.Multer.File[], uploadSchema);
    res.json(result);
  } catch (err: any) {
    const status = err?.statusCode && Number.isFinite(err.statusCode) ? err.statusCode : 500;
    res.status(status).json({ message: err?.message || "Upload failed", error: err?.message || err });
  }
};

export const ingestFilesFromDisk = async (
  dbPool: Pool,
  projectId: number,
  files: IngestFileInput[]
) => {
  const uploadSchema = resolveUploadSchema({});
  return ingestFiles(dbPool, projectId, files, uploadSchema, { emitNotifications: false });
};

// Get file data (GET /api/files/:fileId/data)
export const getFileData = (dbPool: Pool) => async (req: Request, res: Response) => {
  const { fileId } = req.params;
  try {
    const access = await requireFileAccess(dbPool, fileId, req);
    if (!access.ok) {
      return res.status(access.status).json({ message: access.message });
    }

    const encryptionKey = getEncryptionKey();
    const dataJsonExpr = buildDataJsonExpr(encryptionKey);
    await ensureQualityTable(dbPool);
    const [fileRows]: any = await dbPool.query(
      `SELECT f.text_content as textContent, q.score as qualityScore, q.trust_level as trustLevel,
              q.missing_rate as missingRate, q.duplicate_rate as duplicateRate, q.invalid_rate as invalidRate,
              q.schema_inconsistency_rate as schemaInconsistencyRate
       FROM files f
       LEFT JOIN data_quality_scores q ON q.file_id = f.id
       WHERE f.id = ?`,
      [access.fileId]
    );
    const textContent = fileRows?.[0]?.textContent || null;
    const quality = fileRows?.[0]
      ? {
          qualityScore: fileRows[0].qualityScore,
          trustLevel: fileRows[0].trustLevel,
          missingRate: fileRows[0].missingRate,
          duplicateRate: fileRows[0].duplicateRate,
          invalidRate: fileRows[0].invalidRate,
          schemaInconsistencyRate: fileRows[0].schemaInconsistencyRate,
        }
      : null;

    const [colRows]: any = await dbPool.query(
      "SELECT name FROM file_columns WHERE file_id = ? ORDER BY position ASC",
      [access.fileId]
    );
    const columns = colRows.map((c: any) => c.name);

    const [rowRows]: any = await dbPool.query(
      `SELECT ${dataJsonExpr} as data_json FROM file_rows WHERE file_id = ? ORDER BY row_index ASC`,
      [...buildKeyParams(encryptionKey, 1), access.fileId]
    );
    const rows = rowRows.map((r: any) => JSON.parse(r.data_json));

    res.json({ columns, rows, textContent, quality });
  } catch (err) {
    res.status(500).json({ message: "Database error", error: err });
  }
};

// Get file metadata (GET /api/files/:fileId/meta)
export const getFileMeta = (dbPool: Pool) => async (req: Request, res: Response) => {
  const { fileId } = req.params;
  try {
    const access = await requireFileAccess(dbPool, fileId, req);
    if (!access.ok) {
      return res.status(access.status).json({ message: access.message });
    }

    const [rows]: any = await dbPool.query(
      `SELECT id, name, project_id as projectId, file_type as fileType, uploaded_at as uploadedAt
       FROM files
       WHERE id = ?
       LIMIT 1`,
      [access.fileId]
    );
    const row = rows?.[0];
    if (!row) {
      return res.status(404).json({ message: "File not found" });
    }
    res.json(row);
  } catch (err) {
    res.status(500).json({ message: "Database error", error: err });
  }
};

// Delete a file (DELETE /api/files/:fileId)
export const deleteFile = (dbPool: Pool) => async (req: Request, res: Response) => {
  const { fileId } = req.params;
  try {
    const access = await requireFileAccess(dbPool, fileId, req);
    if (!access.ok) {
      return res.status(access.status).json({ message: access.message });
    }

    await dbPool.query("DELETE FROM files WHERE id = ?", [access.fileId]);
    res.json({ message: "File deleted" });
  } catch (err) {
    res.status(500).json({ message: "Database error", error: err });
  }
};

// Update file columns (PATCH /api/files/:fileId/columns)
export const updateFileColumns = (dbPool: Pool) => async (req: Request, res: Response) => {
  const { fileId } = req.params;
  const { columns, renameMap } = req.body || {};
  const encryptionKey = getEncryptionKey();
  const dataJsonExpr = buildDataJsonExpr(encryptionKey);

  if (!Array.isArray(columns)) {
    return res.status(400).json({ message: "columns must be an array" });
  }

  const access = await requireFileAccess(dbPool, fileId, req);
  if (!access.ok) {
    return res.status(access.status).json({ message: access.message });
  }

  const normalized = columns
    .map((c: any) => String(c || "").trim())
    .filter(Boolean);

  if (normalized.length === 0) {
    return res.status(400).json({ message: "At least one column is required" });
  }

  const unique = new Set(normalized.map(c => c.toLowerCase()));
  if (unique.size !== normalized.length) {
    return res.status(400).json({ message: "Column names must be unique" });
  }

  const renameEntries = renameMap && typeof renameMap === "object" ? Object.entries(renameMap) : [];
  const reverseRename = new Map<string, string>();
  for (const [oldName, newName] of renameEntries) {
    if (typeof oldName !== "string" || typeof newName !== "string") continue;
    const cleanedNew = newName.trim();
    if (!cleanedNew) continue;
    reverseRename.set(cleanedNew, oldName);
  }

  const connection = await dbPool.getConnection();
  try {
    await connection.beginTransaction();

    const [oldColRows]: any = await connection.query(
      "SELECT name FROM file_columns WHERE file_id = ? ORDER BY position ASC",
      [access.fileId]
    );
    const oldColumns = oldColRows.map((c: any) => c.name);

    const [rowRows]: any = await connection.query(
      `SELECT id, ${dataJsonExpr} as data_json FROM file_rows WHERE file_id = ? ORDER BY row_index ASC`,
      [...buildKeyParams(encryptionKey, 1), access.fileId]
    );

    for (const row of rowRows) {
      const data = JSON.parse(row.data_json || "{}");
      const nextRow: Record<string, any> = {};

      for (const col of normalized) {
        const oldName = reverseRename.get(col);
        if (oldName && Object.prototype.hasOwnProperty.call(data, oldName)) {
          nextRow[col] = data[oldName];
        } else if (Object.prototype.hasOwnProperty.call(data, col)) {
          nextRow[col] = data[col];
        } else {
          nextRow[col] = "-";
        }
      }

      const encrypted = buildEncryptedValue(JSON.stringify(nextRow), encryptionKey);
      await connection.query(
        `UPDATE file_rows SET data_json = ${encrypted.sql} WHERE id = ?`,
        [...encrypted.params, row.id]
      );
    }

    await connection.query("DELETE FROM file_columns WHERE file_id = ?", [access.fileId]);
    for (let i = 0; i < normalized.length; i++) {
      await connection.query(
        "INSERT INTO file_columns (file_id, name, position) VALUES (?, ?, ?)",
        [access.fileId, normalized[i], i]
      );
    }

    await connection.commit();
    res.json({ columns: normalized, previousColumns: oldColumns });
  } catch (err: any) {
    await connection.rollback();
    res.status(500).json({ message: "Failed to update columns", error: err?.message || err });
  } finally {
    connection.release();
  }
};

// Update file row values for a column (PATCH /api/files/:fileId/rows)
export const updateFileRows = (dbPool: Pool) => async (req: Request, res: Response) => {
  const { fileId } = req.params;
  const { column, updates } = req.body || {};
  const encryptionKey = getEncryptionKey();
  const dataJsonExpr = buildDataJsonExpr(encryptionKey);

  if (!column || typeof column !== "string") {
    return res.status(400).json({ message: "column is required" });
  }
  if (!Array.isArray(updates)) {
    return res.status(400).json({ message: "updates must be an array" });
  }

  const normalizedUpdates = updates
    .map((u: any) => ({
      rowIndex: Number(u?.rowIndex),
      value: u?.value ?? "-",
    }))
    .filter((u: any) => Number.isFinite(u.rowIndex) && u.rowIndex >= 0);

  if (normalizedUpdates.length === 0) {
    return res.status(400).json({ message: "No valid updates provided" });
  }

  const access = await requireFileAccess(dbPool, fileId, req);
  if (!access.ok) {
    return res.status(access.status).json({ message: access.message });
  }

  const connection = await dbPool.getConnection();
  try {
    await connection.beginTransaction();

    for (const update of normalizedUpdates) {
      const [rowRows]: any = await connection.query(
        `SELECT id, ${dataJsonExpr} as data_json FROM file_rows WHERE file_id = ? AND row_index = ? LIMIT 1`,
        [...buildKeyParams(encryptionKey, 1), access.fileId, update.rowIndex]
      );
      if (!rowRows?.length) continue;

      const row = rowRows[0];
      const data = JSON.parse(row.data_json || "{}");
      data[column] = update.value;
      const encrypted = buildEncryptedValue(JSON.stringify(data), encryptionKey);

      await connection.query(
        `UPDATE file_rows SET data_json = ${encrypted.sql} WHERE id = ?`,
        [...encrypted.params, row.id]
      );
    }

    await connection.commit();
    res.json({ ok: true });
  } catch (err: any) {
    await connection.rollback();
    res.status(500).json({ message: "Failed to update rows", error: err?.message || err });
  } finally {
    connection.release();
  }
};
