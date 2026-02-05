import { Router } from "express";
import { Pool } from "mysql2/promise";
import { requireAuth } from "../middleware/auth";
import { getLatestUploadImpact } from "../controllers/impactController";

export const impactRoutes = (dbPool: Pool) => {
  const router = Router();
  router.use(requireAuth);
  router.get("/projects/:projectId/latest", getLatestUploadImpact(dbPool));
  return router;
};
