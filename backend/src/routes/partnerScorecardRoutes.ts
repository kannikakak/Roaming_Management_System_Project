import { Router } from "express";
import { Pool } from "mysql2/promise";
import { requireAuth } from "../middleware/auth";
import { getPartnerScorecard } from "../controllers/partnerScorecardController";

export const partnerScorecardRoutes = (dbPool: Pool) => {
  const router = Router();
  router.use(requireAuth);
  router.get("/", getPartnerScorecard(dbPool));
  return router;
};
