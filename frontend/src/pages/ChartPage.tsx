import React, { useRef, useState, useEffect, useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import * as htmlToImage from "html-to-image";
import { Download, ArrowLeft, BarChart3, TrendingUp, Save, FileText } from "lucide-react";
import { logAudit } from "../utils/auditLog";

const COLORS = ["#EACE5F", "#b89c1d", "#FFD700", "#FFB300", "#FF8C00", "#FFD580", "#F5DEB3"];
const CHART_TYPES = ["Line", "Bar", "Area"];

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

const ChartPage: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();

  const { file: initialFile, selectedCols: initialSelectedCols } = (location.state || {}) as any;

  const chartRef = useRef<HTMLDivElement | null>(null);

  const [currentFile, setCurrentFile] = useState<any>(initialFile || null);
  const [currentSelectedCols, setCurrentSelectedCols] = useState<string[]>(initialSelectedCols || []);

  const [savedCharts, setSavedCharts] = useState<SavedChart[]>([]);

  const [categoryCol, setCategoryCol] = useState<string>(initialSelectedCols?.[0] || "");
  const [valueCols, setValueCols] = useState<string[]>(initialSelectedCols?.slice(1) || []);
  const [chartType, setChartType] = useState<string>("Line");
  const [isExporting, setIsExporting] = useState(false);

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

  const handleValueColChange = (col: string) => {
    setValueCols((prev) => (prev.includes(col) ? prev.filter((c) => c !== col) : [...prev, col]));
  };

  const handleCategoryColChange = (col: string) => {
    setCategoryCol(col);
    setValueCols((prev) => prev.filter((c) => c !== col));
  };

  // ✅ Save chart config (card)
  const saveChartToDb = async () => {
    if (!chartRef.current) return;
    try {
      const chartImage = await htmlToImage.toPng(chartRef.current, {
        pixelRatio: 2,
        backgroundColor: "white",
      });
      await fetch("/api/charts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
        {/* ✅ ALWAYS show saved cards */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-lg font-semibold text-gray-700">Saved Charts</h3>
            <button
              onClick={loadSavedCharts}
              className="text-sm px-3 py-1 rounded bg-white border hover:bg-gray-50"
            >
              Refresh
            </button>
          </div>

          {savedCharts.length === 0 ? (
            <div className="bg-white border rounded-lg p-4 text-sm text-gray-600">
              No saved chart cards yet. Click <b>Save Card</b> to create one.
            </div>
          ) : (
            <div className="flex flex-wrap gap-4">
              {savedCharts.map((chart) => (
                <div
                  key={chart.id}
                  className="cursor-pointer bg-white border-2 border-yellow-200 rounded-lg px-6 py-4 shadow hover:shadow-lg transition-all"
                  onClick={() => handleLoadChart(chart.config)}
                  title="Click to load this chart"
                >
                  <div className="font-bold text-yellow-700">{chart.name}</div>
                  <div className="text-xs text-gray-500 mt-1">
                    {chart.config.chartType} Chart <br />
                    X: {chart.config.categoryCol} <br />
                    Y: {chart.config.valueCols.join(", ")}
                  </div>
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
            <div className="bg-white rounded-xl shadow-lg p-6 mb-6 border border-yellow-100">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                {/* Category */}
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Category Axis (X)
                  </label>
                  <select
                    value={categoryCol}
                    onChange={(e) => handleCategoryColChange(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 focus:border-yellow-400 focus:ring-2 focus:ring-yellow-200 outline-none text-sm"
                  >
                    {currentSelectedCols.map((col: string) => (
                      <option key={col} value={col}>
                        {col}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Chart type */}
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Chart Type</label>
                  <select
                    value={chartType}
                    onChange={(e) => setChartType(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 focus:border-yellow-400 focus:ring-2 focus:ring-yellow-200 outline-none text-sm"
                  >
                    {CHART_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {type} Chart
                      </option>
                    ))}
                  </select>
                </div>

                {/* Buttons */}
                <div className="md:col-span-2 flex items-end gap-2">
                  <button
                    className="flex-1 px-4 py-2 rounded-lg bg-gradient-to-r from-yellow-400 to-amber-500 text-white text-sm font-semibold hover:from-yellow-500 hover:to-amber-600 disabled:opacity-50 flex items-center justify-center gap-2"
                    onClick={() => exportChartAsImage("png")}
                    disabled={isExporting}
                  >
                    <Download className="w-4 h-4" />
                    Export PNG
                  </button>

                  <button
                    className="flex-1 px-4 py-2 rounded-lg bg-white border-2 border-yellow-400 text-yellow-700 text-sm font-semibold hover:bg-yellow-50 disabled:opacity-50 flex items-center justify-center gap-2"
                    onClick={() => exportChartAsImage("jpg")}
                    disabled={isExporting}
                  >
                    <Download className="w-4 h-4" />
                    Export JPG
                  </button>

                  <button
                    className="flex-1 px-4 py-2 rounded-lg bg-yellow-100 border-2 border-yellow-400 text-yellow-700 text-sm font-semibold hover:bg-yellow-200 flex items-center justify-center gap-2"
                    onClick={handleSaveChart}
                    type="button"
                  >
                    <Save className="w-4 h-4" />
                    Save Card
                  </button>

                  {/* ✅ YOUR button is back */}
                  <button
                    className="flex-1 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 flex items-center justify-center gap-2"
                    onClick={addToReportDraft}
                    type="button"
                  >
                    <FileText className="w-4 h-4" />
                    Add to Report
                  </button>
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
