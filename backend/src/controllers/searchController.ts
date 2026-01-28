import { Request, Response } from "express";
import { Pool } from "mysql2/promise";
import { buildDataJsonExpr, buildKeyParams, getEncryptionKey } from "../utils/dbEncryption";
import {
  extractRoamingSummary,
  getDateFromSummary,
  matchesFilterTerm,
  parseDateCandidate,
  rowContainsTerm,
} from "../utils/roamingData";

const toPositiveInt = (value: string | undefined, fallback: number) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
};

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

const buildDateWhere = (
  alias: string,
  startDate?: string,
  endDate?: string
): { clause: string; params: any[] } => {
  const parts: string[] = [];
  const params: any[] = [];
  if (startDate) {
    parts.push(`${alias} >= ?`);
    params.push(startDate);
  }
  if (endDate) {
    parts.push(`${alias} <= ?`);
    params.push(endDate);
  }
  return {
    clause: parts.length ? parts.join(" AND ") : "",
    params,
  };
};

const toPreviewObject = (row: Record<string, any>) => {
  const entries = Object.entries(row || {}).filter(([, value]) =>
    value === null || value === undefined || ["string", "number", "boolean"].includes(typeof value)
  );
  const preview: Record<string, any> = {};
  for (const [key, value] of entries.slice(0, 6)) {
    preview[key] = value;
  }
  return preview;
};

export const globalSearch = (dbPool: Pool) => async (req: Request, res: Response) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const partner = typeof req.query.partner === "string" ? req.query.partner.trim() : "";
  const country = typeof req.query.country === "string" ? req.query.country.trim() : "";
  const startDate = typeof req.query.startDate === "string" ? req.query.startDate : undefined;
  const endDate = typeof req.query.endDate === "string" ? req.query.endDate : undefined;

  if (!q && !partner && !country && !startDate && !endDate) {
    return res.status(400).json({
      message: "Provide at least one of q, partner, country, startDate, or endDate.",
    });
  }

  const limit = clamp(
    toPositiveInt(typeof req.query.limit === "string" ? req.query.limit : undefined, 40),
    10,
    120
  );

  const encryptionKey = getEncryptionKey();
  const dataJsonExpr = buildDataJsonExpr(encryptionKey);

  try {
    const likeTerm = `%${q}%`;

    const fileDate = buildDateWhere("f.uploaded_at", startDate, endDate);
    const fileWhereParts: string[] = [];
    const fileParams: any[] = [];
    if (q) {
      fileWhereParts.push("f.name LIKE ?");
      fileParams.push(likeTerm);
    }
    if (fileDate.clause) {
      fileWhereParts.push(fileDate.clause);
      fileParams.push(...fileDate.params);
    }
    const fileWhereClause = fileWhereParts.length ? `WHERE ${fileWhereParts.join(" AND ")}` : "";

    const [fileRows]: any = await dbPool.query(
      `SELECT f.id, f.name, f.file_type AS fileType, f.uploaded_at AS uploadedAt,
              p.id AS projectId, p.name AS projectName
       FROM files f
       JOIN projects p ON p.id = f.project_id
       ${fileWhereClause}
       ORDER BY f.uploaded_at DESC
       LIMIT ?`,
      [...fileParams, limit]
    );

    const reportDate = buildDateWhere("r.created_at", startDate, endDate);
    const reportWhereParts: string[] = [];
    const reportParams: any[] = [];
    if (q) {
      reportWhereParts.push("r.name LIKE ?");
      reportParams.push(likeTerm);
    }
    if (reportDate.clause) {
      reportWhereParts.push(reportDate.clause);
      reportParams.push(...reportDate.params);
    }
    const reportWhereClause = reportWhereParts.length ? `WHERE ${reportWhereParts.join(" AND ")}` : "";

    const [reportRows]: any = await dbPool.query(
      `SELECT r.id, r.name, r.status, r.created_at AS createdAt, r.updated_at AS updatedAt
       FROM reports r
       ${reportWhereClause}
       ORDER BY r.updated_at DESC
       LIMIT ?`,
      [...reportParams, limit]
    );

    const dashboardDate = buildDateWhere("d.created_at", startDate, endDate);
    const dashboardWhereParts: string[] = [];
    const dashboardParams: any[] = [];
    if (q) {
      dashboardWhereParts.push("(d.title LIKE ? OR d.description LIKE ?)");
      dashboardParams.push(likeTerm, likeTerm);
    }
    if (dashboardDate.clause) {
      dashboardWhereParts.push(dashboardDate.clause);
      dashboardParams.push(...dashboardDate.params);
    }
    const dashboardWhereClause = dashboardWhereParts.length
      ? `WHERE ${dashboardWhereParts.join(" AND ")}`
      : "";

    const [dashboardRows]: any = await dbPool.query(
      `SELECT d.id, d.user_id AS userId, d.title, d.description, d.created_at AS createdAt, d.updated_at AS updatedAt
       FROM dashboards d
       ${dashboardWhereClause}
       ORDER BY d.updated_at DESC
       LIMIT ?`,
      [...dashboardParams, limit]
    );

    const rowDate = buildDateWhere("f.uploaded_at", startDate, endDate);

    const rowWhereParts: string[] = [];
    const rowParams: any[] = [];

    const hasQ = Boolean(q);
    const rowKeyCount = hasQ ? 2 : 1;
    const rowKeyParams = buildKeyParams(encryptionKey, rowKeyCount);

    // Place JSON_SEARCH first to keep parameter ordering predictable.
    if (hasQ) {
      rowWhereParts.push(`JSON_SEARCH(${dataJsonExpr}, 'one', ?, NULL, '$**') IS NOT NULL`);
      rowParams.push(likeTerm);
    }

    if (!hasQ && !rowDate.clause) {
      rowWhereParts.push("f.uploaded_at >= DATE_SUB(NOW(), INTERVAL 180 DAY)");
    } else if (rowDate.clause) {
      rowWhereParts.push(rowDate.clause);
      rowParams.push(...rowDate.params);
    }

    const rowWhereClause = rowWhereParts.length ? `WHERE ${rowWhereParts.join(" AND ")}` : "";

    const rowScanLimit = clamp(limit * 4, 40, 400);

    const [rowRows]: any = await dbPool.query(
      `SELECT fr.id AS rowId, fr.file_id AS fileId, f.name AS fileName, f.uploaded_at AS uploadedAt,
              p.id AS projectId, p.name AS projectName,
              ${dataJsonExpr} AS data_json
       FROM file_rows fr
       JOIN files f ON f.id = fr.file_id
       JOIN projects p ON p.id = f.project_id
       ${rowWhereClause}
       ORDER BY f.uploaded_at DESC
       LIMIT ?`,
      [...rowKeyParams, ...rowParams, rowScanLimit]
    );

    const startBound = startDate ? parseDateCandidate(startDate) : null;
    const endBound = endDate ? parseDateCandidate(endDate) : null;

    const filteredRows: any[] = [];
    for (const row of rowRows as any[]) {
      let parsed: Record<string, any> = {};
      try {
        parsed = JSON.parse(row.data_json || "{}");
      } catch {
        parsed = {};
      }

      const summary = extractRoamingSummary(parsed);

      if (partner && !matchesFilterTerm(summary.partner, parsed, partner)) continue;
      if (country && !matchesFilterTerm(summary.country, parsed, country)) continue;

      const eventDate = getDateFromSummary(summary, parsed) || parseDateCandidate(row.uploadedAt);
      if (eventDate) {
        if (startBound && eventDate < startBound) continue;
        if (endBound && eventDate > endBound) continue;
      }

      if (hasQ && !rowContainsTerm(parsed, q)) continue;

      filteredRows.push({
        rowId: row.rowId,
        fileId: row.fileId,
        fileName: row.fileName,
        uploadedAt: row.uploadedAt,
        projectId: row.projectId,
        projectName: row.projectName,
        partner: summary.partner,
        country: summary.country,
        date: summary.date,
        preview: toPreviewObject(parsed),
      });

      if (filteredRows.length >= limit) break;
    }

    res.json({
      query: {
        q: q || null,
        partner: partner || null,
        country: country || null,
        startDate: startDate || null,
        endDate: endDate || null,
        limit,
      },
      counts: {
        files: (fileRows as any[]).length,
        reports: (reportRows as any[]).length,
        dashboards: (dashboardRows as any[]).length,
        rows: filteredRows.length,
      },
      results: {
        files: fileRows,
        reports: reportRows,
        dashboards: dashboardRows,
        rows: filteredRows,
      },
    });
  } catch (err) {
    console.error("global search error", err);
    res.status(500).json({ message: "Global search failed." });
  }
};
