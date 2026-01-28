import { Pool } from "mysql2/promise";
import { parseDateCandidate } from "../utils/roamingData";

export type ColumnProfile = {
  name: string;
  inferredType: "number" | "date" | "boolean" | "string" | "unknown";
  nonNullCount: number;
  nullCount: number;
  distinctCount: number;
  sampleValues: string[];
  topValues: Array<{ value: string; count: number }>;
  numericStats?: {
    min: number | null;
    max: number | null;
    avg: number | null;
    sum: number | null;
    count: number;
  };
  dateStats?: {
    min: string | null;
    max: string | null;
    count: number;
  };
};

export type FileProfile = {
  version: 1;
  generatedAt: string;
  rowCount: number;
  columnCount: number;
  columns: ColumnProfile[];
  overview: {
    numericColumns: string[];
    dateColumns: string[];
    categoricalColumns: string[];
    highCardinalityColumns: string[];
  };
};

type ColumnAccumulator = {
  name: string;
  nonNullCount: number;
  nullCount: number;
  distinct: Set<string>;
  samples: string[];
  freq: Map<string, number>;
  numeric: {
    count: number;
    sum: number;
    min: number;
    max: number;
  };
  date: {
    count: number;
    min: Date | null;
    max: Date | null;
  };
  boolCount: number;
  stringCount: number;
};

const MAX_PROFILE_ROWS = 800;
const MAX_DISTINCT_TRACKED = 4000;
const MAX_TOP_VALUES = 8;
const MAX_SAMPLES = 6;

const isBlankLike = (value: any) => {
  if (value === null || value === undefined) return true;
  const str = String(value).trim();
  if (!str) return true;
  const lower = str.toLowerCase();
  return lower === "-" || lower === "null" || lower === "nan" || lower === "n/a";
};

const parseNumber = (value: any) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const n = Number(String(value).trim());
  return Number.isFinite(n) ? n : null;
};

const isBooleanLike = (value: any) => {
  const lower = String(value).trim().toLowerCase();
  return lower === "true" || lower === "false" || lower === "yes" || lower === "no" || lower === "0" || lower === "1";
};

const pushSample = (samples: string[], value: string) => {
  if (!value) return;
  if (samples.includes(value)) return;
  if (samples.length >= MAX_SAMPLES) return;
  samples.push(value);
};

const updateTopFrequency = (freq: Map<string, number>, value: string) => {
  if (!value) return;
  freq.set(value, (freq.get(value) || 0) + 1);
};

const finalizeTopValues = (freq: Map<string, number>) =>
  Array.from(freq.entries())
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, MAX_TOP_VALUES);

const inferType = (acc: ColumnAccumulator): ColumnProfile["inferredType"] => {
  const nonNull = acc.nonNullCount;
  if (nonNull === 0) return "unknown";

  const numericRatio = acc.numeric.count / nonNull;
  const dateRatio = acc.date.count / nonNull;
  const boolRatio = acc.boolCount / nonNull;

  if (numericRatio >= 0.7) return "number";
  if (dateRatio >= 0.6) return "date";
  if (boolRatio >= 0.8) return "boolean";
  return "string";
};

const toIso = (date: Date | null) => (date ? date.toISOString() : null);

export const ensureFileProfileTable = async (dbPool: Pool) => {
  await dbPool.query(
    `CREATE TABLE IF NOT EXISTS file_profiles (
      id INT AUTO_INCREMENT PRIMARY KEY,
      file_id INT NOT NULL UNIQUE,
      profile_json LONGTEXT NOT NULL,
      row_count INT NOT NULL DEFAULT 0,
      column_count INT NOT NULL DEFAULT 0,
      generated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
    ) ENGINE=InnoDB`
  );
};

export const buildFileProfile = (columns: string[], rows: Array<Record<string, any>>): FileProfile => {
  const trimmedColumns = (columns || []).map((c) => String(c)).filter(Boolean);
  const rowCount = rows.length;
  const sampleRows = rows.slice(0, MAX_PROFILE_ROWS);

  const accumulators = new Map<string, ColumnAccumulator>();
  for (const col of trimmedColumns) {
    accumulators.set(col, {
      name: col,
      nonNullCount: 0,
      nullCount: 0,
      distinct: new Set<string>(),
      samples: [],
      freq: new Map<string, number>(),
      numeric: { count: 0, sum: 0, min: Number.POSITIVE_INFINITY, max: Number.NEGATIVE_INFINITY },
      date: { count: 0, min: null, max: null },
      boolCount: 0,
      stringCount: 0,
    });
  }

  for (const row of sampleRows) {
    const obj = row && typeof row === "object" ? row : {};
    for (const col of trimmedColumns) {
      const acc = accumulators.get(col);
      if (!acc) continue;

      const raw = obj[col];
      if (isBlankLike(raw)) {
        acc.nullCount += 1;
        continue;
      }

      const strValue = String(raw).trim();
      acc.nonNullCount += 1;
      pushSample(acc.samples, strValue);
      updateTopFrequency(acc.freq, strValue);

      if (acc.distinct.size < MAX_DISTINCT_TRACKED) {
        acc.distinct.add(strValue);
      }

      const n = parseNumber(raw);
      if (n !== null) {
        acc.numeric.count += 1;
        acc.numeric.sum += n;
        acc.numeric.min = Math.min(acc.numeric.min, n);
        acc.numeric.max = Math.max(acc.numeric.max, n);
      }

      const d = parseDateCandidate(raw);
      if (d) {
        acc.date.count += 1;
        acc.date.min = !acc.date.min || d < acc.date.min ? d : acc.date.min;
        acc.date.max = !acc.date.max || d > acc.date.max ? d : acc.date.max;
      }

      if (isBooleanLike(raw)) {
        acc.boolCount += 1;
      } else {
        acc.stringCount += 1;
      }
    }
  }

  const columnsProfile: ColumnProfile[] = [];
  const numericColumns: string[] = [];
  const dateColumns: string[] = [];
  const categoricalColumns: string[] = [];
  const highCardinalityColumns: string[] = [];

  for (const col of trimmedColumns) {
    const acc = accumulators.get(col);
    if (!acc) continue;

    const inferredType = inferType(acc);
    const distinctCount = acc.distinct.size;
    const nonNull = acc.nonNullCount;
    const distinctRatio = nonNull > 0 ? distinctCount / nonNull : 0;

    if (inferredType === "number") numericColumns.push(col);
    else if (inferredType === "date") dateColumns.push(col);
    else categoricalColumns.push(col);

    if (distinctRatio >= 0.8 && nonNull >= 30) {
      highCardinalityColumns.push(col);
    }

    const numericStats =
      acc.numeric.count > 0
        ? {
            min: Number.isFinite(acc.numeric.min) ? acc.numeric.min : null,
            max: Number.isFinite(acc.numeric.max) ? acc.numeric.max : null,
            avg: acc.numeric.count > 0 ? acc.numeric.sum / acc.numeric.count : null,
            sum: acc.numeric.sum,
            count: acc.numeric.count,
          }
        : undefined;

    const dateStats =
      acc.date.count > 0
        ? {
            min: toIso(acc.date.min),
            max: toIso(acc.date.max),
            count: acc.date.count,
          }
        : undefined;

    columnsProfile.push({
      name: col,
      inferredType,
      nonNullCount: acc.nonNullCount,
      nullCount: acc.nullCount,
      distinctCount,
      sampleValues: acc.samples,
      topValues: finalizeTopValues(acc.freq),
      numericStats,
      dateStats,
    });
  }

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    rowCount,
    columnCount: trimmedColumns.length,
    columns: columnsProfile,
    overview: {
      numericColumns,
      dateColumns,
      categoricalColumns,
      highCardinalityColumns,
    },
  };
};

export const saveFileProfile = async (
  connection: any,
  fileId: number,
  profile: FileProfile
) => {
  const profileJson = JSON.stringify(profile);
  await connection.query(
    `INSERT INTO file_profiles (file_id, profile_json, row_count, column_count)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
      profile_json = VALUES(profile_json),
      row_count = VALUES(row_count),
      column_count = VALUES(column_count),
      updated_at = CURRENT_TIMESTAMP`,
    [fileId, profileJson, profile.rowCount, profile.columnCount]
  );
};

export const loadFileProfile = async (dbPool: Pool, fileId: number): Promise<FileProfile | null> => {
  const [rows]: any = await dbPool.query(
    "SELECT profile_json FROM file_profiles WHERE file_id = ? LIMIT 1",
    [fileId]
  );
  const raw = rows?.[0]?.profile_json;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as FileProfile;
  } catch {
    return null;
  }
};

