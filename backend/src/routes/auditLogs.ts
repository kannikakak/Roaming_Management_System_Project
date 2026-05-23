import { Router } from "express";
import { createAuditLog, getAuditLogs, getMyAuditLogs } from "../controllers/auditLogsController";
import { requireAuth, requireRole } from "../middleware/auth";

export const auditLogsRoutes = () => {
  const router = Router();
  router.use(requireAuth);

  router.post("/", createAuditLog);
  router.get("/", requireRole(["admin"]), getAuditLogs);
  router.get("/me", getMyAuditLogs);

  return router;
};
