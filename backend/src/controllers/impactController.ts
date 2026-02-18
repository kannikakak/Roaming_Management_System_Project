import { Request, Response } from "express";
import { Pool } from "mysql2/promise";
import { buildDataJsonExpr, buildKeyParams, getEncryptionKey } from "../utils/dbEncryption";
import { buildSchemaChanges, SchemaChanges } from "../utils/schemaChanges";
import { requireProjectAccess } from "../utils/accessControl";
import { TtlCache } from "../utils/ttlCache";
import { AnalyticsFileMetric, loadFileMetricsMap, queueRefreshAnalyticsForFiles } from "../services/analyticsEtl";

const NET_REVENUE_KEYS = [
  "netrevenue",
  "net_revenue",
  "totalnetrevenue",
  "net",
  "revenue",
  "billingvalue",
  "billingamount",
  "totalrevenue",
];

const USAGE_KEYS = [
  "usage",
  "totalusage",
  "usage_total",
  "volume",
  "totalvolume",
  "payload",
  "minutes",
  "totalminutes",
  "traffic",
  "datavolume",
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

const toBoundedPositiveInt = (
  value: string | undefined,
  fallback: number,
  min: number,
  max: number
) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
};

const IMPACT_ROW_LIMIT = toBoundedPositiveInt(
  process.env.IMPACT_SUMMARY_ROW_LIMIT,
  6000,
  200,
  25000
);
const IMPACT_CACHE_TTL_MS = toBoundedPositiveInt(
  process.env.IMPACT_SUMMARY_CACHE_TTL_MS,
  60000,
  5000,
  15 * 60 * 1000
);
const CURRENCY_FORMATTER = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 1,
});
const NUMBER_FORMATTER = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
});

type FileSummary = {
  fileId: number;
  columns: string[];
  totalRows: number;
  rowsSampled: number;
  columnSums: Record<string, number>;
  partnerColumn?: string;
  partnerCount: number;
};

type ImpactMetric = {
  label: string;
  current: number;
  previous?: number | null;
  change?: number | null;
  changePercent?: number | null;
  unit?: "currency" | "count" | "usage" | "generic";
};

type ImpactResponse = {
  projectId: number;
  projectName: string;
  currentFile: { id: number; name: string; uploadedAt: string };
  previousFile?: { id: number; name: string; uploadedAt: string };
  detectedColumns: {
    netRevenue: string | null;
    usage: string | null;
    partner: string | null;
  };
  metrics: {
    netRevenue: ImpactMetric;
    usage: ImpactMetric;
    partners: ImpactMetric;
  };
  kpis: ImpactMetric[];
  chart?: { label: string; previous: number | null; current: number; unit: string };
  dataConfidence: {
    currentSampledRows: number;
    currentTotalRows: number;
    currentCoverage: number;
    previousSampledRows: number | null;
    previousTotalRows: number | null;
    previousCoverage: number | null;
  };
  warnings: string[];
  insights: string[];
  schemaChanges: SchemaChanges;
};

const impactSummaryCache = new TtlCache<ImpactResponse>(IMPACT_CACHE_TTL_MS, 150);

const normalizeColumnKey = (value?: string | null) =>
  String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");

const findColumnByTerms = (columns: string[], terms: string[]) => {
  const normalizedTerms = terms.map((term) => normalizeColumnKey(term)).filter(Boolean);
  for (const column of columns) {
    const normalized = normalizeColumnKey(column);
    if (normalizedTerms.includes(normalized)) {
      return column;
    }
  }
  for (const column of columns) {
    const normalized = normalizeColumnKey(column);
    if (normalizedTerms.some((term) => normalized.includes(term) && term.length > 2)) {
      return column;
    }
  }
  return undefined;
};

const parseNumericValue = (value: any) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value === null || value === undefined) return null;
  const asString = String(value).trim();
  if (!asString) return null;
  const direct = Number(asString);
  if (Number.isFinite(direct)) return direct;
  const withoutCommas = asString.replace(/,/g, "");
  const commaParsed = Number(withoutCommas);
  if (Number.isFinite(commaParsed)) return commaParsed;
  const cleaned = withoutCommas.replace(/[^0-9.-]/g, "");
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
};

const summaryFromEtlMetric = (metric: AnalyticsFileMetric): FileSummary => {
  const netKey = metric.netRevenueKey || "net_revenue";
  const usageKey = metric.usageKey || "usage";
  const columns = [netKey, usageKey, metric.partnerKey || ""].filter(Boolean);
  const columnSums: Record<string, number> = {};
  columnSums[netKey] = Number(metric.netRevenueSum || 0);
  columnSums[usageKey] = Number(metric.usageSum || 0);
  return {
    fileId: metric.fileId,
    columns,
    totalRows: Number(metric.totalRows || 0),
    rowsSampled: Number(metric.totalRows || 0),
    columnSums,
    partnerColumn: metric.partnerKey || undefined,
    partnerCount: Number(metric.partnerCount || 0),
  };
};

const loadFileSummary = async (dbPool: Pool, fileId: number): Promise<FileSummary> => {
  const encryptionKey = getEncryptionKey();
  const dataJsonExpr = buildDataJsonExpr(encryptionKey);
  const [columnRows]: any = await dbPool.query(
    "SELECT name FROM file_columns WHERE file_id = ? ORDER BY position ASC",
    [fileId]
  );
  const columns = (columnRows || []).map((r: any) => r.name).filter(Boolean as any);

  const [[{ totalRows }]]: any = await dbPool.query(
    "SELECT COUNT(*) as totalRows FROM file_rows WHERE file_id = ?",
    [fileId]
  );

  const rowLimit = Math.max(50, IMPACT_ROW_LIMIT);
  const [rowRows]: any = await dbPool.query(
    `SELECT ${dataJsonExpr} as data_json FROM file_rows WHERE file_id = ? ORDER BY row_index ASC LIMIT ?`,
    [...buildKeyParams(encryptionKey, 1), fileId, rowLimit]
  );

  const rows = (rowRows || []).map((row: any) => {
    try {
      return JSON.parse(row.data_json || "{}");
    } catch {
      return {};
    }
  });

  const columnSums: Record<string, number> = {};
  rows.forEach((row: Record<string, any>) => {
    if (!row || typeof row !== "object") return;
    for (const [column, value] of Object.entries(row)) {
      const num = parseNumericValue(value);
      if (num !== null) {
        columnSums[column] = (columnSums[column] || 0) + num;
      }
    }
  });

  const partnerColumn = findColumnByTerms(columns, PARTNER_KEYS);
  const partnerSet = new Set<string>();
  if (partnerColumn) {
    rows.forEach((row: Record<string, any>) => {
      const value = row?.[partnerColumn];
      const normalized = String(value || "").trim();
      if (normalized) partnerSet.add(normalized);
    });
  }

  return {
    fileId,
    columns,
    totalRows: Number(totalRows || 0),
    rowsSampled: rows.length,
    columnSums,
    partnerColumn,
    partnerCount: partnerColumn ? partnerSet.size : 0,
  };
};

const formatCurrency = (value: number) => CURRENCY_FORMATTER.format(value);
const formatNumber = (value: number) => NUMBER_FORMATTER.format(value);

const computeDelta = (current: number, previous?: number | null) => {
  if (previous === null || previous === undefined) {
    return { change: null, changePercent: null };
  }
  const change = current - previous;
  const changePercent = previous === 0 ? null : (change / previous) * 100;
  return { change, changePercent };
};

const humanize = (value: string) =>
  String(value || "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());

const buildMetric = (
  label: string,
  current: number,
  unit: ImpactMetric["unit"],
  previous?: number | null
): ImpactMetric => {
  const { change, changePercent } = computeDelta(current, previous);
  return { label, current, previous, change, changePercent, unit };
};

const describeChange = (metric: ImpactMetric, format: (value: number) => string) => {
  if (metric.previous == null) {
    return `${metric.label} is ${format(metric.current)} in the latest upload.`;
  }
  const direction = (metric.change || 0) >= 0 ? "increased" : "decreased";
  const percentText = metric.changePercent != null ? ` by ${Math.abs(metric.changePercent).toFixed(1)}%` : "";
  const previousDisplay = format(metric.previous);
  const currentDisplay = format(metric.current);
  return `${metric.label} ${direction}${percentText} (from ${previousDisplay} to ${currentDisplay}).`;
};

const pickChartMetric = (metrics: ImpactMetric[]) => {
  const withChange = metrics
    .map((metric) => ({
      metric,
      weight: Math.abs(metric.changePercent || metric.change || 0),
    }))
    .sort((a, b) => b.weight - a.weight);
  const best = withChange.find((p) => p.metric.previous != null);
  return best ? best.metric : withChange[0]?.metric;
};

const buildKpiInsights = (current: FileSummary, previous?: FileSummary) => {
  const exclusions = new Set<string>();
  const netColumn = findColumnByTerms(current.columns, NET_REVENUE_KEYS);
  const usageColumn = findColumnByTerms(current.columns, USAGE_KEYS);
  if (netColumn) exclusions.add(netColumn);
  if (usageColumn) exclusions.add(usageColumn);

  const entries = Object.entries(current.columnSums)
    .filter(([column]) => !exclusions.has(column))
    .map(([column, currentValue]) => {
      const previousValue = previous?.columnSums?.[column] ?? null;
      const delta = computeDelta(currentValue, previousValue);
      return {
        column,
        currentValue,
        previousValue,
        change: delta.change,
        changePercent: delta.changePercent,
      };
    })
    .filter((entry) => entry.currentValue !== 0 || entry.previousValue)
    .sort((a, b) => Math.abs((b.changePercent ?? b.change ?? 0)) - Math.abs((a.changePercent ?? a.change ?? 0)));

  const results: ImpactMetric[] = [];
  for (let i = 0; i < Math.min(2, entries.length); i += 1) {
    const entry = entries[i];
    results.push(
      buildMetric(humanize(entry.column), entry.currentValue, "generic", entry.previousValue)
    );
  }
  return results;
};

const buildInsights = (response: ImpactResponse) => {
  const insights: string[] = [];
  if (!response.previousFile) {
    insights.push(
      `This is the first upload for ${response.projectName}; baseline metrics are now recorded.`
    );
  }
  insights.push(describeChange(response.metrics.netRevenue, formatCurrency));
  insights.push(describeChange(response.metrics.usage, formatNumber));
  insights.push(describeChange(response.metrics.partners, formatNumber));
  response.kpis.forEach((metric) => {
    if (metric.previous == null) return;
    const deltaText = metric.changePercent
      ? `${Math.abs(metric.changePercent).toFixed(1)}%`
      : formatNumber(Math.abs(metric.change || 0));
    const direction = (metric.change || 0) >= 0 ? "up" : "down";
    insights.push(`${metric.label} is ${direction} ${deltaText} vs the previous upload.`);
  });
  return insights;
};

export const getLatestUploadImpact = (dbPool: Pool) => async (req: Request, res: Response) => {
  const projectId = Number(req.params.projectId);
  if (!projectId || !Number.isFinite(projectId)) {
    return res.status(400).json({ message: "Missing projectId" });
  }

  try {
    const projectAccess = await requireProjectAccess(dbPool, projectId, req);
    if (!projectAccess.ok) {
      return res.status(projectAccess.status).json({ message: projectAccess.message });
    }

    const [projectRows]: any = await dbPool.query(
      "SELECT name FROM projects WHERE id = ? LIMIT 1",
      [projectId]
    );
    const projectName = projectRows?.[0]?.name || "project";
    const [files]: any = await dbPool.query(
      `SELECT id, name, uploaded_at as uploadedAt
       FROM files
       WHERE project_id = ?
       ORDER BY uploaded_at DESC
       LIMIT 2`,
      [projectId]
    );

    if (!files?.length) {
      return res.status(404).json({ message: "No uploads found for this project" });
    }

    const [current, previous] = files;
    const cacheKey = `${projectId}:${current.id}:${previous?.id || 0}:${IMPACT_ROW_LIMIT}`;
    const cached = impactSummaryCache.get(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const metricByFileId = await loadFileMetricsMap(
      dbPool,
      [current.id, previous?.id].filter((id): id is number => Number.isFinite(id))
    );
    const currentMetric = metricByFileId.get(current.id);
    const previousMetric = previous ? metricByFileId.get(previous.id) : undefined;
    const pendingEtlFileIds: number[] = [];
    if (!currentMetric) pendingEtlFileIds.push(current.id);
    if (previous && !previousMetric) pendingEtlFileIds.push(previous.id);
    if (pendingEtlFileIds.length > 0) {
      queueRefreshAnalyticsForFiles(dbPool, pendingEtlFileIds);
    }

    const [currentSummary, previousSummary] = await Promise.all([
      currentMetric ? Promise.resolve(summaryFromEtlMetric(currentMetric)) : loadFileSummary(dbPool, current.id),
      previous
        ? previousMetric
          ? Promise.resolve(summaryFromEtlMetric(previousMetric))
          : loadFileSummary(dbPool, previous.id)
        : Promise.resolve(null),
    ]);

    const netColumn = findColumnByTerms(currentSummary.columns, NET_REVENUE_KEYS);
    const usageColumn = findColumnByTerms(currentSummary.columns, USAGE_KEYS);
    const partnerColumn = findColumnByTerms(currentSummary.columns, PARTNER_KEYS);

    const netSum = netColumn ? currentSummary.columnSums[netColumn] || 0 : 0;
    const usageSum = usageColumn ? currentSummary.columnSums[usageColumn] || 0 : 0;
    const partnerCount = currentSummary.partnerCount;

    const prevNetSum = previousSummary && netColumn
      ? previousSummary.columnSums[netColumn] || 0
      : null;
    const prevUsage = previousSummary && usageColumn
      ? previousSummary.columnSums[usageColumn] || 0
      : null;

    const schemaChanges = buildSchemaChanges(
      currentSummary.columns,
      previousSummary?.columns ?? [],
      previous
        ? { id: previous.id, name: previous.name, uploadedAt: previous.uploadedAt }
        : undefined
    );

    const response: ImpactResponse = {
      projectId,
      projectName,
      currentFile: { id: current.id, name: current.name, uploadedAt: current.uploadedAt },
      previousFile: previous
        ? { id: previous.id, name: previous.name, uploadedAt: previous.uploadedAt }
        : undefined,
      detectedColumns: {
        netRevenue: netColumn || null,
        usage: usageColumn || null,
        partner: partnerColumn || null,
      },
      metrics: {
        netRevenue: buildMetric("Net Revenue", netSum, "currency", prevNetSum),
        usage: buildMetric("Total Usage", usageSum, "usage", prevUsage),
        partners: buildMetric("Partners", partnerCount, "count", previousSummary?.partnerCount ?? null),
      },
      kpis: buildKpiInsights(currentSummary, previousSummary ?? undefined),
      chart: undefined,
      dataConfidence: {
        currentSampledRows: currentSummary.rowsSampled,
        currentTotalRows: currentSummary.totalRows,
        currentCoverage:
          currentSummary.totalRows > 0
            ? Math.min(1, currentSummary.rowsSampled / currentSummary.totalRows)
            : 0,
        previousSampledRows: previousSummary?.rowsSampled ?? null,
        previousTotalRows: previousSummary?.totalRows ?? null,
        previousCoverage:
          previousSummary && previousSummary.totalRows > 0
            ? Math.min(1, previousSummary.rowsSampled / previousSummary.totalRows)
            : previousSummary
            ? 0
            : null,
      },
      warnings: [],
      insights: [],
      schemaChanges,
    };

    if (!netColumn) {
      response.warnings.push("Net revenue column was not detected; revenue delta may be incomplete.");
    }
    if (!usageColumn) {
      response.warnings.push("Usage column was not detected; usage trend may be incomplete.");
    }
    if (!partnerColumn) {
      response.warnings.push("Partner column was not detected; partner count may be understated.");
    }
    if (response.dataConfidence.currentCoverage < 0.6) {
      response.warnings.push(
        `Current file coverage is ${(response.dataConfidence.currentCoverage * 100).toFixed(1)}% of rows sampled.`
      );
    }

    const chartMetric = pickChartMetric([
      response.metrics.netRevenue,
      response.metrics.usage,
    ]);
    if (chartMetric) {
      response.chart = {
        label: chartMetric.label,
        previous: chartMetric.previous ?? null,
        current: chartMetric.current,
        unit: chartMetric.unit || "value",
      };
    }

    response.insights = buildInsights(response);
    impactSummaryCache.set(cacheKey, response);

    res.json(response);
  } catch (error) {
    console.error("Impact summary failed", error);
    res.status(500).json({ message: "Failed to compute impact summary" });
  }
};
