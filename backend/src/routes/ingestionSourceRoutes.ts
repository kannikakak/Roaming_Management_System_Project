import { Router } from "express";
import { Pool } from "mysql2/promise";
import { requireAuth, requireRole } from "../middleware/auth";
import { createRateLimiter } from "../middleware/rateLimit";
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
  const ingestionLimiter = createRateLimiter({
    windowMs: Number(process.env.INGESTION_RATE_LIMIT_WINDOW_MS || 10 * 60 * 1000),
    max: Number(process.env.INGESTION_RATE_LIMIT_MAX || 20),
    keyBy: "ip-user",
    scope: "ingestion",
    message: "Too many ingestion requests. Please retry later.",
  });
  router.get("/", listSources(dbPool));
  router.post("/", ingestionLimiter, requireRole(["admin", "analyst"]), createSource(dbPool));
  router.put("/:id", ingestionLimiter, requireRole(["admin", "analyst"]), updateSource(dbPool));
  router.post("/:id/test", ingestionLimiter, requireRole(["admin", "analyst"]), testSource(dbPool));
  router.post("/:id/scan", ingestionLimiter, requireRole(["admin", "analyst"]), scanSource(dbPool));
  return router;
};
