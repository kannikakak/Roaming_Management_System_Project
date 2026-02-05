import { Router } from "express";
import { Pool } from "mysql2/promise";
import { requireAuth } from "../middleware/auth";
import { getFileQualitySummary } from "../controllers/dataQualityController";

export const dataQualityRoutes = (dbPool: Pool) => {
  const router = Router();
  router.use(requireAuth);
  router.get("/files/:fileId/summary", getFileQualitySummary(dbPool));
  return router;
};
