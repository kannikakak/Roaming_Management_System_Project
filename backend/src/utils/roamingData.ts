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

const COUNTRY_KEYS = [
  "country",
  "country_name",
  "destination_country",
  "origin_country",
  "region",
  "market",
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

type RoamingSummary = {
  partner: string | null;
  country: string | null;
  date: string | null;
};

const normalizeKey = (key: string) =>
  String(key || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

const toStringValue = (value: any) => {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  const str = String(value).trim();
  return str;
};

const buildNormalizedMap = (row: Record<string, any>) => {
  const map = new Map<string, any>();
  for (const [key, value] of Object.entries(row || {})) {
    map.set(normalizeKey(key), value);
  }
  return map;
};

const pickByKeys = (map: Map<string, any>, keys: string[]) => {
  for (const key of keys) {
    const value = map.get(normalizeKey(key));
    const str = toStringValue(value);
    if (str) return str;
  }
  return "";
};

export const parseDateCandidate = (value: any): Date | null => {
  if (value === null || value === undefined) return null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value > 1e12 ? value : value * 1000;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const raw = toStringValue(value);
  if (!raw) return null;

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) return parsed;

  const isoMatch = raw.match(/^(\d{4})[-/](\d{2})[-/](\d{2})/);
  if (isoMatch) {
    const [, y, m, d] = isoMatch;
    const date = new Date(Number(y), Number(m) - 1, Number(d));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const dmyMatch = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmyMatch) {
    const [, a, b, y] = dmyMatch;
    const monthFirst = new Date(Number(y), Number(a) - 1, Number(b));
    if (!Number.isNaN(monthFirst.getTime())) return monthFirst;
    const dayFirst = new Date(Number(y), Number(b) - 1, Number(a));
    return Number.isNaN(dayFirst.getTime()) ? null : dayFirst;
  }

  return null;
};

const scanForDate = (row: Record<string, any>) => {
  for (const value of Object.values(row || {})) {
    if (typeof value === "object") continue;
    const date = parseDateCandidate(value);
    if (date) return date;
  }
  return null;
};

export const extractRoamingSummary = (row: Record<string, any>): RoamingSummary => {
  const normalized = buildNormalizedMap(row);
  const partner = pickByKeys(normalized, PARTNER_KEYS) || null;
  const country = pickByKeys(normalized, COUNTRY_KEYS) || null;
  const dateStr = pickByKeys(normalized, DATE_KEYS) || null;

  return { partner, country, date: dateStr };
};

export const getDateFromSummary = (
  summary: RoamingSummary,
  row: Record<string, any>
): Date | null => {
  const fromSummary = summary.date ? parseDateCandidate(summary.date) : null;
  if (fromSummary) return fromSummary;
  return scanForDate(row);
};

export const rowContainsTerm = (row: Record<string, any>, term: string) => {
  const q = term.trim().toLowerCase();
  if (!q) return true;
  for (const value of Object.values(row || {})) {
    if (value === null || value === undefined) continue;
    if (typeof value === "object") continue;
    const str = String(value).toLowerCase();
    if (str.includes(q)) return true;
  }
  return false;
};

export const matchesFilterTerm = (
  primaryValue: string | null,
  row: Record<string, any>,
  filter: string
) => {
  const q = filter.trim().toLowerCase();
  if (!q) return true;
  if (primaryValue && primaryValue.toLowerCase().includes(q)) return true;
  return rowContainsTerm(row, filter);
};

export type { RoamingSummary };
