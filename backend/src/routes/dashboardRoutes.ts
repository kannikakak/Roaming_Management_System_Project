import { Router } from 'express';
import { Pool } from 'mysql2/promise';
import { getDashboards, createDashboard, updateDashboard, deleteDashboard } from '../controllers/dashboardController';
import { listFiles } from '../controllers/fileController';

export const dashboardRoutes = (dbPool: Pool) => {
  const router = Router();
  router.get('/', getDashboards(dbPool));
  router.post('/', createDashboard(dbPool));
  router.put('/:id', updateDashboard(dbPool));
  router.delete('/:id', deleteDashboard(dbPool));
  router.get('/', listFiles(dbPool));
  return router;
};