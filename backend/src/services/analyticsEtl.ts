import { Pool } from "mysql2/promise";
import { buildDataJsonExpr, buildKeyParams, getEncryptionKey } from "../utils/dbEncryption";
import { extractRoamingSummary, getDateFromSummary, parseDateCandidate } from "../utils/roamingData";

const NET_REVENUE_KEYWORDS = [
  "netrevenue",
  "net_revenue",
  "totalnetrevenue",
  "net",
  "revenue",
  "billingvalue",
  "billingamount",
  "totalrevenue",
];
const USAGE_KEYWORDS = [
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
const PARTNER_KEYWORDS = [
  "roaming_partner",
  "partner",
  "partner_name",
  "operator",
  "network",
  "carrier",
  "mno",
  "plmn",
];
const TRAFFIC_KEYWORDS = ["traffic", "usage", "volume", "mb", "gb", "minute", "minutes", "sms", "data"];
const REVENUE_KEYWORDS = ["revenue", "rev", "income", "amount", "charge", "billed", "billing", "fee"];
const COST_KEYWORDS = ["cost", "expense", "payable", "wholesale", "charge", "billed", "fee"];
const EXPECTED_KEYWORDS = ["expected", "tariff", "rate", "agreed", "contract", "price"];
const ACTUAL_KEYWORDS = ["actual", "charged", "charge", "billed", "cost", "amount", "fee"];

type MetricBucket = { numericCount: number };
type FileMeta = { fileId: number; projectId: number; uploadedAt: string };

export type AnalyticsFileMetric = {
  fileId: number;
  projectId: number;
  uploadedAt: string;
  totalRows: number;
  netRevenueSum: number;
  usageSum: number;
  partnerCount: number;
  netRevenueKey: string | null;
  usageKey: string | null;
  partnerKey: string | null;
};

type DailyPartnerAggregate = {
  fileId: number;
  projectId: number;
  uploadedAt: string;
  day: string;
  partner: string;
  country: string;
  rowsCount: number;
  trafficSum: number;
  revenueSum: number;
  costSum: number;
  expectedSum: number;
  actualSum: number;
  usageSum: number;
};

const DEFAULT_BACKFILL_LIMIT = 2;
const DEFAULT_WORKER_INTERVAL_MS = 3 * 60 * 1000;

const toBoundedPositiveInt = (value: unknown, fallback: number, min: number, max: number) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
};

const normalizeKey = (value: string) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

const sanitizeLabel = (value: unknown, fallback: string) => {
  const text = String(value || "").trim();
  return text || fallback;
};

const parseNumber = (value: unknown): number | null => {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const direct = Number(raw);
  if (Number.isFinite(direct)) return direct;
  const noCommas = raw.replace(/,/g, "");
  const withCommas = Number(noCommas);
  if (Number.isFinite(withCommas)) return withCommas;
  const cleaned = noCommas.replace(/[^0-9.+-]/g, "");
  if (!cleaned || cleaned === "." || cleaned === "-" || cleaned === "+") return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
};

const scoreKey = (key: string, keywords: string[]) => {
  const normalized = normalizeKey(key);
  return keywords.reduce((score, keyword) => {
    const nk = normalizeKey(keyword);
    if (!nk) return score;
    return normalized.includes(nk) ? score + 1 : score;
  }, 0);
};

const findColumnByTerms = (columns: string[], terms: string[]) => {
  const normalizedTerms = terms.map((term) => normalizeKey(term)).filter(Boolean);
  for (const column of columns) {
    const normalized = normalizeKey(column);
    if (normalizedTerms.includes(normalized)) {
      return column;
    }
  }
  for (const column of columns) {
    const normalized = normalizeKey(column);
    if (normalizedTerms.some((term) => normalized.includes(term) && term.length > 2)) {
      return column;
    }
  }
  return null;
};

const collectMetricBuckets = (rows: Record<string, unknown>[]) => {
  const buckets = new Map<string, MetricBucket>();
  const limit = Math.min(rows.length, 1200);
  for (let i = 0; i < limit; i += 1) {
    const row = rows[i];
    if (!row || typeof row !== "object") continue;
    for (const [key, value] of Object.entries(row)) {
      const num = parseNumber(value);
      if (num === null) continue;
      if (!buckets.has(key)) {
        buckets.set(key, { numericCount: 0 });
      }
      buckets.get(key)!.numericCount += 1;
    }
  }
  return buckets;
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

const toDateKey = (date: Date) => date.toISOString().slice(0, 10);

const parseJsonSafe = (value: unknown): Record<string, unknown> => {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
};

const indexExists = async (dbPool: Pool, tableName: string, indexName: string) => {
  const [rows]: any = await dbPool.query(
    `SELECT COUNT(*) AS total
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND INDEX_NAME = ?`,
    [tableName, indexName]
  );
  return Number(rows?.[0]?.total || 0) > 0;
};

const ensureIndex = async (
  dbPool: Pool,
  tableName: string,
  indexName: string,
  definitionSql: string
) => {
  const exists = await indexExists(dbPool, tableName, indexName);
  if (exists) return;
  await dbPool.query(`ALTER TABLE ${tableName} ADD ${definitionSql}`);
};

export const ensureAnalyticsEtlSchema = async (dbPool: Pool) => {
  await dbPool.query(
    `CREATE TABLE IF NOT EXISTS analytics_file_metrics (
      file_id INT PRIMARY KEY,
      project_id INT NOT NULL,
      uploaded_at DATETIME NOT NULL,
      total_rows INT NOT NULL DEFAULT 0,
      net_revenue_sum DECIMAL(20,4) NOT NULL DEFAULT 0,
      usage_sum DECIMAL(20,4) NOT NULL DEFAULT 0,
      partner_count INT NOT NULL DEFAULT 0,
      net_revenue_key VARCHAR(255) NULL,
      usage_key VARCHAR(255) NULL,
      partner_key VARCHAR(255) NULL,
      computed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_afm_project_uploaded (project_id, uploaded_at),
      INDEX idx_afm_uploaded_at (uploaded_at),
      FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
    ) ENGINE=InnoDB`
  );

  await dbPool.query(
    `CREATE TABLE IF NOT EXISTS analytics_file_daily_partner (
      file_id INT NOT NULL,
      project_id INT NOT NULL,
      uploaded_at DATETIME NOT NULL,
      day DATE NOT NULL,
      partner VARCHAR(255) NOT NULL,
      country VARCHAR(255) NOT NULL,
      rows_count INT NOT NULL DEFAULT 0,
      traffic_sum DECIMAL(20,4) NOT NULL DEFAULT 0,
      revenue_sum DECIMAL(20,4) NOT NULL DEFAULT 0,
      cost_sum DECIMAL(20,4) NOT NULL DEFAULT 0,
      expected_sum DECIMAL(20,4) NOT NULL DEFAULT 0,
      actual_sum DECIMAL(20,4) NOT NULL DEFAULT 0,
      usage_sum DECIMAL(20,4) NOT NULL DEFAULT 0,
      computed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (file_id, day, partner, country),
      INDEX idx_afdp_project_day (project_id, day),
      INDEX idx_afdp_project_uploaded (project_id, uploaded_at),
      INDEX idx_afdp_project_partner_day (project_id, partner, day),
      INDEX idx_afdp_project_country_day (project_id, country, day),
      FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
    ) ENGINE=InnoDB`
  );

  await ensureIndex(
    dbPool,
    "analytics_file_metrics",
    "idx_afm_project_uploaded",
    "INDEX idx_afm_project_uploaded (project_id, uploaded_at)"
  );
  await ensureIndex(
    dbPool,
    "analytics_file_daily_partner",
    "idx_afdp_project_day",
    "INDEX idx_afdp_project_day (project_id, day)"
  );
};

const loadFileMeta = async (dbPool: Pool, fileId: number): Promise<FileMeta | null> => {
  const [[row]]: any = await dbPool.query(
    `SELECT id AS fileId, project_id AS projectId, uploaded_at AS uploadedAt
     FROM files
     WHERE id = ?
     LIMIT 1`,
    [fileId]
  );
  if (!row?.fileId) return null;
  return {
    fileId: Number(row.fileId),
    projectId: Number(row.projectId),
    uploadedAt: String(row.uploadedAt),
  };
};

const loadFileColumns = async (dbPool: Pool, fileId: number) => {
  const [rows]: any = await dbPool.query(
    "SELECT name FROM file_columns WHERE file_id = ? ORDER BY position ASC",
    [fileId]
  );
  return (rows as Array<{ name: string }>)
    .map((row) => String(row.name || "").trim())
    .filter(Boolean);
};

const loadParsedRows = async (dbPool: Pool, fileId: number) => {
  const encryptionKey = getEncryptionKey();
  const dataJsonExpr = buildDataJsonExpr(encryptionKey);
  const [rows]: any = await dbPool.query(
    `SELECT ${dataJsonExpr} AS data_json
     FROM file_rows
     WHERE file_id = ?
     ORDER BY row_index ASC`,
    [...buildKeyParams(encryptionKey, 1), fileId]
  );
  return (rows as Array<{ data_json: string }>).map((row) => parseJsonSafe(row.data_json));
};

const buildFileAggregates = (
  meta: FileMeta,
  columns: string[],
  rows: Record<string, unknown>[]
): { metrics: AnalyticsFileMetric; dailyRows: DailyPartnerAggregate[] } => {
  const buckets = collectMetricBuckets(rows);

  const netRevenueKey =
    findColumnByTerms(columns, NET_REVENUE_KEYWORDS) ||
    pickBestKey(buckets, NET_REVENUE_KEYWORDS);
  const usageKey =
    findColumnByTerms(columns, USAGE_KEYWORDS) ||
    pickBestKey(buckets, USAGE_KEYWORDS, NET_REVENUE_KEYWORDS);
  const partnerKey = findColumnByTerms(columns, PARTNER_KEYWORDS);

  const revenueKey = pickBestKey(buckets, REVENUE_KEYWORDS, EXPECTED_KEYWORDS) || netRevenueKey;
  const trafficKey = pickBestKey(buckets, TRAFFIC_KEYWORDS, EXPECTED_KEYWORDS) || usageKey;
  const costKey = pickBestKey(buckets, COST_KEYWORDS, EXPECTED_KEYWORDS);
  const expectedKey = pickBestKey(buckets, EXPECTED_KEYWORDS);
  const actualKey = pickBestKey(buckets, ACTUAL_KEYWORDS, EXPECTED_KEYWORDS);

  const uploadedAtDate = parseDateCandidate(meta.uploadedAt) || new Date(meta.uploadedAt);
  const partnerSet = new Set<string>();
  const dailyMap = new Map<string, DailyPartnerAggregate>();

  let netRevenueSum = 0;
  let usageSum = 0;

  for (const parsed of rows) {
    const summary = extractRoamingSummary(parsed);
    const partner = sanitizeLabel(summary.partner || (partnerKey ? parsed[partnerKey] : ""), "Unknown Partner");
    const country = sanitizeLabel(summary.country, "Unknown Country");
    const eventDate = getDateFromSummary(summary, parsed) || uploadedAtDate;
    const day = toDateKey(eventDate);
    const key = `${day}\u0001${partner}\u0001${country}`;

    if (!dailyMap.has(key)) {
      dailyMap.set(key, {
        fileId: meta.fileId,
        projectId: meta.projectId,
        uploadedAt: meta.uploadedAt,
        day,
        partner,
        country,
        rowsCount: 0,
        trafficSum: 0,
        revenueSum: 0,
        costSum: 0,
        expectedSum: 0,
        actualSum: 0,
        usageSum: 0,
      });
    }
    const bucket = dailyMap.get(key)!;
    bucket.rowsCount += 1;

    partnerSet.add(partner);

    const netRevenue = netRevenueKey ? parseNumber(parsed[netRevenueKey]) : null;
    const usage = usageKey ? parseNumber(parsed[usageKey]) : null;
    const revenue = revenueKey ? parseNumber(parsed[revenueKey]) : null;
    const traffic = trafficKey ? parseNumber(parsed[trafficKey]) : null;
    const cost = costKey ? parseNumber(parsed[costKey]) : null;
    const expected = expectedKey ? parseNumber(parsed[expectedKey]) : null;
    const actual = actualKey ? parseNumber(parsed[actualKey]) : null;

    if (netRevenue !== null) netRevenueSum += netRevenue;
    if (usage !== null) usageSum += usage;

    if (traffic !== null) bucket.trafficSum += traffic;
    if (revenue !== null) bucket.revenueSum += revenue;
    if (cost !== null) bucket.costSum += cost;
    if (expected !== null) bucket.expectedSum += expected;
    if (actual !== null) bucket.actualSum += actual;
    if (usage !== null) bucket.usageSum += usage;
  }

  return {
    metrics: {
      fileId: meta.fileId,
      projectId: meta.projectId,
      uploadedAt: meta.uploadedAt,
      totalRows: rows.length,
      netRevenueSum,
      usageSum,
      partnerCount: partnerSet.size,
      netRevenueKey,
      usageKey,
      partnerKey,
    },
    dailyRows: Array.from(dailyMap.values()),
  };
};

const writeFileAggregates = async (
  dbPool: Pool,
  aggregates: { metrics: AnalyticsFileMetric; dailyRows: DailyPartnerAggregate[] }
) => {
  const connection = await dbPool.getConnection();
  try {
    await connection.beginTransaction();

    const m = aggregates.metrics;
    await connection.query(
      `INSERT INTO analytics_file_metrics
         (file_id, project_id, uploaded_at, total_rows, net_revenue_sum, usage_sum, partner_count, net_revenue_key, usage_key, partner_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         project_id = VALUES(project_id),
         uploaded_at = VALUES(uploaded_at),
         total_rows = VALUES(total_rows),
         net_revenue_sum = VALUES(net_revenue_sum),
         usage_sum = VALUES(usage_sum),
         partner_count = VALUES(partner_count),
         net_revenue_key = VALUES(net_revenue_key),
         usage_key = VALUES(usage_key),
         partner_key = VALUES(partner_key),
         computed_at = CURRENT_TIMESTAMP`,
      [
        m.fileId,
        m.projectId,
        m.uploadedAt,
        m.totalRows,
        m.netRevenueSum,
        m.usageSum,
        m.partnerCount,
        m.netRevenueKey,
        m.usageKey,
        m.partnerKey,
      ]
    );

    await connection.query("DELETE FROM analytics_file_daily_partner WHERE file_id = ?", [m.fileId]);

    if (aggregates.dailyRows.length > 0) {
      const chunkSize = 400;
      for (let start = 0; start < aggregates.dailyRows.length; start += chunkSize) {
        const chunk = aggregates.dailyRows.slice(start, start + chunkSize);
        const valuesSql: string[] = [];
        const params: any[] = [];
        for (const row of chunk) {
          valuesSql.push("(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
          params.push(
            row.fileId,
            row.projectId,
            row.uploadedAt,
            row.day,
            row.partner,
            row.country,
            row.rowsCount,
            row.trafficSum,
            row.revenueSum,
            row.costSum,
            row.expectedSum,
            row.actualSum,
            row.usageSum
          );
        }

        await connection.query(
          `INSERT INTO analytics_file_daily_partner
             (file_id, project_id, uploaded_at, day, partner, country, rows_count, traffic_sum, revenue_sum, cost_sum, expected_sum, actual_sum, usage_sum)
           VALUES ${valuesSql.join(", ")}`,
          params
        );
      }
    }

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const refreshFileAggregates = async (dbPool: Pool, fileId: number) => {
  const meta = await loadFileMeta(dbPool, fileId);
  if (!meta) return;
  const [columns, rows] = await Promise.all([
    loadFileColumns(dbPool, fileId),
    loadParsedRows(dbPool, fileId),
  ]);
  const aggregates = buildFileAggregates(meta, columns, rows);
  await writeFileAggregates(dbPool, aggregates);
};

export const refreshAnalyticsForFiles = async (dbPool: Pool, fileIds: number[]) => {
  const uniqueFileIds = Array.from(
    new Set(
      fileIds
        .map((fileId) => Number(fileId))
        .filter((fileId) => Number.isFinite(fileId) && fileId > 0)
    )
  );
  for (const fileId of uniqueFileIds) {
    try {
      await refreshFileAggregates(dbPool, fileId);
    } catch (error: any) {
      console.error(`[analytics-etl] failed for file ${fileId}:`, error?.message || error);
    }
  }
};

let queuedRun: Promise<void> | null = null;
const queuedFileIds = new Set<number>();

export const queueRefreshAnalyticsForFiles = (dbPool: Pool, fileIds: number[]) => {
  for (const id of fileIds) {
    const fileId = Number(id);
    if (Number.isFinite(fileId) && fileId > 0) {
      queuedFileIds.add(fileId);
    }
  }
  if (queuedRun) return;

  queuedRun = Promise.resolve()
    .then(async () => {
      const batch = Array.from(queuedFileIds.values());
      queuedFileIds.clear();
      await refreshAnalyticsForFiles(dbPool, batch);
    })
    .finally(() => {
      queuedRun = null;
      if (queuedFileIds.size > 0) {
        queueRefreshAnalyticsForFiles(dbPool, []);
      }
    });
};

export const refreshMissingAnalytics = async (dbPool: Pool, limit = DEFAULT_BACKFILL_LIMIT) => {
  const boundedLimit = toBoundedPositiveInt(limit, DEFAULT_BACKFILL_LIMIT, 1, 20);
  const [rows]: any = await dbPool.query(
    `SELECT f.id AS fileId
     FROM files f
     LEFT JOIN analytics_file_metrics afm ON afm.file_id = f.id
     WHERE afm.file_id IS NULL OR afm.computed_at < f.uploaded_at
     ORDER BY f.uploaded_at DESC
     LIMIT ?`,
    [boundedLimit]
  );
  const fileIds = (rows as Array<{ fileId: number }>).map((row) => Number(row.fileId));
  if (fileIds.length === 0) return;
  await refreshAnalyticsForFiles(dbPool, fileIds);
};

export const startAnalyticsEtlWorker = (dbPool: Pool) => {
  const enabled = String(process.env.ENABLE_ANALYTICS_ETL_WORKER || "true").toLowerCase() !== "false";
  if (!enabled) {
    console.log("[analytics-etl] worker disabled by ENABLE_ANALYTICS_ETL_WORKER=false");
    return;
  }

  const intervalMs = toBoundedPositiveInt(
    process.env.ANALYTICS_ETL_INTERVAL_MS,
    DEFAULT_WORKER_INTERVAL_MS,
    30 * 1000,
    60 * 60 * 1000
  );
  const backfillLimit = toBoundedPositiveInt(
    process.env.ANALYTICS_ETL_BACKFILL_LIMIT,
    DEFAULT_BACKFILL_LIMIT,
    1,
    20
  );

  let running = false;
  const tick = () => {
    if (running) return;
    running = true;
    refreshMissingAnalytics(dbPool, backfillLimit)
      .catch((error) => {
        console.error("[analytics-etl] worker tick failed:", error);
      })
      .finally(() => {
        running = false;
      });
  };

  tick();
  setInterval(tick, intervalMs);
  console.log(`[analytics-etl] worker started (every ${Math.round(intervalMs / 1000)}s, limit=${backfillLimit})`);
};

export const loadFileMetricsMap = async (dbPool: Pool, fileIds: number[]) => {
  const unique = Array.from(
    new Set(
      fileIds
        .map((id) => Number(id))
        .filter((id) => Number.isFinite(id) && id > 0)
    )
  );
  const map = new Map<number, AnalyticsFileMetric>();
  if (unique.length === 0) return map;

  const placeholders = unique.map(() => "?").join(", ");
  const [rows]: any = await dbPool.query(
    `SELECT
       file_id AS fileId,
       project_id AS projectId,
       uploaded_at AS uploadedAt,
       total_rows AS totalRows,
       net_revenue_sum AS netRevenueSum,
       usage_sum AS usageSum,
       partner_count AS partnerCount,
       net_revenue_key AS netRevenueKey,
       usage_key AS usageKey,
       partner_key AS partnerKey
     FROM analytics_file_metrics
     WHERE file_id IN (${placeholders})`,
    unique
  );

  for (const row of rows as any[]) {
    const fileId = Number(row.fileId);
    if (!Number.isFinite(fileId) || fileId <= 0) continue;
    map.set(fileId, {
      fileId,
      projectId: Number(row.projectId || 0),
      uploadedAt: String(row.uploadedAt || ""),
      totalRows: Number(row.totalRows || 0),
      netRevenueSum: Number(row.netRevenueSum || 0),
      usageSum: Number(row.usageSum || 0),
      partnerCount: Number(row.partnerCount || 0),
      netRevenueKey: row.netRevenueKey ? String(row.netRevenueKey) : null,
      usageKey: row.usageKey ? String(row.usageKey) : null,
      partnerKey: row.partnerKey ? String(row.partnerKey) : null,
    });
  }

  return map;
};
