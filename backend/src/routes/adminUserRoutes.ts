import { Router } from "express";
import { Pool } from "mysql2/promise";
import { requireAuth, requireRole } from "../middleware/auth";
import { listUsers, updateUserRole, updateUserStatus, createUser, updateUser } from "../controllers/userAdminController";

export function adminUserRoutes(dbPool: Pool) {
  const router = Router();
  router.use(requireAuth, requireRole(["admin"]));

  router.get("/", listUsers(dbPool));
  router.post("/", createUser(dbPool));
  router.put(":id", updateUser(dbPool));
  router.put("/:id/role", updateUserRole(dbPool));
  router.put("/:id/status", updateUserStatus(dbPool));

  return router;
}
