import { Router } from "express";
import { Pool } from "mysql2/promise";
import {
  createTemplate,
  getTemplates,
  getTemplateById,
  updateTemplate,
  deleteTemplate,
} from "../controllers/templateController";
import { requireAuth, requireRole } from "../middleware/auth";

export const templateRoutes = (dbPool: Pool) => {
  const router = Router();
  router.use(requireAuth);

  router.post("/", requireRole(["admin", "analyst"]), createTemplate(dbPool));
  router.get("/", getTemplates(dbPool));
  router.get("/:id", getTemplateById(dbPool));
  router.put("/:id", requireRole(["admin", "analyst"]), updateTemplate(dbPool));
  router.delete("/:id", requireRole(["admin"]), deleteTemplate(dbPool));

  return router;
};
