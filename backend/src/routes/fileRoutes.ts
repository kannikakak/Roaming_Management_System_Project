import { Router, Request, Response } from "express";
import multer from "multer";
import { Pool } from "mysql2/promise";
import {
  listFiles,
  uploadFiles,
  getFileData,
  getFileMeta,
  deleteFile,
  updateFileColumns,
  updateFileRows,
} from "../controllers/fileController";
import { requireAuth, requireRole } from "../middleware/auth";
import { createRateLimiter } from "../middleware/rateLimit";
import { getUploadConfig, isAllowedUpload } from "../utils/uploadValidation";

// Ensure the uploads directory exists
import fs from "fs";
import path from "path";
const uploadConfig = getUploadConfig();
const uploadDir = path.join(process.cwd(), "uploads", "files");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const upload = multer({
  dest: uploadDir,
  limits: {
    fileSize: uploadConfig.maxFileSizeBytes,
    files: uploadConfig.maxFiles,
  },
  fileFilter: (req, file, cb) => {
    if (!isAllowedUpload(file.originalname, file.mimetype, uploadConfig)) {
      return cb(new Error("Invalid file type. Only CSV or Excel files are allowed."));
    }
    return cb(null, true);
  },
});

export function fileRoutes(dbPool: Pool) {
  const router = Router();
  router.use(requireAuth);
  const uploadLimiter = createRateLimiter({
    windowMs: Number(process.env.FILE_UPLOAD_RATE_LIMIT_WINDOW_MS || 10 * 60 * 1000),
    max: Number(process.env.FILE_UPLOAD_RATE_LIMIT_MAX || 30),
  });

  // List files for a card
  router.get('/', listFiles(dbPool));

  // Upload files (multi)
  router.post(
    "/upload",
    requireRole(["admin", "analyst"]),
    uploadLimiter,
    (req, res, next) => {
      upload.array("files", uploadConfig.maxFiles)(req, res, (err: any) => {
        if (err) {
          const message = err.message || "Upload failed";
          return res.status(400).json({ message });
        }
        return next();
      });
    },
    uploadFiles(dbPool)
  );

  // Get file data
  router.get('/:fileId/data', getFileData(dbPool));

  // Get file metadata
  router.get('/:fileId/meta', getFileMeta(dbPool));

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
