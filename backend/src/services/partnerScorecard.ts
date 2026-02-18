import { Pool } from "mysql2/promise";
import { buildDataJsonExpr, buildKeyParams, getEncryptionKey } from "../utils/dbEncryption";
import { extractRoamingSummary, getDateFromSummary, parseDateCandidate } from "../utils/roamingData";
import { TtlCache } from "../utils/ttlCache";

const REVENUE_KEYWORDS = [
  "revenue",
  "netrevenue",
  "net_revenue",
  "billed",
  "billing",
  "amount",
  "charge",
  "fee",
  "value",
];
const USAGE_KEYWORDS = [
  "usage",
  "traffic",
  "volume",
  "minutes",
  "minute",
  "sms",
  "data",
  "mb",
  "gb",
];
const PAYMENT_DELAY_KEYWORDS = [
  "paymentdelay",
  "payment_delay",
  "delaydays",
  "delay_days",
  "daystopay",
  "days_to_pay",
  "agingdays",
  "overduedays",
  "dayspastdue",
  "dso",
];
const DUE_DATE_KEYWORDS = ["due_date", "duedate", "payment_due_date", "invoice_due_date"];
const PAID_DATE_KEYWORDS = ["paid_date", "payment_date", "paidat", "payment_paid_date", "settled_date"];

const MIN_MONTHS = 3;
const MAX_MONTHS = 24;
const MIN_LIMIT = 5;
const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;
const MIN_ROW_LIMIT = 1000;
const MAX_ROW_LIMIT = 120000;
const DEFAULT_ROW_LIMIT = 12000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DEFAULT_SORT_BY = "score" as const;
const DEFAULT_SORT_DIR = "desc" as const;

type MetricBuckets = Map<string, number>;

type ParsedRowMeta = {
  fileId: number;
  uploadedAt: string;
  data_json: string;
};

type TrendBucket = {
  revenue: number;
  usage: number;
};

type PartnerAccumulator = {
  partner: string;
  revenue: number;
  usage: number;
  rows: number;
  files: Set<number>;
  qualitySum: number;
  qualityCount: number;
  delaySum: number;
  delayCount: number;
  trend: Map<string, TrendBucket>;
};

export type PartnerTrendPoint = {
  month: string;
  revenue: number;
  usage: number;
};

export type PartnerScorecardItem = {
  partner: string;
  revenue: number;
  usage: number;
  qualityScore: number | null;
  disputeCount: number;
  paymentDelayDays: number | null;
  riskLevel: "low" | "medium" | "high";
  score: number;
  rows: number;
  files: number;
  trend: PartnerTrendPoint[];
};

export type PartnerScorecardResponse = {
  filters: {
    projectId: number | null;
    months: number;
    limit: number;
    rowLimit: number;
    partner: string | null;
    minScore: number | null;
    sortBy: "score" | "revenue" | "usage" | "quality" | "disputes" | "delay" | "partner";
    sortDir: "asc" | "desc";
  };
  metricKeys: {
    revenue: string | null;
    usage: string | null;
    paymentDelay: string | null;
    paymentDueDate: string | null;
    paymentPaidDate: string | null;
  };
  monthKeys: string[];
  summary: {
    partnerCount: number;
    totalRevenue: number;
    totalUsage: number;
    avgQualityScore: number | null;
    totalDisputes: number;
    avgPaymentDelayDays: number | null;
    riskBreakdown: {
      low: number;
      medium: number;
      high: number;
    };
  };
  partners: PartnerScorecardItem[];
};

export type PartnerScorecardFilters = {
  projectId?: number;
  months?: number;
  limit?: number;
  rowLimit?: number;
  projectIds?: number[] | null;
  partnerSearch?: string;
  minScore?: number;
  sortBy?: string;
  sortDir?: string;
};

type PartnerScorecardDraftItem = Omit<PartnerScorecardItem, "riskLevel">;

const normalizeKey = (value: string) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

const round = (value: number, decimals = 2) => {
  const power = 10 ** decimals;
  return Math.round(value * power) / power;
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const toPositiveInt = (value: unknown, fallback: number, min: number, max: number) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return clamp(Math.floor(parsed), min, max);
};

const PARTNER_SCORECARD_CACHE_TTL_MS = toPositiveInt(
  process.env.PARTNER_SCORECARD_CACHE_TTL_MS,
  60000,
  5000,
  15 * 60 * 1000
);
const partnerScorecardCache = new TtlCache<PartnerScorecardResponse>(
  PARTNER_SCORECARD_CACHE_TTL_MS,
  180
);

const toOptionalBoundedNumber = (value: unknown, min: number, max: number) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return clamp(parsed, min, max);
};

const normalizeSortBy = (
  value: unknown
): PartnerScorecardResponse["filters"]["sortBy"] => {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (
    normalized === "score" ||
    normalized === "revenue" ||
    normalized === "usage" ||
    normalized === "quality" ||
    normalized === "disputes" ||
    normalized === "delay" ||
    normalized === "partner"
  ) {
    return normalized;
  }
  return DEFAULT_SORT_BY;
};

const normalizeSortDir = (value: unknown) => {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  return normalized === "asc" ? "asc" : ("desc" as const);
};

const getRiskLevel = (
  score: number,
  disputeCount: number,
  paymentDelayDays: number | null
): "low" | "medium" | "high" => {
  if (score < 50 || disputeCount >= 5 || (paymentDelayDays !== null && paymentDelayDays >= 30)) {
    return "high";
  }
  if (score < 70 || disputeCount >= 2 || (paymentDelayDays !== null && paymentDelayDays >= 15)) {
    return "medium";
  }
  return "low";
};

const toMonthKey = (date: Date) => {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
};

const toStartOfMonthUtc = (date: Date) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 0, 0, 0, 0));

const addMonthsUtc = (date: Date, delta: number) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + delta, 1, 0, 0, 0, 0));

const toIsoDate = (date: Date) => date.toISOString().slice(0, 10);

const buildMonthKeys = (months: number) => {
  const totalMonths = toPositiveInt(months, 6, MIN_MONTHS, MAX_MONTHS);
  const currentMonthStart = toStartOfMonthUtc(new Date());
  const keys: string[] = [];
  for (let i = totalMonths - 1; i >= 0; i -= 1) {
    keys.push(toMonthKey(addMonthsUtc(currentMonthStart, -i)));
  }
  return keys;
};

const parseFlexibleNumber = (value: unknown): number | null => {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  const negativeByParen = /^\((.*)\)$/.test(trimmed);
  const noParens = negativeByParen ? trimmed.slice(1, -1) : trimmed;
  const sanitized = noParens.replace(/,/g, "").replace(/[^0-9.+-]/g, "");
  if (!sanitized || sanitized === "." || sanitized === "-" || sanitized === "+") return null;

  const parsed = Number(sanitized);
  if (!Number.isFinite(parsed)) return null;
  return negativeByParen ? -Math.abs(parsed) : parsed;
};

const parseJsonSafe = (value: string): Record<string, unknown> => {
  try {
    const parsed = JSON.parse(value || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
};

const scoreKey = (key: string, keywords: string[]) => {
  const normalized = normalizeKey(key);
  return keywords.reduce((score, keyword) => {
    const normalizedKeyword = normalizeKey(keyword);
    if (!normalizedKeyword) return score;
    return normalized.includes(normalizedKeyword) ? score + 1 : score;
  }, 0);
};

const collectNumericBuckets = (rows: Record<string, unknown>[]) => {
  const buckets: MetricBuckets = new Map();
  const limit = Math.min(rows.length, 1200);
  for (let i = 0; i < limit; i += 1) {
    const row = rows[i];
    for (const [key, value] of Object.entries(row)) {
      const parsed = parseFlexibleNumber(value);
      if (parsed === null) continue;
      buckets.set(key, (buckets.get(key) || 0) + 1);
    }
  }
  return buckets;
};

const pickBestNumericKey = (
  buckets: MetricBuckets,
  keywords: string[],
  bannedKeywords: string[] = []
) => {
  let best: { key: string; score: number } | null = null;
  for (const [key, numericCount] of buckets.entries()) {
    const keywordScore = scoreKey(key, keywords);
    if (keywordScore === 0) continue;
    const blocked = bannedKeywords.some((keyword) => normalizeKey(key).includes(normalizeKey(keyword)));
    if (blocked) continue;
    const score = keywordScore * 10 + numericCount;
    if (!best || score > best.score) {
      best = { key, score };
    }
  }
  return best?.key ?? null;
};

const pickBestDateKey = (rows: Record<string, unknown>[], keywords: string[]) => {
  const counts = new Map<string, number>();
  const limit = Math.min(rows.length, 1200);
  for (let i = 0; i < limit; i += 1) {
    const row = rows[i];
    for (const [key, value] of Object.entries(row)) {
      const matchesKeyword = scoreKey(key, keywords) > 0;
      if (!matchesKeyword) continue;
      if (!parseDateCandidate(value)) continue;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }

  let best: { key: string; count: number } | null = null;
  for (const [key, count] of counts.entries()) {
    if (!best || count > best.count) best = { key, count };
  }
  return best?.key ?? null;
};

const toDisputeMap = async (
  dbPool: Pool,
  startBound: Date,
  projectId: number | null,
  projectIds: number[] | null
) => {
  const whereParts = [
    "partner IS NOT NULL",
    "TRIM(partner) <> ''",
    "status <> 'resolved'",
    "last_detected_at >= ?",
  ];
  const params: Array<number | string> = [toIsoDate(startBound)];
  if (projectId !== null) {
    whereParts.push("project_id = ?");
    params.push(projectId);
  } else if (projectIds !== null) {
    if (!projectIds.length) {
      return new Map<string, number>();
    }
    const placeholders = projectIds.map(() => "?").join(", ");
    whereParts.push(`project_id IN (${placeholders})`);
    params.push(...projectIds);
  }

  const [rows]: any = await dbPool.query(
    `SELECT
       COALESCE(NULLIF(TRIM(partner), ''), 'Unknown Partner') AS partner,
       COUNT(*) AS disputeCount
     FROM alerts
     WHERE ${whereParts.join(" AND ")}
     GROUP BY COALESCE(NULLIF(TRIM(partner), ''), 'Unknown Partner')`,
    params
  );

  const map = new Map<string, number>();
  for (const row of rows as Array<{ partner: string; disputeCount: number }>) {
    const partner = String(row.partner || "Unknown Partner");
    map.set(partner, Number(row.disputeCount || 0));
  }
  return map;
};

const toQualityByFileMap = async (dbPool: Pool, fileIds: number[]) => {
  const map = new Map<number, number>();
  if (fileIds.length === 0) return map;

  const placeholders = fileIds.map(() => "?").join(", ");
  const [rows]: any = await dbPool.query(
    `SELECT file_id AS fileId, score
     FROM data_quality_scores
     WHERE file_id IN (${placeholders})`,
    fileIds
  );

  for (const row of rows as Array<{ fileId: number; score: number }>) {
    const fileId = Number(row.fileId);
    const score = Number(row.score);
    if (!Number.isFinite(fileId) || !Number.isFinite(score)) continue;
    map.set(fileId, score);
  }

  return map;
};

const computePartnerScorecardFromEtl = async (
  dbPool: Pool,
  options: {
    projectId: number | null;
    scopedProjectIds: number[] | null;
    monthKeys: string[];
    startBound: Date;
    endBoundExclusive: Date;
    months: number;
    limit: number;
    rowLimit: number;
    partnerSearch: string;
    minScore: number | null;
    sortBy: PartnerScorecardResponse["filters"]["sortBy"];
    sortDir: PartnerScorecardResponse["filters"]["sortDir"];
  }
): Promise<PartnerScorecardResponse | null> => {
  const {
    projectId,
    scopedProjectIds,
    monthKeys,
    startBound,
    endBoundExclusive,
    months,
    limit,
    rowLimit,
    partnerSearch,
    minScore,
    sortBy,
    sortDir,
  } = options;
  const monthSet = new Set(monthKeys);

  const whereParts: string[] = ["a.day >= ?", "a.day < ?"];
  const whereParams: Array<number | string> = [toIsoDate(startBound), toIsoDate(endBoundExclusive)];
  if (projectId !== null) {
    whereParts.push("a.project_id = ?");
    whereParams.push(projectId);
  } else if (scopedProjectIds !== null) {
    if (!scopedProjectIds.length) {
      return {
        filters: {
          projectId,
          months,
          limit,
          rowLimit,
          partner: partnerSearch || null,
          minScore,
          sortBy,
          sortDir,
        },
        metricKeys: {
          revenue: "revenue_sum",
          usage: "usage_sum",
          paymentDelay: null,
          paymentDueDate: null,
          paymentPaidDate: null,
        },
        monthKeys,
        summary: {
          partnerCount: 0,
          totalRevenue: 0,
          totalUsage: 0,
          avgQualityScore: null,
          totalDisputes: 0,
          avgPaymentDelayDays: null,
          riskBreakdown: { low: 0, medium: 0, high: 0 },
        },
        partners: [],
      };
    }
    const placeholders = scopedProjectIds.map(() => "?").join(", ");
    whereParts.push(`a.project_id IN (${placeholders})`);
    whereParams.push(...scopedProjectIds);
  }
  const whereClause = `WHERE ${whereParts.join(" AND ")}`;

  try {
    const [monthlyRows]: any = await dbPool.query(
      `SELECT
         a.partner AS partner,
         DATE_FORMAT(a.day, '%Y-%m') AS monthKey,
         COALESCE(SUM(a.revenue_sum), 0) AS revenue,
         COALESCE(SUM(a.usage_sum), 0) AS usage,
         COALESCE(SUM(a.rows_count), 0) AS rows
       FROM analytics_file_daily_partner a
       ${whereClause}
       GROUP BY a.partner, DATE_FORMAT(a.day, '%Y-%m')`,
      whereParams
    );
    if (!Array.isArray(monthlyRows) || monthlyRows.length === 0) {
      return null;
    }

    const [fileCountRows]: any = await dbPool.query(
      `SELECT
         a.partner AS partner,
         COUNT(DISTINCT a.file_id) AS files
       FROM analytics_file_daily_partner a
       ${whereClause}
       GROUP BY a.partner`,
      whereParams
    );
    const [qualityRows, disputeCountByPartner] = await Promise.all([
      dbPool.query(
        `SELECT
           pf.partner AS partner,
           AVG(dqs.score) AS qualityScore
         FROM (
           SELECT DISTINCT a.partner, a.file_id
           FROM analytics_file_daily_partner a
           ${whereClause}
         ) pf
         JOIN data_quality_scores dqs ON dqs.file_id = pf.file_id
         GROUP BY pf.partner`,
        whereParams
      ),
      toDisputeMap(dbPool, startBound, projectId, scopedProjectIds),
    ]);

    const filesByPartner = new Map<string, number>();
    for (const row of fileCountRows as Array<{ partner: string; files: number }>) {
      filesByPartner.set(String(row.partner || "Unknown Partner"), Number(row.files || 0));
    }

    const qualityByPartner = new Map<string, number>();
    for (const row of (qualityRows as any)[0] as Array<{ partner: string; qualityScore: number }>) {
      const partner = String(row.partner || "Unknown Partner");
      const score = Number(row.qualityScore);
      if (Number.isFinite(score)) {
        qualityByPartner.set(partner, round(score, 1));
      }
    }

    const partnerMap = new Map<string, PartnerScorecardDraftItem>();
    const ensureItem = (partner: string) => {
      const existing = partnerMap.get(partner);
      if (existing) return existing;
      const created: PartnerScorecardDraftItem = {
        partner,
        revenue: 0,
        usage: 0,
        qualityScore: qualityByPartner.get(partner) ?? null,
        disputeCount: disputeCountByPartner.get(partner) || 0,
        paymentDelayDays: null,
        score: 0,
        rows: 0,
        files: filesByPartner.get(partner) || 0,
        trend: monthKeys.map((month) => ({ month, revenue: 0, usage: 0 })),
      };
      partnerMap.set(partner, created);
      return created;
    };

    for (const row of monthlyRows as Array<{ partner: string; monthKey: string; revenue: number; usage: number; rows: number }>) {
      const partner = String(row.partner || "Unknown Partner");
      const monthKey = String(row.monthKey || "");
      if (!monthSet.has(monthKey)) continue;
      const item = ensureItem(partner);
      const revenue = Number(row.revenue || 0);
      const usage = Number(row.usage || 0);
      item.revenue = round(item.revenue + revenue, 2);
      item.usage = round(item.usage + usage, 2);
      item.rows += Number(row.rows || 0);

      const trendPoint = item.trend.find((point) => point.month === monthKey);
      if (trendPoint) {
        trendPoint.revenue = round(trendPoint.revenue + revenue, 2);
        trendPoint.usage = round(trendPoint.usage + usage, 2);
      }
    }

    for (const [partner, disputeCount] of disputeCountByPartner.entries()) {
      const item = ensureItem(partner);
      item.disputeCount = disputeCount;
    }

    const baseItems = Array.from(partnerMap.values());
    const maxRevenue = Math.max(...baseItems.map((item) => Math.max(0, item.revenue)), 1);
    const maxUsage = Math.max(...baseItems.map((item) => Math.max(0, item.usage)), 1);

    const scoredItems = baseItems.map((item) => {
      const revenueNorm = item.revenue > 0 ? item.revenue / maxRevenue : 0;
      const usageNorm = item.usage > 0 ? item.usage / maxUsage : 0;
      const qualityNorm = ((item.qualityScore ?? 60) / 100) * 25;
      const disputePenalty = Math.min(item.disputeCount * 2.5, 18);
      const delayPenalty = 0;
      const rawScore = 25 + revenueNorm * 30 + usageNorm * 20 + qualityNorm - disputePenalty - delayPenalty;
      const score = round(clamp(rawScore, 0, 100), 1);
      const riskLevel = getRiskLevel(score, item.disputeCount, item.paymentDelayDays);
      return {
        ...item,
        score,
        riskLevel,
      };
    });

    const filteredItems = scoredItems.filter((item) => {
      if (partnerSearch && !item.partner.toLowerCase().includes(partnerSearch)) {
        return false;
      }
      if (minScore !== null && item.score < minScore) {
        return false;
      }
      return true;
    });

    const sortedItems = [...filteredItems].sort((a, b) => {
      const dir = sortDir === "asc" ? 1 : -1;
      const compareNumber = (aNum: number, bNum: number) => {
        if (aNum === bNum) return 0;
        return aNum > bNum ? dir : -dir;
      };

      if (sortBy === "partner") {
        const byPartner = a.partner.localeCompare(b.partner);
        if (byPartner !== 0) return byPartner * dir;
        return compareNumber(a.score, b.score) * -1;
      }
      if (sortBy === "revenue") {
        const byRevenue = compareNumber(a.revenue, b.revenue);
        if (byRevenue !== 0) return byRevenue;
      } else if (sortBy === "usage") {
        const byUsage = compareNumber(a.usage, b.usage);
        if (byUsage !== 0) return byUsage;
      } else if (sortBy === "quality") {
        const byQuality = compareNumber(a.qualityScore ?? -1, b.qualityScore ?? -1);
        if (byQuality !== 0) return byQuality;
      } else if (sortBy === "disputes") {
        const byDisputes = compareNumber(a.disputeCount, b.disputeCount);
        if (byDisputes !== 0) return byDisputes;
      } else if (sortBy === "delay") {
        const byDelay = compareNumber(a.paymentDelayDays ?? -1, b.paymentDelayDays ?? -1);
        if (byDelay !== 0) return byDelay;
      } else {
        const byScore = compareNumber(a.score, b.score);
        if (byScore !== 0) return byScore;
      }

      if (a.score !== b.score) return b.score - a.score;
      if (a.revenue !== b.revenue) return b.revenue - a.revenue;
      return a.partner.localeCompare(b.partner);
    });

    const qualityValues = sortedItems
      .map((item) => item.qualityScore)
      .filter((value): value is number => value !== null);
    const riskBreakdown = sortedItems.reduce(
      (acc, item) => {
        acc[item.riskLevel] += 1;
        return acc;
      },
      { low: 0, medium: 0, high: 0 }
    );

    return {
      filters: {
        projectId,
        months,
        limit,
        rowLimit,
        partner: partnerSearch || null,
        minScore,
        sortBy,
        sortDir,
      },
      metricKeys: {
        revenue: "revenue_sum",
        usage: "usage_sum",
        paymentDelay: null,
        paymentDueDate: null,
        paymentPaidDate: null,
      },
      monthKeys,
      summary: {
        partnerCount: sortedItems.length,
        totalRevenue: round(sortedItems.reduce((sum, item) => sum + item.revenue, 0), 2),
        totalUsage: round(sortedItems.reduce((sum, item) => sum + item.usage, 0), 2),
        avgQualityScore:
          qualityValues.length > 0
            ? round(qualityValues.reduce((sum, value) => sum + value, 0) / qualityValues.length, 1)
            : null,
        totalDisputes: sortedItems.reduce((sum, item) => sum + item.disputeCount, 0),
        avgPaymentDelayDays: null,
        riskBreakdown,
      },
      partners: sortedItems.slice(0, limit),
    };
  } catch (error: any) {
    if (String(error?.code || "") === "ER_NO_SUCH_TABLE") {
      return null;
    }
    throw error;
  }
};

export const computePartnerScorecard = async (
  dbPool: Pool,
  filters: PartnerScorecardFilters
): Promise<PartnerScorecardResponse> => {
  const scopedProjectIds = Array.isArray(filters.projectIds)
    ? Array.from(
        new Set(
          filters.projectIds
            .map((id) => Number(id))
            .filter((id) => Number.isFinite(id) && id > 0)
        )
      )
    : null;
  const projectId =
    Number.isFinite(filters.projectId) && Number(filters.projectId) > 0
      ? Number(filters.projectId)
      : null;
  const months = toPositiveInt(filters.months, 6, MIN_MONTHS, MAX_MONTHS);
  const limit = toPositiveInt(filters.limit, DEFAULT_LIMIT, MIN_LIMIT, MAX_LIMIT);
  const envRowLimit = Number(process.env.PARTNER_SCORECARD_ROW_LIMIT || DEFAULT_ROW_LIMIT);
  const rowLimit = toPositiveInt(filters.rowLimit, envRowLimit, MIN_ROW_LIMIT, MAX_ROW_LIMIT);
  const partnerSearch = String(filters.partnerSearch || "")
    .trim()
    .toLowerCase();
  const minScore = toOptionalBoundedNumber(filters.minScore, 0, 100);
  const sortBy = normalizeSortBy(filters.sortBy);
  const sortDir = normalizeSortDir(filters.sortDir);

  const monthKeys = buildMonthKeys(months);
  const scopedProjectKey =
    scopedProjectIds === null ? "all" : [...scopedProjectIds].sort((a, b) => a - b).join(",");
  const cacheKey = JSON.stringify({
    projectId,
    scopedProjectKey,
    months,
    limit,
    rowLimit,
    partnerSearch,
    minScore,
    sortBy,
    sortDir,
    monthAnchor: monthKeys[0],
  });
  const cached = partnerScorecardCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const monthSet = new Set(monthKeys);
  const startBound = parseDateCandidate(`${monthKeys[0]}-01`) || addMonthsUtc(toStartOfMonthUtc(new Date()), -(months - 1));
  const endBoundExclusive = addMonthsUtc(toStartOfMonthUtc(new Date()), 1);

  const etlResponse = await computePartnerScorecardFromEtl(dbPool, {
    projectId,
    scopedProjectIds,
    monthKeys,
    startBound,
    endBoundExclusive,
    months,
    limit,
    rowLimit,
    partnerSearch,
    minScore,
    sortBy,
    sortDir,
  });
  if (etlResponse) {
    partnerScorecardCache.set(cacheKey, etlResponse);
    return etlResponse;
  }

  const whereParts: string[] = ["f.uploaded_at >= ?"];
  const whereParams: Array<number | string> = [toIsoDate(startBound)];
  if (projectId !== null) {
    whereParts.push("f.project_id = ?");
    whereParams.push(projectId);
  } else if (scopedProjectIds !== null) {
    if (!scopedProjectIds.length) {
      whereParts.push("1 = 0");
    } else {
      const placeholders = scopedProjectIds.map(() => "?").join(", ");
      whereParts.push(`f.project_id IN (${placeholders})`);
      whereParams.push(...scopedProjectIds);
    }
  }

  const encryptionKey = getEncryptionKey();
  const dataJsonExpr = buildDataJsonExpr(encryptionKey);
  const rowKeyParams = buildKeyParams(encryptionKey, 1);

  const [rowRows]: any = await dbPool.query(
    `SELECT
       fr.file_id AS fileId,
       f.uploaded_at AS uploadedAt,
       ${dataJsonExpr} AS data_json
     FROM file_rows fr
     JOIN files f ON f.id = fr.file_id
     WHERE ${whereParts.join(" AND ")}
     ORDER BY f.uploaded_at DESC
     LIMIT ?`,
    [...rowKeyParams, ...whereParams, rowLimit]
  );

  const rows = rowRows as ParsedRowMeta[];
  const parsedRows = rows.map((row) => parseJsonSafe(String(row.data_json || "{}")));
  const metricBuckets = collectNumericBuckets(parsedRows);

  const revenueKey = pickBestNumericKey(metricBuckets, REVENUE_KEYWORDS);
  const usageKey = pickBestNumericKey(metricBuckets, USAGE_KEYWORDS, REVENUE_KEYWORDS);
  const paymentDelayKey = pickBestNumericKey(metricBuckets, PAYMENT_DELAY_KEYWORDS);
  const dueDateKey = pickBestDateKey(parsedRows, DUE_DATE_KEYWORDS);
  const paidDateKey = pickBestDateKey(parsedRows, PAID_DATE_KEYWORDS);

  const fileIds = Array.from(
    new Set(
      rows
        .map((row) => Number(row.fileId))
        .filter((id) => Number.isFinite(id) && id > 0)
    )
  );
  const [qualityByFile, disputeCountByPartner] = await Promise.all([
    toQualityByFileMap(dbPool, fileIds),
    toDisputeMap(dbPool, startBound, projectId, scopedProjectIds),
  ]);

  const partnerMap = new Map<string, PartnerAccumulator>();

  const ensureAccumulator = (partner: string) => {
    const existing = partnerMap.get(partner);
    if (existing) return existing;
    const created: PartnerAccumulator = {
      partner,
      revenue: 0,
      usage: 0,
      rows: 0,
      files: new Set<number>(),
      qualitySum: 0,
      qualityCount: 0,
      delaySum: 0,
      delayCount: 0,
      trend: new Map<string, TrendBucket>(),
    };
    partnerMap.set(partner, created);
    return created;
  };

  for (let i = 0; i < rows.length; i += 1) {
    const rowMeta = rows[i];
    const parsed = parsedRows[i];
    const summary = extractRoamingSummary(parsed);
    const partner = summary.partner || "Unknown Partner";
    const uploadedAtDate = parseDateCandidate(rowMeta.uploadedAt);
    const eventDate = getDateFromSummary(summary, parsed) || uploadedAtDate;
    if (!eventDate) continue;
    if (eventDate < startBound || eventDate >= endBoundExclusive) continue;

    const monthKey = toMonthKey(eventDate);
    if (!monthSet.has(monthKey)) continue;

    const acc = ensureAccumulator(partner);
    acc.rows += 1;
    acc.files.add(Number(rowMeta.fileId));

    const revenue = revenueKey ? parseFlexibleNumber(parsed[revenueKey]) : null;
    const usage = usageKey ? parseFlexibleNumber(parsed[usageKey]) : null;

    if (revenue !== null) acc.revenue += revenue;
    if (usage !== null) acc.usage += usage;

    let paymentDelay = paymentDelayKey ? parseFlexibleNumber(parsed[paymentDelayKey]) : null;
    if (paymentDelay === null && dueDateKey && paidDateKey) {
      const dueDate = parseDateCandidate(parsed[dueDateKey]);
      const paidDate = parseDateCandidate(parsed[paidDateKey]);
      if (dueDate && paidDate) {
        const diffDays = (paidDate.getTime() - dueDate.getTime()) / MS_PER_DAY;
        if (Number.isFinite(diffDays)) paymentDelay = Math.max(0, diffDays);
      }
    }
    if (paymentDelay !== null) {
      acc.delaySum += paymentDelay;
      acc.delayCount += 1;
    }

    const qualityScore = qualityByFile.get(Number(rowMeta.fileId));
    if (qualityScore !== undefined) {
      acc.qualitySum += qualityScore;
      acc.qualityCount += 1;
    }

    const trendBucket = acc.trend.get(monthKey) || { revenue: 0, usage: 0 };
    if (revenue !== null) trendBucket.revenue += revenue;
    if (usage !== null) trendBucket.usage += usage;
    acc.trend.set(monthKey, trendBucket);
  }

  const zeroTrend = monthKeys.map((month) => ({ month, revenue: 0, usage: 0 }));
  const baseItems: PartnerScorecardDraftItem[] = Array.from(partnerMap.values()).map((acc) => {
    const qualityScore = acc.qualityCount > 0 ? round(acc.qualitySum / acc.qualityCount, 1) : null;
    const paymentDelayDays = acc.delayCount > 0 ? round(acc.delaySum / acc.delayCount, 2) : null;
    const trend = monthKeys.map((month) => {
      const item = acc.trend.get(month);
      return {
        month,
        revenue: round(item?.revenue || 0, 2),
        usage: round(item?.usage || 0, 2),
      };
    });

    return {
      partner: acc.partner,
      revenue: round(acc.revenue, 2),
      usage: round(acc.usage, 2),
      qualityScore,
      disputeCount: disputeCountByPartner.get(acc.partner) || 0,
      paymentDelayDays,
      score: 0,
      rows: acc.rows,
      files: acc.files.size,
      trend,
    };
  });

  const existingPartners = new Set(baseItems.map((item) => item.partner));
  for (const [partner, disputeCount] of disputeCountByPartner.entries()) {
    if (existingPartners.has(partner)) continue;
    baseItems.push({
      partner,
      revenue: 0,
      usage: 0,
      qualityScore: null,
      disputeCount,
      paymentDelayDays: null,
      score: 0,
      rows: 0,
      files: 0,
      trend: zeroTrend,
    });
  }

  const maxRevenue = Math.max(...baseItems.map((item) => Math.max(0, item.revenue)), 1);
  const maxUsage = Math.max(...baseItems.map((item) => Math.max(0, item.usage)), 1);

  const scoredItems = baseItems.map((item) => {
    const revenueNorm = item.revenue > 0 ? item.revenue / maxRevenue : 0;
    const usageNorm = item.usage > 0 ? item.usage / maxUsage : 0;
    const qualityNorm = ((item.qualityScore ?? 60) / 100) * 25;
    const disputePenalty = Math.min(item.disputeCount * 2.5, 18);
    const delayPenalty = item.paymentDelayDays === null ? 0 : Math.min(item.paymentDelayDays * 1.2, 18);
    const rawScore = 25 + revenueNorm * 30 + usageNorm * 20 + qualityNorm - disputePenalty - delayPenalty;
    const score = round(clamp(rawScore, 0, 100), 1);
    const riskLevel = getRiskLevel(score, item.disputeCount, item.paymentDelayDays);

    return {
      ...item,
      score,
      riskLevel,
    };
  });

  const filteredItems = scoredItems.filter((item) => {
    if (partnerSearch && !item.partner.toLowerCase().includes(partnerSearch)) {
      return false;
    }
    if (minScore !== null && item.score < minScore) {
      return false;
    }
    return true;
  });

  const sortedItems = [...filteredItems].sort((a, b) => {
    const dir = sortDir === "asc" ? 1 : -1;
    const compareNumber = (aNum: number, bNum: number) => {
      if (aNum === bNum) return 0;
      return aNum > bNum ? dir : -dir;
    };

    if (sortBy === "partner") {
      const byPartner = a.partner.localeCompare(b.partner);
      if (byPartner !== 0) return byPartner * dir;
      return compareNumber(a.score, b.score) * -1;
    }
    if (sortBy === "revenue") {
      const byRevenue = compareNumber(a.revenue, b.revenue);
      if (byRevenue !== 0) return byRevenue;
    } else if (sortBy === "usage") {
      const byUsage = compareNumber(a.usage, b.usage);
      if (byUsage !== 0) return byUsage;
    } else if (sortBy === "quality") {
      const byQuality = compareNumber(a.qualityScore ?? -1, b.qualityScore ?? -1);
      if (byQuality !== 0) return byQuality;
    } else if (sortBy === "disputes") {
      const byDisputes = compareNumber(a.disputeCount, b.disputeCount);
      if (byDisputes !== 0) return byDisputes;
    } else if (sortBy === "delay") {
      const byDelay = compareNumber(a.paymentDelayDays ?? -1, b.paymentDelayDays ?? -1);
      if (byDelay !== 0) return byDelay;
    } else {
      const byScore = compareNumber(a.score, b.score);
      if (byScore !== 0) return byScore;
    }

    if (a.score !== b.score) return b.score - a.score;
    if (a.revenue !== b.revenue) return b.revenue - a.revenue;
    return a.partner.localeCompare(b.partner);
  });

  const qualityValues = sortedItems
    .map((item) => item.qualityScore)
    .filter((value): value is number => value !== null);
  const delayValues = sortedItems
    .map((item) => item.paymentDelayDays)
    .filter((value): value is number => value !== null);
  const riskBreakdown = sortedItems.reduce(
    (acc, item) => {
      acc[item.riskLevel] += 1;
      return acc;
    },
    { low: 0, medium: 0, high: 0 }
  );

  const response: PartnerScorecardResponse = {
    filters: {
      projectId,
      months,
      limit,
      rowLimit,
      partner: partnerSearch || null,
      minScore,
      sortBy,
      sortDir,
    },
    metricKeys: {
      revenue: revenueKey,
      usage: usageKey,
      paymentDelay: paymentDelayKey,
      paymentDueDate: dueDateKey,
      paymentPaidDate: paidDateKey,
    },
    monthKeys,
    summary: {
      partnerCount: sortedItems.length,
      totalRevenue: round(sortedItems.reduce((sum, item) => sum + item.revenue, 0), 2),
      totalUsage: round(sortedItems.reduce((sum, item) => sum + item.usage, 0), 2),
      avgQualityScore:
        qualityValues.length > 0
          ? round(qualityValues.reduce((sum, value) => sum + value, 0) / qualityValues.length, 1)
          : null,
      totalDisputes: sortedItems.reduce((sum, item) => sum + item.disputeCount, 0),
      avgPaymentDelayDays:
        delayValues.length > 0
          ? round(delayValues.reduce((sum, value) => sum + value, 0) / delayValues.length, 2)
          : null,
      riskBreakdown,
    },
    partners: sortedItems.slice(0, limit),
  };
  partnerScorecardCache.set(cacheKey, response);
  return response;
};
