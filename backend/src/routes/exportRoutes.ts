import { Router } from "express";
import { Pool } from "mysql2/promise";
import { requireAuth, requireRole } from "../middleware/auth";
import { exportData } from "../controllers/exportController";

export const exportRoutes = (dbPool: Pool) => {
  const router = Router();
  router.use(requireAuth);
  router.post("/data", requireRole(["admin", "analyst"]), exportData(dbPool));
  return router;
};
