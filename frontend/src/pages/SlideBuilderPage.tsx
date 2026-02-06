import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, Download, Trash2, Users, Copy } from "lucide-react";
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
const COLLAB_KEY = "reportDraftId";
const SYNC_INTERVAL_MS = 5000;
const LOCAL_EDIT_GRACE_MS = 2000;

const parseJsonArray = (value: any): string[] => {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
};

const buildSlidePayloads = (slides: ReportSlide[]): SlidePayload[] =>
  slides.map((s) => ({
    chartImage: s.chartImage,
    title: s.title,
    subtitle: s.subtitle,
    summary: s.summary,
    chartMeta: s.chartMeta,
  }));

const mapServerSlides = (slides: any[], createdAtFallback: string): ReportSlide[] =>
  slides.map((slide: any) => ({
    id: `slide-${slide.id ?? slide.slide_index}`,
    chartImage: slide.chart_image_url,
    title: slide.title || "",
    subtitle: slide.subtitle || "",
    summary: slide.summary || "",
    createdAt: createdAtFallback,
    chartMeta: slide.chart_type
      ? {
          chartType: slide.chart_type,
          categoryCol: slide.category_col,
          valueCols: parseJsonArray(slide.value_cols),
          selectedCols: parseJsonArray(slide.selected_cols),
          fileName: slide.file_name || undefined,
          fileId: slide.file_id || undefined,
        }
      : undefined,
  }));

const formatDateLabel = (value?: string) => {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleString();
};

const SlideBuilderPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [slides, setSlides] = useState<ReportSlide[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const [reportId, setReportId] = useState<number | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<Date | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [copyNotice, setCopyNotice] = useState<string | null>(null);
  const lastLocalEditAt = useRef(0);
  const updateTimers = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const paramId = params.get("reportId");
    const storedId = localStorage.getItem(COLLAB_KEY);
    const resolvedId = paramId || storedId;

    if (resolvedId) {
      const parsedId = Number(resolvedId);
      if (Number.isFinite(parsedId)) {
        setReportId(parsedId);
        localStorage.setItem(COLLAB_KEY, String(parsedId));
        if (!paramId) {
          navigate(`/slide-builder?reportId=${parsedId}`, { replace: true });
          return;
        }
        loadFromServer(parsedId);
        return;
      }
    }

    setReportId(null);
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    setSlides(saved);
    if (saved.length > 0) setActiveId(saved[0].id);
  }, [location.search, navigate]);

  useEffect(() => {
    if (!reportId) return;
    const intervalId = window.setInterval(() => {
      if (Date.now() - lastLocalEditAt.current < LOCAL_EDIT_GRACE_MS) return;
      loadFromServer(reportId, { silent: true });
    }, SYNC_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
  }, [reportId]);

  const activeSlide = useMemo(
    () => slides.find((s) => s.id === activeId),
    [slides, activeId]
  );

  const isCollabEnabled = reportId !== null;

  const loadFromServer = async (id: number, options: { silent?: boolean } = {}) => {
    if (!options.silent) {
      setIsSyncing(true);
    }
    setSyncError(null);
    try {
      const res = await apiFetch(`/api/reports/${id}`);
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      const createdAtFallback = data?.report?.created_at
        ? new Date(data.report.created_at).toISOString()
        : new Date().toISOString();
      const nextSlides = mapServerSlides(data.slides || [], createdAtFallback);
      setSlides(nextSlides);
      setActiveId((prev) => nextSlides.find((s) => s.id === prev)?.id || nextSlides[0]?.id || "");
      localStorage.setItem(STORAGE_KEY, JSON.stringify(nextSlides));
      setLastSyncAt(new Date());
    } catch (err: any) {
      setSyncError(err.message || "Failed to sync report.");
    } finally {
      if (!options.silent) {
        setIsSyncing(false);
      }
    }
  };

  const startCollaboration = async () => {
    if (slides.length === 0) {
      alert("Add at least one slide before enabling collaboration.");
      return;
    }
    setIsSyncing(true);
    setSyncError(null);
    try {
      const res = await apiFetch("/api/reports", {
        method: "POST",
        body: JSON.stringify({
          name: `Draft Report ${new Date().toISOString().slice(0, 10)}`,
          slides: buildSlidePayloads(slides),
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      const id = Number(data.reportId);
      if (!Number.isFinite(id)) throw new Error("Invalid report ID.");
      setReportId(id);
      localStorage.setItem(COLLAB_KEY, String(id));
      navigate(`/slide-builder?reportId=${id}`, { replace: true });
      await loadFromServer(id);
    } catch (err: any) {
      setSyncError(err.message || "Failed to start collaboration.");
    } finally {
      setIsSyncing(false);
    }
  };

  const handleCopyLink = async () => {
    if (!reportId) return;
    const shareUrl = `${window.location.origin}/slide-builder?reportId=${reportId}`;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopyNotice("Link copied.");
    } catch {
      setCopyNotice("Unable to copy link.");
    }
    window.setTimeout(() => setCopyNotice(null), 2000);
  };

  const scheduleSlideUpdate = (slideId: string, slideIndex: number, patch: Partial<ReportSlide>) => {
    if (!reportId) return;
    const key = `${slideId}`;
    const existing = updateTimers.current.get(key);
    if (existing) window.clearTimeout(existing);
    const timer = window.setTimeout(async () => {
      try {
        await apiFetch(`/api/reports/${reportId}/slides/${slideIndex}`, {
          method: "PUT",
          body: JSON.stringify({
            title: patch.title,
            subtitle: patch.subtitle,
            summary: patch.summary,
          }),
        });
        setLastSyncAt(new Date());
      } catch (err: any) {
        setSyncError(err.message || "Failed to sync slide.");
      }
    }, 500);
    updateTimers.current.set(key, timer);
    lastLocalEditAt.current = Date.now();
  };

  const updateSlide = (id: string, patch: Partial<ReportSlide>) => {
    setSlides((prev) => {
      const updated = prev.map((s) => (s.id === id ? { ...s, ...patch } : s));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      if (reportId) {
        const slideIndex = prev.findIndex((s) => s.id === id);
        if (slideIndex >= 0) {
          scheduleSlideUpdate(id, slideIndex, updated[slideIndex]);
        }
      }
      return updated;
    });
  };

  const deleteSlide = async (id: string) => {
    const slideIndex = slides.findIndex((s) => s.id === id);
    setSlides((prev) => {
      const updated = prev.filter((s) => s.id !== id);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      if (activeId === id && updated.length > 0) setActiveId(updated[0].id);
      if (updated.length === 0) setActiveId("");
      return updated;
    });
    if (reportId && slideIndex >= 0) {
      try {
        await apiFetch(`/api/reports/${reportId}/slides/${slideIndex}`, { method: "DELETE" });
        await loadFromServer(reportId, { silent: true });
      } catch (err: any) {
        setSyncError(err.message || "Failed to delete slide.");
      }
    }
  };

  const clearAll = () => {
    if (reportId) {
      apiFetch(`/api/reports/${reportId}`, { method: "DELETE" }).catch(() => {
        // ignore errors on cleanup
      });
      localStorage.removeItem(COLLAB_KEY);
      navigate("/slide-builder", { replace: true });
      setReportId(null);
    }
    localStorage.removeItem(STORAGE_KEY);
    setSlides([]);
    setActiveId("");
  };

  const exportPPTX = async () => {
    if (slides.length === 0) {
      alert("No slides in draft. Go generate charts first.");
      return;
    }

    try {
      // Best-effort persistence (may be restricted to admin/analyst on the backend).
      try {
        const reportRes = await apiFetch("/api/reports", {
          method: "POST",
          body: JSON.stringify({
            name: `Roaming Report ${new Date().toISOString().slice(0, 10)}`,
            slides,
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
          slides,
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
      a.download = `Roaming_Report.pptx`;
      a.click();
      URL.revokeObjectURL(url);

      logAudit("Export Multi Slide PPTX", { slidesCount: slides.length });

    } catch (err: any) {
      alert(err.message || "Export error");
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-8">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <button
            onClick={() => navigate(-1)}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white border hover:bg-gray-50"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>

          <div className="flex gap-2">
            <button
              onClick={clearAll}
              className="px-4 py-2 rounded-lg bg-white border text-gray-700 hover:bg-gray-50"
            >
              Clear Draft
            </button>

            <button
              onClick={exportPPTX}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700"
            >
              <Download className="w-4 h-4" />
              Export PPTX ({slides.length})
            </button>
          </div>
        </div>

        <div className="mb-6 bg-white border rounded-xl p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center">
              <Users className="w-4 h-4" />
            </div>
            <div>
              <div className="font-semibold text-gray-800">Collaboration</div>
              <div className="text-xs text-gray-500">
                {isCollabEnabled
                  ? `Live sync on (Report #${reportId})`
                  : "Create a shared draft to edit with others."}
              </div>
              {lastSyncAt && (
                <div className="text-[11px] text-gray-400">
                  Last sync {lastSyncAt.toLocaleTimeString()}
                </div>
              )}
              {copyNotice && <div className="text-[11px] text-amber-700">{copyNotice}</div>}
              {syncError && <div className="text-[11px] text-red-600">{syncError}</div>}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {isCollabEnabled ? (
              <>
                <button
                  onClick={handleCopyLink}
                  className="px-3 py-2 rounded-lg border text-gray-700 text-sm hover:bg-gray-50 flex items-center gap-2"
                >
                  <Copy className="w-4 h-4" />
                  Copy link
                </button>
                <button
                  onClick={() => reportId && loadFromServer(reportId)}
                  className="px-3 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-60"
                  disabled={isSyncing}
                >
                  {isSyncing ? "Syncing..." : "Sync now"}
                </button>
              </>
            ) : (
              <button
                onClick={startCollaboration}
                className="px-3 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-60"
                disabled={isSyncing || slides.length === 0}
              >
                Start collaboration
              </button>
            )}
          </div>
        </div>

        {slides.length === 0 ? (
          <div className="bg-white border rounded-xl p-6">
            <p className="text-gray-700 font-semibold">
              No draft slides yet. Go to Chart Page and click “Add to Report”.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
            {/* Left: Slide list */}
            <div className="bg-white border rounded-xl p-4 lg:col-span-1">
              <h2 className="font-bold mb-3">Slides</h2>
              <div className="space-y-2">
                {slides.map((s, idx) => (
                  <button
                    key={s.id}
                    onClick={() => setActiveId(s.id)}
                    className={`w-full text-left p-2 rounded-lg border ${
                      s.id === activeId ? "border-blue-500 bg-blue-50" : "border-gray-200 bg-white"
                    }`}
                  >
                    <div className="text-sm font-semibold">Slide {idx + 1}</div>
                    <div className="text-xs text-gray-500 truncate">{s.title}</div>

                    <div className="mt-2 flex justify-between items-center">
                      <span className="text-xs text-gray-400">{formatDateLabel(s.createdAt)}</span>
                      <Trash2
                        className="w-4 h-4 text-red-500"
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteSlide(s.id);
                        }}
                      />
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Right: Edit + Preview */}
            <div className="lg:col-span-3 grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Edit */}
              <div className="bg-white border rounded-xl p-6">
                <h2 className="text-lg font-bold mb-4">Edit Slide</h2>

                {activeSlide ? (
                  <>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Title</label>
                    <input
                      className="w-full border rounded-lg px-3 py-2 mb-4"
                      value={activeSlide.title}
                      onChange={(e) => updateSlide(activeSlide.id, { title: e.target.value })}
                    />

                    <label className="block text-sm font-semibold text-gray-700 mb-1">Subtitle</label>
                    <input
                      className="w-full border rounded-lg px-3 py-2 mb-4"
                      value={activeSlide.subtitle}
                      onChange={(e) => updateSlide(activeSlide.id, { subtitle: e.target.value })}
                    />

                    <label className="block text-sm font-semibold text-gray-700 mb-1">Summary</label>
                    <textarea
                      className="w-full border rounded-lg px-3 py-2 min-h-[140px] mb-4"
                      value={activeSlide.summary}
                      onChange={(e) => updateSlide(activeSlide.id, { summary: e.target.value })}
                    />
                  </>
                ) : null}
              </div>

              {/* Preview */}
              <div className="bg-white border rounded-xl p-6">
                <h2 className="text-lg font-bold mb-4">Preview</h2>
                {activeSlide ? (
                  <div className="border rounded-xl overflow-hidden bg-white">
                    <div className="p-4 border-b bg-gray-50">
                      <div className="text-xl font-bold">{activeSlide.title}</div>
                      <div className="text-sm text-gray-500">{activeSlide.subtitle}</div>
                    </div>

                    <div className="p-4">
                      <img
                        src={activeSlide.chartImage}
                        alt="Chart"
                        className="w-full rounded border"
                      />
                    </div>

                    <div className="p-4 border-t bg-gray-50 text-sm text-gray-700 whitespace-pre-wrap">
                      {activeSlide.summary}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default SlideBuilderPage;
