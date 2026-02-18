import { Pool } from "mysql2/promise";
import { buildDataJsonExpr, buildKeyParams, getEncryptionKey } from "../utils/dbEncryption";
import {
  extractRoamingSummary,
  getDateFromSummary,
  matchesFilterTerm,
  parseDateCandidate,
} from "../utils/roamingData";
import { TtlCache } from "../utils/ttlCache";

export type InsightFilters = {
  startDate?: string;
  endDate?: string;
  partner?: string;
  country?: string;
  rowLimit?: number;
  projectIds?: number[] | null;
};

type DailyPoint = {
  day: string;
  rows: number;
  traffic?: number;
  revenue?: number;
  cost?: number;
  expected?: number;
  actual?: number;
};

type ForecastPoint = { day: string; value: number };

type AnomalyPoint = { day: string; value: number; zScore: number };

type LeakageItem = {
  partner: string;
  country: string;
  expected: number;
  actual: number;
  diff: number;
  diffPct: number | null;
};

export type DashboardInsightsResponse = {
  filters: {
    startDate: string | null;
    endDate: string | null;
    partner: string | null;
    country: string | null;
  };
  totals: {
    rowsScanned: number;
    rowsMatched: number;
  };
  metrics: {
    trafficKey: string | null;
    revenueKey: string | null;
    costKey: string | null;
    expectedKey: string | null;
    actualKey: string | null;
    forecastMetric: string;
  };
  series: {
    daily: DailyPoint[];
  };
  forecast: {
    horizonDays: number;
    metric: string;
    points: ForecastPoint[];
  };
  anomalies: {
    metric: string;
    points: AnomalyPoint[];
  };
  leakage: {
    expectedKey: string | null;
    actualKey: string | null;
    items: LeakageItem[];
  };
  summaries: string[];
};

type RowRecord = {
  uploadedAt: string;
  data_json: string;
};

const toBoundedPositiveInt = (
  value: any,
  fallback: number,
  min: number,
  max: number
) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
};

const DEFAULT_ROW_LIMIT = 3500;
const MIN_ROW_LIMIT = 300;
const MAX_ROW_LIMIT = 15000;
const DASHBOARD_INSIGHTS_CACHE_TTL_MS = toBoundedPositiveInt(
  process.env.DASHBOARD_INSIGHTS_CACHE_TTL_MS,
  45000,
  5000,
  15 * 60 * 1000
);
const dashboardInsightsCache = new TtlCache<DashboardInsightsResponse>(
  DASHBOARD_INSIGHTS_CACHE_TTL_MS,
  180
);

const toDateKey = (value: Date) => value.toISOString().slice(0, 10);

const normalizeKey = (key: string) =>
  String(key || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

const parseNumber = (value: any) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value === null || value === undefined) return null;
  const n = Number(String(value).trim());
  return Number.isFinite(n) ? n : null;
};

const addDays = (day: string, delta: number) => {
  const base = new Date(day);
  if (Number.isNaN(base.getTime())) return day;
  base.setDate(base.getDate() + delta);
  return base.toISOString().slice(0, 10);
};

const mean = (values: number[]) => values.reduce((s, v) => s + v, 0) / values.length;

const stddev = (values: number[], avg: number) => {
  if (values.length < 2) return 0;
  const variance =
    values.reduce((s, v) => {
      const d = v - avg;
      return s + d * d;
    }, 0) /
    (values.length - 1);
  return Math.sqrt(variance);
};

const linearRegressionForecast = (series: DailyPoint[], metric: keyof DailyPoint, horizonDays: number) => {
  const points = series
    .map((p) => ({ day: p.day, value: Number(p[metric] ?? 0) }))
    .filter((p) => Number.isFinite(p.value));

  if (points.length < 5) {
    return { metric: String(metric), points: [] as ForecastPoint[] };
  }

  const n = points.length;
  const xs = points.map((_, i) => i);
  const ys = points.map((p) => p.value);
  const xAvg = mean(xs);
  const yAvg = mean(ys);

  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = xs[i] - xAvg;
    numerator += dx * (ys[i] - yAvg);
    denominator += dx * dx;
  }

  const slope = denominator === 0 ? 0 : numerator / denominator;
  const intercept = yAvg - slope * xAvg;

  const lastDay = points[points.length - 1].day;
  const forecastPoints: ForecastPoint[] = [];
  for (let i = 1; i <= horizonDays; i += 1) {
    const x = n - 1 + i;
    const value = intercept + slope * x;
    forecastPoints.push({
      day: addDays(lastDay, i),
      value: Math.max(0, Math.round(value * 100) / 100),
    });
  }

  return { metric: String(metric), points: forecastPoints };
};

const detectAnomalies = (series: DailyPoint[], metric: keyof DailyPoint) => {
  const values = series.map((p) => Number(p[metric] ?? 0)).filter((v) => Number.isFinite(v));
  if (values.length < 6) {
    return { metric: String(metric), points: [] as AnomalyPoint[] };
  }
  const avg = mean(values);
  const sd = stddev(values, avg);
  if (!sd || !Number.isFinite(sd)) {
    return { metric: String(metric), points: [] as AnomalyPoint[] };
  }

  const anomalies = series
    .map((p) => {
      const value = Number(p[metric] ?? 0);
      const zScore = (value - avg) / sd;
      return { day: p.day, value, zScore };
    })
    .filter((p) => Math.abs(p.zScore) >= 2.5)
    .sort((a, b) => Math.abs(b.zScore) - Math.abs(a.zScore))
    .slice(0, 6)
    .map((p) => ({
      day: p.day,
      value: Math.round(p.value * 100) / 100,
      zScore: Math.round(p.zScore * 100) / 100,
    }));

  return { metric: String(metric), points: anomalies };
};

type MetricBucket = {
  numericCount: number;
  keywordScore: number;
};

const scoreKey = (key: string, keywords: string[]) => {
  const nk = normalizeKey(key);
  let score = 0;
  for (const kw of keywords) {
    if (nk.includes(normalizeKey(kw))) score += 1;
  }
  return score;
};

const pickBestKey = (buckets: Map<string, MetricBucket>, keywords: string[], banned: string[] = []) => {
  const bannedNorm = banned.map(normalizeKey);
  let best: { key: string; score: number } | null = null;
  for (const [key, bucket] of buckets.entries()) {
    const nk = normalizeKey(key);
    if (bannedNorm.some((b) => nk.includes(b))) continue;
    const keywordScore = scoreKey(key, keywords);
    if (keywordScore === 0) continue;
    const score = keywordScore * 10 + bucket.numericCount;
    if (!best || score > best.score) {
      best = { key, score };
    }
  }
  return best?.key ?? null;
};

const collectMetricBuckets = (rows: Record<string, any>[]) => {
  const buckets = new Map<string, MetricBucket>();
  const limit = Math.min(rows.length, 800);
  for (let i = 0; i < limit; i += 1) {
    const row = rows[i];
    if (!row || typeof row !== "object") continue;
    for (const [key, value] of Object.entries(row)) {
      const num = parseNumber(value);
      if (num === null) continue;
      if (!buckets.has(key)) {
        buckets.set(key, { numericCount: 0, keywordScore: 0 });
      }
      buckets.get(key)!.numericCount += 1;
    }
  }
  return buckets;
};

const TRAFFIC_KEYWORDS = ["traffic", "usage", "volume", "mb", "gb", "minute", "minutes", "sms", "data"];
const REVENUE_KEYWORDS = ["revenue", "rev", "income", "amount", "charge", "billed", "billing", "fee"];
const COST_KEYWORDS = ["cost", "expense", "payable", "wholesale", "charge", "billed", "fee"];
const EXPECTED_KEYWORDS = ["expected", "tariff", "rate", "agreed", "contract", "price"];
const ACTUAL_KEYWORDS = ["actual", "charged", "charge", "billed", "cost", "amount", "fee"];

const chooseForecastMetric = (daily: DailyPoint[]) => {
  const hasRevenue = daily.some((d) => Number.isFinite(d.revenue ?? NaN) && (d.revenue ?? 0) !== 0);
  if (hasRevenue) return "revenue" as const;
  const hasTraffic = daily.some((d) => Number.isFinite(d.traffic ?? NaN) && (d.traffic ?? 0) !== 0);
  if (hasTraffic) return "traffic" as const;
  return "rows" as const;
};

const buildEmptyInsightsResponse = (
  startDate: string | undefined,
  endDate: string | undefined,
  partnerFilter: string,
  countryFilter: string
): DashboardInsightsResponse => ({
  filters: {
    startDate: startDate || null,
    endDate: endDate || null,
    partner: partnerFilter || null,
    country: countryFilter || null,
  },
  totals: {
    rowsScanned: 0,
    rowsMatched: 0,
  },
  metrics: {
    trafficKey: null,
    revenueKey: null,
    costKey: null,
    expectedKey: null,
    actualKey: null,
    forecastMetric: "rows",
  },
  series: {
    daily: [],
  },
  forecast: {
    horizonDays: 7,
    metric: "rows",
    points: [],
  },
  anomalies: {
    metric: "rows",
    points: [],
  },
  leakage: {
    expectedKey: null,
    actualKey: null,
    items: [],
  },
  summaries: [
    "Scanned 0 rows; matched 0 after filters.",
    "No strong anomalies detected at current sensitivity.",
    "Leakage detection needs both expected tariff and actual charge columns.",
  ],
});

const computeDashboardInsightsFromEtl = async (
  dbPool: Pool,
  startDate: string | undefined,
  endDate: string | undefined,
  partnerFilter: string,
  countryFilter: string,
  scopedProjectIds: number[] | null
): Promise<DashboardInsightsResponse | null> => {
  const baseWhereParts: string[] = [];
  const baseParams: any[] = [];
  if (startDate) {
    baseWhereParts.push("a.day >= ?");
    baseParams.push(startDate);
  }
  if (endDate) {
    baseWhereParts.push("a.day <= ?");
    baseParams.push(endDate);
  }
  if (scopedProjectIds !== null) {
    if (!scopedProjectIds.length) {
      return buildEmptyInsightsResponse(startDate, endDate, partnerFilter, countryFilter);
    }
    const placeholders = scopedProjectIds.map(() => "?").join(", ");
    baseWhereParts.push(`a.project_id IN (${placeholders})`);
    baseParams.push(...scopedProjectIds);
  }
  const baseWhereClause = baseWhereParts.length ? `WHERE ${baseWhereParts.join(" AND ")}` : "";

  const matchedWhereParts = [...baseWhereParts];
  const matchedParams = [...baseParams];
  if (partnerFilter) {
    matchedWhereParts.push("LOWER(a.partner) LIKE ?");
    matchedParams.push(`%${partnerFilter.toLowerCase()}%`);
  }
  if (countryFilter) {
    matchedWhereParts.push("LOWER(a.country) LIKE ?");
    matchedParams.push(`%${countryFilter.toLowerCase()}%`);
  }
  const matchedWhereClause = matchedWhereParts.length ? `WHERE ${matchedWhereParts.join(" AND ")}` : "";

  try {
    const [[scannedRow]]: any = await dbPool.query(
      `SELECT COALESCE(SUM(a.rows_count), 0) AS totalRows
       FROM analytics_file_daily_partner a
       ${baseWhereClause}`,
      baseParams
    );
    const [[matchedRow]]: any = await dbPool.query(
      `SELECT COALESCE(SUM(a.rows_count), 0) AS totalRows
       FROM analytics_file_daily_partner a
       ${matchedWhereClause}`,
      matchedParams
    );
    const [dailyRows]: any = await dbPool.query(
      `SELECT
         a.day AS day,
         COALESCE(SUM(a.rows_count), 0) AS rows,
         COALESCE(SUM(a.traffic_sum), 0) AS traffic,
         COALESCE(SUM(a.revenue_sum), 0) AS revenue,
         COALESCE(SUM(a.cost_sum), 0) AS cost,
         COALESCE(SUM(a.expected_sum), 0) AS expected,
         COALESCE(SUM(a.actual_sum), 0) AS actual
       FROM analytics_file_daily_partner a
       ${matchedWhereClause}
       GROUP BY a.day
       ORDER BY a.day ASC`,
      matchedParams
    );
    const [topPartnerRows]: any = await dbPool.query(
      `SELECT a.partner AS partner, COALESCE(SUM(a.rows_count), 0) AS totalRows
       FROM analytics_file_daily_partner a
       ${matchedWhereClause}
       GROUP BY a.partner
       ORDER BY totalRows DESC
       LIMIT 1`,
      matchedParams
    );
    const [leakageRows]: any = await dbPool.query(
      `SELECT
         a.partner AS partner,
         a.country AS country,
         COALESCE(SUM(a.expected_sum), 0) AS expected,
         COALESCE(SUM(a.actual_sum), 0) AS actual
       FROM analytics_file_daily_partner a
       ${matchedWhereClause}
       GROUP BY a.partner, a.country
       HAVING ABS(COALESCE(SUM(a.actual_sum), 0) - COALESCE(SUM(a.expected_sum), 0)) > 0
       ORDER BY ABS(COALESCE(SUM(a.actual_sum), 0) - COALESCE(SUM(a.expected_sum), 0)) DESC
       LIMIT 8`,
      matchedParams
    );

    const rowsScanned = Number(scannedRow?.totalRows || 0);
    const rowsMatched = Number(matchedRow?.totalRows || 0);
    if (rowsScanned === 0 && rowsMatched === 0) {
      return buildEmptyInsightsResponse(startDate, endDate, partnerFilter, countryFilter);
    }

    const daily: DailyPoint[] = (dailyRows as any[]).map((row) => ({
      day: String(row.day || ""),
      rows: Number(row.rows || 0),
      traffic: Number(row.traffic || 0),
      revenue: Number(row.revenue || 0),
      cost: Number(row.cost || 0),
      expected: Number(row.expected || 0),
      actual: Number(row.actual || 0),
    }));

    const forecastMetric = chooseForecastMetric(daily);
    const forecastHorizonDays = 7;
    const forecast = linearRegressionForecast(daily, forecastMetric, forecastHorizonDays);
    const anomalies = detectAnomalies(daily, forecastMetric);

    const leakageItems: LeakageItem[] = (leakageRows as any[]).map((row) => {
      const expected = Number(row.expected || 0);
      const actual = Number(row.actual || 0);
      const diff = actual - expected;
      const diffPct = expected !== 0 ? (diff / expected) * 100 : null;
      return {
        partner: String(row.partner || "Unknown Partner"),
        country: String(row.country || "Unknown Country"),
        expected: Math.round(expected * 100) / 100,
        actual: Math.round(actual * 100) / 100,
        diff: Math.round(diff * 100) / 100,
        diffPct: diffPct === null ? null : Math.round(diffPct * 100) / 100,
      };
    });

    const topPartner = topPartnerRows?.[0];
    const lastActualPoint = daily[daily.length - 1];
    const nextForecast = forecast.points[0];

    const summaries: string[] = [];
    summaries.push(`Scanned ${rowsScanned} rows; matched ${rowsMatched} after filters.`);
    if (topPartner) {
      summaries.push(`Top roaming partner: ${String(topPartner.partner)} (${Number(topPartner.totalRows || 0)} rows).`);
    }
    if (lastActualPoint && nextForecast) {
      const baseValue = Number(lastActualPoint[forecastMetric] ?? 0);
      const delta = nextForecast.value - baseValue;
      const direction = delta >= 0 ? "up" : "down";
      summaries.push(
        `Forecast (${forecastMetric}) for ${nextForecast.day} is ${nextForecast.value.toLocaleString()} (${direction} ${Math.abs(
          Math.round(delta * 100) / 100
        ).toLocaleString()} vs last observed day).`
      );
    }
    if (anomalies.points.length > 0) {
      const a = anomalies.points[0];
      summaries.push(`Detected ${anomalies.points.length} anomaly day(s); largest on ${a.day} (z=${a.zScore}).`);
    } else {
      summaries.push("No strong anomalies detected at current sensitivity.");
    }
    if (leakageItems.length > 0) {
      const leak = leakageItems[0];
      const pct = leak.diffPct === null ? "" : ` (${leak.diffPct.toLocaleString()}%)`;
      summaries.push(`Potential leakage: ${leak.partner} / ${leak.country} diff ${leak.diff.toLocaleString()}${pct}.`);
    } else {
      summaries.push("Expected vs actual charges look aligned at the aggregated level.");
    }

    return {
      filters: {
        startDate: startDate || null,
        endDate: endDate || null,
        partner: partnerFilter || null,
        country: countryFilter || null,
      },
      totals: {
        rowsScanned,
        rowsMatched,
      },
      metrics: {
        trafficKey: "traffic_sum",
        revenueKey: "revenue_sum",
        costKey: "cost_sum",
        expectedKey: "expected_sum",
        actualKey: "actual_sum",
        forecastMetric,
      },
      series: {
        daily,
      },
      forecast: {
        horizonDays: forecastHorizonDays,
        metric: forecast.metric,
        points: forecast.points,
      },
      anomalies: {
        metric: anomalies.metric,
        points: anomalies.points,
      },
      leakage: {
        expectedKey: "expected_sum",
        actualKey: "actual_sum",
        items: leakageItems,
      },
      summaries,
    };
  } catch (error: any) {
    if (String(error?.code || "") === "ER_NO_SUCH_TABLE") {
      return null;
    }
    throw error;
  }
};

export const computeDashboardInsights = async (
  dbPool: Pool,
  filters: InsightFilters
): Promise<DashboardInsightsResponse> => {
  const startDate = typeof filters.startDate === "string" ? filters.startDate : undefined;
  const endDate = typeof filters.endDate === "string" ? filters.endDate : undefined;
  const partnerFilter = typeof filters.partner === "string" ? filters.partner.trim() : "";
  const countryFilter = typeof filters.country === "string" ? filters.country.trim() : "";
  const scopedProjectIds = Array.isArray(filters.projectIds)
    ? Array.from(
        new Set(
          filters.projectIds
            .map((id) => Number(id))
            .filter((id) => Number.isFinite(id) && id > 0)
        )
      )
    : null;
  const envRowLimit = toBoundedPositiveInt(
    process.env.DASHBOARD_INSIGHTS_ROW_LIMIT || process.env.DASHBOARD_ANALYTICS_ROW_LIMIT,
    DEFAULT_ROW_LIMIT,
    MIN_ROW_LIMIT,
    MAX_ROW_LIMIT
  );
  const rowLimit = toBoundedPositiveInt(
    filters.rowLimit,
    envRowLimit,
    MIN_ROW_LIMIT,
    MAX_ROW_LIMIT
  );

  if (scopedProjectIds !== null && scopedProjectIds.length === 0) {
    return buildEmptyInsightsResponse(startDate, endDate, partnerFilter, countryFilter);
  }

  const scopedProjectKey =
    scopedProjectIds === null ? "all" : [...scopedProjectIds].sort((a, b) => a - b).join(",");
  const cacheKey = JSON.stringify({
    startDate: startDate || null,
    endDate: endDate || null,
    partner: partnerFilter.toLowerCase(),
    country: countryFilter.toLowerCase(),
    rowLimit,
    projects: scopedProjectKey,
  });
  const cached = dashboardInsightsCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const etlResponse = await computeDashboardInsightsFromEtl(
    dbPool,
    startDate,
    endDate,
    partnerFilter,
    countryFilter,
    scopedProjectIds
  );
  if (etlResponse) {
    dashboardInsightsCache.set(cacheKey, etlResponse);
    return etlResponse;
  }

  const encryptionKey = getEncryptionKey();
  const dataJsonExpr = buildDataJsonExpr(encryptionKey);
  const rowKeyParams = buildKeyParams(encryptionKey, 1);

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
  if (scopedProjectIds !== null) {
    const placeholders = scopedProjectIds.map(() => "?").join(", ");
    rowWhereParts.push(`f.project_id IN (${placeholders})`);
    rowWhereParams.push(...scopedProjectIds);
  }
  const rowWhereClause = rowWhereParts.length ? `WHERE ${rowWhereParts.join(" AND ")}` : "";

  const [rowRows]: any = await dbPool.query(
    `SELECT
        f.uploaded_at AS uploadedAt,
        ${dataJsonExpr} AS data_json
      FROM file_rows fr
      JOIN files f ON fr.file_id = f.id
      ${rowWhereClause}
      ORDER BY f.uploaded_at DESC
      LIMIT ?`,
    [...rowKeyParams, ...rowWhereParams, rowLimit]
  );

  const startBound = startDate ? parseDateCandidate(startDate) : null;
  const endBound = endDate ? parseDateCandidate(endDate) : null;

  const parsedRows: Record<string, any>[] = [];
  for (const row of rowRows as RowRecord[]) {
    try {
      parsedRows.push(JSON.parse(row.data_json || "{}"));
    } catch {
      parsedRows.push({});
    }
  }

  const buckets = collectMetricBuckets(parsedRows);
  const expectedKey = pickBestKey(buckets, EXPECTED_KEYWORDS);
  const actualKey = pickBestKey(buckets, ACTUAL_KEYWORDS, EXPECTED_KEYWORDS);
  const revenueKey = pickBestKey(buckets, REVENUE_KEYWORDS, EXPECTED_KEYWORDS);
  const costKey = pickBestKey(buckets, COST_KEYWORDS, EXPECTED_KEYWORDS);
  const trafficKey = pickBestKey(buckets, TRAFFIC_KEYWORDS, EXPECTED_KEYWORDS);

  const dailyMap = new Map<string, DailyPoint>();
  const partnerCounts = new Map<string, number>();
  const leakageMap = new Map<string, { partner: string; country: string; expected: number; actual: number }>();

  let rowsMatched = 0;

  for (let i = 0; i < (rowRows as RowRecord[]).length; i += 1) {
    const rowMeta = (rowRows as RowRecord[])[i];
    const parsed = parsedRows[i] || {};
    const summary = extractRoamingSummary(parsed);

    if (partnerFilter && !matchesFilterTerm(summary.partner, parsed, partnerFilter)) {
      continue;
    }
    if (countryFilter && !matchesFilterTerm(summary.country, parsed, countryFilter)) {
      continue;
    }

    const summaryDate = getDateFromSummary(summary, parsed);
    const uploadedAtDate = parseDateCandidate(rowMeta.uploadedAt);
    const eventDate = summaryDate || uploadedAtDate;
    if (eventDate) {
      if (startBound && eventDate < startBound) continue;
      if (endBound && eventDate > endBound) continue;
    }

    rowsMatched += 1;

    const partner = summary.partner || "Unknown Partner";
    const country = summary.country || "Unknown Country";
    const dateKey = eventDate ? toDateKey(eventDate) : toDateKey(new Date(rowMeta.uploadedAt));

    partnerCounts.set(partner, (partnerCounts.get(partner) || 0) + 1);

    if (!dailyMap.has(dateKey)) {
      dailyMap.set(dateKey, { day: dateKey, rows: 0 });
    }
    const dayBucket = dailyMap.get(dateKey)!;
    dayBucket.rows += 1;

    const traffic = trafficKey ? parseNumber(parsed[trafficKey]) : null;
    const revenue = revenueKey ? parseNumber(parsed[revenueKey]) : null;
    const cost = costKey ? parseNumber(parsed[costKey]) : null;
    const expected = expectedKey ? parseNumber(parsed[expectedKey]) : null;
    const actual = actualKey ? parseNumber(parsed[actualKey]) : null;

    if (traffic !== null) dayBucket.traffic = (dayBucket.traffic || 0) + traffic;
    if (revenue !== null) dayBucket.revenue = (dayBucket.revenue || 0) + revenue;
    if (cost !== null) dayBucket.cost = (dayBucket.cost || 0) + cost;
    if (expected !== null) dayBucket.expected = (dayBucket.expected || 0) + expected;
    if (actual !== null) dayBucket.actual = (dayBucket.actual || 0) + actual;

    if (expectedKey && actualKey && expected !== null && actual !== null) {
      const leakageKey = `${partner}__${country}`;
      if (!leakageMap.has(leakageKey)) {
        leakageMap.set(leakageKey, { partner, country, expected: 0, actual: 0 });
      }
      const bucket = leakageMap.get(leakageKey)!;
      bucket.expected += expected;
      bucket.actual += actual;
    }
  }

  const daily = Array.from(dailyMap.values()).sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));

  const forecastMetric = chooseForecastMetric(daily);
  const forecastHorizonDays = 7;
  const forecast = linearRegressionForecast(daily, forecastMetric, forecastHorizonDays);
  const anomalies = detectAnomalies(daily, forecastMetric);

  const leakageItems: LeakageItem[] = expectedKey && actualKey
    ? Array.from(leakageMap.values())
        .map((item) => {
          const diff = item.actual - item.expected;
          const diffPct = item.expected !== 0 ? (diff / item.expected) * 100 : null;
          return {
            partner: item.partner,
            country: item.country,
            expected: Math.round(item.expected * 100) / 100,
            actual: Math.round(item.actual * 100) / 100,
            diff: Math.round(diff * 100) / 100,
            diffPct: diffPct === null ? null : Math.round(diffPct * 100) / 100,
          };
        })
        .filter((item) => Math.abs(item.diff) > 0)
        .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))
        .slice(0, 8)
    : [];

  const topPartner = Array.from(partnerCounts.entries()).sort((a, b) => b[1] - a[1])[0];
  const lastActualPoint = daily[daily.length - 1];
  const nextForecast = forecast.points[0];

  const summaries: string[] = [];
  summaries.push(`Scanned ${rowRows.length} rows; matched ${rowsMatched} after filters.`);
  if (topPartner) {
    summaries.push(`Top roaming partner: ${topPartner[0]} (${topPartner[1]} rows).`);
  }
  if (lastActualPoint && nextForecast) {
    const baseValue = Number(lastActualPoint[forecastMetric] ?? 0);
    const delta = nextForecast.value - baseValue;
    const direction = delta >= 0 ? "up" : "down";
    summaries.push(
      `Forecast (${forecastMetric}) for ${nextForecast.day} is ${nextForecast.value.toLocaleString()} (${direction} ${Math.abs(
        Math.round(delta * 100) / 100
      ).toLocaleString()} vs last observed day).`
    );
  }
  if (anomalies.points.length > 0) {
    const a = anomalies.points[0];
    summaries.push(`Detected ${anomalies.points.length} anomaly day(s); largest on ${a.day} (z=${a.zScore}).`);
  } else {
    summaries.push("No strong anomalies detected at current sensitivity.");
  }
  if (leakageItems.length > 0) {
    const leak = leakageItems[0];
    const pct = leak.diffPct === null ? "" : ` (${leak.diffPct.toLocaleString()}%)`;
    summaries.push(`Potential leakage: ${leak.partner} / ${leak.country} diff ${leak.diff.toLocaleString()}${pct}.`);
  } else if (!expectedKey || !actualKey) {
    summaries.push("Leakage detection needs both expected tariff and actual charge columns.");
  } else {
    summaries.push("Expected vs actual charges look aligned at the aggregated level.");
  }

  const response: DashboardInsightsResponse = {
    filters: {
      startDate: startDate || null,
      endDate: endDate || null,
      partner: partnerFilter || null,
      country: countryFilter || null,
    },
    totals: {
      rowsScanned: rowRows.length,
      rowsMatched,
    },
    metrics: {
      trafficKey,
      revenueKey,
      costKey,
      expectedKey,
      actualKey,
      forecastMetric,
    },
    series: {
      daily,
    },
    forecast: {
      horizonDays: forecastHorizonDays,
      metric: forecast.metric,
      points: forecast.points,
    },
    anomalies: {
      metric: anomalies.metric,
      points: anomalies.points,
    },
    leakage: {
      expectedKey,
      actualKey,
      items: leakageItems,
    },
    summaries,
  };
  dashboardInsightsCache.set(cacheKey, response);
  return response;
};
