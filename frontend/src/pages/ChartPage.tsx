import React, { useRef, useState, useEffect, useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import * as htmlToImage from "html-to-image";
import { Download, ArrowLeft, BarChart3, TrendingUp, Save, FileText, Users, Copy, RefreshCw } from "lucide-react";
import { logAudit } from "../utils/auditLog";
import { apiFetch } from "../utils/api";

const COLORS = ["#EACE5F", "#b89c1d", "#FFD700", "#FFB300", "#FF8C00", "#FFD580", "#F5DEB3"];
const CHART_TYPES = ["Line", "Bar", "Stacked Bar", "Area", "Pie"];

interface SavedChart {
  id: string;
  name: string;
  createdAt: string;
  config: {
    categoryCol: string;
    valueCols: string[];
    chartType: string;
    selectedCols: string[];
    file: any;
  };
}

const LS_KEY = "savedCharts";
const DRAFT_KEY = "reportDraftSlides";
const COLLAB_KEY = "chartSessionId";
const SYNC_INTERVAL_MS = 5000;
const LOCAL_EDIT_GRACE_MS = 2000;

const ChartPage: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();

  const { file: initialFile, selectedCols: initialSelectedCols, chartType: initialChartType } =
    (location.state || {}) as any;

  const chartRef = useRef<HTMLDivElement | null>(null);

  const [currentFile, setCurrentFile] = useState<any>(initialFile || null);
  const [currentSelectedCols, setCurrentSelectedCols] = useState<string[]>(initialSelectedCols || []);

  const [savedCharts, setSavedCharts] = useState<SavedChart[]>([]);

  const [categoryCol, setCategoryCol] = useState<string>(initialSelectedCols?.[0] || "");
  const [valueCols, setValueCols] = useState<string[]>(initialSelectedCols?.slice(1) || []);
  const [chartType, setChartType] = useState<string>(initialChartType || "Line");
  const [isExporting, setIsExporting] = useState(false);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<Date | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [copyNotice, setCopyNotice] = useState<string | null>(null);
  const lastLocalEditAt = useRef(0);
  const suppressSync = useRef(false);
  const syncTimer = useRef<number | null>(null);

  // ✅ helper to load charts anytime
  const loadSavedCharts = useCallback(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      const charts = raw ? JSON.parse(raw) : [];
      const valid = Array.isArray(charts)
        ? charts.filter(
            (c: any) =>
              c &&
              typeof c.id === "string" &&
              typeof c.name === "string" &&
              c.config &&
              typeof c.config.chartType === "string" &&
              typeof c.config.categoryCol === "string" &&
              Array.isArray(c.config.valueCols)
          )
        : [];
      setSavedCharts(valid);
    } catch (e) {
      console.error("Failed to load savedCharts:", e);
      setSavedCharts([]);
    }
  }, []);

  useEffect(() => {
    loadSavedCharts();
  }, [loadSavedCharts]);

  useEffect(() => {
    const onFocus = () => loadSavedCharts();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [loadSavedCharts]);

  const loadFileData = async (
    fileId: number,
    fileName?: string,
    selected?: string[]
  ) => {
    const res = await apiFetch(`/api/files/${fileId}/data`);
    if (!res.ok) throw new Error("Failed to load file data.");
    const data = await res.json();
    const nextFile = {
      id: fileId,
      name: fileName || `File ${fileId}`,
      rows: data.rows || [],
    };
    setCurrentFile(nextFile);
    if (Array.isArray(selected) && selected.length > 0) {
      setCurrentSelectedCols(selected);
    } else if (Array.isArray(data.columns)) {
      setCurrentSelectedCols(data.columns);
    }
  };

  const buildSessionState = (override: Partial<any> = {}) => ({
    fileId: override.fileId ?? currentFile?.id ?? null,
    fileName: override.fileName ?? currentFile?.name ?? currentFile?.fileName ?? null,
    chartType: override.chartType ?? chartType,
    categoryCol: override.categoryCol ?? categoryCol,
    valueCols: override.valueCols ?? valueCols,
    selectedCols: override.selectedCols ?? currentSelectedCols,
  });

  const applySessionState = async (state: any) => {
    if (state?.fileId) {
      await loadFileData(state.fileId, state.fileName, state.selectedCols);
    }
    if (Array.isArray(state?.selectedCols) && state.selectedCols.length > 0) {
      setCurrentSelectedCols(state.selectedCols);
    }
    if (state?.categoryCol) setCategoryCol(state.categoryCol);
    if (Array.isArray(state?.valueCols)) setValueCols(state.valueCols);
    if (state?.chartType) setChartType(state.chartType);
  };

  const loadSession = async (id: number, options: { silent?: boolean } = {}) => {
    if (!options.silent) setIsSyncing(true);
    setSyncError(null);
    try {
      const res = await apiFetch(`/api/collab-sessions/${id}`);
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      if (data.type && data.type !== "chart") {
        throw new Error("This collaboration link is not for Charts.");
      }
      suppressSync.current = true;
      await applySessionState(data.state || {});
      setLastSyncAt(new Date());
    } catch (err: any) {
      setSyncError(err.message || "Failed to sync session.");
    } finally {
      suppressSync.current = false;
      if (!options.silent) setIsSyncing(false);
    }
  };

  const scheduleSessionUpdate = (override: Partial<any> = {}) => {
    if (!sessionId || suppressSync.current) return;
    lastLocalEditAt.current = Date.now();
    if (syncTimer.current) window.clearTimeout(syncTimer.current);
    const state = buildSessionState(override);
    syncTimer.current = window.setTimeout(async () => {
      try {
        await apiFetch(`/api/collab-sessions/${sessionId}`, {
          method: "PUT",
          body: JSON.stringify({ state }),
        });
        setLastSyncAt(new Date());
      } catch (err: any) {
        setSyncError(err.message || "Failed to update session.");
      }
    }, 400);
  };

  const startCollaboration = async () => {
    if (!currentFile?.id) {
      setSyncError("Select a file before starting collaboration.");
      return;
    }
    setIsSyncing(true);
    setSyncError(null);
    try {
      const res = await apiFetch("/api/collab-sessions", {
        method: "POST",
        body: JSON.stringify({
          type: "chart",
          state: buildSessionState(),
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      const id = Number(data.id);
      if (!Number.isFinite(id)) throw new Error("Invalid session ID.");
      setSessionId(id);
      localStorage.setItem(COLLAB_KEY, String(id));
      navigate(`/charts?sessionId=${id}`, { replace: true });
      await loadSession(id);
    } catch (err: any) {
      setSyncError(err.message || "Failed to start collaboration.");
    } finally {
      setIsSyncing(false);
    }
  };

  const handleCopyLink = async () => {
    if (!sessionId) return;
    const shareUrl = `${window.location.origin}/charts?sessionId=${sessionId}`;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopyNotice("Link copied.");
    } catch {
      setCopyNotice("Unable to copy link.");
    }
    window.setTimeout(() => setCopyNotice(null), 2000);
  };

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const paramId = params.get("sessionId");
    const storedId = localStorage.getItem(COLLAB_KEY);
    const resolved = paramId || storedId;
    if (resolved) {
      const parsedId = Number(resolved);
      if (Number.isFinite(parsedId)) {
        setSessionId(parsedId);
        localStorage.setItem(COLLAB_KEY, String(parsedId));
        if (!paramId) {
          navigate(`/charts?sessionId=${parsedId}`, { replace: true });
          return;
        }
        loadSession(parsedId);
        return;
      }
    }
    setSessionId(null);
  }, [location.search, navigate]);

  useEffect(() => {
    if (!sessionId) return;
    const intervalId = window.setInterval(() => {
      if (Date.now() - lastLocalEditAt.current < LOCAL_EDIT_GRACE_MS) return;
      loadSession(sessionId, { silent: true });
    }, SYNC_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
  }, [sessionId]);

  // Chart data
  const chartData =
    currentFile && currentSelectedCols.length > 0
      ? (currentFile.rows || []).map((row: any) => {
          const obj: any = {};
          currentSelectedCols.forEach((col: string) => (obj[col] = row[col]));
          return obj;
        })
      : [];

  const isNumericCol = (col: string) =>
    chartData.some(
      (row: any) =>
        row[col] !== undefined && row[col] !== null && row[col] !== "" && !isNaN(Number(row[col]))
    );

  const availableValueCols = currentSelectedCols.filter((c) => c !== categoryCol && isNumericCol(c));

  const pieValueCol = valueCols[0] || availableValueCols[0];
  const pieData =
    chartType === "Pie" && pieValueCol
      ? chartData
          .map((row: any) => ({
            name: row[categoryCol],
            value: Number(row[pieValueCol]),
          }))
          .filter((d: any) => !isNaN(d.value))
      : [];

  const handleValueColChange = (col: string) => {
    setValueCols((prev) => {
      const next = prev.includes(col) ? prev.filter((c) => c !== col) : [...prev, col];
      scheduleSessionUpdate({ valueCols: next });
      return next;
    });
  };

  const handleCategoryColChange = (col: string) => {
    setCategoryCol(col);
    setValueCols((prev) => {
      const next = prev.filter((c) => c !== col);
      scheduleSessionUpdate({ categoryCol: col, valueCols: next });
      return next;
    });
  };

  const handleChartTypeChange = (value: string) => {
    setChartType(value);
    scheduleSessionUpdate({ chartType: value });
  };

  // ✅ Save chart config (card)
  const saveChartToDb = async () => {
    if (!chartRef.current) return;
    try {
      const chartImage = await htmlToImage.toPng(chartRef.current, {
        pixelRatio: 2,
        backgroundColor: "white",
      });
      await apiFetch("/api/charts", {
        method: "POST",
        body: JSON.stringify({
          fileId: currentFile?.id || null,
          fileName: currentFile?.name || currentFile?.fileName || null,
          chartType,
          categoryCol,
          valueCols,
          selectedCols: currentSelectedCols,
          chartImage,
        }),
      });
    } catch (e) {
      console.error("Failed to save chart to DB:", e);
    }
  };

  const handleSaveChart = async () => {
    try {
      const existing: SavedChart[] = JSON.parse(localStorage.getItem(LS_KEY) || "[]");

      const fileName =
        currentFile?.name || currentFile?.fileName || `Chart_${new Date().toISOString()}`;

      const newChart: SavedChart = {
        id: `${Date.now()}`,
        name: fileName,
        createdAt: new Date().toISOString(),
        config: {
          categoryCol,
          valueCols,
          chartType,
          selectedCols: currentSelectedCols,
          file: currentFile, // ⚠️ if too big, localStorage can fail
        },
      };

      const updated = [newChart, ...existing];
      localStorage.setItem(LS_KEY, JSON.stringify(updated));
      setSavedCharts(updated);

      logAudit("Save Chart Card", {
        chartType,
        categoryCol,
        valueCols,
        fileName,
        selectedCols: currentSelectedCols,
      });

      await saveChartToDb();
    } catch (e) {
      console.error(e);
      alert("Save failed. Your data may be too large for localStorage.");
    }
  };

  const handleDeleteSavedChart = (id: string) => {
    const updated = savedCharts.filter((chart) => chart.id !== id);
    setSavedCharts(updated);
    localStorage.setItem(LS_KEY, JSON.stringify(updated));
  };

  // ✅ Load chart
  const handleLoadChart = (config: SavedChart["config"]) => {
    setCurrentFile(config.file);
    setCurrentSelectedCols(config.selectedCols);
    setCategoryCol(config.categoryCol);
    setValueCols(config.valueCols);
    setChartType(config.chartType);

    logAudit("Load Chart Card", {
      chartType: config.chartType,
      categoryCol: config.categoryCol,
      valueCols: config.valueCols,
      fileName: config.file?.name || config.file?.fileName,
      selectedCols: config.selectedCols,
    });
  };

  // Export chart as image
  const exportChartAsImage = async (ext: "png" | "jpg") => {
    if (!chartRef.current) return;
    setIsExporting(true);
    try {
      const dataUrl =
        ext === "png"
          ? await htmlToImage.toPng(chartRef.current, { pixelRatio: 2, backgroundColor: "white" })
          : await htmlToImage.toJpeg(chartRef.current, { pixelRatio: 2, backgroundColor: "white" });

      const link = document.createElement("a");
      link.download = `chart.${ext}`;
      link.href = dataUrl;
      link.click();

      logAudit("Export Chart", {
        type: ext,
        chartType,
        categoryCol,
        valueCols,
        fileName: currentFile?.name || currentFile?.fileName,
        selectedCols: currentSelectedCols,
      });
    } finally {
      setIsExporting(false);
    }
  };

  // ✅ Add to slide draft (YOUR button)
  const addToReportDraft = async () => {
    if (!chartRef.current) return;

    const pngDataUrl = await htmlToImage.toPng(chartRef.current, {
      pixelRatio: 2,
      backgroundColor: "white",
    });

    const slide = {
      id: `${Date.now()}`,
      chartImage: pngDataUrl,
      title: currentFile?.name || "Report Slide",
      subtitle: new Date().toLocaleDateString(),
      summary: `Chart: ${chartType} | X: ${categoryCol} | Y: ${valueCols.join(", ")}`,
      createdAt: new Date().toISOString(),
      chartMeta: {
        chartType,
        categoryCol,
        valueCols,
        selectedCols: currentSelectedCols,
        fileName: currentFile?.name || currentFile?.fileName,
        fileId: currentFile?.id,
      },
    };

    const existing = JSON.parse(localStorage.getItem(DRAFT_KEY) || "[]");
    const updated = [...existing, slide];
    const collabReportId = localStorage.getItem("reportDraftId");

    if (collabReportId) {
      try {
        await apiFetch(`/api/reports/${collabReportId}/slides`, {
          method: "POST",
          body: JSON.stringify({ slides: [slide] }),
        });
        logAudit("Add Slide To Shared Draft", {
          reportId: collabReportId,
          chartType,
          categoryCol,
          valueCols,
          fileName: currentFile?.name || currentFile?.fileName,
        });
        navigate(`/slide-builder?reportId=${collabReportId}`);
        return;
      } catch (err) {
        console.error("Failed to append slide to shared draft:", err);
      }
    }

    localStorage.setItem(DRAFT_KEY, JSON.stringify(updated));
    logAudit("Add Slide To Draft", {
      slidesCount: updated.length,
      chartType,
      categoryCol,
      valueCols,
      fileName: currentFile?.name || currentFile?.fileName,
    });

    navigate("/slide-builder");
  };

  const hasChart = !!currentFile && currentSelectedCols.length >= 2;

  const getChartIcon = (type: string) => {
    if (type === "Bar") return <BarChart3 className="w-4 h-4" />;
    return <TrendingUp className="w-4 h-4" />;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 via-yellow-50 to-orange-50 p-4 sm:p-8">
      <div className="max-w-7xl mx-auto">
        <div className="mb-6 flex items-center">
          <button
            onClick={() => navigate("/projects")}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-amber-200 bg-white text-amber-800 hover:bg-amber-50 text-sm font-semibold"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to projects
          </button>
        </div>
        {/* ✅ ALWAYS show saved cards */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-lg font-semibold text-gray-700">Saved Charts</h3>
            <button
              onClick={loadSavedCharts}
              className="text-xs px-3 py-2 rounded-lg border border-amber-200 bg-white hover:bg-amber-50"
            >
              Refresh
            </button>
          </div>

          {savedCharts.length === 0 ? (
            <div className="bg-white border rounded-xl p-4 text-sm text-gray-600">
              No saved charts yet. Click <b>Save Chart</b> to create one.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {savedCharts.map((chart) => (
                <div
                  key={chart.id}
                  className="bg-white border border-amber-100 rounded-xl p-4 shadow-sm hover:shadow-md transition-all"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="cursor-pointer" onClick={() => handleLoadChart(chart.config)}>
                      <div className="font-semibold text-amber-800">{chart.name}</div>
                      <div className="text-xs text-gray-500 mt-1">
                        {chart.config.chartType} Chart
                      </div>
                      <div className="text-xs text-gray-500">
                        X: {chart.config.categoryCol}
                      </div>
                      <div className="text-xs text-gray-500">
                        Y: {chart.config.valueCols.join(", ")}
                      </div>
                    </div>
                    <button
                      className="text-xs text-red-600 hover:text-red-700"
                      onClick={() => handleDeleteSavedChart(chart.id)}
                    >
                      Delete
                    </button>
                  </div>
                  <button
                    className="mt-3 text-xs w-full border border-amber-200 rounded-lg py-2 text-amber-700 hover:bg-amber-50"
                    onClick={() => handleLoadChart(chart.config)}
                  >
                    Open Chart
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* If no chart data */}
        {!hasChart ? (
          <div className="bg-white border rounded-xl p-6 text-gray-700">
            No chart data. Go back and select at least 2 columns.
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="mb-6 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <button onClick={() => navigate(-1)} className="p-2 rounded-lg hover:bg-white/50">
                  <ArrowLeft className="w-5 h-5 text-gray-700" />
                </button>
                <h1 className="text-3xl font-bold text-gray-800">Chart Visualization</h1>
              </div>
            </div>

            {/* Controls */}
            <div className="bg-white rounded-2xl shadow-sm p-6 mb-6 border border-amber-100">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                {/* Category */}
                <div className="space-y-2">
                  <label className="block text-xs font-semibold text-gray-600">
                    Category Axis (X)
                  </label>
                  <select
                    value={categoryCol}
                    onChange={(e) => handleCategoryColChange(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 focus:border-amber-400 focus:ring-2 focus:ring-amber-200 outline-none text-sm"
                  >
                    {currentSelectedCols.map((col: string) => (
                      <option key={col} value={col}>
                        {col}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Chart type */}
                <div className="space-y-2">
                  <label className="block text-xs font-semibold text-gray-600">Chart Type</label>
                  <select
                    value={chartType}
                    onChange={(e) => handleChartTypeChange(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 focus:border-amber-400 focus:ring-2 focus:ring-amber-200 outline-none text-sm"
                  >
                    {CHART_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {type} Chart
                      </option>
                    ))}
                  </select>
                </div>

                {/* Actions */}
                <div className="flex flex-col gap-3">
                  <div className="text-xs font-semibold text-gray-600">Actions</div>
                  <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-2 gap-2">
                    <button
                      className="px-3 py-2 rounded-lg bg-amber-500 text-white text-sm font-semibold hover:bg-amber-600 disabled:opacity-50 flex items-center justify-center gap-2"
                      onClick={() => exportChartAsImage("png")}
                      disabled={isExporting}
                    >
                      <Download className="w-4 h-4" />
                      PNG
                    </button>

                    <button
                      className="px-3 py-2 rounded-lg border border-amber-300 text-amber-700 text-sm font-semibold hover:bg-amber-50 disabled:opacity-50 flex items-center justify-center gap-2"
                      onClick={() => exportChartAsImage("jpg")}
                      disabled={isExporting}
                    >
                      <Download className="w-4 h-4" />
                      JPG
                    </button>

                    <button
                      className="px-3 py-2 rounded-lg border border-amber-300 text-amber-700 text-sm font-semibold hover:bg-amber-50 flex items-center justify-center gap-2"
                      onClick={handleSaveChart}
                      type="button"
                    >
                      <Save className="w-4 h-4" />
                      Save
                    </button>

                    {/* ?? Add to report */}
                    <button
                      className="px-3 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 flex items-center justify-center gap-2"
                      onClick={addToReportDraft}
                      type="button"
                    >
                      <FileText className="w-4 h-4" />
                      Report
                    </button>
                  </div>
                </div>
              </div>

              {/* Value cols */}
              <div className="mt-6 pt-6 border-t border-gray-200">
                <label className="block text-sm font-semibold text-gray-700 mb-3">
                  Data Series (Y-Axis)
                </label>
                <div className="flex flex-wrap gap-2">
                  {availableValueCols.map((col) => (
                    <label
                      key={col}
                      className={`px-4 py-2 rounded-lg border-2 cursor-pointer transition-all text-sm font-medium ${
                        valueCols.includes(col)
                          ? "bg-yellow-100 border-yellow-400 text-yellow-800"
                          : "bg-white border-gray-300 text-gray-700 hover:border-yellow-300 hover:bg-yellow-50"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={valueCols.includes(col)}
                        onChange={() => handleValueColChange(col)}
                        className="mr-2 accent-yellow-500"
                      />
                      {col}
                    </label>
                  ))}
                </div>
              </div>
            </div>

            {/* Chart */}
            <div className="bg-white rounded-xl shadow-xl border border-yellow-100 overflow-hidden">
              <div className="bg-gradient-to-r from-yellow-50 to-amber-50 px-6 py-4 border-b border-yellow-100">
                <div className="flex items-center gap-2">
                  {getChartIcon(chartType)}
                  <h2 className="text-lg font-semibold text-gray-800">
                    {chartType} Chart Visualization
                  </h2>
                </div>
              </div>

              <div ref={chartRef} className="p-6 bg-white">
                <ResponsiveContainer width="100%" height={450}>
                  {chartType === "Line" && (
                    <LineChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey={categoryCol} stroke="#6b7280" style={{ fontSize: "12px" }} />
                      <YAxis stroke="#6b7280" style={{ fontSize: "12px" }} />
                      <Tooltip />
                      <Legend wrapperStyle={{ paddingTop: "20px" }} iconType="line" />
                      {valueCols.map((col, idx) => (
                        <Line
                          key={col}
                          type="monotone"
                          dataKey={col}
                          stroke={COLORS[idx % COLORS.length]}
                          strokeWidth={2}
                        />
                      ))}
                    </LineChart>
                  )}

                  {chartType === "Bar" && (
                    <BarChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey={categoryCol} stroke="#6b7280" style={{ fontSize: "12px" }} />
                      <YAxis stroke="#6b7280" style={{ fontSize: "12px" }} />
                      <Tooltip />
                      <Legend wrapperStyle={{ paddingTop: "20px" }} iconType="rect" />
                      {valueCols.map((col, idx) => (
                        <Bar
                          key={col}
                          dataKey={col}
                          fill={COLORS[idx % COLORS.length]}
                          radius={[8, 8, 0, 0]}
                        />
                      ))}
                    </BarChart>
                  )}

                  {chartType === "Stacked Bar" && (
                    <BarChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey={categoryCol} stroke="#6b7280" style={{ fontSize: "12px" }} />
                      <YAxis stroke="#6b7280" style={{ fontSize: "12px" }} />
                      <Tooltip />
                      <Legend wrapperStyle={{ paddingTop: "20px" }} iconType="rect" />
                      {valueCols.map((col, idx) => (
                        <Bar
                          key={col}
                          dataKey={col}
                          stackId="stack"
                          fill={COLORS[idx % COLORS.length]}
                          radius={[6, 6, 0, 0]}
                        />
                      ))}
                    </BarChart>
                  )}

                  {chartType === "Area" && (
                    <AreaChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey={categoryCol} stroke="#6b7280" style={{ fontSize: "12px" }} />
                      <YAxis stroke="#6b7280" style={{ fontSize: "12px" }} />
                      <Tooltip />
                      <Legend wrapperStyle={{ paddingTop: "20px" }} iconType="rect" />
                      {valueCols.map((col, idx) => (
                        <Area
                          key={col}
                          type="monotone"
                          dataKey={col}
                          stroke={COLORS[idx % COLORS.length]}
                          fill={COLORS[idx % COLORS.length]}
                          fillOpacity={0.6}
                        />
                      ))}
                    </AreaChart>
                  )}

                  {chartType === "Pie" && (
                    <PieChart>
                      <Tooltip />
                      <Legend />
                      <Pie
                        data={pieData}
                        dataKey="value"
                        nameKey="name"
                        outerRadius={160}
                        label
                      >
                        {pieData.map((_item: any, idx: number) => (
                          <Cell key={`cell-${idx}`} fill={COLORS[idx % COLORS.length]} />
                        ))}
                      </Pie>
                    </PieChart>
                  )}
                </ResponsiveContainer>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default ChartPage;
