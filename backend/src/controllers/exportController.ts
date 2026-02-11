import { Request, Response } from "express";
import { Pool } from "mysql2/promise";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { create } from "xmlbuilder2";
import { resolveExportData, ExportRequestBody } from "../utils/exportData";
import { writeAuditLog } from "../utils/auditLogger";

const hasAnyRole = (req: Request, roles: string[]) => {
  const primary = req.user?.role;
  const list = Array.isArray(req.user?.roles)
    ? req.user!.roles
    : primary
      ? [primary]
      : [];
  return list.some((r) => roles.includes(r));
};

const canAccessAnyProject = (req: Request) => hasAnyRole(req, ["admin", "analyst"]);

async function requireProjectAccess(dbPool: Pool, projectId: number, req: Request) {
  const authUserId = req.user?.id;
  if (!authUserId) {
    return { ok: false as const, status: 401, message: "Unauthorized" };
  }

  const [rows]: any = await dbPool.query(
    "SELECT user_id FROM projects WHERE id = ? LIMIT 1",
    [projectId]
  );
  if (!rows?.length) {
    return { ok: false as const, status: 404, message: "Project not found" };
  }

  const ownerId = Number(rows[0].user_id);
  if (!Number.isFinite(ownerId)) {
    return { ok: false as const, status: 500, message: "Invalid project owner" };
  }

  if (ownerId !== authUserId && !canAccessAnyProject(req)) {
    return { ok: false as const, status: 403, message: "Forbidden" };
  }

  return { ok: true as const, ownerId };
}

async function requireFileAccess(dbPool: Pool, fileId: number, req: Request) {
  const authUserId = req.user?.id;
  if (!authUserId) {
    return { ok: false as const, status: 401, message: "Unauthorized" };
  }

  const [rows]: any = await dbPool.query(
    `SELECT f.id as fileId, f.project_id as projectId, p.user_id as ownerId
     FROM files f
     INNER JOIN projects p ON p.id = f.project_id
     WHERE f.id = ?
     LIMIT 1`,
    [fileId]
  );

  if (!rows?.length) {
    return { ok: false as const, status: 404, message: "File not found" };
  }

  const ownerId = Number(rows[0].ownerId);
  if (!Number.isFinite(ownerId)) {
    return { ok: false as const, status: 500, message: "Invalid file owner" };
  }

  if (ownerId !== authUserId && !canAccessAnyProject(req)) {
    return { ok: false as const, status: 403, message: "Forbidden" };
  }

  return {
    ok: true as const,
    fileId,
    projectId: Number(rows[0].projectId),
    ownerId,
  };
}

const ensureFormat = (value: any): ExportRequestBody["format"] | null => {
  const fmt = String(value || "").toLowerCase();
  if (["excel", "pdf", "png", "json", "xml"].includes(fmt)) {
    return fmt as ExportRequestBody["format"];
  }
  return null;
};

const fileSafeName = (title: string, ext: string) => {
  const safe = title.replace(/[^a-zA-Z0-9_\-]+/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "");
  return `${safe || "roaming_export"}.${ext}`;
};

const toMetaRows = (meta: any) => {
  const rows: Array<{ key: string; value: string }> = [];
  rows.push({ key: "generatedAt", value: meta.generatedAt });
  rows.push({ key: "scope", value: meta.scope });
  rows.push({ key: "title", value: meta.title });
  rows.push({ key: "rowCount", value: String(meta.rowCount) });

  if (meta.filters) {
    const { startDate, endDate, partner, country, columnFilters } = meta.filters;
    if (startDate) rows.push({ key: "filters.startDate", value: String(startDate) });
    if (endDate) rows.push({ key: "filters.endDate", value: String(endDate) });
    if (partner) rows.push({ key: "filters.partner", value: String(partner) });
    if (country) rows.push({ key: "filters.country", value: String(country) });
    if (Array.isArray(columnFilters) && columnFilters.length) {
      rows.push({ key: "filters.columnFilters", value: JSON.stringify(columnFilters) });
    }
  }

  if (Array.isArray(meta.selectedColumns) && meta.selectedColumns.length) {
    rows.push({ key: "selectedColumns", value: meta.selectedColumns.join(", ") });
  }

  if (Array.isArray(meta.chartConfig) && meta.chartConfig.length) {
    rows.push({ key: "chartConfig", value: JSON.stringify(meta.chartConfig) });
  }

  return rows;
};

const buildExcelBuffer = (
  meta: any,
  columns: string[],
  rows: Array<Record<string, any>>
) => {
  const wb = XLSX.utils.book_new();

  const dataSheetRows = rows.map((row) => {
    const next: Record<string, any> = {};
    for (const col of columns) next[col] = row[col];
    return next;
  });
  const dataSheet = XLSX.utils.json_to_sheet(dataSheetRows, { header: columns });
  XLSX.utils.book_append_sheet(wb, dataSheet, "data");

  const metaRows = toMetaRows(meta);
  const metaSheet = XLSX.utils.json_to_sheet(metaRows, { header: ["key", "value"] });
  XLSX.utils.book_append_sheet(wb, metaSheet, "metadata");

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  return buf as Buffer;
};

const buildJsonPayload = (meta: any, columns: string[], rows: Array<Record<string, any>>) => ({
  meta,
  columns,
  rows,
});

const buildXmlString = (meta: any, columns: string[], rows: Array<Record<string, any>>) => {
  const root = create({ version: "1.0" })
    .ele("export")
    .ele("meta");

  root.ele("generatedAt").txt(meta.generatedAt).up();
  root.ele("scope").txt(meta.scope).up();
  root.ele("title").txt(meta.title).up();
  root.ele("rowCount").txt(String(meta.rowCount)).up();

  const filters = meta.filters || {};
  const filtersNode = root.ele("filters");
  Object.entries(filters).forEach(([key, value]) => {
    if (value === null || value === undefined) return;
    if (key === "columnFilters") {
      filtersNode.ele(key).txt(JSON.stringify(value)).up();
    } else {
      filtersNode.ele(key).txt(String(value)).up();
    }
  });
  filtersNode.up();

  const columnsNode = root.ele("columns");
  columns.forEach((col) => columnsNode.ele("column").txt(col).up());
  columnsNode.up();

  const chartsNode = root.ele("charts");
  (meta.chartConfig || []).forEach((chart: any) => {
    const chartNode = chartsNode.ele("chart");
    Object.entries(chart || {}).forEach(([key, value]) => {
      if (value === null || value === undefined) return;
      if (Array.isArray(value)) {
        chartNode.ele(key).txt(JSON.stringify(value)).up();
      } else {
        chartNode.ele(key).txt(String(value)).up();
      }
    });
    chartNode.up();
  });
  chartsNode.up();

  const rowsNode = root.up().ele("rows");
  rows.forEach((row) => {
    const rowNode = rowsNode.ele("row");
    columns.forEach((col) => {
      const value = row[col];
      rowNode.ele(col).txt(value === null || value === undefined ? "" : String(value)).up();
    });
    rowNode.up();
  });

  return root.end({ prettyPrint: true });
};

const buildPdfBuffer = (
  meta: any,
  columns: string[],
  rows: Array<Record<string, any>>,
  chartImages: Array<{ title?: string; dataUrl: string }>
) => {
  const doc = new jsPDF({ orientation: "landscape" });

  doc.setFontSize(18);
  doc.text(meta.title || "Roaming Export", 14, 16);
  doc.setFontSize(10);
  doc.text(`Generated: ${new Date(meta.generatedAt).toLocaleString()}`, 14, 22);

  const filterParts: string[] = [];
  if (meta.filters?.startDate) filterParts.push(`start=${meta.filters.startDate}`);
  if (meta.filters?.endDate) filterParts.push(`end=${meta.filters.endDate}`);
  if (meta.filters?.partner) filterParts.push(`partner=${meta.filters.partner}`);
  if (meta.filters?.country) filterParts.push(`country=${meta.filters.country}`);
  if (filterParts.length) {
    doc.text(`Filters: ${filterParts.join(" | ")}`, 14, 28);
  }

  let currentY = filterParts.length ? 34 : 28;

  const chartMax = Math.min(chartImages.length, 3);
  for (let i = 0; i < chartMax; i += 1) {
    const chart = chartImages[i];
    try {
      doc.setFontSize(11);
      doc.text(chart.title || `Chart ${i + 1}`, 14, currentY);
      currentY += 3;
      doc.addImage(chart.dataUrl, "PNG", 14, currentY, 90, 55, undefined, "FAST");
      currentY += 60;
    } catch {
      // Ignore invalid chart images and continue rendering the table.
    }
  }

  const tableBody = rows.map((row) => columns.map((col) => row[col] ?? ""));
  autoTable(doc, {
    head: [columns],
    body: tableBody,
    startY: Math.min(currentY + 4, 150),
    styles: { fontSize: 8 },
    headStyles: { fillColor: [245, 158, 11] },
  });

  const buf = doc.output("arraybuffer");
  return Buffer.from(buf);
};

const dataUrlToPngBuffer = (dataUrl: string) => {
  const match = /^data:image\/(png|jpeg|jpg);base64,(.+)$/i.exec(String(dataUrl || ""));
  if (!match) return null;
  return Buffer.from(match[2], "base64");
};

export const exportData = (dbPool: Pool) => async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const format = ensureFormat(req.body?.format);
    if (!format) {
      return res.status(400).json({ message: "format must be one of: excel, pdf, png, json, xml" });
    }

    const body = { ...req.body, format } as ExportRequestBody;

    if (body.fileId != null) {
      const fileId = Number(body.fileId);
      if (!Number.isFinite(fileId)) {
        return res.status(400).json({ message: "fileId must be a number" });
      }
      const access = await requireFileAccess(dbPool, fileId, req);
      if (!access.ok) {
        return res.status(access.status).json({ message: access.message });
      }
    } else if (body.projectId != null) {
      const projectId = Number(body.projectId);
      if (!Number.isFinite(projectId)) {
        return res.status(400).json({ message: "projectId must be a number" });
      }
      const access = await requireProjectAccess(dbPool, projectId, req);
      if (!access.ok) {
        return res.status(access.status).json({ message: access.message });
      }
    }

    const { meta, columns, rows, chartImages } = await resolveExportData(dbPool, body);
    const auditDetails = {
      format,
      scope: meta?.scope || null,
      title: meta?.title || null,
      rowCount: Number(meta?.rowCount || rows.length || 0),
      columnCount: columns.length,
      chartImagesCount: chartImages.length,
      fileId: body.fileId ?? null,
      projectId: body.projectId ?? null,
    };

    if (format === "json") {
      const payload = buildJsonPayload(meta, columns, rows);
      const pretty = JSON.stringify(payload, null, 2);
      await writeAuditLog(dbPool, {
        req,
        action: "report_exported",
        details: auditDetails,
      });
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${fileSafeName(meta.title, "json")}"`);
      return res.status(200).send(pretty);
    }

    if (format === "xml") {
      const xml = buildXmlString(meta, columns, rows);
      await writeAuditLog(dbPool, {
        req,
        action: "report_exported",
        details: auditDetails,
      });
      res.setHeader("Content-Type", "application/xml; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${fileSafeName(meta.title, "xml")}"`);
      return res.status(200).send(xml);
    }

    if (format === "excel") {
      const buf = buildExcelBuffer(meta, columns, rows);
      await writeAuditLog(dbPool, {
        req,
        action: "report_exported",
        details: auditDetails,
      });
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      res.setHeader("Content-Disposition", `attachment; filename="${fileSafeName(meta.title, "xlsx")}"`);
      return res.status(200).send(buf);
    }

    if (format === "png") {
      const first = chartImages[0];
      if (!first?.dataUrl) {
        return res.status(400).json({ message: "PNG export requires at least one chartImages dataUrl." });
      }
      const buf = dataUrlToPngBuffer(first.dataUrl);
      if (!buf) {
        return res.status(400).json({ message: "Invalid PNG dataUrl." });
      }
      await writeAuditLog(dbPool, {
        req,
        action: "report_exported",
        details: auditDetails,
      });
      res.setHeader("Content-Type", "image/png");
      res.setHeader("Content-Disposition", `attachment; filename="${fileSafeName(meta.title, "png")}"`);
      return res.status(200).send(buf);
    }

    // Default to PDF
    const pdfBuf = buildPdfBuffer(meta, columns, rows, chartImages);
    await writeAuditLog(dbPool, {
      req,
      action: "report_exported",
      details: auditDetails,
    });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${fileSafeName(meta.title, "pdf")}"`);
    return res.status(200).send(pdfBuf);
  } catch (err: any) {
    console.error("export data error", err);
    return res.status(500).json({ message: err?.message || "Failed to export data." });
  }
};
