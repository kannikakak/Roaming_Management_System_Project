import path from "path";
import { spawn } from "child_process";

export type ColumnFormatRule =
  | { type: "number" }
  | { type: "integer" }
  | { type: "date" }
  | { type: "datetime" }
  | { type: "string" }
  | { type: "regex"; pattern: string };

export type UploadSchema = {
  requiredColumns: string[];
  optionalColumns: string[];
  formats: Record<string, ColumnFormatRule>;
  strict: boolean;
};

export type UploadConfig = {
  allowedExtensions: Set<string>;
  allowedMimeTypes: Set<string>;
  maxFileSizeBytes: number;
  maxFiles: number;
  maxColumns: number;
  maxRows: number;
  maxCellLength: number;
  scanEnabled: boolean;
  scanAllowMissing: boolean;
  scanCommand: string;
};

const DEFAULT_ALLOWED_EXTENSIONS = new Set([".csv", ".xlsx", ".xls"]);
const DEFAULT_ALLOWED_MIME = new Set([
  "text/csv",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/octet-stream",
]);

const toNumber = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export const getUploadConfig = (): UploadConfig => {
  const maxFileSizeMb = toNumber(process.env.UPLOAD_MAX_FILE_SIZE_MB, 25);
  const nodeEnv = String(process.env.NODE_ENV || "").toLowerCase();
  const allowMissingEnv = process.env.MALWARE_SCAN_ALLOW_MISSING;
  const allowMissing =
    String(allowMissingEnv || "").toLowerCase() === "true" ||
    (!allowMissingEnv && nodeEnv !== "production");
  return {
    allowedExtensions: DEFAULT_ALLOWED_EXTENSIONS,
    allowedMimeTypes: DEFAULT_ALLOWED_MIME,
    maxFileSizeBytes: Math.round(maxFileSizeMb * 1024 * 1024),
    maxFiles: Math.floor(toNumber(process.env.UPLOAD_MAX_FILES, 10)),
    maxColumns: Math.floor(toNumber(process.env.UPLOAD_MAX_COLUMNS, 200)),
    maxRows: Math.floor(toNumber(process.env.UPLOAD_MAX_ROWS, 200000)),
    maxCellLength: Math.floor(toNumber(process.env.UPLOAD_MAX_CELL_LENGTH, 5000)),
    scanEnabled: String(process.env.MALWARE_SCAN_ENABLED || "true").toLowerCase() !== "false",
    scanAllowMissing: allowMissing,
    scanCommand: process.env.MALWARE_SCAN_CMD || "clamscan",
  };
};

const parseCsvList = (value?: string) => {
  if (!value) return [];
  return value
    .split(/[,;\n]/)
    .map((v) => v.trim())
    .filter(Boolean);
};

const parseFormats = (raw?: string): Record<string, ColumnFormatRule> => {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, string>;
    const formats: Record<string, ColumnFormatRule> = {};
    for (const [key, value] of Object.entries(parsed)) {
      const normalized = String(value || "").trim();
      if (!normalized) continue;
      if (normalized === "number") formats[key] = { type: "number" };
      else if (normalized === "integer") formats[key] = { type: "integer" };
      else if (normalized === "date") formats[key] = { type: "date" };
      else if (normalized === "datetime") formats[key] = { type: "datetime" };
      else if (normalized === "string") formats[key] = { type: "string" };
      else if (normalized.startsWith("regex:")) {
        formats[key] = { type: "regex", pattern: normalized.slice(6) };
      }
    }
    return formats;
  } catch {
    return {};
  }
};

export const resolveUploadSchema = (body: any): UploadSchema => {
  const requiredColumns = parseCsvList(process.env.UPLOAD_REQUIRED_COLUMNS);
  const optionalColumns = parseCsvList(process.env.UPLOAD_OPTIONAL_COLUMNS);
  const formats = parseFormats(process.env.UPLOAD_COLUMN_FORMATS);

  let bodySchema: any = null;
  if (body?.schema) {
    try {
      bodySchema = typeof body.schema === "string" ? JSON.parse(body.schema) : body.schema;
    } catch {
      bodySchema = null;
    }
  }

  const bodyRequired = Array.isArray(bodySchema?.requiredColumns)
    ? bodySchema.requiredColumns.map((c: any) => String(c))
    : parseCsvList(body?.expectedColumns);
  const bodyOptional = Array.isArray(bodySchema?.optionalColumns)
    ? bodySchema.optionalColumns.map((c: any) => String(c))
    : [];
  const bodyFormats = bodySchema?.formats && typeof bodySchema.formats === "object"
    ? Object.fromEntries(
        Object.entries(bodySchema.formats).map(([k, v]) => [k, String(v)])
      )
    : null;

  const mergedFormats = {
    ...formats,
    ...(bodyFormats ? parseFormats(JSON.stringify(bodyFormats)) : {}),
  };

  const resolvedRequired = bodyRequired.length ? bodyRequired : requiredColumns;
  const resolvedOptional = bodyOptional.length ? bodyOptional : optionalColumns;
  const strictEnv = String(process.env.UPLOAD_SCHEMA_STRICT || "").toLowerCase();
  const strict =
    strictEnv === "true" ||
    (strictEnv !== "false" && (resolvedRequired.length > 0 || resolvedOptional.length > 0));

  return {
    requiredColumns: resolvedRequired,
    optionalColumns: resolvedOptional,
    formats: mergedFormats,
    strict,
  };
};

export const sanitizeFileName = (name: string) => {
  const base = path.basename(name || "uploaded");
  const cleaned = base
    .replace(/[\x00-\x1F\x7F]/g, "")
    .replace(/[<>:"/\\|?*]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.slice(0, 200) || "uploaded";
};

export const sanitizeColumnName = (name: string) => {
  const cleaned = String(name || "")
    .replace(/[\x00-\x1F\x7F]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "";
  if (!/^[A-Za-z0-9 _.\-()/]+$/.test(cleaned)) return "";
  return cleaned.slice(0, 128);
};

export const sanitizeCellValue = (value: any, maxLength: number) => {
  if (value === null || value === undefined) return "";
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Date) return value.toISOString();
  const stringValue = String(value)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .trim();
  return stringValue.length > maxLength ? stringValue.slice(0, maxLength) : stringValue;
};

export const validateAndNormalizeData = (
  columns: string[],
  rows: any[],
  schema: UploadSchema,
  config: UploadConfig
) => {
  if (!columns || columns.length === 0) {
    throw new Error("Missing header columns.");
  }
  if (columns.length > config.maxColumns) {
    throw new Error(`Too many columns (max ${config.maxColumns}).`);
  }

  const normalizedColumns = columns.map(sanitizeColumnName);
  if (normalizedColumns.some((c) => !c)) {
    throw new Error("Invalid column name detected. Use letters, numbers, spaces, dots, hyphens, or underscores.");
  }

  const lowerSet = new Set<string>();
  for (const col of normalizedColumns) {
    const lower = col.toLowerCase();
    if (lowerSet.has(lower)) {
      throw new Error("Duplicate column names detected.");
    }
    lowerSet.add(lower);
  }

  if (rows.length > config.maxRows) {
    throw new Error(`Too many rows (max ${config.maxRows}).`);
  }

  const normalizedRows: any[] = [];
  const expectedSet = new Set(normalizedColumns.map((c) => c.toLowerCase()));
  for (const row of rows) {
    const rowObj = row && typeof row === "object" ? row : {};
    const nextRow: Record<string, any> = {};
    for (let i = 0; i < columns.length; i += 1) {
      const original = columns[i];
      const normalized = normalizedColumns[i];
      const value = Object.prototype.hasOwnProperty.call(rowObj, original)
        ? rowObj[original]
        : rowObj[normalized];
      nextRow[normalized] = sanitizeCellValue(value, config.maxCellLength);
    }

    const extraKeys = Object.keys(rowObj).filter((key) => !expectedSet.has(String(key).toLowerCase()));
    if (extraKeys.length > 0) {
      throw new Error("Row contains unexpected columns.");
    }
    normalizedRows.push(nextRow);
  }

  const providedColumns = normalizedColumns.map((c) => c.toLowerCase());
  const requiredMissing = schema.requiredColumns
    .filter((c) => !providedColumns.includes(String(c).toLowerCase()));
  if (requiredMissing.length) {
    throw new Error(`Missing required columns: ${requiredMissing.join(", ")}`);
  }

  if (schema.strict) {
    const allowed = new Set([
      ...schema.requiredColumns.map((c) => String(c).toLowerCase()),
      ...schema.optionalColumns.map((c) => String(c).toLowerCase()),
    ]);
    const unexpected = normalizedColumns.filter((c) => !allowed.has(c.toLowerCase()));
    if (unexpected.length) {
      throw new Error(`Unexpected columns: ${unexpected.join(", ")}`);
    }
  }

  const formatErrors: string[] = [];
  const formatRules = schema.formats || {};
  const formatKeys = Object.keys(formatRules);
  if (formatKeys.length > 0) {
    for (const row of normalizedRows) {
      for (const key of formatKeys) {
        const rule = formatRules[key];
        const colName = normalizedColumns.find((c) => c.toLowerCase() === key.toLowerCase());
        if (!colName) continue;
        const rawValue = row[colName];
        if (rawValue === "" || rawValue === null || rawValue === undefined) continue;
        const value = String(rawValue);
        const isValid = validateFormat(value, rule);
        if (!isValid) {
          formatErrors.push(`${colName}: ${value}`);
          if (formatErrors.length >= 10) break;
        }
      }
      if (formatErrors.length >= 10) break;
    }
  }

  if (formatErrors.length > 0) {
    throw new Error(`Invalid data format in columns: ${formatErrors.join(" | ")}`);
  }

  return { columns: normalizedColumns, rows: normalizedRows };
};

const validateFormat = (value: string, rule: ColumnFormatRule) => {
  switch (rule.type) {
    case "number":
      return /^-?\d+(\.\d+)?$/.test(value);
    case "integer":
      return /^-?\d+$/.test(value);
    case "date":
      return /^\d{4}[-/](0[1-9]|1[0-2])[-/](0[1-9]|[12]\d|3[01])$/.test(value);
    case "datetime":
      return !Number.isNaN(Date.parse(value));
    case "regex":
      try {
        return new RegExp(rule.pattern).test(value);
      } catch {
        return false;
      }
    case "string":
      return value.length > 0;
    default:
      return true;
  }
};

export const isAllowedUpload = (fileName: string, mimeType: string, config: UploadConfig) => {
  const ext = path.extname(fileName || "").toLowerCase();
  const extAllowed = config.allowedExtensions.has(ext);
  const mimeAllowed = config.allowedMimeTypes.has(mimeType);
  return extAllowed && mimeAllowed;
};

export const scanFileForMalware = async (filePath: string, config: UploadConfig) => {
  if (!config.scanEnabled) return { clean: true };

  return new Promise<{ clean: boolean; error?: string }>((resolve) => {
    const child = spawn(config.scanCommand, ["--no-summary", filePath], {
      windowsHide: true,
    });

    let output = "";
    child.stdout.on("data", (data) => {
      output += String(data);
    });
    child.stderr.on("data", (data) => {
      output += String(data);
    });

    child.on("error", (err) => {
      if (config.scanAllowMissing) {
        resolve({ clean: true });
      } else {
        resolve({ clean: false, error: err.message || "Malware scan failed" });
      }
    });

    child.on("close", (code) => {
      if (code === 0) return resolve({ clean: true });
      if (code === 1) return resolve({ clean: false, error: "Malware detected" });
      resolve({ clean: false, error: output.trim() || "Malware scan error" });
    });
  });
};
