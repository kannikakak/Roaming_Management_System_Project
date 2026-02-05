import { Router } from "express";
import { Pool } from "mysql2/promise";
import { requireAuth } from "../middleware/auth";
import { getOperationsSnapshot } from "../controllers/operationsController";

export const operationsRoutes = (dbPool: Pool) => {
  const router = Router();
  router.use(requireAuth);
  router.get("/snapshot", getOperationsSnapshot(dbPool));
  return router;
};
