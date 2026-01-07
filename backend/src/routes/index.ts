import { Express } from 'express';
import { Pool } from 'mysql2/promise';
import { authRoutes } from './authRoutes';
import { dashboardRoutes } from './dashboardRoutes';
import { cardRoutes } from './cardRoutes';      // <-- add this
import { fileRoutes } from './fileRoutes';     
import { projectRoutes } from './projectRoutes';
 // <-- add this

export const setRoutes = (app: Express, dbPool: Pool) => {
  app.use('/api/auth', authRoutes(dbPool));
 app.use('/api/projects', projectRoutes(dbPool));
  app.use('/api/cards', cardRoutes(dbPool));    // <-- add this
  app.use('/api/files', fileRoutes(dbPool));    // <-- add this
};