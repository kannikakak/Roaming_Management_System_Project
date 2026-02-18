import { Request, Response } from "express";
import { Pool } from "mysql2/promise";
import { computePartnerScorecard } from "../services/partnerScorecard";
import { getScopedProjectIds, requireProjectAccess } from "../utils/accessControl";

const toOptionalNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};
const toOptionalScore = (value: unknown) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.max(0, Math.min(100, parsed));
};
const toOptionalString = (value: unknown) => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
};

export const getPartnerScorecard = (dbPool: Pool) => async (req: Request, res: Response) => {
  try {
    const authUserId = req.user?.id;
    if (!authUserId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const projectId = toOptionalNumber(req.query.projectId);
    const months = toOptionalNumber(req.query.months);
    const limit = toOptionalNumber(req.query.limit);
    const rowLimit = toOptionalNumber(req.query.rowLimit);
    const partnerSearch = toOptionalString(req.query.partner);
    const minScore = toOptionalScore(req.query.minScore);
    const sortBy = toOptionalString(req.query.sortBy);
    const sortDir = toOptionalString(req.query.sortDir);

    if (projectId) {
      const projectAccess = await requireProjectAccess(dbPool, projectId, req);
      if (!projectAccess.ok) {
        return res.status(projectAccess.status).json({ message: projectAccess.message });
      }
    }

    const scope = await getScopedProjectIds(dbPool, req);
    if (!scope.ok) {
      return res.status(scope.status).json({ message: scope.message });
    }
    const projectIds = projectId ? [projectId] : scope.projectIds;

    const response = await computePartnerScorecard(dbPool, {
      projectId,
      months,
      limit,
      rowLimit,
      projectIds,
      partnerSearch,
      minScore,
      sortBy,
      sortDir,
    });

    res.json(response);
  } catch (error) {
    console.error("Failed to build partner scorecard", error);
    res.status(500).json({
      message: "Failed to load partner scorecard.",
    });
  }
};
