export type ReportSlide = {
  id: string;
  chartImage: string; // base64 PNG
  title: string;
  subtitle: string;
  summary: string;
  createdAt: string;
  chartMeta?: {
    chartType: string;
    categoryCol: string;
    valueCols: string[];
    fileName?: string;
  };
};

export const REPORT_DRAFT_KEY = "reportDraftSlides";