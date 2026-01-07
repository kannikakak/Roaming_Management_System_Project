import { Router } from 'express';
import { Pool } from 'mysql2/promise';
import { getProjects, createProject, updateProject, deleteProject } from '../controllers/projectController';

export const projectRoutes = (dbPool: Pool) => {
  const router = Router();
  router.get('/', getProjects(dbPool));
  router.post('/', createProject(dbPool));
  router.put('/:id', updateProject(dbPool));
  router.delete('/:id', deleteProject(dbPool));
  return router;
};