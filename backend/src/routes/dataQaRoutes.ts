import { Router } from "express";
import { Pool } from "mysql2/promise";
import { requireAuth } from "../middleware/auth";

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
  | "top";

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

  if (/\b(columns?|fields?|headers?)\b/.test(lower)) {
    return { type: "columns", topN };
  }
  if (/\b(rows?|records?)\b/.test(lower) && /\bhow many\b|\bcount\b/.test(lower)) {
    return { type: "rows", topN };
  }
  if (/\btop\b|\bmost common\b|\bmost frequent\b/.test(lower)) {
    return { type: "top", topN };
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
  const [rows] = await dbPool.query<any[]>(
    "SELECT data_json FROM file_rows WHERE file_id = ? LIMIT 200",
    [fileId]
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

export function dataQaRoutes(dbPool: Pool) {
  const router = Router();
  router.use(requireAuth);

  router.post("/ask", async (req, res) => {
    const payload = req.body as AskPayload;
    const fileId = Number(payload?.fileId);
    const projectId = Number(payload?.projectId);
    const questionRaw = String(payload?.question || "").trim();

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
            "NULLIF(NULLIF(TRIM(JSON_UNQUOTE(JSON_EXTRACT(data_json, ?))), ''), '-')";
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
              "NULLIF(NULLIF(TRIM(JSON_UNQUOTE(JSON_EXTRACT(data_json, ?))), ''), '-')";
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
            const [rows]: any = await dbPool.query(sql, [groupPath, buildJsonPath(measureColumn), file.id, limit]);
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
          const [rows]: any = await dbPool.query(sql, [groupPath, file.id, limit]);
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
          "NULLIF(NULLIF(TRIM(JSON_UNQUOTE(JSON_EXTRACT(data_json, ?))), ''), '-')";
        const baseQuery = `SELECT ${valueExpr} as value FROM file_rows WHERE file_id = ?`;

        if (intent.type === "count") {
          const sql = filter?.value
            ? `SELECT COUNT(*) as count FROM (${baseQuery}) t WHERE value IS NOT NULL AND LOWER(value) = LOWER(?)`
            : `SELECT COUNT(*) as count FROM (${baseQuery}) t WHERE value IS NOT NULL`;
          const params = filter?.value
            ? [jsonPath, file.id, filter.value]
            : [jsonPath, file.id];
          const [[row]]: any = await dbPool.query(sql, params);
          aggregatedValue += Number(row?.count ?? 0);
          matchedFiles += 1;
          continue;
        }

        if (intent.type === "distinct") {
          const sql = `SELECT COUNT(DISTINCT value) as count FROM (${baseQuery}) t WHERE value IS NOT NULL`;
          const [[row]]: any = await dbPool.query(sql, [jsonPath, file.id]);
          aggregatedValue += Number(row?.count ?? 0);
          matchedFiles += 1;
          continue;
        }

        if (intent.type === "top") {
          const sql = `SELECT value, COUNT(*) as count FROM (${baseQuery}) t WHERE value IS NOT NULL GROUP BY value ORDER BY count DESC LIMIT ?`;
          const [rows]: any = await dbPool.query(sql, [jsonPath, file.id, intent.topN]);
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
          const [[row]]: any = await dbPool.query(sql, [jsonPath, file.id]);
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

      if (intent.type === "top" || intent.type === "group") {
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
    const groupByColumn = findGroupByColumn(questionRaw, columns);
    let filter = findFilter(questionRaw, columns);
    let selectedColumn = filter?.column || pickColumn(questionNorm, columns);

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
        "NULLIF(NULLIF(TRIM(JSON_UNQUOTE(JSON_EXTRACT(data_json, ?))), ''), '-')";
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
          return res.json({
            answer: `Please specify a numeric column to aggregate by "${groupByColumn}".`,
            intent: "group",
          });
        }

        const measureExpr =
          "NULLIF(NULLIF(TRIM(JSON_UNQUOTE(JSON_EXTRACT(data_json, ?))), ''), '-')";
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
        const [rows]: any = await dbPool.query(sql, [groupPath, buildJsonPath(measureColumn), fileId, limit]);
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
        const list = items.map((item) => `${item.value} (${formatNumber(item.count)})`).join(", ");
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
      const [rows]: any = await dbPool.query(sql, [groupPath, fileId, limit]);
      const items = (rows || []).map((row: any) => ({
        value: row.value,
        count: Number(row.count || 0),
      }));
      const list = items.length
        ? items.map((item) => `${item.value} (${item.count})`).join(", ")
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
      "NULLIF(NULLIF(TRIM(JSON_UNQUOTE(JSON_EXTRACT(data_json, ?))), ''), '-')";
    const baseQuery = `SELECT ${valueExpr} as value FROM file_rows WHERE file_id = ?`;

    if (intent.type === "count") {
      const sql = filter?.value
        ? `SELECT COUNT(*) as count FROM (${baseQuery}) t WHERE value IS NOT NULL AND LOWER(value) = LOWER(?)`
        : `SELECT COUNT(*) as count FROM (${baseQuery}) t WHERE value IS NOT NULL`;
      const params = filter?.value
        ? [jsonPath, fileId, filter.value]
        : [jsonPath, fileId];
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
      const [[row]]: any = await dbPool.query(sql, [jsonPath, fileId]);
      return res.json({
        answer: `"${selectedColumn}" has ${row?.count ?? 0} distinct values.`,
        intent: "distinct",
        column: selectedColumn,
        value: row?.count ?? 0,
      });
    }

    if (intent.type === "top") {
      const sql = `SELECT value, COUNT(*) as count FROM (${baseQuery}) t WHERE value IS NOT NULL GROUP BY value ORDER BY count DESC LIMIT ?`;
      const [rows]: any = await dbPool.query(sql, [jsonPath, fileId, intent.topN]);
      const items = (rows || []).map((row: any) => ({
        value: row.value,
        count: Number(row.count || 0),
      }));
      const list = items.length
        ? items.map((item) => `${item.value} (${item.count})`).join(", ")
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
      const [[row]]: any = await dbPool.query(sql, [jsonPath, fileId]);
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
  });

  return router;
}
