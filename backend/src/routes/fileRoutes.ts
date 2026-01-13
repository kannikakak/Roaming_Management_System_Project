import { Router, Request, Response } from "express";
import multer from "multer";
import { Pool } from "mysql2/promise";
import { listFiles, uploadFiles, getFileData, deleteFile, updateFileColumns, updateFileRows } from "../controllers/fileController";
import { requireAuth, requireRole } from "../middleware/auth";

// Ensure the uploads directory exists
import fs from "fs";
const uploadDir = "uploads/";
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

const upload = multer({ dest: uploadDir });

export function fileRoutes(dbPool: Pool) {
  const router = Router();
  router.use(requireAuth);

  // List files for a card
  router.get('/', listFiles(dbPool));

  // Upload files (multi)
  router.post('/upload', requireRole(["admin", "analyst"]), upload.array('files'), uploadFiles(dbPool));

  // Get file data
  router.get('/:fileId/data', getFileData(dbPool));

  // Delete file
  router.delete("/:fileId", requireRole(["admin", "analyst"]), deleteFile(dbPool));

  // Update columns
  router.patch("/:fileId/columns", requireRole(["admin", "analyst"]), updateFileColumns(dbPool));

  // Update rows
  router.patch("/:fileId/rows", requireRole(["admin", "analyst"]), updateFileRows(dbPool));

  // Optional: Health check for debugging
  router.get('/health', (req: Request, res: Response) => {
    res.json({ status: 'ok' });
  });

  return router;
}
