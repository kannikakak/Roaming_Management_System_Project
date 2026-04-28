import { Router } from 'express';
import {
  getCardById,
  getCardsByProject,
  createCard,
  updateCard,
  deleteCard,
} from '../controllers/cardController';
import { requireAuth } from "../middleware/auth";

export const cardRoutes = (dbPool: any) => {
  const router = Router();
  router.use(requireAuth);
  router.get('/project/:projectId', getCardsByProject(dbPool));
  router.get('/:cardId', getCardById(dbPool));
  router.post('/', createCard(dbPool));
  router.put('/:cardId', updateCard(dbPool));
  router.delete('/:cardId', deleteCard(dbPool));
  return router;
};
