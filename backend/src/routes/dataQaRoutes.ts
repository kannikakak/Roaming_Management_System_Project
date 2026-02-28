import { Router } from "express";
import { Pool } from "mysql2/promise";
import { requireAuth } from "../middleware/auth";
import { buildDataJsonExpr, buildKeyParams, getEncryptionKey } from "../utils/dbEncryption";
import {
  ensureFileProfileTable,
  loadFileProfile,
  buildFileProfile,
  saveFileProfile,
  FileProfile,
} from "../services/fileProfile";

type AskPayload = {
  fileId?: number;
  projectId?: number;
  question: string;
};

type IntentType =
  | "rows"
  | "columns"
  | "count"
  | "distinct"
  | "sum"
  | "avg"
  | "min"
  | "max"
  | "top"
  | "compare"
  | "summary"
  | "types";

const METRIC_KEYWORD_GROUPS: Array<{ name: string; keywords: string[] }> = [
  { name: "revenue", keywords: ["revenue", "rev", "income", "sales", "charge", "billing", "amount"] },
  { name: "cost", keywords: ["cost", "expense", "actual", "payable", "wholesale", "spend"] },
  { name: "expected", keywords: ["expected", "tariff", "agreed", "contract", "rate"] },
  { name: "traffic", keywords: ["traffic", "usage", "volume", "mb", "gb", "minute", "minutes", "sms"] },
];

const DIMENSION_KEYWORD_GROUPS: Array<{ name: string; keywords: string[] }> = [
  { name: "client", keywords: ["client", "customer", "account", "enterprise"] },
  { name: "dataset", keywords: ["dataset", "file", "source", "table"] },
  { name: "partner", keywords: ["partner", "operator", "carrier", "network", "mno"] },
  { name: "country", keywords: ["country", "market", "region", "destination", "origin"] },
  { name: "service", keywords: ["service", "product", "plan", "package"] },
  { name: "date", keywords: ["date", "day", "month", "year", "period", "time"] },
];

function normalizeText(input: string) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function buildJsonPath(column: string) {
  const escaped = column.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `$."${escaped}"`;
}

function escapeRegExp(input: string) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function detectIntent(question: string): { type: IntentType; topN: number } {
  const lower = question.toLowerCase();
  const topMatch = lower.match(/\btop\s+(\d+)\b/);
  const topN = topMatch ? Math.max(1, Math.min(20, Number(topMatch[1]))) : 5;

  if (/\b(summary|overview|describe|profile|about this data|about this dataset)\b/.test(lower)) {
    return { type: "summary", topN };
  }
  if (/\b(type|types|datatype|data type|schema)\b/.test(lower)) {
    return { type: "types", topN };
  }
  if (/\b(columns?|fields?|headers?)\b/.test(lower)) {
    return { type: "columns", topN };
  }
  if (/\b(rows?|records?)\b/.test(lower) && /\bhow many\b|\bcount\b/.test(lower)) {
    return { type: "rows", topN };
  }
  if (/\btop\b|\bmost common\b|\bmost frequent\b/.test(lower)) {
    return { type: "top", topN };
  }
  if (/\bcompare\b|\bcomparison\b|\bdifference\b|\bdelta\b|\bvs\b|\bversus\b|\bbetween\b/.test(lower)) {
    return { type: "compare", topN };
  }
  if (/\bdistinct\b|\bunique\b/.test(lower)) {
    return { type: "distinct", topN };
  }
  if (/\baverage\b|\bavg\b|\bmean\b/.test(lower)) {
    return { type: "avg", topN };
  }
  if (/\bsum\b|\btotal\b/.test(lower)) {
    return { type: "sum", topN };
  }
  if (/\bmax\b|\bhighest\b|\blargest\b/.test(lower)) {
    return { type: "max", topN };
  }
  if (/\bmin\b|\blowest\b|\bsmallest\b/.test(lower)) {
    return { type: "min", topN };
  }
  if (/\bhow many\b|\bcount\b|\bnumber of\b/.test(lower)) {
    return { type: "count", topN };
  }
  return { type: "count", topN };
}

function scoreColumn(questionNorm: string, column: string) {
  const colNorm = normalizeText(column);
  if (!colNorm) return 0;

  let score = 0;
  if (questionNorm.includes(colNorm)) score += 4;

  const questionTokens = new Set(questionNorm.split(" ").filter(Boolean));
  const colTokens = colNorm.split(" ").filter(Boolean);
  let hits = 0;
  for (const token of colTokens) {
    if (questionTokens.has(token)) hits += 1;
  }
  if (hits === colTokens.length && hits > 0) score += 2;
  score += hits * 0.7;

  return score;
}

function scoreColumnByKeywords(column: string, keywords: string[]) {
  const colNorm = normalizeText(column);
  if (!colNorm) return 0;
  const compact = colNorm.replace(/\s+/g, "");
  let score = 0;

  for (const keyword of keywords) {
    const kwNorm = normalizeText(keyword);
    if (!kwNorm) continue;
    const kwCompact = kwNorm.replace(/\s+/g, "");
    if (colNorm.includes(kwNorm)) {
      score += 2;
      continue;
    }
    if (compact.includes(kwCompact)) {
      score += 1.5;
      continue;
    }
    const kwTokens = kwNorm.split(" ").filter(Boolean);
    if (kwTokens.length > 0 && kwTokens.every((token) => colNorm.includes(token))) {
      score += 1;
    }
  }

  return score;
}

function findBestColumnByKeywords(columns: string[], keywords: string[], excluded: string[] = []) {
  const excludedSet = new Set(excluded);
  let best = "";
  let bestScore = 0;
  for (const col of columns) {
    if (excludedSet.has(col)) continue;
    const score = scoreColumnByKeywords(col, keywords);
    if (score > bestScore) {
      best = col;
      bestScore = score;
    }
  }
  return bestScore > 0 ? best : "";
}

function pickColumnsByAskedGroups(
  questionNorm: string,
  columns: string[],
  groups: Array<{ name: string; keywords: string[] }>,
  excluded: string[] = []
) {
  const selected: string[] = [];
  const used = new Set(excluded);
  for (const group of groups) {
    const asked = group.keywords.some((kw) => questionNorm.includes(normalizeText(kw)));
    if (!asked) continue;
    const match = findBestColumnByKeywords(columns, group.keywords, Array.from(used));
    if (match) {
      selected.push(match);
      used.add(match);
    }
  }
  return selected;
}

function pickColumn(questionNorm: string, columns: string[]) {
  let best = "";
  let bestScore = 0;
  for (const col of columns) {
    const score = scoreColumn(questionNorm, col);
    if (score > bestScore) {
      bestScore = score;
      best = col;
    }
  }
  return bestScore >= 0.7 ? best : "";
}

function findGroupByColumn(question: string, columns: string[]) {
  const lower = question.toLowerCase();
  const normalized = normalizeText(question);
  const sorted = [...columns].sort((a, b) => b.length - a.length);

  for (const col of sorted) {
    const colLower = col.toLowerCase();
    const escaped = escapeRegExp(colLower);
    const patterns = [
      new RegExp(`\\bgroup\\s+by\\s+${escaped}\\b`),
      new RegExp(`\\bby\\s+${escaped}\\b`),
      new RegExp(`\\bper\\s+${escaped}\\b`),
    ];
    if (patterns.some((pattern) => pattern.test(lower))) {
      return col;
    }
  }

  if (/\b(by|per|group|grouped|split|wise)\b/.test(lower)) {
    const semantic = pickColumnsByAskedGroups(normalized, columns, DIMENSION_KEYWORD_GROUPS);
    if (semantic.length > 0) {
      return semantic[0];
    }
  }
  return "";
}

function findFilter(question: string, columns: string[]) {
  const lower = question.toLowerCase();
  const sorted = [...columns].sort((a, b) => b.length - a.length);
  const stopWords = /(\band\b|\bor\b|,|\.|;)/i;

  for (const col of sorted) {
    const colLower = col.toLowerCase();
    const patterns = [
      `${colLower} =`,
      `${colLower} is`,
      `${colLower}:`,
      `${colLower} equals`,
    ];
    for (const pattern of patterns) {
      const idx = lower.indexOf(pattern);
      if (idx < 0) continue;
      const after = lower.slice(idx + pattern.length).trim();
      const rawValue = after.split(stopWords)[0]?.trim() || "";
      const value = rawValue.replace(/^["']|["']$/g, "").trim();
      if (value) {
        return { column: col, value };
      }
    }
  }
  return null;
}

function extractValueHint(question: string) {
  const normalized = normalizeText(question);
  const patterns = [
    /\bhow many\s+([a-z0-9_-]+)\b/,
    /\bcount\s+([a-z0-9_-]+)\b/,
    /\bnumber of\s+([a-z0-9_-]+)\b/,
  ];
  const blocked = new Set([
    "row",
    "rows",
    "record",
    "records",
    "column",
    "columns",
    "field",
    "fields",
    "header",
    "headers",
  ]);

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match && match[1]) {
      const value = match[1].trim();
      if (!blocked.has(value)) return value;
    }
  }
  return "";
}

async function inferColumnByValue(
  dbPool: Pool,
  fileId: number,
  columns: string[],
  rawValue: string
) {
  const target = rawValue.toLowerCase();
  if (!target) return null;

  const maxColumns = 50;
  const inspectedColumns = columns.slice(0, maxColumns);
  const encryptionKey = getEncryptionKey();
  const dataJsonExpr = buildDataJsonExpr(encryptionKey);
  const [rows] = await dbPool.query<any[]>(
    `SELECT ${dataJsonExpr} as data_json FROM file_rows WHERE file_id = ? LIMIT 200`,
    [...buildKeyParams(encryptionKey, 1), fileId]
  );

  const counts = new Map<string, number>();
  for (const row of rows || []) {
    let data: Record<string, any> = {};
    try {
      data = JSON.parse(row.data_json || "{}");
    } catch {
      continue;
    }
    for (const col of inspectedColumns) {
      const value = data[col];
      if (value === undefined || value === null) continue;
      const normalized = String(value).trim().toLowerCase();
      if (normalized === target) {
        counts.set(col, (counts.get(col) || 0) + 1);
      }
    }
  }

  let bestCol = "";
  let bestCount = 0;
  for (const [col, count] of counts.entries()) {
    if (count > bestCount) {
      bestCol = col;
      bestCount = count;
    }
  }

  if (!bestCol) return null;
  return { column: bestCol, value: rawValue };
}

function formatNumber(value: number) {
  if (!Number.isFinite(value)) return "0";
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function findProfileColumn(profile: FileProfile | null, column: string) {
  if (!profile) return null;
  return profile.columns.find((c) => c.name === column) || null;
}

function formatProfileSummary(profile: FileProfile, fileName: string) {
  const numeric = profile.overview.numericColumns.length;
  const dates = profile.overview.dateColumns.length;
  const categorical = profile.overview.categoricalColumns.length;
  const numericPreview = profile.overview.numericColumns.slice(0, 4).join(", ");
  const datePreview = profile.overview.dateColumns.slice(0, 3).join(", ");

  const parts: string[] = [];
  parts.push(
    `${fileName} has ${profile.rowCount} rows and ${profile.columnCount} columns.`
  );
  parts.push(
    `I detected ${numeric} numeric, ${dates} date, and ${categorical} categorical columns.`
  );
  if (numericPreview) parts.push(`Numeric examples: ${numericPreview}.`);
  if (datePreview) parts.push(`Date examples: ${datePreview}.`);
  return parts.join(" ");
}

function formatProfileTypes(profile: FileProfile) {
  const groups: Array<{ label: string; cols: string[] }> = [
    { label: "Numeric", cols: profile.overview.numericColumns },
    { label: "Date", cols: profile.overview.dateColumns },
    { label: "Categorical/String", cols: profile.overview.categoricalColumns },
  ];

  const lines = groups
    .map((g) => {
      if (!g.cols.length) return "";
      const preview = g.cols.slice(0, 8);
      const extra = g.cols.length > preview.length ? g.cols.length - preview.length : 0;
      return `${g.label}: ${preview.join(", ")}${extra ? ` and ${extra} more` : ""}`;
    })
    .filter(Boolean);

  return lines.length ? lines.join(". ") : "I could not infer column types yet.";
}

function pickColumnWithProfile(
  questionNorm: string,
  columns: string[],
  profile: FileProfile | null,
  intentType: IntentType
) {
  const basePick = pickColumn(questionNorm, columns);
  if (basePick) return basePick;
  if (!profile) return "";

  const preferNumeric = intentType === "sum" || intentType === "avg" || intentType === "min" || intentType === "max";
  const preferCategorical = intentType === "top" || intentType === "distinct";

  if (preferNumeric && profile.overview.numericColumns.length) {
    return profile.overview.numericColumns[0];
  }
  if (preferCategorical && profile.overview.categoricalColumns.length) {
    return profile.overview.categoricalColumns[0];
  }
  return profile.columns[0]?.name || "";
}

type QaRowObject = Record<string, any>;

type FallbackFileContext = {
  id: number;
  name: string;
  columns: string[];
  rows: QaRowObject[];
  profile: FileProfile | null;
};

function isBlankLikeValue(value: any) {
  if (value === null || value === undefined) return true;
  const str = String(value).trim();
  if (!str) return true;
  const lower = str.toLowerCase();
  return lower === "-" || lower === "null" || lower === "nan" || lower === "n/a";
}

function normalizeCellValue(value: any) {
  if (isBlankLikeValue(value)) return "";
  return String(value).trim();
}

function parseNumericValue(value: any) {
  const normalized = normalizeCellValue(value);
  if (!normalized) return null;
  const isParenNegative = /^\(.*\)$/.test(normalized);
  const unwrapped = isParenNegative ? normalized.slice(1, -1) : normalized;
  const cleaned = unwrapped
    .replace(/,/g, "")
    .replace(/[$€£¥₩₫៛%]/g, "")
    .replace(/[^\d.+-]/g, "");
  if (!cleaned || !/[0-9]/.test(cleaned)) return null;
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) return null;
  return isParenNegative ? -Math.abs(parsed) : parsed;
}

function inferNumericColumnsFromRows(columns: string[], rows: QaRowObject[]) {
  const result: string[] = [];
  const sampledRows = rows.slice(0, 400);
  for (const col of columns) {
    let nonBlank = 0;
    let numeric = 0;
    for (const row of sampledRows) {
      const raw = row?.[col];
      if (isBlankLikeValue(raw)) continue;
      nonBlank += 1;
      if (parseNumericValue(raw) !== null) numeric += 1;
    }
    if (nonBlank > 0 && numeric / nonBlank >= 0.6) {
      result.push(col);
    }
  }
  return result;
}

function inferCategoricalColumnsFromRows(columns: string[], rows: QaRowObject[]) {
  const result: string[] = [];
  const sampledRows = rows.slice(0, 400);
  for (const col of columns) {
    let nonBlank = 0;
    let numeric = 0;
    for (const row of sampledRows) {
      const raw = row?.[col];
      if (isBlankLikeValue(raw)) continue;
      nonBlank += 1;
      if (parseNumericValue(raw) !== null) numeric += 1;
    }
    if (nonBlank > 0 && numeric / nonBlank <= 0.35) {
      result.push(col);
    }
  }
  return result;
}

function pickFallbackColumn(
  questionNorm: string,
  columns: string[],
  rows: QaRowObject[],
  profile: FileProfile | null,
  intentType: IntentType
) {
  const direct = pickColumn(questionNorm, columns);
  if (direct) return direct;

  const numericCols =
    profile?.overview.numericColumns?.length
      ? profile.overview.numericColumns
      : inferNumericColumnsFromRows(columns, rows);
  const categoricalCols =
    profile?.overview.categoricalColumns?.length
      ? profile.overview.categoricalColumns
      : inferCategoricalColumnsFromRows(columns, rows);

  const preferNumeric =
    intentType === "sum" ||
    intentType === "avg" ||
    intentType === "min" ||
    intentType === "max" ||
    intentType === "compare";
  const preferCategorical = intentType === "top" || intentType === "distinct";

  if (preferNumeric && numericCols.length) return numericCols[0];
  if (preferCategorical && categoricalCols.length) return categoricalCols[0];
  return columns[0] || "";
}

function inferColumnByValueFromRows(columns: string[], rows: QaRowObject[], rawValue: string) {
  const target = rawValue.trim().toLowerCase();
  if (!target) return null;

  const counts = new Map<string, number>();
  for (const row of rows.slice(0, 500)) {
    for (const col of columns) {
      const value = normalizeCellValue(row?.[col]).toLowerCase();
      if (!value) continue;
      if (value === target) {
        counts.set(col, (counts.get(col) || 0) + 1);
      }
    }
  }

  let bestCol = "";
  let bestCount = 0;
  for (const [col, count] of counts.entries()) {
    if (count > bestCount) {
      bestCol = col;
      bestCount = count;
    }
  }
  if (!bestCol) return null;
  return { column: bestCol, value: rawValue };
}

function parseJsonObject(input: any): QaRowObject | null {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    return input as QaRowObject;
  }
  if (typeof input !== "string") return null;
  try {
    const parsed = JSON.parse(input);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as QaRowObject;
    }
    return null;
  } catch {
    return null;
  }
}

async function loadRowsForFallback(
  dbPool: Pool,
  fileId: number,
  maxRows: number
): Promise<QaRowObject[]> {
  const encryptionKey = getEncryptionKey();
  const dataTextExpr = encryptionKey
    ? "COALESCE(CAST(AES_DECRYPT(data_json, ?) AS CHAR CHARACTER SET utf8mb4), CAST(data_json AS CHAR CHARACTER SET utf8mb4))"
    : "CAST(data_json AS CHAR CHARACTER SET utf8mb4)";
  const params = encryptionKey ? [encryptionKey, fileId, maxRows] : [fileId, maxRows];
  const [rows]: any = await dbPool.query(
    `SELECT ${dataTextExpr} as data_text
     FROM file_rows
     WHERE file_id = ?
     ORDER BY row_index ASC
     LIMIT ?`,
    params
  );

  const parsed: QaRowObject[] = [];
  for (const row of rows || []) {
    const obj = parseJsonObject(row?.data_text);
    if (obj) parsed.push(obj);
  }
  return parsed;
}

function cleanCompareHintText(input: string) {
  return input
    .toLowerCase()
    .replace(/\b(graph|chart|visual|plot|please|show|me|the|a|an|based on|base on)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseCompareHints(question: string) {
  const lower = question.toLowerCase();
  const compareMatch = lower.match(
    /\bcompare\s+(.+?)\s+(?:and|vs|versus)\s+(.+?)(?:\s+\bby\b|\s+\bper\b|$)/
  );
  if (compareMatch?.[1] && compareMatch?.[2]) {
    return {
      leftHint: cleanCompareHintText(compareMatch[1]),
      rightHint: cleanCompareHintText(compareMatch[2]),
    };
  }
  const betweenMatch = lower.match(/\bbetween\s+(.+?)\s+and\s+(.+?)(?:\s+\bby\b|\s+\bper\b|$)/);
  if (betweenMatch?.[1] && betweenMatch?.[2]) {
    return {
      leftHint: cleanCompareHintText(betweenMatch[1]),
      rightHint: cleanCompareHintText(betweenMatch[2]),
    };
  }
  const vsMatch = lower.match(/\b(.+?)\s+(?:vs|versus)\s+(.+?)(?:\s+\bby\b|\s+\bper\b|$)/);
  if (vsMatch?.[1] && vsMatch?.[2]) {
    return {
      leftHint: cleanCompareHintText(vsMatch[1]),
      rightHint: cleanCompareHintText(vsMatch[2]),
    };
  }
  return null;
}

function resolveCompareColumns(
  questionRaw: string,
  questionNorm: string,
  columns: string[],
  rows: QaRowObject[],
  profile: FileProfile | null
) {
  const numericCandidates =
    profile?.overview.numericColumns?.length
      ? profile.overview.numericColumns
      : inferNumericColumnsFromRows(columns, rows);
  const categoricalCandidates =
    profile?.overview.categoricalColumns?.length
      ? profile.overview.categoricalColumns
      : inferCategoricalColumnsFromRows(columns, rows);

  const comparePool = numericCandidates.length ? numericCandidates : columns;
  const hints = parseCompareHints(questionRaw);
  let left = hints?.leftHint ? pickColumn(normalizeText(hints.leftHint), comparePool) : "";
  let right = hints?.rightHint ? pickColumn(normalizeText(hints.rightHint), comparePool) : "";

  const askedMetricColumns = pickColumnsByAskedGroups(questionNorm, comparePool, METRIC_KEYWORD_GROUPS);
  if (!left && askedMetricColumns.length > 0) {
    left = askedMetricColumns[0];
  }
  if (!right && askedMetricColumns.length > 1) {
    right = askedMetricColumns.find((col) => col !== left) || "";
  }

  const ranked = comparePool
    .map((col) => ({ col, score: scoreColumn(questionNorm, col) }))
    .sort((a, b) => b.score - a.score)
    .map((item) => item.col);

  if (!left) {
    left = ranked[0] || "";
  }
  if (!right) {
    right =
      ranked.find((col) => col !== left) ||
      "";
  }

  let groupBy = findGroupByColumn(questionRaw, columns);
  const askedDimensions = pickColumnsByAskedGroups(questionNorm, categoricalCandidates, DIMENSION_KEYWORD_GROUPS, [
    left,
    right,
  ]);
  if (!groupBy && askedDimensions.length > 0) {
    groupBy = askedDimensions[0];
  }
  if (!groupBy) {
    groupBy =
      categoricalCandidates.find((col) => col !== left && col !== right) ||
      columns.find((col) => col !== left && col !== right) ||
      "";
  }

  return { left, right, groupBy };
}

async function buildFallbackContexts(
  dbPool: Pool,
  options: { fileId: number; projectId: number }
): Promise<FallbackFileContext[]> {
  const { fileId, projectId } = options;
  const rowLimit = Math.max(1000, Number(process.env.DATA_QA_FALLBACK_ROW_LIMIT || 25000));

  let files: Array<{ id: number; name: string }> = [];
  if (Number.isFinite(fileId) && fileId > 0) {
    const [[fileRow]]: any = await dbPool.query(
      "SELECT id, name FROM files WHERE id = ? LIMIT 1",
      [fileId]
    );
    if (fileRow?.id) files = [fileRow];
  } else if (Number.isFinite(projectId) && projectId > 0) {
    const [fileRows]: any = await dbPool.query(
      "SELECT id, name FROM files WHERE project_id = ? ORDER BY uploaded_at DESC",
      [projectId]
    );
    files = (Array.isArray(fileRows) ? fileRows : []).map((row: any) => ({
      id: Number(row.id),
      name: String(row.name || `File ${row.id}`),
    }));
  }

  const contexts: FallbackFileContext[] = [];
  for (const file of files) {
    const [colRows]: any = await dbPool.query(
      "SELECT name FROM file_columns WHERE file_id = ? ORDER BY position ASC",
      [file.id]
    );
    const columns = (Array.isArray(colRows) ? colRows : [])
      .map((row: any) => String(row?.name || "").trim())
      .filter(Boolean);
    if (!columns.length) continue;

    const rows = await loadRowsForFallback(dbPool, file.id, rowLimit);
    let profile: FileProfile | null = null;
    try {
      profile = await loadFileProfile(dbPool, file.id);
    } catch {
      profile = null;
    }

    contexts.push({
      id: file.id,
      name: file.name,
      columns,
      rows,
      profile,
    });
  }
  return contexts;
}

async function answerQuestionWithFallback(
  dbPool: Pool,
  options: { fileId: number; projectId: number; questionRaw: string; forceIntent?: IntentType }
) {
  const contexts = await buildFallbackContexts(dbPool, {
    fileId: options.fileId,
    projectId: options.projectId,
  });
  if (!contexts.length) return null;

  const detected = detectIntent(options.questionRaw);
  const intentType = options.forceIntent || detected.type;
  const intent = { type: intentType, topN: detected.topN };
  const questionNorm = normalizeText(options.questionRaw);
  const lowerQuestion = options.questionRaw.toLowerCase();

  const allColumns = new Set<string>();
  for (const context of contexts) {
    context.columns.forEach((col) => allColumns.add(col));
  }

  if (intent.type === "columns") {
    const columns = Array.from(allColumns);
    const preview = columns.slice(0, 8);
    const extra = columns.length > preview.length ? columns.length - preview.length : 0;
    const list = preview.length ? `: ${preview.join(", ")}${extra ? ` and ${extra} more` : ""}` : "";
    return {
      answer:
        contexts.length > 1
          ? `Across ${contexts.length} files, there are ${columns.length} unique columns${list}.`
          : `This file has ${columns.length} columns${list}.`,
      intent: "columns",
      columns,
    };
  }

  if (intent.type === "rows") {
    const totalRows = contexts.reduce((sum, context) => sum + context.rows.length, 0);
    return {
      answer:
        contexts.length > 1
          ? `There are ${totalRows} rows across ${contexts.length} files.`
          : `There are ${totalRows} rows in ${contexts[0].name}.`,
      intent: "rows",
      value: totalRows,
    };
  }

  if (contexts.length === 1 && intent.type === "summary") {
    const context = contexts[0];
    if (context.profile) {
      return {
        answer: formatProfileSummary(context.profile, context.name),
        intent: "summary",
        profile: context.profile,
      };
    }
    return {
      answer: `${context.name} has ${context.rows.length} rows and ${context.columns.length} columns.`,
      intent: "summary",
      value: { rows: context.rows.length, columns: context.columns.length },
    };
  }

  if (contexts.length === 1 && intent.type === "types") {
    const context = contexts[0];
    if (context.profile) {
      return {
        answer: formatProfileTypes(context.profile),
        intent: "types",
        profile: {
          numeric: context.profile.overview.numericColumns,
          dates: context.profile.overview.dateColumns,
          categorical: context.profile.overview.categoricalColumns,
        },
      };
    }
    const numeric = inferNumericColumnsFromRows(context.columns, context.rows);
    const categorical = inferCategoricalColumnsFromRows(context.columns, context.rows);
    const lineParts = [];
    if (numeric.length) lineParts.push(`Numeric: ${numeric.slice(0, 8).join(", ")}`);
    if (categorical.length) lineParts.push(`Categorical/String: ${categorical.slice(0, 8).join(", ")}`);
    return {
      answer: lineParts.join(". ") || "I could not infer column types yet.",
      intent: "types",
    };
  }

  if (intent.type === "compare") {
    const numericCompareItems = new Map<string, { count: number; compare: number }>();
    const categoricalMatrix = new Map<string, Map<string, number>>();
    const splitTotals = new Map<string, number>();

    let primaryLabel = "";
    let secondaryLabel = "";
    let groupLabel = "";
    let splitByLabel = "";
    let numericMatchedFiles = 0;
    let categoricalMatchedFiles = 0;

    for (const context of contexts) {
      const numericCandidates =
        context.profile?.overview.numericColumns?.length
          ? context.profile.overview.numericColumns
          : inferNumericColumnsFromRows(context.columns, context.rows);
      const categoricalCandidates =
        context.profile?.overview.categoricalColumns?.length
          ? context.profile.overview.categoricalColumns
          : inferCategoricalColumnsFromRows(context.columns, context.rows);

      const resolved = resolveCompareColumns(
        options.questionRaw,
        questionNorm,
        context.columns,
        context.rows,
        context.profile
      );

      const leftIsNumeric = !!resolved.left && numericCandidates.includes(resolved.left);
      const rightIsNumeric = !!resolved.right && numericCandidates.includes(resolved.right);
      const askedNumericDimensions = pickColumnsByAskedGroups(
        questionNorm,
        categoricalCandidates,
        DIMENSION_KEYWORD_GROUPS,
        [resolved.left, resolved.right]
      );
      const numericGroupBy =
        (resolved.groupBy && categoricalCandidates.includes(resolved.groupBy) ? resolved.groupBy : "") ||
        askedNumericDimensions[0] ||
        findGroupByColumn(options.questionRaw, categoricalCandidates) ||
        categoricalCandidates.find((col) => col !== resolved.left && col !== resolved.right) ||
        "";

      if (leftIsNumeric && rightIsNumeric && numericGroupBy) {
        if (!primaryLabel) primaryLabel = resolved.left;
        if (!secondaryLabel) secondaryLabel = resolved.right;
        if (!groupLabel) groupLabel = numericGroupBy;

        let contributed = false;
        for (const row of context.rows) {
          const groupValue = normalizeCellValue(row?.[numericGroupBy]);
          if (!groupValue) continue;
          const leftValue = parseNumericValue(row?.[resolved.left]) || 0;
          const rightValue = parseNumericValue(row?.[resolved.right]) || 0;
          if (leftValue === 0 && rightValue === 0) continue;
          const current = numericCompareItems.get(groupValue) || { count: 0, compare: 0 };
          current.count += leftValue;
          current.compare += rightValue;
          numericCompareItems.set(groupValue, current);
          contributed = true;
        }
        if (contributed) numericMatchedFiles += 1;
        continue;
      }

      const categoricalPool = categoricalCandidates.length ? categoricalCandidates : context.columns;
      if (!categoricalPool.length) continue;
      const askedDimensionColumns = pickColumnsByAskedGroups(
        questionNorm,
        categoricalPool,
        DIMENSION_KEYWORD_GROUPS,
        [resolved.left, resolved.right]
      );

      let localGroupBy =
        (groupLabel && categoricalPool.includes(groupLabel) ? groupLabel : "") ||
        (resolved.groupBy && categoricalPool.includes(resolved.groupBy) ? resolved.groupBy : "") ||
        askedDimensionColumns[0] ||
        ([resolved.left, resolved.right].find(
          (col): col is string => Boolean(col) && categoricalPool.includes(col)
        ) || "") ||
        categoricalPool[0] ||
        "";

      let localSplitBy =
        (splitByLabel && categoricalPool.includes(splitByLabel) && splitByLabel !== localGroupBy
          ? splitByLabel
          : "") ||
        askedDimensionColumns.find((col) => col !== localGroupBy) ||
        ([resolved.left, resolved.right].find(
          (col): col is string =>
            Boolean(col) && col !== localGroupBy && categoricalPool.includes(col)
        ) || "") ||
        categoricalPool.find((col) => col !== localGroupBy) ||
        "";

      if (!localGroupBy || !localSplitBy) continue;
      if (!groupLabel) groupLabel = localGroupBy;
      if (!splitByLabel) splitByLabel = localSplitBy;

      let contributed = false;
      for (const row of context.rows) {
        const groupValue = normalizeCellValue(row?.[localGroupBy]);
        const splitValue = normalizeCellValue(row?.[localSplitBy]);
        if (!groupValue || !splitValue) continue;

        if (!categoricalMatrix.has(groupValue)) {
          categoricalMatrix.set(groupValue, new Map<string, number>());
        }
        const splitMap = categoricalMatrix.get(groupValue)!;
        splitMap.set(splitValue, (splitMap.get(splitValue) || 0) + 1);
        splitTotals.set(splitValue, (splitTotals.get(splitValue) || 0) + 1);
        contributed = true;
      }
      if (contributed) categoricalMatchedFiles += 1;
    }

    const numericItems = Array.from(numericCompareItems.entries())
      .map(([value, pair]) => ({
        value,
        count: Number(pair.count || 0),
        compare: Number(pair.compare || 0),
      }))
      .sort((a, b) => Math.max(b.count, b.compare) - Math.max(a.count, a.compare))
      .slice(0, Math.max(2, intent.topN));

    if (numericItems.length) {
      const preview = numericItems
        .slice(0, 5)
        .map((item) => `${item.value} (${formatNumber(item.count)} vs ${formatNumber(item.compare)})`)
        .join(", ");
      const scopeText =
        contexts.length > 1 ? `across ${numericMatchedFiles || contexts.length} files` : `in ${contexts[0].name}`;
      return {
        answer: `Comparison of "${primaryLabel}" vs "${secondaryLabel}" by "${groupLabel}" ${scopeText}: ${preview}`,
        intent: "compare",
        column: primaryLabel,
        compareColumn: secondaryLabel,
        groupBy: groupLabel,
        items: numericItems,
      };
    }

    const topSplits = Array.from(splitTotals.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([value]) => value);

    if (topSplits.length < 2 || !groupLabel || !splitByLabel) {
      return {
        answer:
          "I could not build a comparison from your data. Try: compare Revenue vs Cost by Country, or compare Client and Dataset.",
        intent: "compare",
      };
    }

    const [primarySplit, secondarySplit] = topSplits;
    primaryLabel = `${splitByLabel}: ${primarySplit}`;
    secondaryLabel = `${splitByLabel}: ${secondarySplit}`;

    const items = Array.from(categoricalMatrix.entries())
      .map(([value, splitMap]) => ({
        value,
        count: Number(splitMap.get(primarySplit) || 0),
        compare: Number(splitMap.get(secondarySplit) || 0),
      }))
      .filter((item) => item.count > 0 || item.compare > 0)
      .sort((a, b) => Math.max(b.count, b.compare) - Math.max(a.count, a.compare))
      .slice(0, Math.max(2, intent.topN));

    if (!items.length) {
      return {
        answer:
          "I could not build a comparison from your data. Try: compare Revenue vs Cost by Country, or compare Client and Dataset.",
        intent: "compare",
      };
    }

    const preview = items
      .slice(0, 5)
      .map((item) => `${item.value} (${formatNumber(item.count)} vs ${formatNumber(item.compare)})`)
      .join(", ");
    const scopeText =
      contexts.length > 1 ? `across ${categoricalMatchedFiles || contexts.length} files` : `in ${contexts[0].name}`;
    return {
      answer: `Comparison of "${primaryLabel}" vs "${secondaryLabel}" by "${groupLabel}" ${scopeText}: ${preview}`,
      intent: "compare",
      column: primaryLabel,
      compareColumn: secondaryLabel,
      groupBy: groupLabel,
      items,
    };
  }

  const aggregatedItems = new Map<string, number>();
  let aggregatedValue = 0;
  let aggregatedCount = 0;
  let selectedColumnAny = "";
  let matchedFilter: { column: string; value: string } | null = null;
  let matchedFiles = 0;
  let minValue: number | null = null;
  let maxValue: number | null = null;

  for (const context of contexts) {
    const columns = context.columns;
    const rows = context.rows;
    if (!columns.length || !rows.length) continue;

    const groupByColumn = findGroupByColumn(options.questionRaw, columns);
    let filter = findFilter(options.questionRaw, columns);
    let selectedColumn =
      filter?.column ||
      pickFallbackColumn(questionNorm, columns, rows, context.profile, intent.type);

    if (!selectedColumn && intent.type === "count") {
      const impliedValue = extractValueHint(options.questionRaw);
      if (impliedValue) {
        const inferred = inferColumnByValueFromRows(columns, rows, impliedValue);
        if (inferred?.column) {
          selectedColumn = inferred.column;
          filter = { column: inferred.column, value: inferred.value };
        }
      }
    }

    if (groupByColumn) {
      const wantsTop = /\btop\b/.test(lowerQuestion);
      const groupLimit = wantsTop ? intent.topN : 12;
      const limit = Math.max(1, Math.min(20, groupLimit));
      const groupMetric = intent.type === "distinct" ? "count" : intent.type;

      if (["sum", "avg", "min", "max"].includes(groupMetric)) {
        const measureQuestion = options.questionRaw.split(/\bby\b|\bper\b/)[0] || options.questionRaw;
        const measureColumns = columns.filter((c) => c !== groupByColumn);
        const measureColumn = pickFallbackColumn(
          normalizeText(measureQuestion),
          measureColumns,
          rows,
          context.profile,
          intent.type
        );
        if (!measureColumn) continue;

        const perGroup = new Map<string, { sum: number; count: number; min: number; max: number }>();
        for (const row of rows) {
          const groupValue = normalizeCellValue(row?.[groupByColumn]);
          if (!groupValue) continue;
          const numeric = parseNumericValue(row?.[measureColumn]);
          if (numeric === null) continue;
          const state = perGroup.get(groupValue) || {
            sum: 0,
            count: 0,
            min: Number.POSITIVE_INFINITY,
            max: Number.NEGATIVE_INFINITY,
          };
          state.sum += numeric;
          state.count += 1;
          state.min = Math.min(state.min, numeric);
          state.max = Math.max(state.max, numeric);
          perGroup.set(groupValue, state);
        }

        const derived = Array.from(perGroup.entries())
          .map(([value, state]) => {
            const metricValue =
              groupMetric === "sum"
                ? state.sum
                : groupMetric === "avg"
                ? state.sum / state.count
                : groupMetric === "min"
                ? state.min
                : state.max;
            return { value, count: metricValue };
          })
          .sort((a, b) => (groupMetric === "min" ? a.count - b.count : b.count - a.count))
          .slice(0, limit);

        if (!derived.length) continue;
        selectedColumnAny = measureColumn;
        if (!matchedFilter && filter) matchedFilter = filter;
        matchedFiles += 1;
        for (const item of derived) {
          aggregatedItems.set(item.value, (aggregatedItems.get(item.value) || 0) + item.count);
        }
        continue;
      }

      const groupCounts = new Map<string, number>();
      for (const row of rows) {
        const groupValue = normalizeCellValue(row?.[groupByColumn]);
        if (!groupValue) continue;
        groupCounts.set(groupValue, (groupCounts.get(groupValue) || 0) + 1);
      }
      const derived = Array.from(groupCounts.entries())
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, limit);
      if (!derived.length) continue;
      selectedColumnAny = groupByColumn;
      if (!matchedFilter && filter) matchedFilter = filter;
      matchedFiles += 1;
      for (const item of derived) {
        aggregatedItems.set(item.value, (aggregatedItems.get(item.value) || 0) + item.count);
      }
      continue;
    }

    if (!selectedColumn) continue;
    selectedColumnAny = selectedColumn;
    if (!matchedFilter && filter) matchedFilter = filter;

    if (intent.type === "count") {
      let count = 0;
      for (const row of rows) {
        const value = normalizeCellValue(row?.[selectedColumn]);
        if (!value) continue;
        if (filter?.value && value.toLowerCase() !== filter.value.toLowerCase()) continue;
        count += 1;
      }
      aggregatedValue += count;
      matchedFiles += 1;
      continue;
    }

    if (intent.type === "distinct") {
      const distinct = new Set<string>();
      for (const row of rows) {
        const value = normalizeCellValue(row?.[selectedColumn]);
        if (!value) continue;
        distinct.add(value);
      }
      aggregatedValue += distinct.size;
      matchedFiles += 1;
      continue;
    }

    if (intent.type === "top") {
      const freq = new Map<string, number>();
      for (const row of rows) {
        const value = normalizeCellValue(row?.[selectedColumn]);
        if (!value) continue;
        freq.set(value, (freq.get(value) || 0) + 1);
      }
      for (const [value, count] of freq.entries()) {
        aggregatedItems.set(value, (aggregatedItems.get(value) || 0) + count);
      }
      matchedFiles += 1;
      continue;
    }

    if (["sum", "avg", "min", "max"].includes(intent.type)) {
      let localCount = 0;
      let localSum = 0;
      let localMin = Number.POSITIVE_INFINITY;
      let localMax = Number.NEGATIVE_INFINITY;

      for (const row of rows) {
        const numeric = parseNumericValue(row?.[selectedColumn]);
        if (numeric === null) continue;
        localCount += 1;
        localSum += numeric;
        localMin = Math.min(localMin, numeric);
        localMax = Math.max(localMax, numeric);
      }

      if (localCount === 0) continue;
      matchedFiles += 1;

      if (intent.type === "sum") {
        aggregatedValue += localSum;
      } else if (intent.type === "avg") {
        aggregatedValue += localSum;
        aggregatedCount += localCount;
      } else if (intent.type === "min") {
        minValue = minValue === null ? localMin : Math.min(minValue, localMin);
      } else if (intent.type === "max") {
        maxValue = maxValue === null ? localMax : Math.max(maxValue, localMax);
      }
    }
  }

  if (matchedFiles === 0) {
    return {
      answer:
        "I could not match a column across your files. Try mentioning a column name from Data Explorer.",
      intent: "unknown",
    };
  }

  if (intent.type === "top") {
    const items = Array.from(aggregatedItems.entries())
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, intent.topN);
    const list = items.length
      ? items.map((item) => `${item.value} (${item.count})`).join(", ")
      : "No values found.";
    return {
      answer:
        contexts.length > 1
          ? `Across ${matchedFiles} files, top values of "${selectedColumnAny}": ${list}`
          : `Top ${items.length} values of "${selectedColumnAny}": ${list}`,
      intent: "top",
      column: selectedColumnAny,
      items,
    };
  }

  if (intent.type === "count") {
    const target = matchedFilter?.value ? `"${matchedFilter.value}"` : `non-empty "${selectedColumnAny}"`;
    return {
      answer:
        contexts.length > 1
          ? `There are ${aggregatedValue} rows with ${target} across ${matchedFiles} files.`
          : `There are ${aggregatedValue} rows with ${target}.`,
      intent: "count",
      column: selectedColumnAny,
      filter: matchedFilter?.value ? { value: matchedFilter.value } : null,
      value: aggregatedValue,
    };
  }

  if (intent.type === "distinct") {
    return {
      answer:
        contexts.length > 1
          ? `"${selectedColumnAny}" has ${aggregatedValue} distinct values across ${matchedFiles} files.`
          : `"${selectedColumnAny}" has ${aggregatedValue} distinct values.`,
      intent: "distinct",
      column: selectedColumnAny,
      value: aggregatedValue,
    };
  }

  if (intent.type === "sum") {
    return {
      answer:
        contexts.length > 1
          ? `The total of "${selectedColumnAny}" across ${matchedFiles} files is ${formatNumber(aggregatedValue)}.`
          : `The total of "${selectedColumnAny}" is ${formatNumber(aggregatedValue)}.`,
      intent: "sum",
      column: selectedColumnAny,
      value: aggregatedValue,
    };
  }

  if (intent.type === "avg") {
    const avgValue = aggregatedCount > 0 ? aggregatedValue / aggregatedCount : 0;
    return {
      answer:
        contexts.length > 1
          ? `The average of "${selectedColumnAny}" across ${matchedFiles} files is ${formatNumber(avgValue)}.`
          : `The average of "${selectedColumnAny}" is ${formatNumber(avgValue)}.`,
      intent: "avg",
      column: selectedColumnAny,
      value: avgValue,
    };
  }

  if (intent.type === "min") {
    const value = minValue ?? 0;
    return {
      answer:
        contexts.length > 1
          ? `The minimum of "${selectedColumnAny}" across ${matchedFiles} files is ${formatNumber(value)}.`
          : `The minimum of "${selectedColumnAny}" is ${formatNumber(value)}.`,
      intent: "min",
      column: selectedColumnAny,
      value,
    };
  }

  if (intent.type === "max") {
    const value = maxValue ?? 0;
    return {
      answer:
        contexts.length > 1
          ? `The maximum of "${selectedColumnAny}" across ${matchedFiles} files is ${formatNumber(value)}.`
          : `The maximum of "${selectedColumnAny}" is ${formatNumber(value)}.`,
      intent: "max",
      column: selectedColumnAny,
      value,
    };
  }

  return null;
}

export function dataQaRoutes(dbPool: Pool) {
  const router = Router();
  router.use(requireAuth);

  router.post("/ask", async (req, res) => {
    const payload = req.body as AskPayload;
    const fileId = Number(payload?.fileId);
    const projectId = Number(payload?.projectId);
    const questionRaw = String(payload?.question || "").trim();
    const encryptionKey = getEncryptionKey();
    const dataJsonExpr = buildDataJsonExpr(encryptionKey);
    const keyParams = (count: number) => buildKeyParams(encryptionKey, count);
    try {

      if ((!Number.isFinite(fileId) || fileId <= 0) && (!Number.isFinite(projectId) || projectId <= 0)) {
        return res.status(400).json({ message: "fileId or projectId is required" });
      }
      if (!questionRaw) {
        return res.status(400).json({ message: "question is required" });
      }

    if (!Number.isFinite(fileId) || fileId <= 0) {
      const [fileRows]: any = await dbPool.query(
        "SELECT id, name, file_type FROM files WHERE project_id = ? ORDER BY uploaded_at DESC",
        [projectId]
      );
      const files = Array.isArray(fileRows) ? fileRows : [];
      if (files.length === 0) {
        return res.status(404).json({ message: "No files found for this project." });
      }

      const intent = detectIntent(questionRaw);
      const questionNorm = normalizeText(questionRaw);
      const lowerQuestion = questionRaw.toLowerCase();
      if (intent.type === "compare") {
        const compare = await answerQuestionWithFallback(dbPool, {
          fileId: Number.NaN,
          projectId,
          questionRaw,
          forceIntent: "compare",
        });
        if (compare) return res.json(compare);
        return res.json({
          answer: "I could not build a comparison. Try: compare Revenue vs Cost by Country.",
          intent: "compare",
        });
      }

      const allColumns = new Set<string>();
      const perFileColumns = new Map<number, string[]>();
      for (const file of files) {
        const [colRows]: any = await dbPool.query(
          "SELECT name FROM file_columns WHERE file_id = ? ORDER BY position ASC",
          [file.id]
        );
        const columns = colRows.map((row: any) => row.name).filter(Boolean);
        perFileColumns.set(file.id, columns);
        columns.forEach((c: string) => allColumns.add(c));
      }

      if (intent.type === "columns") {
        const columns = Array.from(allColumns);
        const preview = columns.slice(0, 8);
        const extra = columns.length > preview.length ? columns.length - preview.length : 0;
        const list = preview.length ? `: ${preview.join(", ")}${extra ? ` and ${extra} more` : ""}` : "";
        return res.json({
          answer: `Across ${files.length} files, there are ${columns.length} unique columns${list}.`,
          intent: "columns",
          columns,
        });
      }

      if (intent.type === "rows") {
        let total = 0;
        for (const file of files) {
          const [[rowCount]]: any = await dbPool.query(
            "SELECT COUNT(*) as count FROM file_rows WHERE file_id = ?",
            [file.id]
          );
          total += Number(rowCount?.count ?? 0);
        }
        return res.json({
          answer: `There are ${total} rows across ${files.length} files.`,
          intent: "rows",
          value: total,
        });
      }

      const aggregatedItems = new Map<string, number>();
      let aggregatedValue = 0;
      let aggregatedCount = 0;
      let selectedColumnAny = "";
      let matchedFilter: { column: string; value: string } | null = null;
      let matchedFiles = 0;

      for (const file of files) {
        const columns = perFileColumns.get(file.id) || [];
        if (columns.length === 0) continue;

        const groupByColumn = findGroupByColumn(questionRaw, columns);
        let filter = findFilter(questionRaw, columns);
        let selectedColumn = filter?.column || pickColumn(questionNorm, columns);

        if (!selectedColumn && intent.type === "count") {
          const impliedValue = extractValueHint(questionRaw);
          if (impliedValue) {
            const inferred = await inferColumnByValue(dbPool, file.id, columns, impliedValue);
            if (inferred?.column) {
              selectedColumn = inferred.column;
              filter = { column: inferred.column, value: inferred.value };
            }
          }
        }

        if (groupByColumn) {
          const wantsTop = /\btop\b/.test(lowerQuestion);
          const groupLimit = wantsTop ? intent.topN : 12;
          const limit = Math.max(1, Math.min(20, groupLimit));
          const groupExpr =
            `NULLIF(NULLIF(TRIM(JSON_UNQUOTE(JSON_EXTRACT(${dataJsonExpr}, ?))), ''), '-')`;
          const groupPath = buildJsonPath(groupByColumn);
          const groupMetric = intent.type === "distinct" ? "count" : intent.type;

          if (["sum", "avg", "min", "max"].includes(groupMetric)) {
            const measureQuestion = questionRaw.split(/\bby\b|\bper\b/)[0] || questionRaw;
            const measureColumns = columns.filter((c) => c !== groupByColumn);
            let measureColumn = pickColumn(normalizeText(measureQuestion), measureColumns);
            if (!measureColumn) {
              measureColumn = pickColumn(questionNorm, measureColumns);
            }
            if (!measureColumn) {
              continue;
            }

            const measureExpr =
              `NULLIF(NULLIF(TRIM(JSON_UNQUOTE(JSON_EXTRACT(${dataJsonExpr}, ?))), ''), '-')`;
            const sql = `
              SELECT
                groupValue as value,
                SUM(CASE WHEN measureValue REGEXP '^-?[0-9]+(\\.[0-9]+)?$' THEN 1 ELSE 0 END) as numericCount,
                SUM(CASE WHEN measureValue REGEXP '^-?[0-9]+(\\.[0-9]+)?$' THEN CAST(measureValue AS DECIMAL(20,6)) END) as sum,
                AVG(CASE WHEN measureValue REGEXP '^-?[0-9]+(\\.[0-9]+)?$' THEN CAST(measureValue AS DECIMAL(20,6)) END) as avg,
                MIN(CASE WHEN measureValue REGEXP '^-?[0-9]+(\\.[0-9]+)?$' THEN CAST(measureValue AS DECIMAL(20,6)) END) as min,
                MAX(CASE WHEN measureValue REGEXP '^-?[0-9]+(\\.[0-9]+)?$' THEN CAST(measureValue AS DECIMAL(20,6)) END) as max
              FROM (
                SELECT ${groupExpr} as groupValue, ${measureExpr} as measureValue
                FROM file_rows
                WHERE file_id = ?
              ) t
              WHERE groupValue IS NOT NULL
              GROUP BY groupValue
              HAVING numericCount > 0
              ORDER BY ${groupMetric} ${groupMetric === "min" ? "ASC" : "DESC"}
              LIMIT ?
            `;
            const [rows]: any = await dbPool.query(sql, [
              ...keyParams(1),
              groupPath,
              ...keyParams(1),
              buildJsonPath(measureColumn),
              file.id,
              limit,
            ]);
            for (const row of rows || []) {
              const value = String(row.value);
              const next = Number(row[groupMetric] || 0);
              aggregatedItems.set(value, (aggregatedItems.get(value) || 0) + next);
            }
            selectedColumnAny = measureColumn;
            if (!matchedFilter && filter) matchedFilter = filter;
            matchedFiles += 1;
            continue;
          }

          const sql = `
            SELECT groupValue as value, COUNT(*) as count
            FROM (
              SELECT ${groupExpr} as groupValue
              FROM file_rows
              WHERE file_id = ?
            ) t
            WHERE groupValue IS NOT NULL
            GROUP BY groupValue
            ORDER BY count DESC
            LIMIT ?
          `;
          const [rows]: any = await dbPool.query(sql, [...keyParams(1), groupPath, file.id, limit]);
          for (const row of rows || []) {
            const value = String(row.value);
            const next = Number(row.count || 0);
            aggregatedItems.set(value, (aggregatedItems.get(value) || 0) + next);
          }
          selectedColumnAny = groupByColumn;
          if (!matchedFilter && filter) matchedFilter = filter;
          matchedFiles += 1;
          continue;
        }

        if (!selectedColumn) continue;
        selectedColumnAny = selectedColumn;
        if (!matchedFilter && filter) matchedFilter = filter;

        const jsonPath = buildJsonPath(selectedColumn);
        const valueExpr =
          `NULLIF(NULLIF(TRIM(JSON_UNQUOTE(JSON_EXTRACT(${dataJsonExpr}, ?))), ''), '-')`;
        const baseQuery = `SELECT ${valueExpr} as value FROM file_rows WHERE file_id = ?`;

        if (intent.type === "count") {
          const sql = filter?.value
            ? `SELECT COUNT(*) as count FROM (${baseQuery}) t WHERE value IS NOT NULL AND LOWER(value) = LOWER(?)`
            : `SELECT COUNT(*) as count FROM (${baseQuery}) t WHERE value IS NOT NULL`;
          const params = filter?.value
            ? [...keyParams(1), jsonPath, file.id, filter.value]
            : [...keyParams(1), jsonPath, file.id];
          const [[row]]: any = await dbPool.query(sql, params);
          aggregatedValue += Number(row?.count ?? 0);
          matchedFiles += 1;
          continue;
        }

        if (intent.type === "distinct") {
          const sql = `SELECT COUNT(DISTINCT value) as count FROM (${baseQuery}) t WHERE value IS NOT NULL`;
          const [[row]]: any = await dbPool.query(sql, [...keyParams(1), jsonPath, file.id]);
          aggregatedValue += Number(row?.count ?? 0);
          matchedFiles += 1;
          continue;
        }

        if (intent.type === "top") {
          const sql = `SELECT value, COUNT(*) as count FROM (${baseQuery}) t WHERE value IS NOT NULL GROUP BY value ORDER BY count DESC LIMIT ?`;
          const [rows]: any = await dbPool.query(sql, [...keyParams(1), jsonPath, file.id, intent.topN]);
          for (const row of rows || []) {
            const value = String(row.value);
            const next = Number(row.count || 0);
            aggregatedItems.set(value, (aggregatedItems.get(value) || 0) + next);
          }
          matchedFiles += 1;
          continue;
        }

        if (["sum", "avg", "min", "max"].includes(intent.type)) {
          const sql = `
            SELECT
              COUNT(*) as total,
              SUM(CASE WHEN value REGEXP '^-?[0-9]+(\\.[0-9]+)?$' THEN 1 ELSE 0 END) as numericCount,
              SUM(CASE WHEN value REGEXP '^-?[0-9]+(\\.[0-9]+)?$' THEN CAST(value AS DECIMAL(20,6)) ELSE 0 END) as sum,
              AVG(CASE WHEN value REGEXP '^-?[0-9]+(\\.[0-9]+)?$' THEN CAST(value AS DECIMAL(20,6)) END) as avg,
              MIN(CASE WHEN value REGEXP '^-?[0-9]+(\\.[0-9]+)?$' THEN CAST(value AS DECIMAL(20,6)) END) as min,
              MAX(CASE WHEN value REGEXP '^-?[0-9]+(\\.[0-9]+)?$' THEN CAST(value AS DECIMAL(20,6)) END) as max
            FROM (${baseQuery}) t
            WHERE value IS NOT NULL
          `;
          const [[row]]: any = await dbPool.query(sql, [...keyParams(1), jsonPath, file.id]);
          const numericCount = Number(row?.numericCount ?? 0);
          if (numericCount === 0) continue;
          matchedFiles += 1;
          aggregatedCount += numericCount;
          if (intent.type === "sum") {
            aggregatedValue += Number(row.sum || 0);
          } else if (intent.type === "avg") {
            aggregatedValue += Number(row.avg || 0) * numericCount;
          } else if (intent.type === "min") {
            const value = Number(row.min);
            if (Number.isFinite(value)) {
              aggregatedValue = aggregatedCount === numericCount ? value : Math.min(aggregatedValue, value);
            }
          } else if (intent.type === "max") {
            const value = Number(row.max);
            if (Number.isFinite(value)) {
              aggregatedValue = aggregatedCount === numericCount ? value : Math.max(aggregatedValue, value);
            }
          }
        }
      }

      if (matchedFiles === 0) {
        return res.json({
          answer:
            "I could not match a column across your files. Try mentioning a column name from Data Explorer.",
          intent: "unknown",
        });
      }

      if (intent.type === "top") {
        const items = Array.from(aggregatedItems.entries())
          .map(([value, count]) => ({ value, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, intent.topN);
        const list = items.length
          ? items.map((item) => `${item.value} (${item.count})`).join(", ")
          : "No values found.";
        return res.json({
          answer: `Across ${matchedFiles} files, top values of "${selectedColumnAny}": ${list}`,
          intent: intent.type,
          column: selectedColumnAny,
          items,
        });
      }

      if (intent.type === "count") {
        const target = matchedFilter?.value ? `"${matchedFilter.value}"` : `non-empty "${selectedColumnAny}"`;
        return res.json({
          answer: `There are ${aggregatedValue} rows with ${target} across ${matchedFiles} files.`,
          intent: "count",
          column: selectedColumnAny,
          filter: matchedFilter?.value ? { value: matchedFilter.value } : null,
          value: aggregatedValue,
        });
      }

      if (intent.type === "distinct") {
        return res.json({
          answer: `"${selectedColumnAny}" has ${aggregatedValue} distinct values across ${matchedFiles} files.`,
          intent: "distinct",
          column: selectedColumnAny,
          value: aggregatedValue,
        });
      }

      if (intent.type === "sum") {
        return res.json({
          answer: `The total of "${selectedColumnAny}" across ${matchedFiles} files is ${formatNumber(aggregatedValue)}.`,
          intent: "sum",
          column: selectedColumnAny,
          value: aggregatedValue,
        });
      }

      if (intent.type === "avg") {
        const avgValue = aggregatedCount > 0 ? aggregatedValue / aggregatedCount : 0;
        return res.json({
          answer: `The average of "${selectedColumnAny}" across ${matchedFiles} files is ${formatNumber(avgValue)}.`,
          intent: "avg",
          column: selectedColumnAny,
          value: avgValue,
        });
      }

      if (intent.type === "min") {
        return res.json({
          answer: `The minimum of "${selectedColumnAny}" across ${matchedFiles} files is ${formatNumber(aggregatedValue)}.`,
          intent: "min",
          column: selectedColumnAny,
          value: aggregatedValue,
        });
      }

      if (intent.type === "max") {
        return res.json({
          answer: `The maximum of "${selectedColumnAny}" across ${matchedFiles} files is ${formatNumber(aggregatedValue)}.`,
          intent: "max",
          column: selectedColumnAny,
          value: aggregatedValue,
        });
      }
    }

    const [[fileRow]]: any = await dbPool.query(
      "SELECT id, name, file_type FROM files WHERE id = ?",
      [fileId]
    );
    if (!fileRow) {
      return res.status(404).json({ message: "File not found" });
    }

    const [colRows]: any = await dbPool.query(
      "SELECT name FROM file_columns WHERE file_id = ? ORDER BY position ASC",
      [fileId]
    );
    const columns = colRows.map((row: any) => row.name).filter(Boolean);
    if (columns.length === 0) {
      return res.json({
        answer:
          "This file has no structured columns. Q&A works best with CSV or Excel files.",
        intent: "unsupported",
      });
    }

    const intent = detectIntent(questionRaw);
    const questionNorm = normalizeText(questionRaw);
    const lowerQuestion = questionRaw.toLowerCase();
    if (intent.type === "compare") {
      const compare = await answerQuestionWithFallback(dbPool, {
        fileId,
        projectId: Number.NaN,
        questionRaw,
        forceIntent: "compare",
      });
      if (compare) return res.json(compare);
      return res.json({
        answer: "I could not build a comparison. Try: compare Revenue vs Cost by Country.",
        intent: "compare",
      });
    }
    await ensureFileProfileTable(dbPool);
    let profile = await loadFileProfile(dbPool, fileId);
    if (!profile) {
      const [rowRows]: any = await dbPool.query(
        `SELECT ${dataJsonExpr} as data_json FROM file_rows WHERE file_id = ? ORDER BY row_index ASC LIMIT 800`,
        [...keyParams(1), fileId]
      );
      const sampledRows: Array<Record<string, any>> = (rowRows || []).map((r: any) => {
        try {
          return JSON.parse(r.data_json || "{}");
        } catch {
          return {};
        }
      });
      profile = buildFileProfile(columns, sampledRows);
      await saveFileProfile(dbPool, fileId, profile);
    }

    if (intent.type === "summary" && profile) {
      return res.json({
        answer: formatProfileSummary(profile, fileRow.name),
        intent: "summary",
        profile,
      });
    }

    if (intent.type === "summary" && !profile) {
      const [[rowCount]]: any = await dbPool.query(
        "SELECT COUNT(*) as count FROM file_rows WHERE file_id = ?",
        [fileId]
      );
      return res.json({
        answer: `${fileRow.name} has ${rowCount?.count ?? 0} rows and ${columns.length} columns.`,
        intent: "summary",
        value: {
          rows: rowCount?.count ?? 0,
          columns: columns.length,
        },
      });
    }

    if (intent.type === "types" && profile) {
      return res.json({
        answer: formatProfileTypes(profile),
        intent: "types",
        profile: {
          numeric: profile.overview.numericColumns,
          dates: profile.overview.dateColumns,
          categorical: profile.overview.categoricalColumns,
        },
      });
    }

    const groupByColumn = findGroupByColumn(questionRaw, columns);
    let filter = findFilter(questionRaw, columns);
    let selectedColumn = filter?.column || pickColumnWithProfile(questionNorm, columns, profile, intent.type);

    if (intent.type === "columns") {
      const preview = columns.slice(0, 8);
      const extra = columns.length > preview.length ? columns.length - preview.length : 0;
      const list = preview.length ? `: ${preview.join(", ")}${extra ? ` and ${extra} more` : ""}` : "";
      return res.json({
        answer: `This file has ${columns.length} columns${list}.`,
        intent: "columns",
        columns,
      });
    }

    if (intent.type === "rows") {
      const [[rowCount]]: any = await dbPool.query(
        "SELECT COUNT(*) as count FROM file_rows WHERE file_id = ?",
        [fileId]
      );
      return res.json({
        answer: `There are ${rowCount?.count ?? 0} rows in ${fileRow.name}.`,
        intent: "rows",
        value: rowCount?.count ?? 0,
      });
    }

    if (groupByColumn) {
      const wantsTop = /\btop\b/.test(lowerQuestion);
      const groupLimit = wantsTop ? intent.topN : 12;
      const limit = Math.max(1, Math.min(20, groupLimit));
      const groupExpr =
        `NULLIF(NULLIF(TRIM(JSON_UNQUOTE(JSON_EXTRACT(${dataJsonExpr}, ?))), ''), '-')`;
      const groupPath = buildJsonPath(groupByColumn);
      const groupMetric = intent.type === "distinct" ? "count" : intent.type;

      if (["sum", "avg", "min", "max"].includes(groupMetric)) {
        const measureQuestion = questionRaw.split(/\bby\b|\bper\b/)[0] || questionRaw;
        const measureColumns = columns.filter((c: string) => c !== groupByColumn);
        let measureColumn = pickColumn(normalizeText(measureQuestion), measureColumns);
        if (!measureColumn) {
          measureColumn = pickColumnWithProfile(questionNorm, measureColumns, profile, intent.type);
        }
        if (!measureColumn && profile?.overview.numericColumns?.length) {
          const numericFallback = profile.overview.numericColumns.find((c) => c !== groupByColumn);
          if (numericFallback) measureColumn = numericFallback;
        }
        if (!measureColumn) {
          return res.json({
            answer: `Please specify a numeric column to aggregate by "${groupByColumn}".`,
            intent: "group",
          });
        }

        const measureExpr =
          `NULLIF(NULLIF(TRIM(JSON_UNQUOTE(JSON_EXTRACT(${dataJsonExpr}, ?))), ''), '-')`;
        const sql = `
          SELECT
            groupValue as value,
            SUM(CASE WHEN measureValue REGEXP '^-?[0-9]+(\\.[0-9]+)?$' THEN 1 ELSE 0 END) as numericCount,
            SUM(CASE WHEN measureValue REGEXP '^-?[0-9]+(\\.[0-9]+)?$' THEN CAST(measureValue AS DECIMAL(20,6)) END) as sum,
            AVG(CASE WHEN measureValue REGEXP '^-?[0-9]+(\\.[0-9]+)?$' THEN CAST(measureValue AS DECIMAL(20,6)) END) as avg,
            MIN(CASE WHEN measureValue REGEXP '^-?[0-9]+(\\.[0-9]+)?$' THEN CAST(measureValue AS DECIMAL(20,6)) END) as min,
            MAX(CASE WHEN measureValue REGEXP '^-?[0-9]+(\\.[0-9]+)?$' THEN CAST(measureValue AS DECIMAL(20,6)) END) as max
          FROM (
            SELECT ${groupExpr} as groupValue, ${measureExpr} as measureValue
            FROM file_rows
            WHERE file_id = ?
          ) t
          WHERE groupValue IS NOT NULL
          GROUP BY groupValue
          HAVING numericCount > 0
          ORDER BY ${groupMetric} ${groupMetric === "min" ? "ASC" : "DESC"}
          LIMIT ?
        `;
        const [rows]: any = await dbPool.query(sql, [
          ...keyParams(1),
          groupPath,
          ...keyParams(1),
          buildJsonPath(measureColumn),
          fileId,
          limit,
        ]);
        const items = (rows || []).map((row: any) => ({
          value: row.value,
          count: Number(row[groupMetric] || 0),
        }));
        if (items.length === 0) {
          return res.json({
            answer: `No numeric values found in "${measureColumn}".`,
            intent: "group",
          });
        }
        const label =
          groupMetric === "sum"
            ? "Sum"
            : groupMetric === "avg"
            ? "Average"
            : groupMetric === "min"
            ? "Minimum"
            : "Maximum";
        const list = items
          .map((item: { value: string; count: number }) => `${item.value} (${formatNumber(item.count)})`)
          .join(", ");
        return res.json({
          answer: `${label} of "${measureColumn}" by "${groupByColumn}": ${list}`,
          intent: "group",
          column: measureColumn,
          groupBy: groupByColumn,
          items,
        });
      }

      const sql = `
        SELECT groupValue as value, COUNT(*) as count
        FROM (
          SELECT ${groupExpr} as groupValue
          FROM file_rows
          WHERE file_id = ?
        ) t
        WHERE groupValue IS NOT NULL
        GROUP BY groupValue
        ORDER BY count DESC
        LIMIT ?
      `;
      const [rows]: any = await dbPool.query(sql, [...keyParams(1), groupPath, fileId, limit]);
      const items = (rows || []).map((row: any) => ({
        value: row.value,
        count: Number(row.count || 0),
      }));
      const list = items.length
        ? items.map((item: { value: string; count: number }) => `${item.value} (${item.count})`).join(", ")
        : "No values found.";
      return res.json({
        answer: `Count by "${groupByColumn}": ${list}`,
        intent: "group",
        groupBy: groupByColumn,
        items,
      });
    }

    if (!selectedColumn && intent.type === "count") {
      const impliedValue = extractValueHint(questionRaw);
      if (impliedValue) {
        const inferred = await inferColumnByValue(dbPool, fileId, columns, impliedValue);
        if (inferred?.column) {
          selectedColumn = inferred.column;
          filter = { column: inferred.column, value: inferred.value };
        }
      }
    }

    if (!selectedColumn && intent.type === "count") {
      const [[rowCount]]: any = await dbPool.query(
        "SELECT COUNT(*) as count FROM file_rows WHERE file_id = ?",
        [fileId]
      );
      return res.json({
        answer: `There are ${rowCount?.count ?? 0} rows in ${fileRow.name}.`,
        intent: "rows",
        value: rowCount?.count ?? 0,
      });
    }

    if (!selectedColumn) {
      return res.json({
        answer:
          "I could not match a column name. Try mentioning a column from your preview (for example: \"top 5 values of Service\").",
        intent: "unknown",
      });
    }

    const jsonPath = buildJsonPath(selectedColumn);
    const valueExpr =
      `NULLIF(NULLIF(TRIM(JSON_UNQUOTE(JSON_EXTRACT(${dataJsonExpr}, ?))), ''), '-')`;
    const baseQuery = `SELECT ${valueExpr} as value FROM file_rows WHERE file_id = ?`;

    if (intent.type === "count") {
      const sql = filter?.value
        ? `SELECT COUNT(*) as count FROM (${baseQuery}) t WHERE value IS NOT NULL AND LOWER(value) = LOWER(?)`
        : `SELECT COUNT(*) as count FROM (${baseQuery}) t WHERE value IS NOT NULL`;
      const params = filter?.value
        ? [...keyParams(1), jsonPath, fileId, filter.value]
        : [...keyParams(1), jsonPath, fileId];
      const [[row]]: any = await dbPool.query(sql, params);
      const target = filter?.value ? `"${filter.value}"` : `non-empty "${selectedColumn}"`;
      return res.json({
        answer: `There are ${row?.count ?? 0} rows with ${target}.`,
        intent: "count",
        column: selectedColumn,
        filter: filter?.value ? { value: filter.value } : null,
        value: row?.count ?? 0,
      });
    }

    if (intent.type === "distinct") {
      const sql = `SELECT COUNT(DISTINCT value) as count FROM (${baseQuery}) t WHERE value IS NOT NULL`;
      const [[row]]: any = await dbPool.query(sql, [...keyParams(1), jsonPath, fileId]);
      return res.json({
        answer: `"${selectedColumn}" has ${row?.count ?? 0} distinct values.`,
        intent: "distinct",
        column: selectedColumn,
        value: row?.count ?? 0,
      });
    }

    if (intent.type === "top") {
      const sql = `SELECT value, COUNT(*) as count FROM (${baseQuery}) t WHERE value IS NOT NULL GROUP BY value ORDER BY count DESC LIMIT ?`;
      const [rows]: any = await dbPool.query(sql, [...keyParams(1), jsonPath, fileId, intent.topN]);
      const items = (rows || []).map((row: any) => ({
        value: row.value,
        count: Number(row.count || 0),
      }));
      const list = items.length
        ? items.map((item: { value: string; count: number }) => `${item.value} (${item.count})`).join(", ")
        : "No values found.";
      return res.json({
        answer: `Top ${items.length} values of "${selectedColumn}": ${list}`,
        intent: "top",
        column: selectedColumn,
        items,
      });
    }

    if (["sum", "avg", "min", "max"].includes(intent.type)) {
      const sql = `
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN value REGEXP '^-?[0-9]+(\\.[0-9]+)?$' THEN 1 ELSE 0 END) as numericCount,
          SUM(CASE WHEN value REGEXP '^-?[0-9]+(\\.[0-9]+)?$' THEN CAST(value AS DECIMAL(20,6)) ELSE 0 END) as sum,
          AVG(CASE WHEN value REGEXP '^-?[0-9]+(\\.[0-9]+)?$' THEN CAST(value AS DECIMAL(20,6)) END) as avg,
          MIN(CASE WHEN value REGEXP '^-?[0-9]+(\\.[0-9]+)?$' THEN CAST(value AS DECIMAL(20,6)) END) as min,
          MAX(CASE WHEN value REGEXP '^-?[0-9]+(\\.[0-9]+)?$' THEN CAST(value AS DECIMAL(20,6)) END) as max
        FROM (${baseQuery}) t
        WHERE value IS NOT NULL
      `;
      const [[row]]: any = await dbPool.query(sql, [...keyParams(1), jsonPath, fileId]);
      const numericCount = Number(row?.numericCount ?? 0);
      if (numericCount === 0) {
        return res.json({
          answer: `No numeric values found in "${selectedColumn}".`,
          intent: intent.type,
          column: selectedColumn,
          value: 0,
        });
      }

      if (intent.type === "sum") {
        return res.json({
          answer: `The total of "${selectedColumn}" is ${formatNumber(Number(row.sum || 0))}.`,
          intent: "sum",
          column: selectedColumn,
          value: Number(row.sum || 0),
        });
      }

      if (intent.type === "avg") {
        return res.json({
          answer: `The average of "${selectedColumn}" is ${formatNumber(Number(row.avg || 0))}.`,
          intent: "avg",
          column: selectedColumn,
          value: Number(row.avg || 0),
        });
      }

      if (intent.type === "min") {
        return res.json({
          answer: `The minimum of "${selectedColumn}" is ${formatNumber(Number(row.min || 0))}.`,
          intent: "min",
          column: selectedColumn,
          value: Number(row.min || 0),
        });
      }

      if (intent.type === "max") {
        return res.json({
          answer: `The maximum of "${selectedColumn}" is ${formatNumber(Number(row.max || 0))}.`,
          intent: "max",
          column: selectedColumn,
          value: Number(row.max || 0),
        });
      }
    }

      return res.json({
        answer: "I could not understand the question. Try asking for counts or top values.",
        intent: "unknown",
      });
    } catch (error: any) {
      console.error("[data-qa] /ask failed", {
        message: error?.message,
        code: error?.code,
        sqlMessage: error?.sqlMessage,
      });
      try {
        const fallback = await answerQuestionWithFallback(dbPool, {
          fileId,
          projectId,
          questionRaw,
        });
        if (fallback) {
          return res.json(fallback);
        }
      } catch (fallbackError: any) {
        console.error("[data-qa] fallback failed", {
          message: fallbackError?.message,
          code: fallbackError?.code,
          sqlMessage: fallbackError?.sqlMessage,
        });
      }
      return res.status(500).json({
        message: "AI Q&A request failed. Please verify file columns/data format and try again.",
      });
    }
  });

  return router;
}
