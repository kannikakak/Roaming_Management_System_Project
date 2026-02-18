import { Request, Response } from "express";
import { Pool } from "mysql2/promise";
import { buildDataJsonExpr, buildKeyParams, getEncryptionKey } from "../utils/dbEncryption";
import { parseDateCandidate } from "../utils/roamingData";
import { buildSchemaChanges, SchemaChanges } from "../utils/schemaChanges";
import { requireFileAccess } from "../utils/accessControl";

const NET_REVENUE_KEYS = [
  "netrevenue",
  "totalnetrevenue",
  "net_revenue",
  "totalrevenue",
  "revenue",
  "billingvalue",
  "billingamount",
];

const PARTNER_KEYS = [
  "roaming_partner",
  "partner",
  "partner_name",
  "operator",
  "network",
  "carrier",
  "mno",
  "plmn",
];

const DATE_KEYS = [
  "date",
  "event_date",
  "usage_date",
  "billing_date",
  "period",
  "day",
  "timestamp",
  "time",
  "datetime",
  "created_at",
  "start_date",
  "end_date",
];

const DATA_QUALITY_ROW_LIMIT = Number(process.env.DATA_QUALITY_ROW_LIMIT || 5000);

type DataQualityHighlight = {
  label: string;
  value: string;
  detail: string;
  severity?: "info" | "warning" | "critical";
};

type DataQualitySummary = {
  fileId: number;
  fileName: string;
  uploadedAt: string;
  score: number;
  badge: "good" | "warning" | "poor";
  status: string;
  confidence: "High" | "Medium" | "Low";
  issues: string[];
  recommendations: Array<{
    priority: "high" | "medium" | "low";
    action: string;
    rationale: string;
  }>;
  highlights: DataQualityHighlight[];
  metrics: {
    missingRate: number;
    partnerMissingRate: number;
    negativeRevenueRate: number;
    missingDateRate: number;
    invalidRevenueRate: number;
    timeCoverage: number;
    partnerCoverage: number;
    rowCount: number;
    columnCount: number;
    uniquePartners: number;
    uniqueDates: number;
  };
  columns: {
    revenueColumn?: string;
    partnerColumn?: string;
    dateColumn?: string;
  };
  schemaChanges: SchemaChanges;
};

const normalizeKey = (value?: string | null) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

const findColumn = (columns: string[], terms: string[]) => {
  const normalizedTerms = terms.map((term) => normalizeKey(term)).filter(Boolean);
  for (const column of columns) {
    const normalized = normalizeKey(column);
    if (normalizedTerms.includes(normalized)) return column;
  }
  for (const column of columns) {
    const normalized = normalizeKey(column);
    if (normalizedTerms.some((term) => normalized.includes(term) && term.length > 2)) return column;
  }
  return undefined;
};

const buildScore = (
  missingRate: number,
  partnerMissingRate: number,
  negativeRevenueRate: number,
  missingDateRate: number,
  partnerCoverage: number,
  timeCoverage: number,
  hasDateColumn: boolean
) => {
  const penalties = [
    missingRate * 30,
    partnerMissingRate * 20,
    negativeRevenueRate * 20,
    missingDateRate * 15,
    Math.max(0, 0.6 - partnerCoverage) * 20,
    hasDateColumn ? Math.max(0, 0.85 - timeCoverage) * 20 : 0,
  ];
  const score = 100 - penalties.reduce((sum, item) => sum + item, 0);
  const rounded = Math.max(0, Math.min(100, score));
  return Math.round(rounded * 10) / 10;
};

const getBadge = (score: number): DataQualitySummary["badge"] => {
  if (score >= 90) return "good";
  if (score >= 75) return "warning";
  return "poor";
};

const isBlankLike = (value: any) => {
  if (value === null || value === undefined) return true;
  const str = String(value).trim();
  if (!str) return true;
  const lower = str.toLowerCase();
  return lower === "-" || lower === "null" || lower === "nan" || lower === "n/a";
};

const buildRecommendations = (input: {
  totalRows: number;
  missingRate: number;
  partnerMissingRate: number;
  negativeRevenueRate: number;
  invalidRevenueRate: number;
  missingDateRate: number;
  timeCoverage: number;
  partnerCoverage: number;
  revenueColumn?: string;
  partnerColumn?: string;
  dateColumn?: string;
}) => {
  const items: DataQualitySummary["recommendations"] = [];

  if (input.totalRows === 0) {
    items.push({
      priority: "high",
      action: "Verify ingestion source and retry the upload.",
      rationale: "No rows were sampled, so downstream analytics cannot be trusted.",
    });
    return items;
  }

  if (input.missingRate > 0.02) {
    items.push({
      priority: input.missingRate > 0.08 ? "high" : "medium",
      action: "Add mandatory-field checks in the source export.",
      rationale: `Missing values are ${(input.missingRate * 100).toFixed(1)}% of sampled cells.`,
    });
  }

  if (!input.partnerColumn) {
    items.push({
      priority: "medium",
      action: "Include a partner/operator column in the source file.",
      rationale: "Partner-level monitoring and dispute analysis rely on this field.",
    });
  } else if (input.partnerMissingRate > 0.05 || input.partnerCoverage < 0.6) {
    items.push({
      priority: input.partnerMissingRate > 0.15 ? "high" : "medium",
      action: "Normalize partner naming and block blank partner rows.",
      rationale: `Partner coverage is ${(input.partnerCoverage * 100).toFixed(1)}%, which is below target.`,
    });
  }

  if (!input.dateColumn) {
    items.push({
      priority: "medium",
      action: "Provide a usage/billing date column with consistent format.",
      rationale: "Time-series trend, anomaly, and forecast features need event dates.",
    });
  } else if (input.missingDateRate > 0.03 || input.timeCoverage < 0.6) {
    items.push({
      priority: input.missingDateRate > 0.15 ? "high" : "medium",
      action: "Fix date parsing at source (prefer ISO `YYYY-MM-DD`).",
      rationale: `Date validity/coverage is insufficient for accurate daily trend analysis.`,
    });
  }

  const revenueProblemRate = Math.min(1, input.negativeRevenueRate + input.invalidRevenueRate);
  if (!input.revenueColumn) {
    items.push({
      priority: "medium",
      action: "Add a revenue amount column for financial quality controls.",
      rationale: "Revenue sanity checks are currently limited without a detected revenue field.",
    });
  } else if (revenueProblemRate > 0.05) {
    items.push({
      priority: revenueProblemRate > 0.2 ? "high" : "medium",
      action: "Apply numeric/currency formatting rules before ingestion.",
      rationale: `Revenue issues affect ${(revenueProblemRate * 100).toFixed(1)}% of rows.`,
    });
  }

  if (!items.length) {
    items.push({
      priority: "low",
      action: "Keep the current template and monitor trend drift weekly.",
      rationale: "Current sample quality is acceptable for downstream operations.",
    });
  }

  return items.slice(0, 6);
};

export const getFileQualitySummary = (dbPool: Pool) => async (req: Request, res: Response) => {
  const { fileId } = req.params;
  try {
    const access = await requireFileAccess(dbPool, fileId, req);
    if (!access.ok) {
      return res.status(access.status).json({ message: access.message });
    }
    const fileIdNum = access.fileId;

    const [fileRow]: any = await dbPool.query(
      `SELECT id, name, project_id as projectId, uploaded_at as uploadedAt
       FROM files
       WHERE id = ?
       LIMIT 1`,
      [fileIdNum]
    );
    const fileInfo = fileRow?.[0];
    if (!fileInfo) {
      return res.status(404).json({ message: "File not found" });
    }

    const encryptionKey = getEncryptionKey();
    const dataJsonExpr = buildDataJsonExpr(encryptionKey);

    const [columnsResult]: any = await dbPool.query(
      "SELECT name FROM file_columns WHERE file_id = ? ORDER BY position ASC",
      [fileIdNum]
    );
    const columns = (columnsResult || []).map((c: any) => c?.name).filter(Boolean as any);

    const [previousFileRows]: any = await dbPool.query(
      `SELECT id, name, uploaded_at as uploadedAt
       FROM files
       WHERE project_id = ? AND id != ? AND uploaded_at < ?
       ORDER BY uploaded_at DESC
       LIMIT 1`,
      [access.projectId, fileIdNum, fileInfo.uploadedAt]
    );
    const previousFile = previousFileRows?.[0] ?? null;
    const previousFileId = previousFile?.id ?? null;
    let previousColumns: string[] = [];
    if (previousFileId) {
      const [prevColumnsResult]: any = await dbPool.query(
        "SELECT name FROM file_columns WHERE file_id = ? ORDER BY position ASC",
        [previousFileId]
      );
      previousColumns = (prevColumnsResult || []).map((c: any) => c?.name).filter(Boolean as any);
    }

    const [rows]: any = await dbPool.query(
      `SELECT ${dataJsonExpr} as data_json FROM file_rows WHERE file_id = ? ORDER BY row_index ASC LIMIT ?`,
      [...buildKeyParams(encryptionKey, 1), fileIdNum, DATA_QUALITY_ROW_LIMIT]
    );

    const parsedRows: Array<Record<string, any>> = (rows || []).map((row: any) => {
      try {
        return JSON.parse(row.data_json || "{}");
      } catch {
        return {};
      }
    });

    const totalRows = parsedRows.length;
    const columnCount = Math.max(columns.length, 1);
    const totalCells = totalRows * columnCount || 1;

    let missingCells = 0;
    let partnerMissing = 0;
    let negativeRevenue = 0;
    let missingDates = 0;
    let invalidRevenue = 0;
    const partnerValues = new Set<string>();
    const dateValues = new Set<string>();
    let minDate: Date | null = null;
    let maxDate: Date | null = null;

    const revenueColumn = findColumn(columns, NET_REVENUE_KEYS);
    const partnerColumn = findColumn(columns, PARTNER_KEYS);
    const dateColumn = findColumn(columns, DATE_KEYS);

    for (const row of parsedRows) {
      for (const column of columns) {
        if (isBlankLike(row?.[column])) missingCells += 1;
      }
      if (partnerColumn) {
        const value = row?.[partnerColumn];
        if (isBlankLike(value)) {
          partnerMissing += 1;
        } else {
          partnerValues.add(String(value).trim());
        }
      }
      if (revenueColumn) {
        const revenueValue = row?.[revenueColumn];
        const revenueNum = typeof revenueValue === "number"
          ? revenueValue
          : parseFloat(String(revenueValue || "").replace(/[^0-9.-]/g, ""));
        if (Number.isNaN(revenueNum)) {
          invalidRevenue += 1;
        } else if (revenueNum <= 0) {
          negativeRevenue += 1;
        }
      }
      if (dateColumn) {
        const dateValue = row?.[dateColumn];
        const parsedDate = parseDateCandidate(dateValue);
        if (!parsedDate) {
          missingDates += 1;
        } else {
          const isoDate = parsedDate.toISOString().split("T")[0];
          dateValues.add(isoDate);
          if (!minDate || parsedDate < minDate) minDate = parsedDate;
          if (!maxDate || parsedDate > maxDate) maxDate = parsedDate;
        }
      }
    }

    const missingRate = totalRows ? missingCells / totalCells : 1;
    const partnerMissingRate = totalRows ? partnerMissing / totalRows : 0;
    const negativeRevenueRate = totalRows ? negativeRevenue / totalRows : 0;
    const invalidRevenueRate = totalRows ? invalidRevenue / totalRows : 0;
    const missingDateRate = dateColumn ? (totalRows ? missingDates / totalRows : 0) : 0;
    const partnerCoverage = totalRows ? partnerValues.size / totalRows : 0;
    const revenueProblemRate = Math.min(1, negativeRevenueRate + invalidRevenueRate);

    const timeSpanDays = (() => {
      if (!dateColumn || !minDate || !maxDate) return 0;
      const durationMs = maxDate.getTime() - minDate.getTime();
      const spanDays = Math.ceil(durationMs / 86400000) + 1;
      return Math.max(1, spanDays);
    })();
    const timeCoverage = dateColumn
      ? timeSpanDays
        ? Math.min(1, dateValues.size / timeSpanDays)
        : totalRows
        ? 1
        : 0
      : 1;

    const score = buildScore(
      missingRate,
      partnerMissingRate,
      negativeRevenueRate,
      missingDateRate,
      partnerCoverage,
      timeCoverage,
      Boolean(dateColumn)
    );
    const badge = getBadge(score);

    let confidence: DataQualitySummary["confidence"] = "High";
    if (score < 90) confidence = "Medium";
    if (score < 75) confidence = "Low";

    const status =
      badge === "good" ? "Ready for downstream teams" : badge === "warning" ? "Review recommended" : "Fix data issues";

    const issues: string[] = [];
    if (totalRows === 0) {
      issues.push("No rows were sampled; ensure data was uploaded successfully.");
    }
    if (missingRate > 0.02) {
      issues.push(`Missing values in ${(missingRate * 100).toFixed(1)}% of sampled cells.`);
    }
    if (partnerColumn && partnerMissingRate > 0.05) {
      issues.push(`Partners unspecified for ${(partnerMissingRate * 100).toFixed(1)}% of rows.`);
    }
    if (negativeRevenueRate > 0.02) {
      issues.push(`Non-positive revenue reported in ${(negativeRevenueRate * 100).toFixed(1)}% of rows.`);
    }
    if (invalidRevenueRate > 0.01) {
      issues.push(`Revenue values cannot be parsed for ${(invalidRevenueRate * 100).toFixed(1)}% of rows.`);
    }
    if (dateColumn && missingDateRate > 0.03) {
      issues.push(`Dates missing or invalid in ${(missingDateRate * 100).toFixed(1)}% of rows.`);
    }
    if (dateColumn && timeCoverage < 0.6) {
      issues.push(`Date coverage low (${(timeCoverage * 100).toFixed(1)}% of ${timeSpanDays} possible days).`);
    }
    if (partnerColumn && partnerCoverage < 0.6) {
      issues.push(`Partner coverage limited (${(partnerCoverage * 100).toFixed(1)}% of rows reference a partner).`);
    }
    if (!issues.length) {
      issues.push("No major issues detected in the sampled rows; data looks ready.");
    }

    const schemaChanges = buildSchemaChanges(
      columns,
      previousColumns,
      previousFile
        ? { id: previousFileId, name: previousFile.name, uploadedAt: previousFile.uploadedAt }
        : undefined
    );

    const highlights: DataQualityHighlight[] = [
      {
        label: "Sample depth",
        value: `${totalRows} rows ${columns.length} columns`,
        detail: `Limited to first ${DATA_QUALITY_ROW_LIMIT} rows for a fast yet representative score.`,
      },
      {
        label: "Time coverage",
        value: dateColumn ? `${(timeCoverage * 100).toFixed(1)}%` : "No date column",
        detail: dateColumn
          ? timeSpanDays
            ? `Span of ${timeSpanDays} days (${Math.min(dateValues.size, timeSpanDays)} unique dates seen).`
            : "Dates present but single day."
          : "No date column detected.",
        severity: dateColumn && timeCoverage < 0.65 ? "warning" : "info",
      },
      {
        label: "Partner dispersion",
        value: `${partnerValues.size} partners`,
        detail: partnerColumn
          ? `${(partnerCoverage * 100).toFixed(1)}% of rows match a partner name.`
          : "No partner column detected.",
        severity: partnerColumn && partnerCoverage < 0.5 ? "warning" : "info",
      },
      {
        label: "Revenue sanity",
        value: `${Math.round((1 - revenueProblemRate) * 100)}% valid`,
        detail: `Negative/zero or unparsable revenue in ${(revenueProblemRate * 100).toFixed(1)}% of rows.`,
        severity: revenueProblemRate > 0.1 ? "critical" : "info",
      },
    ];

    const response: DataQualitySummary = {
      fileId: fileIdNum,
      fileName: fileInfo.name,
      uploadedAt: fileInfo.uploadedAt,
      score,
      badge,
      status,
      confidence,
      issues,
      recommendations: buildRecommendations({
        totalRows,
        missingRate,
        partnerMissingRate,
        negativeRevenueRate,
        invalidRevenueRate,
        missingDateRate,
        timeCoverage,
        partnerCoverage,
        revenueColumn,
        partnerColumn,
        dateColumn,
      }),
      highlights,
      metrics: {
        missingRate,
        partnerMissingRate,
        negativeRevenueRate,
        missingDateRate,
        invalidRevenueRate,
        timeCoverage,
        partnerCoverage,
        rowCount: totalRows,
        columnCount: columns.length,
        uniquePartners: partnerValues.size,
        uniqueDates: dateValues.size,
      },
      columns: {
        revenueColumn,
        partnerColumn,
        dateColumn,
      },
      schemaChanges,
    };

    res.json(response);
  } catch (error) {
    console.error("Quality summary failed", error);
    res.status(500).json({ message: "Failed to compute quality summary" });
  }
};
