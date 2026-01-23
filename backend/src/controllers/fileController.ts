import { Request, Response } from "express";
import { Pool } from "mysql2/promise";
import fs from "fs/promises";
import path from "path";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import mammoth from "mammoth";
import { getNotificationSettings } from "../services/notificationSettings";

type ParsedFile = {
  columns: string[];
  rows: any[];
  textContent?: string;
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

const parseFile = async (file: Express.Multer.File): Promise<ParsedFile> => {
  const ext = path.extname(file.originalname).toLowerCase();

  if (ext === ".csv") {
    const text = await fs.readFile(file.path, "utf8");
    const result = Papa.parse(text, { header: true, skipEmptyLines: true });
    if (result.errors.length) {
      throw new Error(`Failed to parse CSV: ${file.originalname}`);
    }
    return {
      columns: result.meta.fields || [],
      rows: result.data as any[],
    };
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

  if (ext === ".txt") {
    const textContent = await fs.readFile(file.path, "utf8");
    return { columns: [], rows: [], textContent };
  }

  if (ext === ".docx") {
    const result = await mammoth.extractRawText({ path: file.path });
    return { columns: [], rows: [], textContent: result.value };
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

// List files for a project (GET /api/files?projectId=...)
export const listFiles = (dbPool: Pool) => async (req: Request, res: Response) => {
  const projectId = req.query.projectId || req.query.cardId;
  if (!projectId) {
    return res.status(400).json({ message: "Missing projectId" });
  }

  try {
    await ensureQualityTable(dbPool);
    const [rows]: any = await dbPool.query(
      `SELECT f.id, f.name, f.file_type as fileType, f.uploaded_at as uploadedAt,
              q.score as qualityScore, q.trust_level as trustLevel
       FROM files f
       LEFT JOIN data_quality_scores q ON q.file_id = f.id
       WHERE f.project_id = ?
       ORDER BY f.uploaded_at DESC`,
      [projectId]
    );
    res.json({ files: rows });
  } catch {
    res.status(500).json({ message: "Database error." });
  }
};

// Upload files (POST /api/files/upload)
export const uploadFiles = (dbPool: Pool) => async (req: Request, res: Response) => {
  const { projectId } = req.body;
  if (!req.files || !Array.isArray(req.files) || !projectId) {
    return res.status(400).json({ message: "Missing files or projectId" });
  }

  const createdFiles: any[] = [];
  const settings = await getNotificationSettings(dbPool);
  await ensureQualityTable(dbPool);

  try {
    for (const file of req.files as Express.Multer.File[]) {
      const parsed = await parseFile(file);
      const quality = computeQualityMetrics(parsed.columns, parsed.rows);
      const connection = await dbPool.getConnection();
      try {
        await connection.beginTransaction();

        const [fileResult]: any = await connection.query(
          "INSERT INTO files (project_id, name, file_type, storage_path, text_content, uploaded_at) VALUES (?, ?, ?, ?, ?, NOW())",
          [
            projectId,
            file.originalname,
            path.extname(file.originalname).replace(".", "") || "unknown",
            file.path,
            parsed.textContent || null,
          ]
        );
        const fileId = fileResult.insertId as number;

        if (parsed.columns.length > 0) {
          for (let i = 0; i < parsed.columns.length; i++) {
            await connection.query(
              "INSERT INTO file_columns (file_id, name, position) VALUES (?, ?, ?)",
              [fileId, parsed.columns[i], i]
            );
          }
        }

        if (parsed.rows.length > 0) {
          for (let i = 0; i < parsed.rows.length; i++) {
            await connection.query(
              "INSERT INTO file_rows (file_id, row_index, data_json) VALUES (?, ?, ?)",
              [fileId, i, JSON.stringify(parsed.rows[i])]
            );
          }
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
            quality.score,
            quality.trustLevel,
            quality.missingRate,
            quality.duplicateRate,
            quality.invalidRate,
            quality.schemaInconsistencyRate,
            quality.totalRows,
            quality.totalColumns,
          ]
        );

        await connection.commit();

        createdFiles.push({
          id: fileId,
          name: file.originalname,
          fileType: path.extname(file.originalname).replace(".", "") || "unknown",
          uploadedAt: new Date().toISOString(),
          qualityScore: quality.score,
          trustLevel: quality.trustLevel,
        });

        if (settings.in_app_enabled) {
          await connection.query(
            "INSERT INTO notifications (type, channel, message, metadata) VALUES (?, ?, ?, ?)",
            [
              "upload_success",
              "system",
              `File uploaded: ${file.originalname}`,
              JSON.stringify({ fileId, fileName: file.originalname, projectId }),
            ]
          );
        }
      } catch (err) {
        await connection.rollback();
        throw err;
      } finally {
        connection.release();
      }
    }

    res.json({ files: createdFiles });
  } catch (err: any) {
    console.error("Upload error:", err);
    if (settings.in_app_enabled) {
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
    res.status(500).json({ message: "Database error", error: err.message || err });
  }
};

// Get file data (GET /api/files/:fileId/data)
export const getFileData = (dbPool: Pool) => async (req: Request, res: Response) => {
  const { fileId } = req.params;
  try {
    await ensureQualityTable(dbPool);
    const [fileRows]: any = await dbPool.query(
      `SELECT f.text_content as textContent, q.score as qualityScore, q.trust_level as trustLevel,
              q.missing_rate as missingRate, q.duplicate_rate as duplicateRate, q.invalid_rate as invalidRate,
              q.schema_inconsistency_rate as schemaInconsistencyRate
       FROM files f
       LEFT JOIN data_quality_scores q ON q.file_id = f.id
       WHERE f.id = ?`,
      [fileId]
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
      [fileId]
    );
    const columns = colRows.map((c: any) => c.name);

    const [rowRows]: any = await dbPool.query(
      "SELECT data_json FROM file_rows WHERE file_id = ? ORDER BY row_index ASC",
      [fileId]
    );
    const rows = rowRows.map((r: any) => JSON.parse(r.data_json));

    res.json({ columns, rows, textContent, quality });
  } catch (err) {
    res.status(500).json({ message: "Database error", error: err });
  }
};

// Delete a file (DELETE /api/files/:fileId)
export const deleteFile = (dbPool: Pool) => async (req: Request, res: Response) => {
  const { fileId } = req.params;
  try {
    await dbPool.query("DELETE FROM files WHERE id = ?", [fileId]);
    res.json({ message: "File deleted" });
  } catch (err) {
    res.status(500).json({ message: "Database error", error: err });
  }
};

// Update file columns (PATCH /api/files/:fileId/columns)
export const updateFileColumns = (dbPool: Pool) => async (req: Request, res: Response) => {
  const { fileId } = req.params;
  const { columns, renameMap } = req.body || {};

  if (!Array.isArray(columns)) {
    return res.status(400).json({ message: "columns must be an array" });
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
      [fileId]
    );
    const oldColumns = oldColRows.map((c: any) => c.name);

    const [rowRows]: any = await connection.query(
      "SELECT id, data_json FROM file_rows WHERE file_id = ? ORDER BY row_index ASC",
      [fileId]
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

      await connection.query(
        "UPDATE file_rows SET data_json = ? WHERE id = ?",
        [JSON.stringify(nextRow), row.id]
      );
    }

    await connection.query("DELETE FROM file_columns WHERE file_id = ?", [fileId]);
    for (let i = 0; i < normalized.length; i++) {
      await connection.query(
        "INSERT INTO file_columns (file_id, name, position) VALUES (?, ?, ?)",
        [fileId, normalized[i], i]
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

  const connection = await dbPool.getConnection();
  try {
    await connection.beginTransaction();

    for (const update of normalizedUpdates) {
      const [rowRows]: any = await connection.query(
        "SELECT id, data_json FROM file_rows WHERE file_id = ? AND row_index = ? LIMIT 1",
        [fileId, update.rowIndex]
      );
      if (!rowRows?.length) continue;

      const row = rowRows[0];
      const data = JSON.parse(row.data_json || "{}");
      data[column] = update.value;

      await connection.query(
        "UPDATE file_rows SET data_json = ? WHERE id = ?",
        [JSON.stringify(data), row.id]
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
