import { Router } from "express";
import { Pool } from "mysql2/promise";
import { requireAuth, requireRole } from "../middleware/auth";
import {
  createSource,
  listSources,
  scanSource,
  testSource,
  updateSource,
} from "../controllers/ingestionSourcesController";

export const ingestionSourceRoutes = (dbPool: Pool) => {
  const router = Router();
  router.use(requireAuth);
  router.get("/", listSources(dbPool));
  router.post("/", requireRole(["admin", "analyst"]), createSource(dbPool));
  router.put("/:id", requireRole(["admin", "analyst"]), updateSource(dbPool));
  router.post("/:id/test", requireRole(["admin", "analyst"]), testSource(dbPool));
  router.post("/:id/scan", requireRole(["admin", "analyst"]), scanSource(dbPool));
  return router;
};
