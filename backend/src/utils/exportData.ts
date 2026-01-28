import { Pool } from "mysql2/promise";
import { buildDataJsonExpr, buildKeyParams, getEncryptionKey } from "./dbEncryption";
import { extractRoamingSummary, getDateFromSummary, matchesFilterTerm, parseDateCandidate } from "./roamingData";

export type ColumnFilterOp = "eq" | "neq" | "contains" | "gt" | "gte" | "lt" | "lte";

export type ColumnFilter = {
  column: string;
  op?: ColumnFilterOp;
  value: string | number | boolean | null;
};

export type ExportFilters = {
  startDate?: string;
  endDate?: string;
  partner?: string;
  country?: string;
  columnFilters?: ColumnFilter[];
};

export type ExportChartConfig = {
  id: string;
  title?: string;
  type?: string;
  dataset?: string;
  categoryKey?: string;
  valueKeys?: string[];
  notes?: string;
};

export type ExportRequestBody = {
  format: "excel" | "pdf" | "png" | "json" | "xml";
  scope?: "dashboard" | "file" | "report" | "custom";
  title?: string;
  fileId?: number;
  projectId?: number;
  filters?: ExportFilters;
  selectedColumns?: string[];
  chartConfig?: { charts?: ExportChartConfig[] };
  chartImages?: Array<{ id?: string; title?: string; dataUrl: string }>;
  dataRows?: Array<Record<string, any>>;
  rowLimit?: number;
};

export type ExportMeta = {
  generatedAt: string;
  scope: string;
  title: string;
  filters: ExportFilters | null;
  selectedColumns: string[];
  chartConfig: ExportChartConfig[];
  rowCount: number;
};

const toPositiveInt = (value: any, fallback: number) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
};

const toLower = (value: any) => String(value ?? "").toLowerCase();

const toComparableNumber = (value: any): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const compareValues = (left: any, op: ColumnFilterOp, right: any) => {
  const lNum = toComparableNumber(left);
  const rNum = toComparableNumber(right);

  if (op === "contains") {
    return toLower(left).includes(toLower(right));
  }

  if (op === "eq") return toLower(left) === toLower(right);
  if (op === "neq") return toLower(left) !== toLower(right);

  if (lNum !== null && rNum !== null) {
    if (op === "gt") return lNum > rNum;
    if (op === "gte") return lNum >= rNum;
    if (op === "lt") return lNum < rNum;
    if (op === "lte") return lNum <= rNum;
  }

  // Fallback to string comparison for non-numeric values.
  if (op === "gt") return toLower(left) > toLower(right);
  if (op === "gte") return toLower(left) >= toLower(right);
  if (op === "lt") return toLower(left) < toLower(right);
  if (op === "lte") return toLower(left) <= toLower(right);

  return false;
};

const applyColumnFilters = (rows: Array<Record<string, any>>, filters?: ColumnFilter[]) => {
  if (!filters || filters.length === 0) return rows;
  const normalized = filters
    .map((f) => ({
      column: String(f.column || "").trim(),
      op: (f.op || "eq") as ColumnFilterOp,
      value: f.value,
    }))
    .filter((f) => f.column);
  if (normalized.length === 0) return rows;

  return rows.filter((row) => {
    return normalized.every((f) => {
      const value = row[f.column];
      return compareValues(value, f.op, f.value);
    });
  });
};

const applyRoamingFilters = (rows: Array<Record<string, any>>, filters?: ExportFilters) => {
  if (!filters) return rows;
  const startBound = filters.startDate ? parseDateCandidate(filters.startDate) : null;
  const endBound = filters.endDate ? parseDateCandidate(filters.endDate) : null;
  const partnerFilter = String(filters.partner || "").trim();
  const countryFilter = String(filters.country || "").trim();

  return rows.filter((row) => {
    const summary = extractRoamingSummary(row);

    if (partnerFilter && !matchesFilterTerm(summary.partner, row, partnerFilter)) {
      return false;
    }
    if (countryFilter && !matchesFilterTerm(summary.country, row, countryFilter)) {
      return false;
    }

    const eventDate = getDateFromSummary(summary, row) || parseDateCandidate(row.date) || parseDateCandidate(row.day);
    if (eventDate) {
      if (startBound && eventDate < startBound) return false;
      if (endBound && eventDate > endBound) return false;
    }

    return true;
  });
};

const pickColumns = (rows: Array<Record<string, any>>, selectedColumns?: string[]) => {
  if (!selectedColumns || selectedColumns.length === 0) {
    const union = new Set<string>();
    for (const row of rows) {
      Object.keys(row || {}).forEach((k) => union.add(k));
    }
    return Array.from(union.values());
  }
  return selectedColumns.map((c) => String(c)).filter(Boolean);
};

const projectRows = (rows: Array<Record<string, any>>, columns: string[]) => {
  return rows.map((row) => {
    const next: Record<string, any> = {};
    for (const col of columns) {
      next[col] = Object.prototype.hasOwnProperty.call(row, col) ? row[col] : "";
    }
    return next;
  });
};

const fetchRowsForFile = async (dbPool: Pool, fileId: number, rowLimit: number) => {
  const encryptionKey = getEncryptionKey();
  const dataJsonExpr = buildDataJsonExpr(encryptionKey);
  const [colRows]: any = await dbPool.query(
    "SELECT name FROM file_columns WHERE file_id = ? ORDER BY position ASC",
    [fileId]
  );
  const fileColumns = (colRows as any[]).map((c) => c.name);

  const [rowRows]: any = await dbPool.query(
    `SELECT ${dataJsonExpr} as data_json FROM file_rows WHERE file_id = ? ORDER BY row_index ASC LIMIT ?`,
    [...buildKeyParams(encryptionKey, 1), fileId, rowLimit]
  );
  const rows = (rowRows as any[]).map((r) => {
    try {
      return JSON.parse(r.data_json || "{}");
    } catch {
      return {};
    }
  });

  return { fileColumns, rows: rows as Array<Record<string, any>> };
};

const fetchRowsForProject = async (dbPool: Pool, projectId: number, rowLimit: number) => {
  const perFileLimit = Math.max(200, Math.floor(rowLimit / 3));
  const [fileRows]: any = await dbPool.query(
    "SELECT id, name FROM files WHERE project_id = ? ORDER BY uploaded_at DESC LIMIT 3",
    [projectId]
  );
  const files = fileRows as Array<{ id: number; name: string }>;
  const combined: Array<Record<string, any>> = [];
  const unionColumns = new Set<string>();

  for (const file of files) {
    const { fileColumns, rows } = await fetchRowsForFile(dbPool, file.id, perFileLimit);
    fileColumns.forEach((c) => unionColumns.add(c));
    for (const row of rows) {
      combined.push({
        __fileId: file.id,
        __fileName: file.name,
        ...row,
      });
      if (combined.length >= rowLimit) break;
    }
    if (combined.length >= rowLimit) break;
  }

  return { fileColumns: Array.from(unionColumns.values()), rows: combined };
};

export const resolveExportData = async (dbPool: Pool, body: ExportRequestBody) => {
  const rowLimit = toPositiveInt(body.rowLimit, 5000);

  let baseRows: Array<Record<string, any>> = Array.isArray(body.dataRows) ? body.dataRows : [];
  let baseColumns: string[] = [];

  if (baseRows.length === 0 && body.fileId) {
    const { fileColumns, rows } = await fetchRowsForFile(dbPool, body.fileId, rowLimit);
    baseRows = rows;
    baseColumns = fileColumns;
  } else if (baseRows.length === 0 && body.projectId) {
    const { fileColumns, rows } = await fetchRowsForProject(dbPool, body.projectId, rowLimit);
    baseRows = rows;
    baseColumns = fileColumns;
  }

  const filteredByRoaming = applyRoamingFilters(baseRows, body.filters);
  const filteredRows = applyColumnFilters(filteredByRoaming, body.filters?.columnFilters);

  const columnsFromSelection = pickColumns(filteredRows, body.selectedColumns);
  const columns = columnsFromSelection.length > 0 ? columnsFromSelection : baseColumns;
  const projectedRows = projectRows(filteredRows, columns);

  const charts = Array.isArray(body.chartConfig?.charts) ? body.chartConfig!.charts! : [];
  const meta: ExportMeta = {
    generatedAt: new Date().toISOString(),
    scope: body.scope || (body.fileId ? "file" : body.projectId ? "project" : "custom"),
    title: body.title || "Roaming Export",
    filters: body.filters || null,
    selectedColumns: columns,
    chartConfig: charts,
    rowCount: projectedRows.length,
  };

  return { meta, columns, rows: projectedRows, chartImages: body.chartImages || [] };
};
