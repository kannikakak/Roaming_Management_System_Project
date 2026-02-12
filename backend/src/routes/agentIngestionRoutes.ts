import { Router } from "express";
import fs from "fs";
import path from "path";
import multer from "multer";
import { Pool } from "mysql2/promise";
import { createRateLimiter } from "../middleware/rateLimit";
import { requireAuth, requireRole } from "../middleware/auth";
import { getUploadConfig } from "../utils/uploadValidation";
import { agentUpload, listIngestionHistory } from "../controllers/agentIngestionController";

const uploadConfig = getUploadConfig();
const uploadDir = path.join(process.cwd(), "uploads", "agent-ingest");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const upload = multer({
  dest: uploadDir,
  limits: {
    fileSize: uploadConfig.maxFileSizeBytes,
    files: 1,
  },
});

export const agentIngestionRoutes = (dbPool: Pool) => {
  const router = Router();

  const agentUploadLimiter = createRateLimiter({
    windowMs: Number(process.env.AGENT_UPLOAD_RATE_LIMIT_WINDOW_MS || 60 * 1000),
    max: Number(process.env.AGENT_UPLOAD_RATE_LIMIT_MAX || 60),
    keyBy: "ip",
    scope: "agent-upload",
    message: "Too many agent uploads. Please retry shortly.",
  });

  const historyLimiter = createRateLimiter({
    windowMs: Number(process.env.INGESTION_HISTORY_RATE_LIMIT_WINDOW_MS || 60 * 1000),
    max: Number(process.env.INGESTION_HISTORY_RATE_LIMIT_MAX || 60),
    keyBy: "ip-user",
    scope: "ingestion-history",
    message: "Too many history requests. Please retry later.",
  });

  router.post(
    "/agent-upload",
    agentUploadLimiter,
    (req, res, next) => {
      upload.single("file")(req, res, (err: any) => {
        if (err) {
          return res.status(400).json({ message: err?.message || "Upload failed" });
        }
        return next();
      });
    },
    agentUpload(dbPool)
  );

  router.get(
    "/history",
    requireAuth,
    historyLimiter,
    requireRole(["admin", "analyst"]),
    listIngestionHistory(dbPool)
  );

  return router;
};
