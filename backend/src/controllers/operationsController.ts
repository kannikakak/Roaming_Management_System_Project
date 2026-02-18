import { Request, Response } from "express";
import { Pool } from "mysql2/promise";
import {
  getScopedProjectIds,
  requireProjectAccess,
} from "../utils/accessControl";
import { buildOperationsSnapshot } from "../services/operationsSnapshot";

const toOptionalPositiveInt = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
};
const toPositiveInt = (value: unknown, fallback: number, min: number, max: number) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
};

export const getOperationsSnapshot = (dbPool: Pool) => async (req: Request, res: Response) => {
  try {
    const requestedProjectId = toOptionalPositiveInt(req.query.projectId);
    if (req.query.projectId !== undefined && requestedProjectId === null) {
      return res.status(400).json({ message: "Invalid projectId" });
    }
    if (requestedProjectId) {
      const projectAccess = await requireProjectAccess(dbPool, requestedProjectId, req);
      if (!projectAccess.ok) {
        return res.status(projectAccess.status).json({ message: projectAccess.message });
      }
    }
    const staleThresholdHours = toPositiveInt(req.query.staleHours, 24, 1, 24 * 14);

    const scope = await getScopedProjectIds(dbPool, req);
    if (!scope.ok) {
      return res.status(scope.status).json({ message: scope.message });
    }
    const projectIds = requestedProjectId ? [requestedProjectId] : scope.projectIds;
    const snapshot = await buildOperationsSnapshot(dbPool, {
      projectIds,
      staleThresholdHours,
    });

    res.json(snapshot);
  } catch (error) {
    console.error("Failed to build operations snapshot", error);
    res.status(500).json({ message: "Failed to load operations snapshot.", error });
  }
};
