import { Router } from "express";
import { Pool } from "mysql2/promise";
import { globalSearch } from "../controllers/searchController";
import { requireAuth } from "../middleware/auth";

export const searchRoutes = (dbPool: Pool) => {
  const router = Router();
  router.use(requireAuth);
  router.get("/global", globalSearch(dbPool));
  return router;
};
