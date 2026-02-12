import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Download,
  Image as ImageIcon,
  LayoutPanelLeft,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react";
import { logAudit } from "../utils/auditLog";
import { apiFetch } from "../utils/api";

type ReportSlide = {
  id: string;
  chartImage: string;
  title: string;
  subtitle: string;
  summary: string;
  createdAt: string;
  chartMeta?: {
    chartType: string;
    categoryCol: string;
    valueCols: string[];
    fileName?: string;
    fileId?: number;
    selectedCols?: string[];
  };
};

type SlidePayload = {
  chartImage: string;
  title: string;
  subtitle: string;
  summary: string;
  chartMeta?: {
    chartType: string;
    categoryCol: string;
    valueCols: string[];
    fileName?: string;
    fileId?: number;
    selectedCols?: string[];
  };
};

const STORAGE_KEY = "reportDraftSlides";
const LEGACY_COLLAB_KEY = "reportDraftId";

const buildSlidePayloads = (slides: ReportSlide[]): SlidePayload[] =>
  slides.map((s) => ({
    chartImage: s.chartImage,
    title: s.title,
    subtitle: s.subtitle,
    summary: s.summary,
    chartMeta: s.chartMeta,
  }));

const parseStoredSlides = (): ReportSlide[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((slide: any, idx: number) => {
        const nowIso = new Date().toISOString();
        return {
          id: typeof slide?.id === "string" && slide.id ? slide.id : `slide-${idx + 1}`,
          chartImage: typeof slide?.chartImage === "string" ? slide.chartImage : "",
          title: typeof slide?.title === "string" ? slide.title : "",
          subtitle: typeof slide?.subtitle === "string" ? slide.subtitle : "",
          summary: typeof slide?.summary === "string" ? slide.summary : "",
          createdAt: typeof slide?.createdAt === "string" ? slide.createdAt : nowIso,
          chartMeta: slide?.chartMeta,
        } as ReportSlide;
      })
      .filter((slide: ReportSlide) => typeof slide.id === "string");
  } catch {
    return [];
  }
};

const formatDateLabel = (value?: string) => {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleString();
};

const SlideBuilderPage: React.FC = () => {
  const navigate = useNavigate();
  const [slides, setSlides] = useState<ReportSlide[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const [slideQuery, setSlideQuery] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  useEffect(() => {
    const loadedSlides = parseStoredSlides();
    setSlides(loadedSlides);
    setActiveId(loadedSlides[0]?.id || "");

    const hadLegacyCollab = Boolean(localStorage.getItem(LEGACY_COLLAB_KEY));
    if (hadLegacyCollab) {
      localStorage.removeItem(LEGACY_COLLAB_KEY);
      setNotice("Collaboration removed. Slide Builder is now local-only.");
    }

    const params = new URLSearchParams(window.location.search);
    if (params.get("reportId")) {
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(slides));
  }, [slides]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 2400);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (slides.length === 0) {
      setActiveId("");
      return;
    }
    if (!slides.some((s) => s.id === activeId)) {
      setActiveId(slides[0].id);
    }
  }, [slides, activeId]);

  const activeSlide = useMemo(
    () => slides.find((s) => s.id === activeId),
    [slides, activeId]
  );

  const activeSlideIndex = useMemo(
    () => slides.findIndex((s) => s.id === activeId),
    [slides, activeId]
  );

  const activeSlideSummaryCount = useMemo(
    () => (activeSlide?.summary || "").trim().length,
    [activeSlide]
  );

  const filteredSlides = useMemo(() => {
    const query = slideQuery.trim().toLowerCase();
    if (!query) return slides;
    return slides.filter((slide) => {
      const haystack = `${slide.title} ${slide.subtitle} ${slide.summary}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [slides, slideQuery]);

  const goToPreviousSlide = () => {
    if (activeSlideIndex <= 0) return;
    setActiveId(slides[activeSlideIndex - 1].id);
  };

  const goToNextSlide = () => {
    if (activeSlideIndex < 0 || activeSlideIndex >= slides.length - 1) return;
    setActiveId(slides[activeSlideIndex + 1].id);
  };

  const updateSlide = (id: string, patch: Partial<ReportSlide>) => {
    setSlides((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  };

  const deleteSlide = (id: string) => {
    setSlides((prev) => prev.filter((s) => s.id !== id));
    setNotice("Slide deleted.");
  };

  const clearDraft = () => {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(LEGACY_COLLAB_KEY);
    setSlides([]);
    setActiveId("");
    setSlideQuery("");
    setNotice("Draft cleared.");
  };

  const exportPPTX = async () => {
    if (slides.length === 0) {
      alert("No slides in draft. Go generate charts first.");
      return;
    }

    setIsExporting(true);
    try {
      try {
        const reportRes = await apiFetch("/api/reports", {
          method: "POST",
          body: JSON.stringify({
            name: `Roaming Report ${new Date().toISOString().slice(0, 10)}`,
            slides: buildSlidePayloads(slides),
          }),
        });
        if (!reportRes.ok) {
          console.warn("Save report failed:", await reportRes.text());
        }
      } catch (err) {
        console.warn("Save report failed:", err);
      }

      const res = await apiFetch("/api/export/pptx-multi", {
        method: "POST",
        body: JSON.stringify({
          slides: buildSlidePayloads(slides),
          fileName: `Roaming_Report_${new Date().toISOString().slice(0, 10)}.pptx`,
        }),
      });

      if (!res.ok) {
        const msg = await res.text();
        throw new Error(msg || "Export failed");
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "Roaming_Report.pptx";
      a.click();
      URL.revokeObjectURL(url);

      logAudit("Export Multi Slide PPTX", { slidesCount: slides.length });
      setNotice("PPTX exported.");
    } catch (err: any) {
      alert(err.message || "Export error");
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[linear-gradient(160deg,#fffdf7_0%,#fff7ed_45%,#fffbeb_100%)] p-4 sm:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <section className="rounded-3xl border border-amber-200/80 bg-white/90 backdrop-blur p-5 sm:p-7 shadow-[0_10px_40px_-24px_rgba(15,23,42,0.45)]">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800">
                <LayoutPanelLeft className="h-3.5 w-3.5" />
                Local Draft Mode
              </div>
              <h1 className="mt-3 text-3xl sm:text-4xl font-black tracking-tight text-slate-900">
                Slide Builder
              </h1>
              <p className="mt-2 text-sm text-slate-600 max-w-2xl leading-relaxed">
                Collaboration has been removed from this page. Build, edit, and export your slides from local draft data.
              </p>
              {notice && (
                <div className="mt-3 inline-flex rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700">
                  {notice}
                </div>
              )}
            </div>

            <div className="flex flex-wrap gap-2 sm:gap-3">
              <button
                onClick={() => navigate(-1)}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white border border-slate-200 text-slate-700 font-semibold hover:bg-slate-50"
              >
                <ArrowLeft className="w-4 h-4" />
                Back
              </button>

              <button
                onClick={clearDraft}
                className="px-4 py-2.5 rounded-xl bg-white border border-slate-200 text-slate-700 font-semibold hover:bg-slate-50"
              >
                Clear Draft
              </button>

              <button
                onClick={exportPPTX}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-500 text-white font-semibold hover:bg-amber-600 disabled:opacity-60"
                disabled={isExporting || slides.length === 0}
              >
                <Download className="w-4 h-4" />
                {isExporting ? "Exporting..." : `Export PPTX (${slides.length})`}
              </button>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="rounded-xl border border-amber-200 bg-gradient-to-br from-amber-50 to-orange-50 px-3 py-2">
              <div className="text-[11px] uppercase tracking-wide text-amber-700">Total Slides</div>
              <div className="text-lg font-bold text-slate-900">{slides.length}</div>
            </div>
            <div className="rounded-xl border border-amber-200 bg-gradient-to-br from-amber-50 to-orange-50 px-3 py-2">
              <div className="text-[11px] uppercase tracking-wide text-amber-700">Active Slide</div>
              <div className="text-lg font-bold text-slate-900">
                {activeSlideIndex >= 0 ? activeSlideIndex + 1 : "-"}
              </div>
            </div>
            <div className="rounded-xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-teal-50 px-3 py-2">
              <div className="text-[11px] uppercase tracking-wide text-emerald-700">Filtered</div>
              <div className="text-lg font-bold text-slate-900">{filteredSlides.length}</div>
            </div>
            <div className="rounded-xl border border-violet-200 bg-gradient-to-br from-violet-50 to-fuchsia-50 px-3 py-2">
              <div className="text-[11px] uppercase tracking-wide text-violet-700">Storage</div>
              <div className="text-lg font-bold text-slate-900">Local</div>
            </div>
          </div>
        </section>

        {slides.length === 0 ? (
          <section className="rounded-3xl border border-dashed border-slate-300 bg-white/85 p-10 text-center shadow-[0_8px_24px_-18px_rgba(15,23,42,0.5)]">
            <div className="mx-auto h-12 w-12 rounded-xl bg-slate-100 text-slate-500 flex items-center justify-center">
              <Sparkles className="h-6 w-6" />
            </div>
            <h2 className="mt-4 text-xl font-bold text-slate-900">No Draft Slides Yet</h2>
            <p className="mt-2 text-sm text-slate-600">
              Go to Chart Page, generate a chart, then click <span className="font-semibold">Report</span> to add it here.
            </p>
            <button
              onClick={() => navigate("/charts")}
              className="mt-5 px-4 py-2.5 rounded-xl bg-amber-500 text-white font-semibold hover:bg-amber-600"
            >
              Open Chart Page
            </button>
          </section>
        ) : (
          <section className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
            <aside className="xl:col-span-3 rounded-3xl border border-slate-200 bg-white/90 p-4 sm:p-5 xl:sticky xl:top-6 shadow-[0_8px_26px_-20px_rgba(15,23,42,0.45)]">
              <h2 className="text-lg font-bold text-slate-900">Slides</h2>
              <div className="mt-3 relative">
                <Search className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  value={slideQuery}
                  onChange={(e) => setSlideQuery(e.target.value)}
                  placeholder="Search title, subtitle, summary..."
                  className="w-full rounded-xl border border-slate-200 pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-200"
                />
              </div>
              <div className="mt-4 space-y-3 max-h-[70vh] overflow-auto pr-1">
                {filteredSlides.map((slide, idx) => {
                  const isActive = slide.id === activeId;
                  return (
                    <button
                      key={slide.id}
                      onClick={() => setActiveId(slide.id)}
                      className={`w-full text-left rounded-2xl border p-3 transition-all duration-150 ${
                        isActive
                          ? "border-amber-300 bg-amber-50/80 ring-2 ring-amber-100 shadow-sm"
                          : "border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm"
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        {slide.chartImage ? (
                          <img
                            src={slide.chartImage}
                            alt={slide.title || `Slide ${idx + 1}`}
                            className="h-12 w-16 rounded-lg border border-slate-200 object-cover bg-white"
                          />
                        ) : (
                          <div className="h-12 w-16 rounded-lg border border-slate-200 bg-slate-100 flex items-center justify-center text-slate-400">
                            <ImageIcon className="h-4 w-4" />
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                            Slide {slides.findIndex((s) => s.id === slide.id) + 1}
                          </div>
                          <div className="text-sm font-semibold text-slate-900 truncate">
                            {slide.title || "Untitled"}
                          </div>
                          <div className="text-xs text-slate-500 truncate">
                            {slide.subtitle || "-"}
                          </div>
                        </div>
                        <Trash2
                          className="h-4 w-4 text-rose-500 shrink-0 hover:text-rose-700"
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteSlide(slide.id);
                          }}
                        />
                      </div>
                      <div className="mt-2 text-[11px] text-slate-400">
                        {formatDateLabel(slide.createdAt)}
                      </div>
                    </button>
                  );
                })}
                {filteredSlides.length === 0 && (
                  <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-5 text-center text-sm text-slate-500">
                    No slides match your search.
                  </div>
                )}
              </div>
            </aside>

            <div className="xl:col-span-5 rounded-3xl border border-slate-200 bg-white/90 p-5 sm:p-6 shadow-[0_8px_26px_-20px_rgba(15,23,42,0.45)]">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl font-bold text-slate-900">Edit Slide</h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Slide {activeSlideIndex >= 0 ? activeSlideIndex + 1 : "-"} of {slides.length}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={goToPreviousSlide}
                    disabled={activeSlideIndex <= 0}
                    className="h-9 w-9 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                  >
                    <ChevronLeft className="h-4 w-4 mx-auto" />
                  </button>
                  <button
                    type="button"
                    onClick={goToNextSlide}
                    disabled={activeSlideIndex < 0 || activeSlideIndex >= slides.length - 1}
                    className="h-9 w-9 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                  >
                    <ChevronRight className="h-4 w-4 mx-auto" />
                  </button>
                </div>
              </div>
              {activeSlide ? (
                <div className="mt-5 space-y-4">
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-1.5">Title</label>
                    <input
                      className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-200"
                      value={activeSlide.title}
                      onChange={(e) => updateSlide(activeSlide.id, { title: e.target.value })}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-1.5">Subtitle</label>
                    <input
                      className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-200"
                      value={activeSlide.subtitle}
                      onChange={(e) => updateSlide(activeSlide.id, { subtitle: e.target.value })}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-1.5">Summary</label>
                    <textarea
                      className="w-full rounded-xl border border-slate-200 px-3 py-2.5 min-h-[190px] text-sm focus:outline-none focus:ring-2 focus:ring-amber-200"
                      value={activeSlide.summary}
                      onChange={(e) => updateSlide(activeSlide.id, { summary: e.target.value })}
                    />
                    <div className="mt-1.5 flex items-center justify-between text-[11px] text-slate-500">
                      <span>Tip: keep summary concise and action-oriented.</span>
                      <span>{activeSlideSummaryCount} chars</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                      <div className="text-[11px] uppercase tracking-wide text-slate-500">Chart Type</div>
                      <div className="text-sm font-semibold text-slate-900">
                        {activeSlide.chartMeta?.chartType || "-"}
                      </div>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                      <div className="text-[11px] uppercase tracking-wide text-slate-500">File</div>
                      <div className="text-sm font-semibold text-slate-900 truncate">
                        {activeSlide.chartMeta?.fileName || "-"}
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="mt-4 text-sm text-slate-500">Select a slide to edit.</div>
              )}
            </div>

            <div className="xl:col-span-4 rounded-3xl border border-slate-200 bg-white/90 p-5 sm:p-6 xl:sticky xl:top-6 shadow-[0_8px_26px_-20px_rgba(15,23,42,0.45)]">
              <h2 className="text-xl font-bold text-slate-900">Live Preview</h2>
              {activeSlide ? (
                <div className="mt-5 rounded-2xl border border-slate-200 overflow-hidden bg-white shadow-sm">
                  <div className="p-4 border-b border-slate-200 bg-slate-50">
                    <div className="text-lg font-extrabold text-slate-900 break-words">
                      {activeSlide.title || "Untitled"}
                    </div>
                    <div className="text-sm text-slate-500 break-words">
                      {activeSlide.subtitle || "-"}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <span className="inline-flex rounded-full bg-amber-100 text-amber-700 text-[11px] font-semibold px-2 py-0.5">
                        {activeSlide.chartMeta?.chartType || "Chart"}
                      </span>
                      {activeSlide.chartMeta?.fileName && (
                        <span className="inline-flex rounded-full bg-amber-100 text-amber-700 text-[11px] font-semibold px-2 py-0.5 max-w-full truncate">
                          {activeSlide.chartMeta.fileName}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="p-4">
                    <div className="aspect-[16/9] rounded-xl border border-slate-200 overflow-hidden bg-slate-50">
                      {activeSlide.chartImage ? (
                        <img
                          src={activeSlide.chartImage}
                          alt="Chart preview"
                          className="h-full w-full object-contain bg-white"
                        />
                      ) : (
                        <div className="h-full w-full flex items-center justify-center text-slate-400">
                          <ImageIcon className="h-8 w-8" />
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="p-4 border-t border-slate-200 bg-slate-50 text-sm text-slate-700 whitespace-pre-wrap break-words">
                    {activeSlide.summary || "No summary"}
                  </div>
                </div>
              ) : (
                <div className="mt-4 text-sm text-slate-500">Select a slide to preview.</div>
              )}
            </div>
          </section>
        )}
      </div>
    </div>
  );
};

export default SlideBuilderPage;
