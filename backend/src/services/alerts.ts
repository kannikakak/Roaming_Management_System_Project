import { Pool } from "mysql2/promise";
import { buildDataJsonExpr, buildKeyParams, getEncryptionKey } from "../utils/dbEncryption";
import {
  extractRoamingSummary,
  getDateFromSummary,
  parseDateCandidate,
} from "../utils/roamingData";

export type AlertSeverity = "low" | "medium" | "high";
export type AlertStatus = "open" | "resolved";

type UpsertAlertInput = {
  fingerprint: string;
  alertType: string;
  severity: AlertSeverity;
  title: string;
  message: string;
  source?: string;
  projectId?: number | null;
  projectName?: string | null;
  partner?: string | null;
  payload?: any;
};

type DetectionSummary = {
  created: number;
  reopened: number;
  updated: number;
  totalProcessed: number;
};

type AlertListFilters = {
  status?: string;
  severity?: string;
  projectId?: number;
  partner?: string;
  alertType?: string;
  q?: string;
  limit?: number;
  offset?: number;
};

const TRAFFIC_KEYWORDS = [
  "traffic",
  "usage",
  "volume",
  "mb",
  "gb",
  "minute",
  "minutes",
  "sms",
  "data",
  "call",
  "timesofattempted",
  "timesofanswered",
];
const REVENUE_KEYWORDS = [
  "revenue",
  "rev",
  "income",
  "amount",
  "charge",
  "billed",
  "billing",
  "fee",
];

const toDateKey = (value: Date) => value.toISOString().slice(0, 10);

const normalizeKey = (key: string) =>
  String(key || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

const parseNumber = (value: any) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value === null || value === undefined) return null;
  const raw = String(value).trim().replace(/,/g, "");
  if (!raw || raw === "-") return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
};

const clampSeverity = (value: string | undefined): AlertSeverity => {
  const lower = String(value || "").toLowerCase();
  if (lower === "low" || lower === "medium" || lower === "high") return lower;
  return "medium";
};

const clampStatus = (value: string | undefined): AlertStatus => {
  return String(value || "").toLowerCase() === "resolved" ? "resolved" : "open";
};

const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;

const stddev = (values: number[], avg: number) => {
  if (values.length < 2) return 0;
  const variance =
    values.reduce((sum, value) => {
      const delta = value - avg;
      return sum + delta * delta;
    }, 0) /
    (values.length - 1);
  return Math.sqrt(variance);
};

const median = (values: number[]) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
};

const readEnvNumber = (
  key: string,
  fallback: number,
  options: { min?: number; max?: number } = {}
) => {
  const parsed = Number(process.env[key]);
  let value = Number.isFinite(parsed) ? parsed : fallback;
  if (Number.isFinite(options.min)) {
    value = Math.max(options.min as number, value);
  }
  if (Number.isFinite(options.max)) {
    value = Math.min(options.max as number, value);
  }
  return value;
};

const positiveValues = (values: number[]) =>
  values.filter((value) => Number.isFinite(value) && value > 0);

const computeDynamicThreshold = (
  baseThreshold: number,
  baselineValues: number[],
  volatilityMultiplier: number,
  maxThreshold: number
) => {
  const clean = positiveValues(baselineValues);
  if (clean.length < 2) return baseThreshold;
  const avg = mean(clean);
  if (!Number.isFinite(avg) || avg <= 0) return baseThreshold;
  const sd = stddev(clean, avg);
  const coefficientOfVariation = sd > 0 ? sd / avg : 0;
  const candidate = baseThreshold + coefficientOfVariation * volatilityMultiplier;
  return Math.max(baseThreshold, Math.min(maxThreshold, candidate));
};

const scoreKey = (key: string, keywords: string[]) => {
  const nk = normalizeKey(key);
  let score = 0;
  for (const kw of keywords) {
    if (nk.includes(normalizeKey(kw))) score += 1;
  }
  return score;
};

type MetricBucket = { numericCount: number };

const collectMetricBuckets = (rows: Record<string, any>[]) => {
  const buckets = new Map<string, MetricBucket>();
  const limit = Math.min(rows.length, 1000);
  for (let i = 0; i < limit; i += 1) {
    const row = rows[i];
    if (!row || typeof row !== "object") continue;
    for (const [key, value] of Object.entries(row)) {
      const num = parseNumber(value);
      if (num === null) continue;
      if (!buckets.has(key)) buckets.set(key, { numericCount: 0 });
      buckets.get(key)!.numericCount += 1;
    }
  }
  return buckets;
};

const pickBestKey = (buckets: Map<string, MetricBucket>, keywords: string[]) => {
  let best: { key: string; score: number } | null = null;
  for (const [key, bucket] of buckets.entries()) {
    const keywordScore = scoreKey(key, keywords);
    if (keywordScore === 0) continue;
    const score = keywordScore * 10 + bucket.numericCount;
    if (!best || score > best.score) {
      best = { key, score };
    }
  }
  return best?.key ?? null;
};

export const ensureAlertsTable = async (dbPool: Pool) => {
  await dbPool.execute(`
    CREATE TABLE IF NOT EXISTS alerts (
      id INT AUTO_INCREMENT PRIMARY KEY,
      fingerprint VARCHAR(255) NOT NULL UNIQUE,
      alert_type VARCHAR(64) NOT NULL,
      severity VARCHAR(16) NOT NULL DEFAULT 'medium',
      status VARCHAR(16) NOT NULL DEFAULT 'open',
      title VARCHAR(255) NOT NULL,
      message TEXT NOT NULL,
      source VARCHAR(64) NOT NULL DEFAULT 'system',
      project_id INT NULL,
      project_name VARCHAR(255) NULL,
      partner VARCHAR(255) NULL,
      payload JSON NULL,
      first_detected_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_detected_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      resolved_at DATETIME NULL,
      resolved_by VARCHAR(255) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_alerts_status (status),
      INDEX idx_alerts_severity (severity),
      INDEX idx_alerts_project (project_id),
      INDEX idx_alerts_partner (partner),
      INDEX idx_alerts_alert_type (alert_type),
      INDEX idx_alerts_last_detected (last_detected_at),
      INDEX idx_alerts_project_detected_status_partner (project_id, last_detected_at, status, partner),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
    ) ENGINE=InnoDB
  `);
};

const emitAlertNotification = async (
  dbPool: Pool,
  alert: Pick<UpsertAlertInput, "title" | "message" | "severity" | "projectId" | "partner" | "alertType">,
  alertId?: number
) => {
  try {
    await dbPool.execute(
      "INSERT INTO notifications (type, channel, message, metadata) VALUES (?, ?, ?, ?)",
      [
        "alert_center",
        "system",
        `[${String(alert.severity || "medium").toUpperCase()}] ${alert.title}`,
        JSON.stringify({
          alertId: alertId ?? null,
          alertType: alert.alertType,
          projectId: alert.projectId ?? null,
          partner: alert.partner ?? null,
          message: alert.message,
        }),
      ]
    );
  } catch (err) {
    console.error("Failed to emit alert notification:", err);
  }
};

export const upsertAlert = async (
  dbPool: Pool,
  input: UpsertAlertInput
): Promise<{ id: number; created: boolean; reopened: boolean }> => {
  await ensureAlertsTable(dbPool);

  const fingerprint = String(input.fingerprint || "").trim();
  if (!fingerprint) {
    throw new Error("Alert fingerprint is required.");
  }

  const severity = clampSeverity(input.severity);
  const source = String(input.source || "system");
  const payload = input.payload === undefined || input.payload === null ? null : JSON.stringify(input.payload);

  const [rows]: any = await dbPool.query(
    "SELECT id, status FROM alerts WHERE fingerprint = ? LIMIT 1",
    [fingerprint]
  );

  if (!rows?.length) {
    const [result]: any = await dbPool.query(
      `INSERT INTO alerts
       (fingerprint, alert_type, severity, status, title, message, source, project_id, project_name, partner, payload, first_detected_at, last_detected_at)
       VALUES (?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [
        fingerprint,
        input.alertType,
        severity,
        input.title,
        input.message,
        source,
        input.projectId ?? null,
        input.projectName ?? null,
        input.partner ?? null,
        payload,
      ]
    );
    const id = Number(result?.insertId || 0);
    await emitAlertNotification(dbPool, input, id);
    return { id, created: true, reopened: false };
  }

  const existing = rows[0];
  const reopened = String(existing.status || "").toLowerCase() === "resolved";
  await dbPool.query(
    `UPDATE alerts
     SET alert_type = ?,
         severity = ?,
         status = 'open',
         title = ?,
         message = ?,
         source = ?,
         project_id = ?,
         project_name = ?,
         partner = ?,
         payload = ?,
         last_detected_at = NOW(),
         resolved_at = NULL,
         resolved_by = NULL
     WHERE id = ?`,
    [
      input.alertType,
      severity,
      input.title,
      input.message,
      source,
      input.projectId ?? null,
      input.projectName ?? null,
      input.partner ?? null,
      payload,
      existing.id,
    ]
  );

  if (reopened) {
    await emitAlertNotification(dbPool, input, Number(existing.id));
  }
  return { id: Number(existing.id), created: false, reopened };
};

export const listAlerts = async (dbPool: Pool, filters: AlertListFilters) => {
  await ensureAlertsTable(dbPool);

  const whereParts: string[] = [];
  const params: any[] = [];

  if (filters.status) {
    whereParts.push("status = ?");
    params.push(clampStatus(filters.status));
  }
  if (filters.severity) {
    whereParts.push("severity = ?");
    params.push(clampSeverity(filters.severity));
  }
  if (Number.isFinite(filters.projectId)) {
    whereParts.push("project_id = ?");
    params.push(filters.projectId);
  }
  if (filters.partner) {
    whereParts.push("partner LIKE ?");
    params.push(`%${filters.partner}%`);
  }
  if (filters.alertType) {
    whereParts.push("alert_type = ?");
    params.push(filters.alertType);
  }
  if (filters.q) {
    whereParts.push("(title LIKE ? OR message LIKE ? OR partner LIKE ? OR project_name LIKE ?)");
    params.push(`%${filters.q}%`, `%${filters.q}%`, `%${filters.q}%`, `%${filters.q}%`);
  }

  const whereClause = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";
  const limit = Number.isFinite(filters.limit) ? Math.max(1, Math.min(200, Number(filters.limit))) : 100;
  const offset = Number.isFinite(filters.offset) ? Math.max(0, Number(filters.offset)) : 0;

  const [rows]: any = await dbPool.query(
    `SELECT *
     FROM alerts
     ${whereClause}
     ORDER BY
       CASE severity WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END DESC,
       last_detected_at DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  const [countRows]: any = await dbPool.query(
    `SELECT COUNT(*) as total
     FROM alerts
     ${whereClause}`,
    params
  );

  return {
    items: Array.isArray(rows) ? rows : [],
    total: Number(countRows?.[0]?.total || 0),
  };
};

export const resolveAlert = async (dbPool: Pool, alertId: number, resolvedBy: string) => {
  await ensureAlertsTable(dbPool);
  await dbPool.query(
    "UPDATE alerts SET status = 'resolved', resolved_at = NOW(), resolved_by = ? WHERE id = ?",
    [resolvedBy || "system", alertId]
  );
};

export const reopenAlert = async (dbPool: Pool, alertId: number) => {
  await ensureAlertsTable(dbPool);
  await dbPool.query(
    "UPDATE alerts SET status = 'open', resolved_at = NULL, resolved_by = NULL WHERE id = ?",
    [alertId]
  );
};

const detectDataQualityWarnings = async (dbPool: Pool): Promise<DetectionSummary> => {
  const [rows]: any = await dbPool.query(
    `SELECT
       q.file_id as fileId,
       q.score,
       q.trust_level as trustLevel,
       q.missing_rate as missingRate,
       q.invalid_rate as invalidRate,
       q.schema_inconsistency_rate as schemaInconsistencyRate,
       f.name as fileName,
       f.project_id as projectId,
       p.name as projectName
     FROM data_quality_scores q
     JOIN files f ON f.id = q.file_id
     LEFT JOIN projects p ON p.id = f.project_id
     WHERE q.score < 70
        OR q.trust_level = 'Low'
        OR q.invalid_rate >= 0.15
        OR q.schema_inconsistency_rate >= 0.2`
  );

  let created = 0;
  let reopened = 0;
  let updated = 0;
  for (const row of rows as any[]) {
    const severity: AlertSeverity =
      Number(row.score) < 50 || Number(row.invalidRate) >= 0.3 ? "high" : "medium";
    const result = await upsertAlert(dbPool, {
      fingerprint: `data_quality_warning|file:${row.fileId}`,
      alertType: "data_quality_warning",
      severity,
      title: `Data quality warning on ${row.fileName}`,
      message: `Score ${Number(row.score).toFixed(1)} | trust ${row.trustLevel} | invalid ${(Number(row.invalidRate) * 100).toFixed(1)}% | schema inconsistency ${(Number(row.schemaInconsistencyRate) * 100).toFixed(1)}%`,
      source: "data_quality",
      projectId: Number(row.projectId),
      projectName: row.projectName || null,
      payload: row,
    });
    if (result.created) created += 1;
    else if (result.reopened) reopened += 1;
    else updated += 1;
  }

  return { created, reopened, updated, totalProcessed: rows.length };
};

const detectTrafficRevenueAndAnomalies = async (dbPool: Pool): Promise<DetectionSummary> => {
  const lookbackDays = readEnvNumber("ALERT_LOOKBACK_DAYS", 45, { min: 7, max: 365 });
  const rowLimit = readEnvNumber("ALERT_ROW_LIMIT", 50000, { min: 1000, max: 500000 });

  // Base thresholds are stricter by default to reduce false positives.
  const revenueDropThreshold = readEnvNumber("ALERT_REVENUE_DROP_THRESHOLD", 0.5, {
    min: 0.1,
    max: 0.95,
  });
  const trafficSpikeThreshold = readEnvNumber("ALERT_TRAFFIC_SPIKE_THRESHOLD", 1, {
    min: 0.1,
    max: 5,
  });

  // Dynamic tuning knobs.
  const baselineWindowDays = readEnvNumber("ALERT_BASELINE_WINDOW_DAYS", 7, { min: 3, max: 30 });
  const minHistoryPoints = readEnvNumber("ALERT_MIN_HISTORY_POINTS", 4, { min: 2, max: 20 });
  const minDailyRows = readEnvNumber("ALERT_MIN_DAILY_ROWS", 3, { min: 1, max: 5000 });
  const minBaselineRevenue = readEnvNumber("ALERT_MIN_BASELINE_REVENUE", 5, { min: 0 });
  const minBaselineTraffic = readEnvNumber("ALERT_MIN_BASELINE_TRAFFIC", 50, { min: 0 });
  const volatilityMultiplier = readEnvNumber("ALERT_DYNAMIC_VOLATILITY_MULTIPLIER", 0.6, {
    min: 0,
    max: 3,
  });
  const maxRevenueDropThreshold = readEnvNumber("ALERT_MAX_REVENUE_DROP_THRESHOLD", 0.85, {
    min: revenueDropThreshold,
    max: 0.99,
  });
  const maxTrafficSpikeThreshold = readEnvNumber("ALERT_MAX_TRAFFIC_SPIKE_THRESHOLD", 2.5, {
    min: trafficSpikeThreshold,
    max: 10,
  });
  const anomalyZThreshold = readEnvNumber("ALERT_ANOMALY_Z_THRESHOLD", 3, { min: 2, max: 8 });
  const anomalyHighZThreshold = readEnvNumber("ALERT_ANOMALY_HIGH_Z_THRESHOLD", 4, {
    min: anomalyZThreshold,
    max: 12,
  });

  const encryptionKey = getEncryptionKey();
  const dataJsonExpr = buildDataJsonExpr(encryptionKey);
  const keyParams = buildKeyParams(encryptionKey, 1);

  const [rows]: any = await dbPool.query(
    `SELECT
       p.id as projectId,
       p.name as projectName,
       f.uploaded_at as uploadedAt,
       ${dataJsonExpr} as data_json
     FROM file_rows fr
     JOIN files f ON fr.file_id = f.id
     JOIN projects p ON p.id = f.project_id
     WHERE f.uploaded_at >= DATE_SUB(NOW(), INTERVAL ${lookbackDays} DAY)
     ORDER BY f.uploaded_at DESC
     LIMIT ?`,
    [...keyParams, rowLimit]
  );

  type ParsedRow = {
    projectId: number;
    projectName: string;
    uploadedAt: string;
    parsed: Record<string, any>;
    partner: string;
    country: string;
    day: string;
  };

  const grouped = new Map<number, ParsedRow[]>();
  for (const row of rows as any[]) {
    let parsed: Record<string, any> = {};
    try {
      parsed = JSON.parse(row.data_json || "{}");
    } catch {
      parsed = {};
    }

    const summary = extractRoamingSummary(parsed);
    const eventDate =
      getDateFromSummary(summary, parsed) || parseDateCandidate(row.uploadedAt) || new Date(row.uploadedAt);
    if (!eventDate || Number.isNaN(eventDate.getTime())) continue;
    const day = toDateKey(eventDate);
    const partner = summary.partner || "Unknown Partner";
    const country = summary.country || "Unknown Country";

    const entry: ParsedRow = {
      projectId: Number(row.projectId),
      projectName: String(row.projectName || `Project ${row.projectId}`),
      uploadedAt: String(row.uploadedAt || ""),
      parsed,
      partner,
      country,
      day,
    };
    if (!grouped.has(entry.projectId)) grouped.set(entry.projectId, []);
    grouped.get(entry.projectId)!.push(entry);
  }

  let created = 0;
  let reopened = 0;
  let updated = 0;
  let totalProcessed = 0;

  for (const [projectId, entries] of grouped.entries()) {
    if (!entries.length) continue;
    totalProcessed += entries.length;

    const buckets = collectMetricBuckets(entries.map((item) => item.parsed));
    const revenueKey = pickBestKey(buckets, REVENUE_KEYWORDS);
    const trafficKey = pickBestKey(buckets, TRAFFIC_KEYWORDS);

    type PartnerDay = { day: string; revenue: number; traffic: number; rows: number };
    const partnerMap = new Map<string, Map<string, PartnerDay>>();

    for (const item of entries) {
      if (!partnerMap.has(item.partner)) partnerMap.set(item.partner, new Map());
      const dayMap = partnerMap.get(item.partner)!;
      if (!dayMap.has(item.day)) {
        dayMap.set(item.day, { day: item.day, revenue: 0, traffic: 0, rows: 0 });
      }
      const point = dayMap.get(item.day)!;
      point.rows += 1;
      if (revenueKey) {
        const revenue = parseNumber(item.parsed[revenueKey]);
        if (revenue !== null) point.revenue += revenue;
      }
      if (trafficKey) {
        const traffic = parseNumber(item.parsed[trafficKey]);
        if (traffic !== null) point.traffic += traffic;
      }
    }

    for (const [partner, dayMap] of partnerMap.entries()) {
      const daily = Array.from(dayMap.values()).sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
      if (daily.length < 2) continue;

      const curr = daily[daily.length - 1];
      if (!Number.isFinite(curr.rows) || curr.rows < minDailyRows) continue;

      const historyStart = Math.max(0, daily.length - 1 - baselineWindowDays);
      const history = daily.slice(historyStart, daily.length - 1);
      if (history.length < minHistoryPoints) continue;

      const historyRowMedian = median(history.map((point) => Number(point.rows || 0)));
      if (!Number.isFinite(historyRowMedian) || historyRowMedian < minDailyRows) continue;

      const prev = history[history.length - 1];

      if (revenueKey && curr.revenue > 0) {
        const revenueHistory = positiveValues(history.map((point) => Number(point.revenue || 0)));
        if (revenueHistory.length >= minHistoryPoints) {
          const revenueBaseline = mean(revenueHistory);
          if (Number.isFinite(revenueBaseline) && revenueBaseline >= minBaselineRevenue) {
            const dynamicDropThreshold = computeDynamicThreshold(
              revenueDropThreshold,
              revenueHistory,
              volatilityMultiplier,
              maxRevenueDropThreshold
            );
            const dropRatio = (revenueBaseline - curr.revenue) / revenueBaseline;
            if (dropRatio >= dynamicDropThreshold) {
              const highCutoff = Math.min(0.98, dynamicDropThreshold + 0.25);
              const severity: AlertSeverity = dropRatio >= highCutoff ? "high" : "medium";
              const alert = await upsertAlert(dbPool, {
                fingerprint: `revenue_drop|project:${projectId}|partner:${partner}|day:${curr.day}`,
                alertType: "revenue_drop",
                severity,
                title: `Revenue drop detected for ${partner}`,
                message:
                  `Revenue dropped ${(dropRatio * 100).toFixed(1)}% (` +
                  `${revenueBaseline.toFixed(2)} baseline -> ${curr.revenue.toFixed(2)}) on ${curr.day}.`,
                source: "alert_engine",
                projectId,
                projectName: entries[0].projectName,
                partner,
                payload: {
                  projectId,
                  partner,
                  day: curr.day,
                  previousRevenue: prev.revenue,
                  baselineRevenue: revenueBaseline,
                  currentRevenue: curr.revenue,
                  revenueKey,
                  dropRatio,
                  dynamicThreshold: dynamicDropThreshold,
                  baselineWindowDays,
                  minHistoryPoints,
                },
              });
              if (alert.created) created += 1;
              else if (alert.reopened) reopened += 1;
              else updated += 1;
            }
          }
        }
      }

      if (trafficKey && curr.traffic > 0) {
        const trafficHistory = positiveValues(history.map((point) => Number(point.traffic || 0)));
        if (trafficHistory.length >= minHistoryPoints) {
          const trafficBaseline = mean(trafficHistory);
          if (Number.isFinite(trafficBaseline) && trafficBaseline >= minBaselineTraffic) {
            const dynamicSpikeThreshold = computeDynamicThreshold(
              trafficSpikeThreshold,
              trafficHistory,
              volatilityMultiplier,
              maxTrafficSpikeThreshold
            );
            const spikeRatio = (curr.traffic - trafficBaseline) / trafficBaseline;
            if (spikeRatio >= dynamicSpikeThreshold) {
              const highCutoff = dynamicSpikeThreshold + 0.5;
              const severity: AlertSeverity = spikeRatio >= highCutoff ? "high" : "medium";
              const alert = await upsertAlert(dbPool, {
                fingerprint: `traffic_spike|project:${projectId}|partner:${partner}|day:${curr.day}`,
                alertType: "traffic_spike",
                severity,
                title: `Traffic spike detected for ${partner}`,
                message:
                  `Traffic increased ${(spikeRatio * 100).toFixed(1)}% (` +
                  `${trafficBaseline.toFixed(2)} baseline -> ${curr.traffic.toFixed(2)}) on ${curr.day}.`,
                source: "alert_engine",
                projectId,
                projectName: entries[0].projectName,
                partner,
                payload: {
                  projectId,
                  partner,
                  day: curr.day,
                  previousTraffic: prev.traffic,
                  baselineTraffic: trafficBaseline,
                  currentTraffic: curr.traffic,
                  trafficKey,
                  spikeRatio,
                  dynamicThreshold: dynamicSpikeThreshold,
                  baselineWindowDays,
                  minHistoryPoints,
                },
              });
              if (alert.created) created += 1;
              else if (alert.reopened) reopened += 1;
              else updated += 1;
            }
          }
        }
      }

      const anomalyMetricKey = trafficKey ? "traffic" : revenueKey ? "revenue" : "rows";
      const historyMetricValues = history.map((point) => Number(point[anomalyMetricKey as keyof PartnerDay] || 0));
      const cleanHistoryMetricValues = historyMetricValues.filter((value) => Number.isFinite(value));
      if (cleanHistoryMetricValues.length >= minHistoryPoints) {
        const avg = mean(cleanHistoryMetricValues);
        const sd = stddev(cleanHistoryMetricValues, avg);
        if (sd > 0 && Number.isFinite(sd)) {
          const lastValue = Number(curr[anomalyMetricKey as keyof PartnerDay] || 0);
          const zScore = (lastValue - avg) / sd;
          if (Math.abs(zScore) >= anomalyZThreshold) {
            const severity: AlertSeverity =
              Math.abs(zScore) >= anomalyHighZThreshold ? "high" : "medium";
            const alert = await upsertAlert(dbPool, {
              fingerprint: `anomaly_detection|project:${projectId}|partner:${partner}|metric:${anomalyMetricKey}|day:${curr.day}`,
              alertType: "anomaly_detection",
              severity,
              title: `Anomaly detected for ${partner}`,
              message:
                `Metric ${anomalyMetricKey} is abnormal on ${curr.day} ` +
                `(z-score ${zScore.toFixed(2)}, baseline ${avg.toFixed(2)}).`,
              source: "alert_engine",
              projectId,
              projectName: entries[0].projectName,
              partner,
              payload: {
                projectId,
                partner,
                day: curr.day,
                metric: anomalyMetricKey,
                value: lastValue,
                baselineMean: avg,
                zScore,
                zThreshold: anomalyZThreshold,
                baselineWindowDays,
              },
            });
            if (alert.created) created += 1;
            else if (alert.reopened) reopened += 1;
            else updated += 1;
          }
        }
      }
    }
  }

  return { created, reopened, updated, totalProcessed };
};

export const runAlertDetections = async (dbPool: Pool) => {
  await ensureAlertsTable(dbPool);
  const quality = await detectDataQualityWarnings(dbPool);
  const metrics = await detectTrafficRevenueAndAnomalies(dbPool);
  return {
    quality,
    metrics,
    totals: {
      created: quality.created + metrics.created,
      reopened: quality.reopened + metrics.reopened,
      updated: quality.updated + metrics.updated,
      processedRows: quality.totalProcessed + metrics.totalProcessed,
    },
  };
};

export const getAlertSummary = async (dbPool: Pool) => {
  await ensureAlertsTable(dbPool);
  const [rows]: any = await dbPool.query(
    `SELECT severity, status, COUNT(*) as total
     FROM alerts
     GROUP BY severity, status`
  );

  const base = {
    open: { low: 0, medium: 0, high: 0, total: 0 },
    resolved: { low: 0, medium: 0, high: 0, total: 0 },
  };

  for (const row of rows as any[]) {
    const status = clampStatus(row.status);
    const severity = clampSeverity(row.severity);
    const count = Number(row.total || 0);
    (base as any)[status][severity] += count;
    (base as any)[status].total += count;
  }

  return base;
};
