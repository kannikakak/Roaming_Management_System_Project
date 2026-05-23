import { Router } from "express";
import { Pool } from "mysql2/promise";
import {
  getCardById,
  getCardsByProject,
  createCard,
  updateCard,
  deleteCard,
} from "../controllers/cardController";
import { requireAuth } from "../middleware/auth";

export const cardRoutes = (dbPool: Pool) => {
  const router = Router();
  router.use(requireAuth);
  router.get('/project/:projectId', getCardsByProject(dbPool));
  router.get('/:cardId', getCardById(dbPool));
  router.post('/', createCard(dbPool));
  router.put('/:cardId', updateCard(dbPool));
  router.delete('/:cardId', deleteCard(dbPool));
  return router;
};
