import { Router, Request, Response } from 'express';
import multer from 'multer';
import { Pool } from 'mysql2/promise';
import { listFiles, uploadFiles, getFileData, saveFileData } from '../controllers/fileController';

// Ensure the uploads directory exists
import fs from 'fs';
const uploadDir = 'uploads/';
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

const upload = multer({ dest: uploadDir });

export function fileRoutes(dbPool: Pool) {
  const router = Router();

  // List files for a card
  router.get('/', listFiles(dbPool));

  // Upload files (multi)
  router.post('/upload', upload.array('files'), uploadFiles(dbPool));

  // Get file data
  router.get('/:fileId/data', getFileData(dbPool));

  // Save parsed file data (if needed)
  router.post('/save-data', saveFileData(dbPool));

  // Optional: Health check for debugging
  router.get('/health', (req: Request, res: Response) => {
    res.json({ status: 'ok' });
  });

  return router;
}