import { Router } from "express";
import path from "path";
import fs from "fs/promises";
import { Pool } from "mysql2/promise";
import { requireAuth, requireRole } from "../middleware/auth";

type ChartPayload = {
  fileId?: number;
  fileName?: string;
  chartType: string;
  categoryCol?: string;
  valueCols?: string[];
  selectedCols?: string[];
  chartImage?: string; // base64 dataUrl
};

function ensureUploadsDir() {
  const dir = path.join(process.cwd(), "uploads", "charts");
  return fs.mkdir(dir, { recursive: true }).then(() => dir);
}

function dataUrlToBuffer(dataUrl: string) {
  const match = dataUrl.match(/^data:(image\/\w+);base64,(.+)$/);
  if (!match) throw new Error("Invalid image dataUrl");
  const mime = match[1];
  const base64 = match[2];
  const ext = mime.includes("png") ? "png" : mime.includes("jpeg") ? "jpg" : "png";
  return { buffer: Buffer.from(base64, "base64"), ext };
}

export function chartRoutes(dbPool: Pool) {
  const router = Router();
  router.use(requireAuth);

  // Save generated chart config (and optional image)
  router.post("/", requireRole(["admin", "analyst"]), async (req, res) => {
    try {
      const payload = req.body as ChartPayload;
      if (!payload?.chartType) return res.status(400).send("chartType is required");

      let imageUrl: string | null = null;
      if (payload.chartImage) {
        const uploadsDir = await ensureUploadsDir();
        const { buffer, ext } = dataUrlToBuffer(payload.chartImage);
        const fileName = `chart_${Date.now()}_${Math.floor(Math.random() * 10000)}.${ext}`;
        const filePath = path.join(uploadsDir, fileName);
        await fs.writeFile(filePath, buffer);
        imageUrl = `/uploads/charts/${fileName}`;
      }

      const [result] = await dbPool.query<any>(
        `INSERT INTO charts
          (file_id, file_name, chart_type, category_col, value_cols, selected_cols, chart_image_url)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          payload.fileId || null,
          payload.fileName || null,
          payload.chartType,
          payload.categoryCol || null,
          JSON.stringify(payload.valueCols || []),
          JSON.stringify(payload.selectedCols || []),
          imageUrl,
        ]
      );

      res.json({ ok: true, chartId: result.insertId, chartImageUrl: imageUrl });
    } catch (err: any) {
      console.error(err);
      res.status(500).send(err.message || "Save chart failed");
    }
  });

  return router;
}
