import { Router, Request, Response } from "express";
import { Pool } from "mysql2/promise";
import { requireAuth } from "../middleware/auth";
import PptxGenJS from "pptxgenjs";
import { writeAuditLog } from "../utils/auditLogger";

type SlidePayload = {
  title?: string;
  subtitle?: string;
  summary?: string;
  chartImage?: string;
};

export const exportPptxRoutes = (dbPool: Pool) => {
  const router = Router();
  router.use(requireAuth);

  router.post("/pptx-multi", async (req: Request, res: Response) => {
    try {
      const { slides, fileName } = req.body as {
        slides: SlidePayload[];
        fileName?: string;
      };

      if (!Array.isArray(slides) || slides.length === 0) {
        return res.status(400).json({ message: "slides is required" });
      }

      const pptx = new PptxGenJS();
      pptx.layout = "LAYOUT_WIDE";

      for (const s of slides) {
        if (!s?.chartImage) continue;

        const slide = pptx.addSlide();

        slide.addText(s.title || "Report", {
          x: 0.6, y: 0.3, w: 12.2, h: 0.6,
          fontSize: 30, bold: true, color: "1F2937",
        });

        slide.addText(s.subtitle || "", {
          x: 0.6, y: 0.9, w: 12.2, h: 0.4,
          fontSize: 14, color: "6B7280",
        });

        slide.addImage({
          data: s.chartImage,
          x: 0.7, y: 1.35, w: 12.0, h: 4.8,
        });

        slide.addText(s.summary || "", {
          x: 0.7, y: 6.25, w: 12.0, h: 1.1,
          fontSize: 14, color: "111827",
        });
      }

      const buf = (await (pptx as any).write("nodebuffer")) as Buffer;

      await writeAuditLog(dbPool, {
        req,
        action: "report_exported",
        details: {
          format: "pptx",
          slidesCount: slides.length,
          fileName: fileName || "report.pptx",
        },
      });

      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation"
      );
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${fileName || "report.pptx"}"`
      );

      return res.status(200).send(buf);
    } catch (err: any) {
      return res.status(500).json({ message: err?.message || "Failed to generate PPTX" });
    }
  });

  return router;
};
