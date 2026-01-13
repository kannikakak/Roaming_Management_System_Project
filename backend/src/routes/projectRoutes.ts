import { Router } from "express";
import { Pool } from "mysql2/promise";
import {
  getProjects,
  createProject,
  updateProject,
  deleteProject,
} from "../controllers/projectController";

const projectRoutes = (dbPool: Pool) => {
  const router = Router();

  // GET /api/projects?user_id=1
  router.get("/", getProjects(dbPool));

  // POST /api/projects
  router.post("/", createProject(dbPool));

  // PUT /api/projects/:id
  router.put("/:id", updateProject(dbPool));

  // DELETE /api/projects/:id
  router.delete("/:id", deleteProject(dbPool));

  return router;
};

export default projectRoutes;
