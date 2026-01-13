import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Download, Trash2 } from "lucide-react";
import { logAudit } from "../utils/auditLog";

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
  };
};

const STORAGE_KEY = "reportDraftSlides";

const SlideBuilderPage: React.FC = () => {
  const navigate = useNavigate();
  const [slides, setSlides] = useState<ReportSlide[]>([]);
  const [activeId, setActiveId] = useState<string>("");

  useEffect(() => {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    setSlides(saved);
    if (saved.length > 0) setActiveId(saved[0].id);
  }, []);

  const activeSlide = useMemo(
    () => slides.find((s) => s.id === activeId),
    [slides, activeId]
  );

  const updateSlide = (id: string, patch: Partial<ReportSlide>) => {
    setSlides((prev) => {
      const updated = prev.map((s) => (s.id === id ? { ...s, ...patch } : s));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      return updated;
    });
  };

  const deleteSlide = (id: string) => {
    setSlides((prev) => {
      const updated = prev.filter((s) => s.id !== id);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      if (activeId === id && updated.length > 0) setActiveId(updated[0].id);
      if (updated.length === 0) setActiveId("");
      return updated;
    });
  };

  const clearAll = () => {
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
      const res = await fetch("http://localhost:3001/api/export/pptx-multi", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
                      <span className="text-xs text-gray-400">{new Date(s.createdAt).toLocaleString()}</span>
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
