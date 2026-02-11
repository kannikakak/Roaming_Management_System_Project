import React, { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../utils/api";
import { REPORT_DRAFT_KEY } from "../types/report";

type Report = {
  id: number;
  name: string;
  status: string;
  created_at: string;
  updated_at: string;
  qualityScore?: number | null;
  trustLevel?: "High" | "Medium" | "Low" | null;
};

type ReportSlide = {
  id: number;
  title: string;
  subtitle?: string | null;
  summary?: string | null;
  chart_image_url: string;
  chart_type?: string | null;
  category_col?: string | null;
  value_cols?: string | null;
};

type LocalDraftStoredSlide = {
  id?: string;
  chartImage?: string;
  title?: string;
  subtitle?: string;
  summary?: string;
  createdAt?: string;
  chartMeta?: {
    chartType?: string;
    categoryCol?: string;
    valueCols?: string[];
  };
};

const ReportsLibraryPage: React.FC = () => {
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(false);

  const [activeReport, setActiveReport] = useState<Report | null>(null);
  const [slides, setSlides] = useState<ReportSlide[]>([]);
  const [slidesLoading, setSlidesLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [page, setPage] = useState(0);

  const [isLocalDraftOpen, setIsLocalDraftOpen] = useState(false);
  const [localDraftSlides, setLocalDraftSlides] = useState<ReportSlide[]>([]);
  const [localDraftUpdatedAt, setLocalDraftUpdatedAt] = useState<string | null>(null);

  const loadReports = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch("/api/reports");
      const data = await res.json();
      setReports(Array.isArray(data) ? data : []);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadLocalDraftSlides = useCallback(() => {
    try {
      const raw = localStorage.getItem(REPORT_DRAFT_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      const source = Array.isArray(parsed) ? (parsed as LocalDraftStoredSlide[]) : [];

      const mapped: ReportSlide[] = source
        .map((slide, idx) => ({
          id: idx + 1,
          title: typeof slide?.title === "string" && slide.title.trim() ? slide.title : `Slide ${idx + 1}`,
          subtitle: typeof slide?.subtitle === "string" ? slide.subtitle : "",
          summary: typeof slide?.summary === "string" ? slide.summary : "",
          chart_image_url: typeof slide?.chartImage === "string" ? slide.chartImage : "",
          chart_type: typeof slide?.chartMeta?.chartType === "string" ? slide.chartMeta.chartType : null,
          category_col: typeof slide?.chartMeta?.categoryCol === "string" ? slide.chartMeta.categoryCol : null,
          value_cols: Array.isArray(slide?.chartMeta?.valueCols)
            ? JSON.stringify(slide?.chartMeta?.valueCols)
            : null,
        }))
        .filter((slide) => Boolean(slide.chart_image_url));

      const timestamps = source
        .map((slide) => {
          if (typeof slide?.createdAt !== "string") return 0;
          const t = new Date(slide.createdAt).getTime();
          return Number.isFinite(t) ? t : 0;
        })
        .filter((t) => t > 0);

      setLocalDraftSlides(mapped);
      setLocalDraftUpdatedAt(timestamps.length ? new Date(Math.max(...timestamps)).toISOString() : null);
    } catch {
      setLocalDraftSlides([]);
      setLocalDraftUpdatedAt(null);
    }
  }, []);

  const refreshAll = useCallback(async () => {
    await loadReports();
    loadLocalDraftSlides();
  }, [loadReports, loadLocalDraftSlides]);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  useEffect(() => {
    const onFocus = () => loadLocalDraftSlides();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [loadLocalDraftSlides]);

  const openReport = async (report: Report) => {
    setIsLocalDraftOpen(false);
    setActiveReport(report);
    setSlides([]);
    setSlidesLoading(true);
    setActiveIndex(0);
    setPage(0);
    try {
      const res = await apiFetch(`/api/reports/${report.id}`);
      const data = await res.json();
      setSlides(Array.isArray(data?.slides) ? data.slides : []);
    } finally {
      setSlidesLoading(false);
    }
  };

  const openLocalDraft = () => {
    if (localDraftSlides.length === 0) return;
    setIsLocalDraftOpen(true);
    setActiveReport({
      id: -1,
      name: "Local Draft (This Device)",
      status: "local",
      created_at: localDraftUpdatedAt || "",
      updated_at: localDraftUpdatedAt || "",
    });
    setSlides(localDraftSlides);
    setSlidesLoading(false);
    setActiveIndex(0);
    setPage(0);
  };

  const closeReport = () => {
    setActiveReport(null);
    setIsLocalDraftOpen(false);
    setSlides([]);
    setActiveIndex(0);
    setPage(0);
  };

  const pageSize = 6;
  const totalPages = Math.ceil(slides.length / pageSize);
  const pageSlides = slides.slice(page * pageSize, page * pageSize + pageSize);

  const renameReport = async (reportId: number, currentName: string) => {
    const name = window.prompt("New report name:", currentName);
    if (!name) return;
    await apiFetch(`/api/reports/${reportId}`, {
      method: "PUT",
      body: JSON.stringify({ name }),
    });
    refreshAll();
  };

  const deleteReport = async (reportId: number) => {
    if (!window.confirm("Delete this report?")) return;
    await apiFetch(`/api/reports/${reportId}`, { method: "DELETE" });
    refreshAll();
  };

  const clearLocalDraft = () => {
    if (!window.confirm("Clear local draft slides on this device?")) return;
    localStorage.removeItem(REPORT_DRAFT_KEY);
    loadLocalDraftSlides();
    if (isLocalDraftOpen) closeReport();
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 via-white to-orange-50 p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-3xl font-bold text-amber-800">Reports Library</h2>
          <button
            onClick={refreshAll}
            className="text-sm px-3 py-2 rounded-lg border border-amber-200 bg-white hover:bg-amber-50"
          >
            Refresh
          </button>
        </div>

        <div className="bg-white border rounded-2xl p-5 space-y-5">
          <div>
            <div className="text-xs uppercase tracking-wide text-amber-700 font-semibold mb-2">
              Saved Reports (Server)
            </div>
            {loading ? (
              <div className="text-sm text-gray-500">Loading...</div>
            ) : reports.length === 0 ? (
              <div className="text-sm text-gray-500">No saved reports in backend yet.</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-600">
                    <th className="py-2">Name</th>
                    <th>Status</th>
                    <th>Quality</th>
                    <th>Updated</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {reports.map((r) => (
                    <tr key={r.id} className="border-t hover:bg-amber-50/40">
                      <td className="py-2 font-semibold">{r.name}</td>
                      <td>{r.status}</td>
                      <td>
                        {typeof r.qualityScore === "number"
                          ? `${r.qualityScore}% - ${r.trustLevel || "Unknown"}`
                          : "N/A"}
                      </td>
                      <td>{r.updated_at ? new Date(r.updated_at).toLocaleString() : "-"}</td>
                      <td className="text-right space-x-3">
                        <button className="text-amber-700" onClick={() => openReport(r)}>
                          Open
                        </button>
                        <button className="text-amber-700" onClick={() => renameReport(r.id, r.name)}>
                          Rename
                        </button>
                        <button className="text-red-600" onClick={() => deleteReport(r.id)}>
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="pt-4 border-t">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div>
                <div className="text-xs uppercase tracking-wide text-amber-700 font-semibold">
                  Local Draft (This Device)
                </div>
                <div className="text-sm text-gray-600">
                  {localDraftSlides.length === 0
                    ? "No local draft slides."
                    : `${localDraftSlides.length} slide(s) found in browser storage.`}
                </div>
                {localDraftUpdatedAt && (
                  <div className="text-xs text-gray-500">
                    Last updated: {new Date(localDraftUpdatedAt).toLocaleString()}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={loadLocalDraftSlides}
                  className="text-xs px-3 py-2 rounded border border-amber-200 hover:bg-amber-50"
                >
                  Reload Draft
                </button>
                <button
                  onClick={clearLocalDraft}
                  className="text-xs px-3 py-2 rounded border border-red-200 text-red-600 hover:bg-red-50"
                  disabled={localDraftSlides.length === 0}
                >
                  Clear Draft
                </button>
                <button
                  onClick={openLocalDraft}
                  className="text-xs px-3 py-2 rounded bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-60"
                  disabled={localDraftSlides.length === 0}
                >
                  Open Draft
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {activeReport && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-6">
          <div className="bg-white rounded-2xl shadow-xl max-w-5xl w-full max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b">
              <div>
                <div className="text-xs uppercase tracking-wide text-amber-600">
                  {isLocalDraftOpen ? "Local Draft" : "Report"}
                </div>
                <div className="text-xl font-bold text-gray-900">{activeReport.name}</div>
              </div>
              <button onClick={closeReport} className="text-sm text-gray-600 hover:text-gray-800">
                Close
              </button>
            </div>
            <div className="p-5">
              {slidesLoading ? (
                <div className="text-sm text-gray-500">Loading slides...</div>
              ) : slides.length === 0 ? (
                <div className="text-sm text-gray-500">
                  {isLocalDraftOpen ? "No slides in local draft." : "No slides saved for this report."}
                </div>
              ) : (
                <>
                  <div className="border rounded-2xl overflow-hidden mb-6">
                    <div className="px-5 py-3 border-b bg-amber-50/60 flex items-center justify-between">
                      <div>
                        <div className="text-xs text-gray-500">
                          Slide {activeIndex + 1} of {slides.length}
                        </div>
                        <div className="font-semibold text-gray-900">{slides[activeIndex]?.title}</div>
                        {slides[activeIndex]?.subtitle && (
                          <div className="text-xs text-gray-500">{slides[activeIndex]?.subtitle}</div>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <button
                          className="text-xs px-3 py-1 rounded border"
                          disabled={activeIndex === 0}
                          onClick={() => setActiveIndex((v) => Math.max(0, v - 1))}
                        >
                          Prev
                        </button>
                        <button
                          className="text-xs px-3 py-1 rounded border"
                          disabled={activeIndex === slides.length - 1}
                          onClick={() => setActiveIndex((v) => Math.min(slides.length - 1, v + 1))}
                        >
                          Next
                        </button>
                      </div>
                    </div>
                    <div className="p-5">
                      <img
                        src={slides[activeIndex]?.chart_image_url}
                        alt={slides[activeIndex]?.title}
                        className="w-full rounded border"
                      />
                      {slides[activeIndex]?.summary && (
                        <div className="text-xs text-gray-600 mt-3 whitespace-pre-wrap">
                          {slides[activeIndex]?.summary}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center justify-between mb-3">
                    <div className="text-xs text-gray-500">All slides</div>
                    <div className="text-xs text-gray-500">
                      Page {page + 1} / {Math.max(1, totalPages)}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                    {pageSlides.map((s, idx) => {
                      const globalIndex = page * pageSize + idx;
                      return (
                        <button
                          key={s.id}
                          className={`border rounded-xl overflow-hidden text-left ${
                            globalIndex === activeIndex
                              ? "border-amber-400 ring-2 ring-amber-200"
                              : "border-gray-200"
                          }`}
                          onClick={() => setActiveIndex(globalIndex)}
                        >
                          <div className="px-3 py-2 border-b bg-amber-50/40">
                            <div className="text-[11px] text-gray-500">Slide {globalIndex + 1}</div>
                            <div className="text-xs font-semibold text-gray-900 truncate">{s.title}</div>
                          </div>
                          <div className="p-3">
                            <img
                              src={s.chart_image_url}
                              alt={s.title}
                              className="w-full h-28 object-cover rounded border"
                              loading="lazy"
                            />
                          </div>
                        </button>
                      );
                    })}
                  </div>
                  {totalPages > 1 && (
                    <div className="flex items-center justify-center gap-2 mt-4">
                      <button
                        className="text-xs px-3 py-1 rounded border"
                        disabled={page === 0}
                        onClick={() => setPage((p) => Math.max(0, p - 1))}
                      >
                        Previous Page
                      </button>
                      <button
                        className="text-xs px-3 py-1 rounded border"
                        disabled={page >= totalPages - 1}
                        onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                      >
                        Next Page
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ReportsLibraryPage;
