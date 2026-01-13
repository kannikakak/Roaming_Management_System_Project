import { Router } from "express";
import { Pool } from "mysql2/promise";
import {
  getProjects,
  createProject,
  updateProject,
  deleteProject,
} from "../controllers/projectController";
import { requireAuth, requireRole } from "../middleware/auth";

const projectRoutes = (dbPool: Pool) => {
  const router = Router();
  router.use(requireAuth);

  // GET /api/projects?user_id=1
  router.get("/", getProjects(dbPool));

  // POST /api/projects
  router.post("/", requireRole(["admin", "analyst"]), createProject(dbPool));

  // PUT /api/projects/:id
  router.put("/:id", requireRole(["admin", "analyst"]), updateProject(dbPool));

  // DELETE /api/projects/:id
  router.delete("/:id", requireRole(["admin", "analyst"]), deleteProject(dbPool));

  return router;
};

export default projectRoutes;
