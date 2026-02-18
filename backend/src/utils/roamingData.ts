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

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MIN_REASONABLE_EPOCH_MS = Date.UTC(1990, 0, 1, 0, 0, 0, 0);
const MAX_REASONABLE_EPOCH_MS = Date.UTC(2100, 11, 31, 23, 59, 59, 999);
const EXCEL_EPOCH_OFFSET_DAYS = 25569; // 1970-01-01 relative to 1899-12-30

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

const isReasonableEpochDate = (date: Date) => {
  const time = date.getTime();
  return Number.isFinite(time) && time >= MIN_REASONABLE_EPOCH_MS && time <= MAX_REASONABLE_EPOCH_MS;
};

const createDateFromParts = (year: number, month: number, day: number) => {
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(date.getTime())) return null;
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
};

const parseNumericDateCandidate = (value: number) => {
  if (!Number.isFinite(value)) return null;
  const candidates: number[] = [];
  const absolute = Math.abs(value);

  // Epoch milliseconds.
  if (absolute >= 1e12 && absolute < 1e14) {
    candidates.push(Math.round(value));
  }
  // Epoch seconds.
  if (absolute >= 1e9 && absolute < 1e12) {
    candidates.push(Math.round(value * 1000));
  }
  // Excel serial date numbers.
  if (value >= 20000 && value <= 80000) {
    candidates.push(Math.round((value - EXCEL_EPOCH_OFFSET_DAYS) * MS_PER_DAY));
  }

  for (const candidate of candidates) {
    const date = new Date(candidate);
    if (isReasonableEpochDate(date)) {
      return date;
    }
  }
  return null;
};

export const parseDateCandidate = (value: any): Date | null => {
  if (value === null || value === undefined) return null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return parseNumericDateCandidate(value);
  }

  const raw = toStringValue(value);
  if (!raw) return null;

  if (/^-?\d+(\.\d+)?$/.test(raw)) {
    const numeric = Number(raw);
    return parseNumericDateCandidate(numeric);
  }

  const isoMatch = raw.match(/^(\d{4})[-/](\d{2})[-/](\d{2})/);
  if (isoMatch) {
    const [, y, m, d] = isoMatch;
    return createDateFromParts(Number(y), Number(m), Number(d));
  }

  const compactIsoMatch = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compactIsoMatch) {
    const [, y, m, d] = compactIsoMatch;
    return createDateFromParts(Number(y), Number(m), Number(d));
  }

  const dmyMatch = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmyMatch) {
    const [, a, b, y] = dmyMatch;
    const monthFirst = createDateFromParts(Number(y), Number(a), Number(b));
    if (monthFirst) return monthFirst;
    return createDateFromParts(Number(y), Number(b), Number(a));
  }

  const looksDateLike = /[a-zA-Z]|[-/:T.]/.test(raw);
  if (!looksDateLike) return null;

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed;
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
