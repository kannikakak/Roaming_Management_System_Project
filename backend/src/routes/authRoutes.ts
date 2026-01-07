import { Router } from 'express';
import { register, login } from '../controllers/authController';
import { Pool } from 'mysql2/promise';

export const authRoutes = (dbPool: Pool) => {
  const router = Router();
  router.post('/register', register(dbPool));
  router.post('/login', login(dbPool));
  return router;
};