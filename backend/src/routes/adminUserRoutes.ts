import { Router } from "express";
import { Pool } from "mysql2/promise";
import { requireAuth, requireRole } from "../middleware/auth";
import { listUsers, updateUserRole, updateUserStatus } from "../controllers/userAdminController";

export function adminUserRoutes(dbPool: Pool) {
  const router = Router();
  router.use(requireAuth, requireRole(["admin"]));

  router.get("/", listUsers(dbPool));
  router.put("/:id/role", updateUserRole(dbPool));
  router.put("/:id/status", updateUserStatus(dbPool));

  return router;
}
