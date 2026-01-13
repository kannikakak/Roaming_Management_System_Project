import { Router } from 'express';
import { getCardById } from '../controllers/cardController';
import { requireAuth } from "../middleware/auth";

export const cardRoutes = (dbPool: any) => {
  const router = Router();
  router.use(requireAuth);
  router.get('/:cardId', getCardById(dbPool));
  // Add more card-related routes here if needed
  return router;
};
