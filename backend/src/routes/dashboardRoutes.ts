import { Router } from 'express';
import { Pool } from 'mysql2/promise';
import { getDashboards, createDashboard, updateDashboard, deleteDashboard } from '../controllers/dashboardController';
import { listFiles } from '../controllers/fileController';
import { requireAuth, requireRole } from "../middleware/auth";

export const dashboardRoutes = (dbPool: Pool) => {
  const router = Router();
  router.use(requireAuth);
  router.get('/', getDashboards(dbPool));
  router.post('/', requireRole(["admin", "analyst"]), createDashboard(dbPool));
  router.put('/:id', requireRole(["admin", "analyst"]), updateDashboard(dbPool));
  router.delete('/:id', requireRole(["admin", "analyst"]), deleteDashboard(dbPool));
  router.get('/', listFiles(dbPool));
  return router;
};
