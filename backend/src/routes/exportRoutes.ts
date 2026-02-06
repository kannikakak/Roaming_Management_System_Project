import { Router } from "express";
import { Pool } from "mysql2/promise";
import { requireAuth } from "../middleware/auth";
import { exportData } from "../controllers/exportController";

export const exportRoutes = (dbPool: Pool) => {
  const router = Router();
  router.use(requireAuth);
  router.post("/data", exportData(dbPool));
  return router;
};
