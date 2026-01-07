// List files for a card (GET /api/files?cardId=...)
export const listFiles = (dbPool: Pool) => async (req: Request, res: Response) => {
  const { cardId } = req.query;
  try {
    const [rows]: any = await dbPool.query(
      'SELECT id, file_name as name, created_at as uploadedAt FROM files WHERE card_id = ? ORDER BY created_at DESC',
      [cardId]
    );
    res.json({ files: rows });
  } catch (err) {
    res.status(500).json({ message: 'Database error.' });
  }
};

// Upload files (POST /api/files/upload)
export const uploadFiles = (dbPool: Pool) => async (req: Request, res: Response) => {
  const { cardId } = req.body;
  if (!req.files || !Array.isArray(req.files) || !cardId) {
    return res.status(400).json({ message: 'Missing files or cardId', files: req.files, cardId });
  }
  try {
    for (const file of req.files as Express.Multer.File[]) {
      await dbPool.query(
        'INSERT INTO files (card_id, file_name, file_type, file_path, row_count, uploaded_by, created_at) VALUES (?, ?, ?, ?, ?, ?, NOW())',
        [cardId, file.originalname, file.mimetype, file.path, 0, 1]
      );
    }
    res.json({ message: 'Files uploaded' });
  } catch (err: any) {
    console.error('Upload error:', err);
    res.status(500).json({ message: 'Database error', error: err.message || err });
  }
};
// Get file data (GET /api/files/:fileId/data)
export const getFileData = (dbPool: Pool) => async (req: Request, res: Response) => {
  const { fileId } = req.params;
  try {
    const [colRows]: any = await dbPool.query('SELECT column_name FROM columns WHERE file_id = ?', [fileId]);
    const columns = colRows.map((c: any) => c.column_name);
    const [rowRows]: any = await dbPool.query('SELECT row_data FROM file_rows WHERE file_id = ?', [fileId]);
    const rows = rowRows.map((r: any) => JSON.parse(r.row_data));
    res.json({ columns, rows });
  } catch (err) {
    res.status(500).json({ message: 'Database error', error: err });
  }
};
import { Request, Response } from 'express';
import { Pool } from 'mysql2/promise';

// Get files for a card
export const getFilesByCard = (dbPool: Pool) => async (req: Request, res: Response) => {
  const { card_id } = req.query;
  try {
    const [rows] = await dbPool.query('SELECT * FROM files WHERE card_id = ?', [card_id]);
    res.json(rows);
  } catch {
    res.status(500).json({ message: 'Database error.' });
  }
};

// Save parsed file data (columns and rows) for a card
export const saveFileData = (dbPool: Pool) => async (req: Request, res: Response) => {
  const { cardId, columns, rows } = req.body;
  if (!cardId || !columns || !rows) {
    return res.status(400).json({ message: 'Missing cardId, columns, or rows' });
  }
  try {
    // Insert file record
    const [fileResult]: any = await dbPool.query(
      'INSERT INTO files (card_id, file_name, file_type, file_path, row_count, uploaded_by, created_at) VALUES (?, ?, ?, ?, ?, ?, NOW())',
      [cardId, 'manual_upload', 'table', '', rows.length, 1]
    );
    const fileId = fileResult.insertId;
    // Insert columns
    for (const col of columns) {
      await dbPool.query(
        'INSERT INTO columns (file_id, column_name, data_type, is_visible, created_at) VALUES (?, ?, ?, ?, NOW())',
        [fileId, col, 'string', true]
      );
    }
    // Insert rows (as JSON, or you can normalize further)
    for (const row of rows) {
      await dbPool.query(
        'INSERT INTO file_rows (file_id, row_data, created_at) VALUES (?, ?, NOW())',
        [fileId, JSON.stringify(row)]
      );
    }
    res.json({ message: 'Data saved successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Database error', error: err });
  }
};