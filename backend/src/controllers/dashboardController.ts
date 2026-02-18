import { Request, Response } from "express";
import { Pool } from "mysql2/promise";
import { buildDataJsonExpr, buildKeyParams, getEncryptionKey } from "../utils/dbEncryption";
import {
  extractRoamingSummary,
  getDateFromSummary,
  matchesFilterTerm,
  parseDateCandidate,
} from "../utils/roamingData";
import { computeDashboardInsights } from "../services/dashboardInsights";
import {
  canAccessAnyProject,
  getScopedProjectIds,
  pushProjectScopeCondition,
  requireProjectAccess,
} from "../utils/accessControl";

type Dashboard = {
  id: number;
  user_id: number;
  title: string;
  description: string;
  created_at: string;
  updated_at: string;
};

const toOptionalPositiveInt = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
};

const requireDashboardAccess = async (dbPool: Pool, dashboardId: number, req: Request) => {
  const authUserId = req.user?.id;
  if (!authUserId) {
    return { ok: false as const, status: 401, message: "Unauthorized" };
  }
  if (!Number.isFinite(dashboardId) || dashboardId <= 0) {
    return { ok: false as const, status: 400, message: "Invalid dashboard id" };
  }

  const [rows]: any = await dbPool.query(
    "SELECT user_id as userId FROM dashboards WHERE id = ? LIMIT 1",
    [dashboardId]
  );
  if (!rows?.length) {
    return { ok: false as const, status: 404, message: "Dashboard not found" };
  }

  const ownerId = Number(rows[0].userId);
  if (!Number.isFinite(ownerId)) {
    return { ok: false as const, status: 500, message: "Invalid dashboard owner" };
  }

  if (ownerId !== authUserId && !canAccessAnyProject(req)) {
    return { ok: false as const, status: 403, message: "Forbidden" };
  }

  return { ok: true as const, ownerId };
};

export const getDashboards = (dbPool: Pool) => async (req: Request, res: Response) => {
  const authUserId = req.user?.id;
  if (!authUserId) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const requestedUserId = toOptionalPositiveInt(req.query.user_id);
  if (requestedUserId && requestedUserId !== authUserId && !canAccessAnyProject(req)) {
    return res.status(403).json({ message: "Forbidden" });
  }

  const targetUserId = requestedUserId || authUserId;
  try {
    const [rows] = await dbPool.query(
      "SELECT * FROM dashboards WHERE user_id = ? ORDER BY created_at DESC",
      [targetUserId]
    );
    res.json(rows);
  } catch {
    res.status(500).json({ message: "Database error." });
  }
};

export const createDashboard = (dbPool: Pool) => async (req: Request, res: Response) => {
  const authUserId = req.user?.id;
  if (!authUserId) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const title = String(req.body?.title || "").trim();
  const description = req.body?.description == null ? null : String(req.body.description);
  if (!title) {
    return res.status(400).json({ message: "title is required" });
  }

  try {
    const [result]: any = await dbPool.query(
      "INSERT INTO dashboards (user_id, title, description) VALUES (?, ?, ?)",
      [authUserId, title, description]
    );
    const [dashboardRows] = await dbPool.query("SELECT * FROM dashboards WHERE id = ?", [result.insertId]);
    res.json((dashboardRows as Dashboard[])[0]);
  } catch {
    res.status(500).json({ message: "Database error." });
  }
};

export const updateDashboard = (dbPool: Pool) => async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const title = req.body?.title === undefined ? undefined : String(req.body.title).trim();
  const description =
    req.body?.description === undefined ? undefined : req.body.description == null ? null : String(req.body.description);

  if (!Number.isFinite(id) || id <= 0) {
    return res.status(400).json({ message: "Invalid dashboard id" });
  }
  if (title !== undefined && !title) {
    return res.status(400).json({ message: "title cannot be empty" });
  }
  if (title === undefined && description === undefined) {
    return res.status(400).json({ message: "No fields to update" });
  }

  try {
    const access = await requireDashboardAccess(dbPool, id, req);
    if (!access.ok) {
      return res.status(access.status).json({ message: access.message });
    }

    const fields: string[] = [];
    const values: any[] = [];
    if (title !== undefined) {
      fields.push("title = ?");
      values.push(title);
    }
    if (description !== undefined) {
      fields.push("description = ?");
      values.push(description);
    }
    values.push(id);

    await dbPool.query(`UPDATE dashboards SET ${fields.join(", ")} WHERE id = ?`, values);
    const [dashboardRows] = await dbPool.query("SELECT * FROM dashboards WHERE id = ?", [id]);
    res.json((dashboardRows as Dashboard[])[0]);
  } catch {
    res.status(500).json({ message: "Database error." });
  }
};

export const deleteDashboard = (dbPool: Pool) => async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    return res.status(400).json({ message: "Invalid dashboard id" });
  }

  try {
    const access = await requireDashboardAccess(dbPool, id, req);
    if (!access.ok) {
      return res.status(access.status).json({ message: access.message });
    }

    await dbPool.query("DELETE FROM dashboards WHERE id = ?", [id]);
    res.json({ message: "Deleted" });
  } catch {
    res.status(500).json({ message: "Database error." });
  }
};

const toPositiveInt = (value: string | undefined, fallback: number) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
};

const toDateKey = (value: Date) => value.toISOString().slice(0, 10);

export const getDashboardAnalytics = (dbPool: Pool) => async (req: Request, res: Response) => {
  const authUserId = req.user?.id;
  if (!authUserId) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  let scopedProjectIds: number[] | null = null;
  const requestedProjectId = toOptionalPositiveInt(req.query.projectId);
  try {
    if (requestedProjectId) {
      const projectAccess = await requireProjectAccess(dbPool, requestedProjectId, req);
      if (!projectAccess.ok) {
        return res.status(projectAccess.status).json({ message: projectAccess.message });
      }
    }
    const scope = await getScopedProjectIds(dbPool, req);
    if (!scope.ok) {
      return res.status(scope.status).json({ message: scope.message });
    }
    scopedProjectIds = requestedProjectId ? [requestedProjectId] : scope.projectIds;
  } catch (err) {
    console.error("dashboard analytics access check error", err);
    return res.status(500).json({ message: "Failed to validate analytics access." });
  }

  const startDate = typeof req.query.startDate === "string" ? req.query.startDate : undefined;
  const endDate = typeof req.query.endDate === "string" ? req.query.endDate : undefined;
  const partnerFilter = typeof req.query.partner === "string" ? req.query.partner.trim() : "";
  const countryFilter = typeof req.query.country === "string" ? req.query.country.trim() : "";
  const rowLimit = toPositiveInt(
    typeof req.query.rowLimit === "string" ? req.query.rowLimit : undefined,
    Number(process.env.DASHBOARD_ANALYTICS_ROW_LIMIT || 3000)
  );

  const encryptionKey = getEncryptionKey();
  const dataJsonExpr = buildDataJsonExpr(encryptionKey);

  const fileWhereParts: string[] = [];
  const fileWhereParams: any[] = [];
  if (startDate) {
    fileWhereParts.push("uploaded_at >= ?");
    fileWhereParams.push(startDate);
  }
  if (endDate) {
    fileWhereParts.push("uploaded_at <= ?");
    fileWhereParams.push(endDate);
  }
  pushProjectScopeCondition(fileWhereParts, fileWhereParams, "project_id", scopedProjectIds);
  const fileWhereClause = fileWhereParts.length ? `WHERE ${fileWhereParts.join(" AND ")}` : "";

  const joinedDateParts: string[] = [];
  const joinedDateParams: any[] = [];
  if (startDate) {
    joinedDateParts.push("f.uploaded_at >= ?");
    joinedDateParams.push(startDate);
  }
  if (endDate) {
    joinedDateParts.push("f.uploaded_at <= ?");
    joinedDateParams.push(endDate);
  }
  pushProjectScopeCondition(joinedDateParts, joinedDateParams, "p.id", scopedProjectIds);
  const joinedDateClause = joinedDateParts.length ? `WHERE ${joinedDateParts.join(" AND ")}` : "";

  try {
    const [uploadTrendRows]: any = await dbPool.query(
      `SELECT DATE(uploaded_at) AS day, COUNT(*) AS files
       FROM files
       ${fileWhereClause}
       GROUP BY DATE(uploaded_at)
       ORDER BY day ASC
       LIMIT 180`,
      fileWhereParams
    );

    const [projectRows]: any = await dbPool.query(
      `SELECT
          p.id,
          p.name,
          COUNT(DISTINCT f.id) AS fileCount,
          COUNT(fr.id) AS rowCount
        FROM projects p
        LEFT JOIN files f ON f.project_id = p.id
        LEFT JOIN file_rows fr ON fr.file_id = f.id
        ${joinedDateClause}
        GROUP BY p.id, p.name
        ORDER BY rowCount DESC
        LIMIT 12`,
      joinedDateParams
    );

    const rowWhereParts: string[] = [];
    const rowWhereParams: any[] = [];
    if (startDate) {
      rowWhereParts.push("f.uploaded_at >= ?");
      rowWhereParams.push(startDate);
    }
    if (endDate) {
      rowWhereParts.push("f.uploaded_at <= ?");
      rowWhereParams.push(endDate);
    }
    pushProjectScopeCondition(rowWhereParts, rowWhereParams, "f.project_id", scopedProjectIds);
    const rowWhereClause = rowWhereParts.length ? `WHERE ${rowWhereParts.join(" AND ")}` : "";

    const rowKeyParams = buildKeyParams(encryptionKey, 1);
    const [rowRows]: any = await dbPool.query(
      `SELECT
          fr.id AS rowId,
          fr.file_id AS fileId,
          f.name AS fileName,
          f.uploaded_at AS uploadedAt,
          p.id AS projectId,
          p.name AS projectName,
          ${dataJsonExpr} AS data_json
        FROM file_rows fr
        JOIN files f ON fr.file_id = f.id
        JOIN projects p ON f.project_id = p.id
        ${rowWhereClause}
        ORDER BY f.uploaded_at DESC
        LIMIT ?`,
      [...rowKeyParams, ...rowWhereParams, rowLimit]
    );

    const startBound = startDate ? parseDateCandidate(startDate) : null;
    const endBound = endDate ? parseDateCandidate(endDate) : null;

    const partnerCounts = new Map<string, number>();
    const countryCounts = new Map<string, number>();
    const rowTrendCounts = new Map<string, number>();
    const drilldown = new Map<string, Map<string, number>>();

    let rowsMatched = 0;

    for (const row of rowRows as any[]) {
      let parsed: any = {};
      try {
        parsed = JSON.parse(row.data_json || "{}");
      } catch {
        parsed = {};
      }

      const summary = extractRoamingSummary(parsed);

      if (partnerFilter && !matchesFilterTerm(summary.partner, parsed, partnerFilter)) {
        continue;
      }
      if (countryFilter && !matchesFilterTerm(summary.country, parsed, countryFilter)) {
        continue;
      }

      const summaryDate = getDateFromSummary(summary, parsed);
      const uploadedAtDate = parseDateCandidate(row.uploadedAt);
      const eventDate = summaryDate || uploadedAtDate;
      if (eventDate) {
        if (startBound && eventDate < startBound) continue;
        if (endBound && eventDate > endBound) continue;
      }

      rowsMatched += 1;

      const partner = summary.partner || "Unknown Partner";
      const country = summary.country || "Unknown Country";
      const dateKey = eventDate ? toDateKey(eventDate) : toDateKey(new Date(row.uploadedAt));

      partnerCounts.set(partner, (partnerCounts.get(partner) || 0) + 1);
      countryCounts.set(country, (countryCounts.get(country) || 0) + 1);
      rowTrendCounts.set(dateKey, (rowTrendCounts.get(dateKey) || 0) + 1);

      if (!drilldown.has(partner)) {
        drilldown.set(partner, new Map<string, number>());
      }
      const countryMap = drilldown.get(partner)!;
      countryMap.set(country, (countryMap.get(country) || 0) + 1);
    }

    const toSortedSeries = (map: Map<string, number>, topN: number) =>
      Array.from(map.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, topN)
        .map(([name, value]) => ({ name, value }));

    const rowTrend = Array.from(rowTrendCounts.entries())
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      .map(([day, rows]) => ({ day, rows }));

    const partnerDrilldown: Record<string, Array<{ name: string; value: number }>> = {};
    for (const [partner, countryMap] of drilldown.entries()) {
      partnerDrilldown[partner] = toSortedSeries(countryMap, 12);
    }

    res.json({
      filters: {
        startDate: startDate || null,
        endDate: endDate || null,
        partner: partnerFilter || null,
        country: countryFilter || null,
        projectId: requestedProjectId || null,
      },
      totals: {
        rowsScanned: (rowRows as any[]).length,
        rowsMatched,
      },
      uploadTrend: (uploadTrendRows as any[]).map((r) => ({
        day: r.day,
        files: Number(r.files) || 0,
      })),
      projectComparison: (projectRows as any[]).map((r) => ({
        id: r.id,
        name: r.name,
        fileCount: Number(r.fileCount) || 0,
        rowCount: Number(r.rowCount) || 0,
      })),
      rowTrend,
      partnerShare: toSortedSeries(partnerCounts, 8),
      countryShare: toSortedSeries(countryCounts, 8),
      partnerDrilldown,
    });
  } catch (err) {
    console.error("dashboard analytics error", err);
    res.status(500).json({ message: "Failed to compute dashboard analytics." });
  }
};

export const getDashboardInsights = (dbPool: Pool) => async (req: Request, res: Response) => {
  try {
    const authUserId = req.user?.id;
    if (!authUserId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const requestedProjectId = toOptionalPositiveInt(req.query.projectId);
    if (requestedProjectId) {
      const projectAccess = await requireProjectAccess(dbPool, requestedProjectId, req);
      if (!projectAccess.ok) {
        return res.status(projectAccess.status).json({ message: projectAccess.message });
      }
    }

    const scope = await getScopedProjectIds(dbPool, req);
    if (!scope.ok) {
      return res.status(scope.status).json({ message: scope.message });
    }
    const scopedProjectIds = requestedProjectId ? [requestedProjectId] : scope.projectIds;

    const startDate = typeof req.query.startDate === "string" ? req.query.startDate : undefined;
    const endDate = typeof req.query.endDate === "string" ? req.query.endDate : undefined;
    const partner = typeof req.query.partner === "string" ? req.query.partner : undefined;
    const country = typeof req.query.country === "string" ? req.query.country : undefined;
    const rowLimit = toPositiveInt(
      typeof req.query.rowLimit === "string" ? req.query.rowLimit : undefined,
      Number(process.env.DASHBOARD_INSIGHTS_ROW_LIMIT || process.env.DASHBOARD_ANALYTICS_ROW_LIMIT || 3500)
    );

    const insights = await computeDashboardInsights(dbPool, {
      startDate,
      endDate,
      partner,
      country,
      rowLimit,
      projectIds: scopedProjectIds,
    });
    res.json(insights);
  } catch (err) {
    console.error("dashboard insights error", err);
    res.status(500).json({ message: "Failed to compute dashboard insights." });
  }
};
