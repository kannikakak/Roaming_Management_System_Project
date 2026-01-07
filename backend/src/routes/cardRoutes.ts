import { Router } from 'express';
import { getCardById } from '../controllers/cardController';

export const cardRoutes = (dbPool: any) => {
  const router = Router();
  router.get('/:cardId', getCardById(dbPool));
  // Add more card-related routes here if needed
  return router;
};