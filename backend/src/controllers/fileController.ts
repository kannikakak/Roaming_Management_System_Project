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

// List files for a project (GET /api/files?projectId=...)
export const listFiles = (dbPool: Pool) => async (req: Request, res: Response) => {
  const projectId = req.query.projectId || req.query.cardId;
  if (!projectId) {
    return res.status(400).json({ message: "Missing projectId" });
  }

  try {
    const [rows]: any = await dbPool.query(
      "SELECT id, name, file_type as fileType, uploaded_at as uploadedAt FROM files WHERE project_id = ? ORDER BY uploaded_at DESC",
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

  try {
    for (const file of req.files as Express.Multer.File[]) {
      const parsed = await parseFile(file);
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

        await connection.commit();

        createdFiles.push({
          id: fileId,
          name: file.originalname,
          fileType: path.extname(file.originalname).replace(".", "") || "unknown",
          uploadedAt: new Date().toISOString(),
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
    const [fileRows]: any = await dbPool.query(
      "SELECT text_content as textContent FROM files WHERE id = ?",
      [fileId]
    );
    const textContent = fileRows?.[0]?.textContent || null;

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

    res.json({ columns, rows, textContent });
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
