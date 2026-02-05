import { Request, Response } from "express";
import { Pool } from "mysql2/promise";
import { buildDataJsonExpr, buildKeyParams, getEncryptionKey } from "../utils/dbEncryption";
import { buildSchemaChanges, SchemaChanges } from "../utils/schemaChanges";

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

const IMPACT_ROW_LIMIT = Number(process.env.IMPACT_SUMMARY_ROW_LIMIT || 12000);
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
  metrics: {
    netRevenue: ImpactMetric;
    usage: ImpactMetric;
    partners: ImpactMetric;
  };
  kpis: ImpactMetric[];
  chart?: { label: string; previous: number | null; current: number; unit: string };
  insights: string[];
  schemaChanges: SchemaChanges;
};

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
  const cleaned = String(value)
    .replace(/[,$]/g, "")
    .replace(/[^0-9.-]/g, "")
    .trim();
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
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
    columns.forEach((column: string) => {
      const num = parseNumericValue(row[column]);
      if (num !== null) {
        columnSums[column] = (columnSums[column] || 0) + num;
      }
    });
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
    const [currentSummary, previousSummary] = await Promise.all([
      loadFileSummary(dbPool, current.id),
      previous ? loadFileSummary(dbPool, previous.id) : Promise.resolve(null),
    ]);

    const netColumn = findColumnByTerms(currentSummary.columns, NET_REVENUE_KEYS);
    const usageColumn = findColumnByTerms(currentSummary.columns, USAGE_KEYS);

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
      metrics: {
        netRevenue: buildMetric("Net Revenue", netSum, "currency", prevNetSum),
        usage: buildMetric("Total Usage", usageSum, "usage", prevUsage),
        partners: buildMetric("Partners", partnerCount, "count", previousSummary?.partnerCount ?? null),
      },
      kpis: buildKpiInsights(currentSummary, previousSummary ?? undefined),
      chart: undefined,
      insights: [],
      schemaChanges,
    };

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

    res.json(response);
  } catch (error) {
    console.error("Impact summary failed", error);
    res.status(500).json({ message: "Failed to compute impact summary" });
  }
};
