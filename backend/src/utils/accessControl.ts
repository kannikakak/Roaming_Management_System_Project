import { Request } from "express";
import { Pool } from "mysql2/promise";

type AccessFailure = {
  ok: false;
  status: number;
  message: string;
};

export type ProjectAccessResult =
  | {
      ok: true;
      ownerId: number;
    }
  | AccessFailure;

export type FileAccessResult =
  | {
      ok: true;
      fileId: number;
      projectId: number;
      ownerId: number;
    }
  | AccessFailure;

export type ProjectScopeResult =
  | {
      ok: true;
      projectIds: number[] | null;
    }
  | AccessFailure;

const toRoleList = (req: Request) => {
  const primary = req.user?.role;
  const roles = Array.isArray(req.user?.roles) ? req.user.roles : primary ? [primary] : [];
  return roles.filter(Boolean);
};

export const hasAnyRole = (req: Request, roles: string[]) => {
  const userRoles = toRoleList(req);
  return userRoles.some((role) => roles.includes(role));
};

export const canAccessAnyProject = (req: Request) => hasAnyRole(req, ["admin", "analyst"]);

export const requireProjectAccess = async (
  dbPool: Pool,
  projectId: number,
  req: Request
): Promise<ProjectAccessResult> => {
  const authUserId = req.user?.id;
  if (!authUserId) {
    return { ok: false, status: 401, message: "Unauthorized" };
  }
  if (!Number.isFinite(projectId) || projectId <= 0) {
    return { ok: false, status: 400, message: "Invalid projectId" };
  }

  const [rows]: any = await dbPool.query(
    "SELECT user_id FROM projects WHERE id = ? LIMIT 1",
    [projectId]
  );
  if (!rows?.length) {
    return { ok: false, status: 404, message: "Project not found" };
  }

  const ownerId = Number(rows[0].user_id);
  if (!Number.isFinite(ownerId)) {
    return { ok: false, status: 500, message: "Invalid project owner" };
  }

  if (ownerId !== authUserId && !canAccessAnyProject(req)) {
    return { ok: false, status: 403, message: "Forbidden" };
  }

  return { ok: true, ownerId };
};

export const requireFileAccess = async (
  dbPool: Pool,
  rawFileId: string | number,
  req: Request
): Promise<FileAccessResult> => {
  const authUserId = req.user?.id;
  if (!authUserId) {
    return { ok: false, status: 401, message: "Unauthorized" };
  }

  const fileId = Number(rawFileId);
  if (!Number.isFinite(fileId) || fileId <= 0) {
    return { ok: false, status: 400, message: "Invalid fileId" };
  }

  const [rows]: any = await dbPool.query(
    `SELECT f.id as fileId, f.project_id as projectId, p.user_id as ownerId
     FROM files f
     INNER JOIN projects p ON p.id = f.project_id
     WHERE f.id = ?
     LIMIT 1`,
    [fileId]
  );
  if (!rows?.length) {
    return { ok: false, status: 404, message: "File not found" };
  }

  const ownerId = Number(rows[0].ownerId);
  const projectId = Number(rows[0].projectId);
  if (!Number.isFinite(ownerId) || !Number.isFinite(projectId)) {
    return { ok: false, status: 500, message: "Invalid file owner" };
  }

  if (ownerId !== authUserId && !canAccessAnyProject(req)) {
    return { ok: false, status: 403, message: "Forbidden" };
  }

  return {
    ok: true,
    fileId,
    projectId,
    ownerId,
  };
};

export const getScopedProjectIds = async (
  dbPool: Pool,
  req: Request
): Promise<ProjectScopeResult> => {
  const authUserId = req.user?.id;
  if (!authUserId) {
    return { ok: false, status: 401, message: "Unauthorized" };
  }

  if (canAccessAnyProject(req)) {
    return { ok: true, projectIds: null };
  }

  const [rows]: any = await dbPool.query("SELECT id FROM projects WHERE user_id = ?", [authUserId]);
  const projectIds = (Array.isArray(rows) ? rows : [])
    .map((row: any) => Number(row?.id))
    .filter((id: number) => Number.isFinite(id) && id > 0);

  return { ok: true, projectIds };
};

export const normalizeProjectIds = (value: unknown) => {
  const normalized = Array.isArray(value) ? value : [];
  const ids = normalized
    .map((item) => Number(item))
    .filter((id) => Number.isFinite(id) && id > 0);
  return Array.from(new Set(ids));
};

export const pushProjectScopeCondition = (
  whereParts: string[],
  params: any[],
  fieldSql: string,
  projectIds: number[] | null
) => {
  if (projectIds === null) return;
  if (projectIds.length === 0) {
    whereParts.push("1 = 0");
    return;
  }
  const placeholders = projectIds.map(() => "?").join(", ");
  whereParts.push(`${fieldSql} IN (${placeholders})`);
  params.push(...projectIds);
};

