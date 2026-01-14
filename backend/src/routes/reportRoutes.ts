import { Router } from "express";
import path from "path";
import fs from "fs/promises";
import { Pool } from "mysql2/promise";
import { requireAuth, requireRole } from "../middleware/auth";

type SlidePayload = {
  id?: string;
  chartImage: string; // base64 dataUrl
  title: string;
  subtitle: string;
  summary: string;
  createdAt?: string;
  chartMeta?: {
    chartType: string;
    categoryCol: string;
    valueCols: string[];
    fileName?: string;
    fileId?: number;
    selectedCols?: string[];
  };
};

function ensureUploadsDir() {
  const dir = path.join(process.cwd(), "uploads", "reports");
  return fs.mkdir(dir, { recursive: true }).then(() => dir);
}

function dataUrlToBuffer(dataUrl: string) {
  // expects: data:image/png;base64,xxxx
  const match = dataUrl.match(/^data:(image\/\w+);base64,(.+)$/);
  if (!match) throw new Error("Invalid image dataUrl");
  const mime = match[1];
  const base64 = match[2];
  const ext = mime.includes("png") ? "png" : mime.includes("jpeg") ? "jpg" : "png";
  return { buffer: Buffer.from(base64, "base64"), ext };
}

export function reportRoutes(dbPool: Pool) {
  const router = Router();
  router.use(requireAuth);

  // ✅ Create report + slides (save to DB, store images on server)
  router.post("/", requireRole(["admin", "analyst"]), async (req, res) => {
    try {
      const { name, slides } = req.body as { name: string; slides: SlidePayload[] };

      if (!name) return res.status(400).send("name is required");
      if (!Array.isArray(slides) || slides.length === 0) return res.status(400).send("slides is required");

      const uploadsDir = await ensureUploadsDir();

      const conn = await dbPool.getConnection();
      try {
        await conn.beginTransaction();

        const [r] = await conn.query<any>(
          "INSERT INTO reports (name, status) VALUES (?, 'draft')",
          [name]
        );
        const reportId = r.insertId as number;

        for (let i = 0; i < slides.length; i++) {
          const s = slides[i];
          if (!s.chartImage) throw new Error("Slide chartImage missing");

          const { buffer, ext } = dataUrlToBuffer(s.chartImage);
          const fileName = `report_${reportId}_slide_${i + 1}.${ext}`;
          const filePath = path.join(uploadsDir, fileName);
          await fs.writeFile(filePath, buffer);

          const imageUrl = `/uploads/reports/${fileName}`;

          await conn.query(
            `INSERT INTO report_slides
              (report_id, slide_index, title, subtitle, summary, chart_type, category_col, value_cols, selected_cols, file_id, file_name, chart_image_url)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              reportId,
              i,
              s.title || `Slide ${i + 1}`,
              s.subtitle || "",
              s.summary || "",
              s.chartMeta?.chartType || null,
              s.chartMeta?.categoryCol || null,
              JSON.stringify(s.chartMeta?.valueCols || []),
              JSON.stringify(s.chartMeta?.selectedCols || []),
              s.chartMeta?.fileId || null,
              s.chartMeta?.fileName || null,
              imageUrl,
            ]
          );
        }

        await conn.commit();
        res.json({ ok: true, reportId });
      } catch (e) {
        await conn.rollback();
        throw e;
      } finally {
        conn.release();
      }
    } catch (err: any) {
      console.error(err);
      res.status(500).send(err.message || "Save report failed");
    }
  });

  // ✅ List reports
  router.get("/", async (_req, res) => {
    try {
      const [rows] = await dbPool.query(
        "SELECT id, name, status, created_at, updated_at FROM reports ORDER BY id DESC"
      );
      res.json(rows);
    } catch (err: any) {
      res.status(500).send(err.message || "Failed to list reports");
    }
  });

  // ✅ Update report name/status
  router.put("/:id", requireRole(["admin", "analyst"]), async (req, res) => {
    try {
      const reportId = Number(req.params.id);
      const { name, status } = req.body as { name?: string; status?: string };
      await dbPool.execute(
        "UPDATE reports SET name = COALESCE(?, name), status = COALESCE(?, status) WHERE id = ?",
        [name || null, status || null, reportId]
      );
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).send(err.message || "Failed to update report");
    }
  });

  // Add slides to an existing report (collaboration)
  router.post("/:id/slides", requireRole(["admin", "analyst"]), async (req, res) => {
    try {
      const reportId = Number(req.params.id);
      const { slides } = req.body as { slides: SlidePayload[] };
      if (!Array.isArray(slides) || slides.length === 0) {
        return res.status(400).send("slides is required");
      }

      const uploadsDir = await ensureUploadsDir();
      const conn = await dbPool.getConnection();
      try {
        await conn.beginTransaction();

        const [maxRows] = await conn.query<any[]>(
          "SELECT MAX(slide_index) as maxIndex FROM report_slides WHERE report_id = ?",
          [reportId]
        );
        const currentMax = Number(maxRows?.[0]?.maxIndex ?? -1);
        let nextIndex = Number.isFinite(currentMax) ? currentMax + 1 : 0;

        for (const s of slides) {
          if (!s.chartImage) throw new Error("Slide chartImage missing");

          const { buffer, ext } = dataUrlToBuffer(s.chartImage);
          const fileName = `report_${reportId}_slide_${nextIndex + 1}.${ext}`;
          const filePath = path.join(uploadsDir, fileName);
          await fs.writeFile(filePath, buffer);

          const imageUrl = `/uploads/reports/${fileName}`;

          await conn.query(
            `INSERT INTO report_slides
              (report_id, slide_index, title, subtitle, summary, chart_type, category_col, value_cols, selected_cols, file_id, file_name, chart_image_url)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              reportId,
              nextIndex,
              s.title || `Slide ${nextIndex + 1}`,
              s.subtitle || "",
              s.summary || "",
              s.chartMeta?.chartType || null,
              s.chartMeta?.categoryCol || null,
              JSON.stringify(s.chartMeta?.valueCols || []),
              JSON.stringify(s.chartMeta?.selectedCols || []),
              s.chartMeta?.fileId || null,
              s.chartMeta?.fileName || null,
              imageUrl,
            ]
          );

          nextIndex += 1;
        }

        await conn.query("UPDATE reports SET updated_at = NOW() WHERE id = ?", [reportId]);
        await conn.commit();
        res.json({ ok: true });
      } catch (e) {
        await conn.rollback();
        throw e;
      } finally {
        conn.release();
      }
    } catch (err: any) {
      res.status(500).send(err.message || "Failed to add slides");
    }
  });

  // Update one slide in a report (collaboration)
  router.put("/:id/slides/:index", requireRole(["admin", "analyst"]), async (req, res) => {
    try {
      const reportId = Number(req.params.id);
      const slideIndex = Number(req.params.index);
      const { title, subtitle, summary } = req.body as {
        title?: string;
        subtitle?: string;
        summary?: string;
      };

      await dbPool.execute(
        "UPDATE report_slides SET title = ?, subtitle = ?, summary = ? WHERE report_id = ? AND slide_index = ?",
        [title ?? "", subtitle ?? "", summary ?? "", reportId, slideIndex]
      );
      await dbPool.execute("UPDATE reports SET updated_at = NOW() WHERE id = ?", [reportId]);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).send(err.message || "Failed to update slide");
    }
  });

  // Delete one slide in a report (collaboration)
  router.delete("/:id/slides/:index", requireRole(["admin", "analyst"]), async (req, res) => {
    const reportId = Number(req.params.id);
    const slideIndex = Number(req.params.index);
    const conn = await dbPool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute(
        "DELETE FROM report_slides WHERE report_id = ? AND slide_index = ?",
        [reportId, slideIndex]
      );
      await conn.execute(
        "UPDATE report_slides SET slide_index = slide_index - 1 WHERE report_id = ? AND slide_index > ?",
        [reportId, slideIndex]
      );
      await conn.execute("UPDATE reports SET updated_at = NOW() WHERE id = ?", [reportId]);
      await conn.commit();
      res.json({ ok: true });
    } catch (err: any) {
      await conn.rollback();
      res.status(500).send(err.message || "Failed to delete slide");
    } finally {
      conn.release();
    }
  });

  // ✅ Delete report
  router.delete("/:id", requireRole(["admin", "analyst"]), async (req, res) => {
    try {
      const reportId = Number(req.params.id);
      await dbPool.execute("DELETE FROM reports WHERE id = ?", [reportId]);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).send(err.message || "Failed to delete report");
    }
  });

  // ✅ Get one report + slides
  router.get("/:id", async (req, res) => {
    try {
      const reportId = Number(req.params.id);
      const [reports] = await dbPool.query<any[]>(
        "SELECT id, name, status, created_at, updated_at FROM reports WHERE id=?",
        [reportId]
      );
      if (!reports.length) return res.status(404).send("Report not found");

      const [slides] = await dbPool.query<any[]>(
        "SELECT * FROM report_slides WHERE report_id=? ORDER BY slide_index ASC",
        [reportId]
      );

      res.json({ report: reports[0], slides });
    } catch (err: any) {
      res.status(500).send(err.message || "Failed to load report");
    }
  });

  return router;
}
