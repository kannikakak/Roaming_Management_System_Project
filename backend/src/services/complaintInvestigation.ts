import { Pool } from "mysql2/promise";
import { pushProjectScopeCondition } from "../utils/accessControl";

type ComplaintInvestigationInput = {
  projectIds: number[] | null;
  q?: string;
  partner?: string;
  country?: string;
  days: number;
  limit: number;
};

type CandidateRow = {
  partner: string;
  country: string;
  rowsCount: number;
  usageSum: number;
  revenueSum: number;
  expectedSum: number;
  actualSum: number;
  lastSeen: string | null;
};

type AlertListRow = {
  id: number;
  severity: string;
  status: string;
  title: string;
  message: string;
  partner: string | null;
  projectId: number | null;
  projectName: string | null;
  lastDetectedAt: string;
};

type UploadRow = {
  fileId: number;
  fileName: string;
  projectId: number;
  projectName: string;
  uploadedAt: string;
  totalRows: number;
  partnerCount: number;
  netRevenue: number;
  usage: number;
};

export type ComplaintCandidate = {
  partner: string;
  country: string;
  rows: number;
  usage: number;
  revenue: number;
  expected: number;
  actual: number;
  leakage: number;
  leakagePct: number | null;
  openAlerts: number;
  riskScore: number;
  lastSeen: string | null;
};

export type ComplaintCountryProfile = {
  country: string;
  partners: number;
  rows: number;
  totalLeakage: number;
  openAlerts: number;
  highestRiskPartner: string | null;
};

export type ComplaintInvestigationResponse = {
  filters: {
    q: string | null;
    partner: string | null;
    country: string | null;
    days: number;
    limit: number;
  };
  summary: {
    candidatePairs: number;
    uniquePartners: number;
    uniqueCountries: number;
    openAlerts: number;
    recentUploads: number;
  };
  candidates: ComplaintCandidate[];
  countryProfiles: ComplaintCountryProfile[];
  alerts: Array<{
    id: number;
    severity: string;
    status: string;
    title: string;
    message: string;
    partner: string | null;
    projectId: number | null;
    projectName: string | null;
    lastDetectedAt: string;
  }>;
  recentUploads: UploadRow[];
  recommendations: string[];
};

const round = (value: number, digits = 2) => {
  const power = 10 ** digits;
  return Math.round(value * power) / power;
};

const toLike = (value: string) => `%${value.toLowerCase()}%`;

const sanitizeLabel = (value: unknown, fallback: string) => {
  const text = String(value || "").trim();
  return text || fallback;
};

const riskScoreForCandidate = (
  leakage: number,
  leakagePct: number | null,
  rows: number,
  openAlerts: number
) => {
  const pctRisk = Math.min(45, Math.abs(leakagePct || 0) * 0.8);
  const valueRisk = Math.min(30, Math.log10(Math.abs(leakage) + 1) * 8);
  const volumeRisk = Math.min(15, rows / 500);
  const alertRisk = Math.min(30, openAlerts * 6);
  return round(Math.min(100, pctRisk + valueRisk + volumeRisk + alertRisk), 1);
};

const loadCandidateRows = async (
  dbPool: Pool,
  input: ComplaintInvestigationInput
): Promise<CandidateRow[]> => {
  const whereParts: string[] = ["a.day >= DATE_SUB(CURDATE(), INTERVAL ? DAY)"];
  const whereParams: any[] = [input.days];
  pushProjectScopeCondition(whereParts, whereParams, "a.project_id", input.projectIds);

  if (input.partner) {
    whereParts.push("LOWER(a.partner) LIKE ?");
    whereParams.push(toLike(input.partner));
  }
  if (input.country) {
    whereParts.push("LOWER(a.country) LIKE ?");
    whereParams.push(toLike(input.country));
  }
  if (input.q) {
    const qLike = toLike(input.q);
    whereParts.push("(LOWER(a.partner) LIKE ? OR LOWER(a.country) LIKE ?)");
    whereParams.push(qLike, qLike);
  }

  const whereClause = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";
  try {
    const [rows]: any = await dbPool.query(
      `SELECT
         a.partner AS partner,
         a.country AS country,
         COALESCE(SUM(a.rows_count), 0) AS rowsCount,
         COALESCE(SUM(a.usage_sum), 0) AS usageSum,
         COALESCE(SUM(a.revenue_sum), 0) AS revenueSum,
         COALESCE(SUM(a.expected_sum), 0) AS expectedSum,
         COALESCE(SUM(a.actual_sum), 0) AS actualSum,
         MAX(a.day) AS lastSeen
       FROM analytics_file_daily_partner a
       ${whereClause}
       GROUP BY a.partner, a.country
       ORDER BY rowsCount DESC
       LIMIT ?`,
      [...whereParams, Math.max(input.limit * 3, 25)]
    );
    return Array.isArray(rows) ? (rows as CandidateRow[]) : [];
  } catch (error: any) {
    if (String(error?.code || "") === "ER_NO_SUCH_TABLE") {
      return [];
    }
    throw error;
  }
};

const loadAlertCountsByPartner = async (
  dbPool: Pool,
  input: ComplaintInvestigationInput
) => {
  const whereParts: string[] = [
    "a.status <> 'resolved'",
    "a.last_detected_at >= DATE_SUB(NOW(), INTERVAL ? DAY)",
  ];
  const whereParams: any[] = [input.days];
  pushProjectScopeCondition(whereParts, whereParams, "a.project_id", input.projectIds);

  if (input.partner) {
    whereParts.push("LOWER(a.partner) LIKE ?");
    whereParams.push(toLike(input.partner));
  }
  if (input.q) {
    const qLike = toLike(input.q);
    whereParts.push("(LOWER(a.partner) LIKE ? OR LOWER(a.title) LIKE ? OR LOWER(a.message) LIKE ?)");
    whereParams.push(qLike, qLike, qLike);
  }

  const whereClause = `WHERE ${whereParts.join(" AND ")}`;
  const [rows]: any = await dbPool.query(
    `SELECT COALESCE(NULLIF(TRIM(a.partner), ''), 'Unknown Partner') AS partner,
            COUNT(*) AS total
     FROM alerts a
     ${whereClause}
     GROUP BY COALESCE(NULLIF(TRIM(a.partner), ''), 'Unknown Partner')`,
    whereParams
  );

  const map = new Map<string, number>();
  for (const row of rows as Array<{ partner: string; total: number }>) {
    map.set(String(row.partner || "Unknown Partner"), Number(row.total || 0));
  }
  return map;
};

const loadAlertList = async (dbPool: Pool, input: ComplaintInvestigationInput) => {
  const whereParts: string[] = [
    "a.status <> 'resolved'",
    "a.last_detected_at >= DATE_SUB(NOW(), INTERVAL ? DAY)",
  ];
  const whereParams: any[] = [input.days];
  pushProjectScopeCondition(whereParts, whereParams, "a.project_id", input.projectIds);

  if (input.partner) {
    whereParts.push("LOWER(a.partner) LIKE ?");
    whereParams.push(toLike(input.partner));
  }
  if (input.q) {
    const qLike = toLike(input.q);
    whereParts.push("(LOWER(a.partner) LIKE ? OR LOWER(a.title) LIKE ? OR LOWER(a.message) LIKE ?)");
    whereParams.push(qLike, qLike, qLike);
  }
  const whereClause = `WHERE ${whereParts.join(" AND ")}`;

  const [rows]: any = await dbPool.query(
    `SELECT
       a.id,
       a.severity,
       a.status,
       a.title,
       a.message,
       a.partner,
       a.project_id AS projectId,
       p.name AS projectName,
       a.last_detected_at AS lastDetectedAt
     FROM alerts a
     LEFT JOIN projects p ON p.id = a.project_id
     ${whereClause}
     ORDER BY a.last_detected_at DESC
     LIMIT ?`,
    [...whereParams, Math.max(input.limit, 8)]
  );

  return Array.isArray(rows) ? (rows as AlertListRow[]) : [];
};

const loadRecentUploads = async (
  dbPool: Pool,
  input: ComplaintInvestigationInput
): Promise<UploadRow[]> => {
  const whereParts: string[] = ["afm.uploaded_at >= DATE_SUB(NOW(), INTERVAL ? DAY)"];
  const whereParams: any[] = [input.days];
  pushProjectScopeCondition(whereParts, whereParams, "afm.project_id", input.projectIds);

  if (input.q) {
    whereParts.push("(LOWER(f.name) LIKE ? OR LOWER(p.name) LIKE ?)");
    const qLike = toLike(input.q);
    whereParams.push(qLike, qLike);
  }
  const whereClause = `WHERE ${whereParts.join(" AND ")}`;

  try {
    const [rows]: any = await dbPool.query(
      `SELECT
         afm.file_id AS fileId,
         f.name AS fileName,
         afm.project_id AS projectId,
         p.name AS projectName,
         afm.uploaded_at AS uploadedAt,
         afm.total_rows AS totalRows,
         afm.partner_count AS partnerCount,
         afm.net_revenue_sum AS netRevenue,
         afm.usage_sum AS usage
       FROM analytics_file_metrics afm
       JOIN files f ON f.id = afm.file_id
       JOIN projects p ON p.id = afm.project_id
       ${whereClause}
       ORDER BY afm.uploaded_at DESC
       LIMIT ?`,
      [...whereParams, Math.max(input.limit, 8)]
    );

    return Array.isArray(rows)
      ? (rows as any[]).map((row) => ({
          fileId: Number(row.fileId || 0),
          fileName: String(row.fileName || "Unknown file"),
          projectId: Number(row.projectId || 0),
          projectName: String(row.projectName || "Unknown project"),
          uploadedAt: String(row.uploadedAt || ""),
          totalRows: Number(row.totalRows || 0),
          partnerCount: Number(row.partnerCount || 0),
          netRevenue: Number(row.netRevenue || 0),
          usage: Number(row.usage || 0),
        }))
      : [];
  } catch (error: any) {
    if (String(error?.code || "") !== "ER_NO_SUCH_TABLE") {
      throw error;
    }
  }

  const fallbackWhereParts: string[] = ["f.uploaded_at >= DATE_SUB(NOW(), INTERVAL ? DAY)"];
  const fallbackWhereParams: any[] = [input.days];
  pushProjectScopeCondition(fallbackWhereParts, fallbackWhereParams, "f.project_id", input.projectIds);
  if (input.q) {
    const qLike = toLike(input.q);
    fallbackWhereParts.push("(LOWER(f.name) LIKE ? OR LOWER(p.name) LIKE ?)");
    fallbackWhereParams.push(qLike, qLike);
  }

  const [fallbackRows]: any = await dbPool.query(
    `SELECT
       f.id AS fileId,
       f.name AS fileName,
       f.project_id AS projectId,
       p.name AS projectName,
       f.uploaded_at AS uploadedAt,
       COALESCE(dq.total_rows, 0) AS totalRows
     FROM files f
     JOIN projects p ON p.id = f.project_id
     LEFT JOIN data_quality_scores dq ON dq.file_id = f.id
     WHERE ${fallbackWhereParts.join(" AND ")}
     ORDER BY f.uploaded_at DESC
     LIMIT ?`,
    [...fallbackWhereParams, Math.max(input.limit, 8)]
  );

  return Array.isArray(fallbackRows)
    ? (fallbackRows as any[]).map((row) => ({
        fileId: Number(row.fileId || 0),
        fileName: String(row.fileName || "Unknown file"),
        projectId: Number(row.projectId || 0),
        projectName: String(row.projectName || "Unknown project"),
        uploadedAt: String(row.uploadedAt || ""),
        totalRows: Number(row.totalRows || 0),
        partnerCount: 0,
        netRevenue: 0,
        usage: 0,
      }))
    : [];
};

const buildRecommendations = (
  candidates: ComplaintCandidate[],
  alerts: AlertListRow[]
) => {
  const recommendations: string[] = [];
  if (candidates.length === 0) {
    recommendations.push("No high-risk partner/country pattern found in the selected window. Expand days or remove filters.");
    if (alerts.length > 0) {
      recommendations.push("Open alerts exist. Start from latest unresolved alerts and verify partner naming consistency.");
    }
    return recommendations;
  }

  const top = candidates[0];
  recommendations.push(
    `Start triage with ${top.partner} / ${top.country}; risk score ${top.riskScore} and leakage ${round(top.leakage, 2).toLocaleString()}.`
  );

  if (top.leakagePct !== null && Math.abs(top.leakagePct) >= 5) {
    recommendations.push(
      `Expected vs actual gap is ${round(top.leakagePct, 2)}%. Validate tariff setup and rating rule for this corridor.`
    );
  }
  if (top.openAlerts > 0) {
    recommendations.push(
      `${top.openAlerts} unresolved alert(s) for ${top.partner}. Review alert timeline first before opening new complaint tickets.`
    );
  }

  const unknownCountry = candidates.some((item) => item.country.toLowerCase().includes("unknown"));
  if (unknownCountry) {
    recommendations.push("Some records have unknown country values. Enforce country normalization in ingestion mapping.");
  }

  if (recommendations.length < 3) {
    recommendations.push("Use the latest upload list to cross-check if the issue started after a specific partner file import.");
  }

  return recommendations.slice(0, 4);
};

export const buildComplaintInvestigation = async (
  dbPool: Pool,
  input: ComplaintInvestigationInput
): Promise<ComplaintInvestigationResponse> => {
  const normalizedInput: ComplaintInvestigationInput = {
    ...input,
    q: input.q?.trim() || "",
    partner: input.partner?.trim() || "",
    country: input.country?.trim() || "",
  };

  const [candidateRows, alertCountsByPartner, alerts, recentUploads] = await Promise.all([
    loadCandidateRows(dbPool, normalizedInput),
    loadAlertCountsByPartner(dbPool, normalizedInput),
    loadAlertList(dbPool, normalizedInput),
    loadRecentUploads(dbPool, normalizedInput),
  ]);

  const candidates: ComplaintCandidate[] = candidateRows
    .map((row) => {
      const partner = sanitizeLabel(row.partner, "Unknown Partner");
      const country = sanitizeLabel(row.country, "Unknown Country");
      const rows = Number(row.rowsCount || 0);
      const usage = Number(row.usageSum || 0);
      const revenue = Number(row.revenueSum || 0);
      const expected = Number(row.expectedSum || 0);
      const actual = Number(row.actualSum || 0);
      const leakage = actual - expected;
      const leakagePct = expected !== 0 ? (leakage / expected) * 100 : null;
      const openAlerts = alertCountsByPartner.get(partner) || 0;
      const riskScore = riskScoreForCandidate(leakage, leakagePct, rows, openAlerts);

      return {
        partner,
        country,
        rows,
        usage: round(usage, 2),
        revenue: round(revenue, 2),
        expected: round(expected, 2),
        actual: round(actual, 2),
        leakage: round(leakage, 2),
        leakagePct: leakagePct === null ? null : round(leakagePct, 2),
        openAlerts,
        riskScore,
        lastSeen: row.lastSeen ? new Date(row.lastSeen).toISOString().slice(0, 10) : null,
      };
    })
    .sort((a, b) => b.riskScore - a.riskScore || Math.abs(b.leakage) - Math.abs(a.leakage))
    .slice(0, normalizedInput.limit);

  const countryMap = new Map<string, ComplaintCountryProfile>();
  for (const candidate of candidates) {
    const existing = countryMap.get(candidate.country);
    if (!existing) {
      countryMap.set(candidate.country, {
        country: candidate.country,
        partners: 1,
        rows: candidate.rows,
        totalLeakage: candidate.leakage,
        openAlerts: candidate.openAlerts,
        highestRiskPartner: candidate.partner,
      });
      continue;
    }

    existing.partners += 1;
    existing.rows += candidate.rows;
    existing.totalLeakage += candidate.leakage;
    existing.openAlerts += candidate.openAlerts;
    const currentTop = candidates.find((item) => item.partner === existing.highestRiskPartner && item.country === existing.country);
    if (!currentTop || candidate.riskScore > currentTop.riskScore) {
      existing.highestRiskPartner = candidate.partner;
    }
  }

  const countryProfiles = Array.from(countryMap.values())
    .map((item) => ({
      ...item,
      rows: Math.round(item.rows),
      totalLeakage: round(item.totalLeakage, 2),
    }))
    .sort((a, b) => Math.abs(b.totalLeakage) - Math.abs(a.totalLeakage))
    .slice(0, normalizedInput.limit);

  const uniquePartners = new Set(candidates.map((item) => item.partner));
  const uniqueCountries = new Set(candidates.map((item) => item.country));
  const openAlerts = Array.from(alertCountsByPartner.values()).reduce((sum, value) => sum + value, 0);

  const recommendations = buildRecommendations(candidates, alerts);

  return {
    filters: {
      q: normalizedInput.q || null,
      partner: normalizedInput.partner || null,
      country: normalizedInput.country || null,
      days: normalizedInput.days,
      limit: normalizedInput.limit,
    },
    summary: {
      candidatePairs: candidates.length,
      uniquePartners: uniquePartners.size,
      uniqueCountries: uniqueCountries.size,
      openAlerts,
      recentUploads: recentUploads.length,
    },
    candidates,
    countryProfiles,
    alerts: alerts.map((row) => ({
      id: Number(row.id || 0),
      severity: String(row.severity || "medium"),
      status: String(row.status || "open"),
      title: String(row.title || "Untitled alert"),
      message: String(row.message || ""),
      partner: row.partner ? String(row.partner) : null,
      projectId: row.projectId === null ? null : Number(row.projectId),
      projectName: row.projectName ? String(row.projectName) : null,
      lastDetectedAt: new Date(row.lastDetectedAt).toISOString(),
    })),
    recentUploads,
    recommendations,
  };
};
