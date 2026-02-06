import { Router, Request, Response } from "express";
import { requireAuth } from "../middleware/auth";
import PptxGenJS from "pptxgenjs";

const router = Router();
router.use(requireAuth);

type SlidePayload = {
  title?: string;
  subtitle?: string;
  summary?: string;
  chartImage?: string; // data URL: "data:image/png;base64,...."
};

router.post("/pptx-multi", async (req: Request, res: Response) => {
  try {
    const { slides, fileName } = req.body as {
      slides: SlidePayload[];
      fileName?: string;
    };

    if (!Array.isArray(slides) || slides.length === 0) {
      return res.status(400).send("slides is required");
    }

    const pptx = new PptxGenJS();
    pptx.layout = "LAYOUT_WIDE";

    // Create a slide for each valid slide payload
    for (const s of slides) {
      if (!s?.chartImage) continue;

      const slide = pptx.addSlide();

      slide.addText(s.title || "Report", {
        x: 0.6,
        y: 0.3,
        w: 12.2,
        h: 0.6,
        fontSize: 30,
        bold: true,
        color: "1F2937",
      });

      slide.addText(s.subtitle || "", {
        x: 0.6,
        y: 0.9,
        w: 12.2,
        h: 0.4,
        fontSize: 14,
        color: "6B7280",
      });

      slide.addImage({
        data: s.chartImage, // ✅ data URL is OK
        x: 0.7,
        y: 1.35,
        w: 12.0,
        h: 4.8,
      });

      slide.addText(s.summary || "", {
        x: 0.7,
        y: 6.25,
        w: 12.0,
        h: 1.1,
        fontSize: 14,
        color: "111827",
      });
    }

    // ✅ Most compatible for server-side
   
    const buf = (await (pptx as any).write("nodebuffer")) as Buffer;
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
    console.error("❌ PPTX MULTI export error:", err);
    return res.status(500).send(err?.message || "Failed to generate PPTX");
  }
});

export default router;
