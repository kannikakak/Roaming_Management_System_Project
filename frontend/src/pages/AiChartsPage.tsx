import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { TrendingUp } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { apiFetch } from "../utils/api";
import { useTheme } from "../theme/ThemeProvider";

type Project = { id: number; name: string };
type FileItem = { id: number; name: string };
type QaItem = { value: string; count: number; compare?: number | null };
type FileQaResult = {
  fileId: number;
  fileName: string;
  answer: string;
  items: QaItem[];
  columns: string[];
  value: number | null;
  intent: string | null;
  column: string | null;
  compareColumn: string | null;
  error: string | null;
};
type InsightDailyPoint = {
  day: string;
  rows: number;
  traffic?: number;
  revenue?: number;
  cost?: number;
  expected?: number;
  actual?: number;
};

type DashboardInsights = {
  filters: {
    startDate: string | null;
    endDate: string | null;
    partner: string | null;
    country: string | null;
  };
  totals: {
    rowsScanned: number;
    rowsMatched: number;
  };
  metrics: {
    trafficKey: string | null;
    revenueKey: string | null;
    costKey: string | null;
    expectedKey: string | null;
    actualKey: string | null;
    forecastMetric: "rows" | "traffic" | "revenue";
  };
  series: {
    daily: InsightDailyPoint[];
  };
  forecast: {
    horizonDays: number;
    metric: string;
    points: Array<{ day: string; value: number }>;
  };
  anomalies: {
    metric: string;
    points: Array<{ day: string; value: number; zScore: number }>;
  };
  leakage: {
    expectedKey: string | null;
    actualKey: string | null;
    items: Array<{
      partner: string;
      country: string;
      expected: number;
      actual: number;
      diff: number;
      diffPct: number | null;
    }>;
  };
  summaries: string[];
};

const CHART_TYPES = ["Line", "Bar"] as const;
const DEFAULT_SUGGESTIONS = [
  "How many rows are in this file?",
  "Top 5 values of Service",
  "Compare Revenue vs Cost by Country",
  "Average of Revenue",
];
const FILE_CARD_STYLES = [
  "border-sky-200 bg-sky-50/60",
  "border-emerald-200 bg-emerald-50/60",
  "border-rose-200 bg-rose-50/60",
  "border-violet-200 bg-violet-50/60",
];
const AUTO_SEARCH_DELAY_MS = 650;

const toDateLabel = (day: string) => {
  const parsed = new Date(day);
  if (Number.isNaN(parsed.getTime())) return day;
  return parsed.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

const AiChartsPage: React.FC = () => {
  const navigate = useNavigate();
  const { theme } = useTheme();
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<number | null>(null);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [scopeMode, setScopeMode] = useState<"single" | "all">("single");
  const [selectedFileId, setSelectedFileId] = useState<number | null>(null);
  const [fileResults, setFileResults] = useState<FileQaResult[]>([]);
  const [activeFileResultId, setActiveFileResultId] = useState<number | null>(null);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [qaItems, setQaItems] = useState<QaItem[]>([]);
  const [qaColumns, setQaColumns] = useState<string[]>([]);
  const [qaValue, setQaValue] = useState<number | null>(null);
  const [qaIntent, setQaIntent] = useState<string | null>(null);
  const [qaColumn, setQaColumn] = useState<string | null>(null);
  const [qaCompareColumn, setQaCompareColumn] = useState<string | null>(null);
  const [chartType, setChartType] = useState<(typeof CHART_TYPES)[number]>("Line");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const autoSearchTimerRef = useRef<number | null>(null);
  const lastAskedKeyRef = useRef("");
  const [insightLoading, setInsightLoading] = useState(true);
  const [insightError, setInsightError] = useState<string | null>(null);
  const [insights, setInsights] = useState<DashboardInsights | null>(null);

  const resetQaState = useCallback(() => {
    setAnswer(null);
    setQaItems([]);
    setQaColumns([]);
    setQaValue(null);
    setQaIntent(null);
    setQaColumn(null);
    setQaCompareColumn(null);
    setFileResults([]);
    setActiveFileResultId(null);
    setError("");
  }, []);

  const buildKey = (
    activeProjectId: number | null,
    mode: "single" | "all",
    activeFileId: number | null,
    text: string
  ) => `${activeProjectId ?? "none"}:${mode}:${activeFileId ?? "all"}:${text.trim().toLowerCase()}`;

  const loadFiles = useCallback(
    async (options: { keepSelection?: boolean } = {}) => {
      if (!projectId) {
        setFiles([]);
        return;
      }
      try {
        const res = await apiFetch(`/api/files?projectId=${projectId}`);
        const data = await res.json();
        const nextFiles = Array.isArray(data.files) ? data.files : [];
        setFiles(nextFiles);

        if (nextFiles.length === 0) {
          setSelectedFileId(null);
          return;
        }

        setSelectedFileId((prev) => {
          if (options.keepSelection && prev && nextFiles.some((f: FileItem) => f.id === prev)) {
            return prev;
          }
          return nextFiles[0].id;
        });

        if (options.keepSelection) return;
      } catch {
        setFiles([]);
        setSelectedFileId(null);
      }
    },
    [projectId]
  );

  useEffect(() => {
    const storedUser = localStorage.getItem("authUser");
    const userId = storedUser ? JSON.parse(storedUser).id : 1;
    apiFetch(`/api/projects?user_id=${userId}`)
      .then((res) => res.json())
      .then((data) => {
        setProjects(Array.isArray(data) ? data : []);
        if (data?.length) setProjectId(data[0].id);
      });
  }, []);

  const loadInsights = useCallback(async () => {
    try {
      setInsightLoading(true);
      setInsightError(null);
      const res = await apiFetch("/api/dashboard/insights");
      if (!res.ok) {
        const message = await res.text();
        throw new Error(message || "Failed to load insights");
      }
      const json = (await res.json()) as DashboardInsights;
      setInsights(json);
    } catch (err: any) {
      setInsightError(err.message || "Failed to load insights.");
    } finally {
      setInsightLoading(false);
    }
  }, []);

  useEffect(() => {
    loadInsights();
  }, [loadInsights]);

  useEffect(() => {
    loadFiles();
  }, [loadFiles]);

  useEffect(() => {
    const handleFocus = () => loadFiles({ keepSelection: true });
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [loadFiles]);

  useEffect(() => {
    if (autoSearchTimerRef.current) {
      window.clearTimeout(autoSearchTimerRef.current);
      autoSearchTimerRef.current = null;
    }
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setLoading(false);
    resetQaState();
    lastAskedKeyRef.current = "";
    setScopeMode("single");
    setSelectedFileId(null);
  }, [projectId, resetQaState]);

  const chartData = useMemo(
    () =>
      qaItems.map((item) => ({
        label: String(item.value ?? "Unknown"),
        count: Number(item.count || 0),
        compare:
          item.compare === null || item.compare === undefined
            ? undefined
            : Number(item.compare || 0),
      })),
    [qaItems]
  );
  const hasCompareSeries = useMemo(
    () => chartData.some((item) => Number.isFinite(item.compare as number)),
    [chartData]
  );

  const submitQuestion = useCallback(async (raw: string, options: { force?: boolean } = {}) => {
    if (!projectId) {
      resetQaState();
      setError("Select a project first.");
      return;
    }
    const trimmed = raw.trim();
    if (!trimmed) {
      resetQaState();
      setError("Enter a question.");
      return;
    }

    const isSingleMode = scopeMode === "single";
    const hasSelectedFile = Number.isFinite(selectedFileId) && (selectedFileId ?? 0) > 0;
    if (isSingleMode && !hasSelectedFile) {
      resetQaState();
      setError("Select a file for accurate AI results.");
      return;
    }

    const key = buildKey(projectId, scopeMode, hasSelectedFile ? selectedFileId : null, trimmed);
    if (!options.force && key === lastAskedKeyRef.current) {
      return;
    }
    lastAskedKeyRef.current = key;

    resetQaState();
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);

    try {
      const parseResponse = async (res: Response) => {
        const contentType = res.headers.get("content-type") || "";
        if (contentType.includes("application/json")) {
          return res.json().catch(() => null);
        }
        const text = await res.text().catch(() => "");
        return text ? { message: text } : null;
      };

      if (!isSingleMode) {
        if (files.length === 0) {
          setError("No files uploaded yet.");
          return;
        }

        const results = await Promise.all(
          files.map(async (file): Promise<FileQaResult> => {
            try {
              const res = await apiFetch("/api/data-qa/ask", {
                method: "POST",
                body: JSON.stringify({ fileId: file.id, projectId, question: trimmed }),
                signal: controller.signal,
              });
              const data = await parseResponse(res);
              if (!res.ok) {
                const message =
                  (typeof data?.message === "string" && data.message.trim()) ||
                  `Request failed with status ${res.status}.`;
                return {
                  fileId: file.id,
                  fileName: file.name,
                  answer: "",
                  items: [],
                  columns: [],
                  value: null,
                  intent: null,
                  column: null,
                  compareColumn: null,
                  error: message,
                };
              }
              const numericValue = Number(data?.value);
              return {
                fileId: file.id,
                fileName: file.name,
                answer: data?.answer || "No answer returned.",
                items: Array.isArray(data?.items) ? data.items : [],
                columns: Array.isArray(data?.columns) ? data.columns : [],
                value: Number.isFinite(numericValue) ? numericValue : null,
                intent: typeof data?.intent === "string" ? data.intent : null,
                column: typeof data?.column === "string" ? data.column : null,
                compareColumn: typeof data?.compareColumn === "string" ? data.compareColumn : null,
                error: null,
              };
            } catch (err: any) {
              if (err?.name === "AbortError") throw err;
              return {
                fileId: file.id,
                fileName: file.name,
                answer: "",
                items: [],
                columns: [],
                value: null,
                intent: null,
                column: null,
                compareColumn: null,
                error: "Network error.",
              };
            }
          })
        );

        const successResults = results.filter((r) => !r.error);
        const dataResults = successResults.filter((r) => r.items.length > 0 || r.value !== null || r.answer);
        const active = dataResults[0] || successResults[0] || null;

        setFileResults(results);
        if (!active) {
          setError("AI could not return results for uploaded files.");
          return;
        }

        setActiveFileResultId(active.fileId);
        setAnswer(active.answer);
        setQaItems(active.items);
        setQaColumns(active.columns);
        setQaValue(active.value);
        setQaIntent(active.intent);
        setQaColumn(active.column);
        setQaCompareColumn(active.compareColumn);

        if (successResults.length < files.length) {
          setError(`Read ${successResults.length}/${files.length} files. Some files failed to process.`);
        }
      } else {
        const res = await apiFetch("/api/data-qa/ask", {
          method: "POST",
          body: JSON.stringify({ fileId: selectedFileId, projectId, question: trimmed }),
          signal: controller.signal,
        });
        const data = await parseResponse(res);
        if (!res.ok) {
          const message =
            (typeof data?.message === "string" && data.message.trim()) ||
            `Request failed with status ${res.status}.`;
          setError(message);
          return;
        }

        setAnswer(data?.answer || "No answer returned.");
        setQaItems(Array.isArray(data?.items) ? data.items : []);
        setQaColumns(Array.isArray(data?.columns) ? data.columns : []);
        const numericValue = Number(data?.value);
        setQaValue(Number.isFinite(numericValue) ? numericValue : null);
        setQaIntent(typeof data?.intent === "string" ? data.intent : null);
        setQaColumn(typeof data?.column === "string" ? data.column : null);
        setQaCompareColumn(typeof data?.compareColumn === "string" ? data.compareColumn : null);
      }
    } catch (err) {
      if ((err as any)?.name === "AbortError") return;
      setError("Network error. Please try again.");
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
      setLoading(false);
    }
  }, [projectId, resetQaState, scopeMode, selectedFileId, files]);

  const selectedFile = useMemo(
    () => files.find((f) => f.id === selectedFileId) || null,
    [files, selectedFileId]
  );

  const applyFileResult = useCallback((result: FileQaResult) => {
    setActiveFileResultId(result.fileId);
    setAnswer(result.answer || `No answer for ${result.fileName}.`);
    setQaItems(result.items);
    setQaColumns(result.columns);
    setQaValue(result.value);
    setQaIntent(result.intent);
    setQaColumn(result.column);
    setQaCompareColumn(result.compareColumn);
    setError(result.error || "");
  }, []);

  const askQuestion = async (event: React.FormEvent) => {
    event.preventDefault();
    await submitQuestion(question, { force: true });
  };

  const handleSuggestionClick = (text: string) => {
    setQuestion(text);
    submitQuestion(text, { force: true });
  };

  useEffect(() => {
    if (autoSearchTimerRef.current) {
      window.clearTimeout(autoSearchTimerRef.current);
      autoSearchTimerRef.current = null;
    }

    const trimmed = question.trim();
    if (!trimmed) return;
    if (!projectId || files.length === 0) return;
    if (scopeMode === "single" && !selectedFileId) return;

    autoSearchTimerRef.current = window.setTimeout(() => {
      submitQuestion(trimmed);
    }, AUTO_SEARCH_DELAY_MS);

    return () => {
      if (autoSearchTimerRef.current) {
        window.clearTimeout(autoSearchTimerRef.current);
        autoSearchTimerRef.current = null;
      }
    };
  }, [question, projectId, files.length, scopeMode, selectedFileId, submitQuestion]);

  const quickPrompts = useMemo(() => {
    const items = [...DEFAULT_SUGGESTIONS];
    if (qaColumn) {
      items.unshift(`Show top 5 ${qaColumn}`);
    }
    if (qaColumn && qaCompareColumn) {
      items.unshift(`Compare ${qaColumn} vs ${qaCompareColumn} by Country`);
    }
    if (insights?.metrics.revenueKey && insights?.metrics.costKey) {
      items.push(`Compare ${insights.metrics.revenueKey} vs ${insights.metrics.costKey}`);
    }
    return Array.from(new Set(items)).slice(0, 5);
  }, [qaColumn, qaCompareColumn, insights]);

  const hasChart = chartData.length > 0;

  const chartPalette = useMemo(
    () => ({
      axis: "#9CA3AF",
      grid: theme === "dark" ? "rgba(255,255,255,0.12)" : "#F3E8D2",
      tooltipBg: theme === "dark" ? "#111827" : "#FFFFFF",
      tooltipBorder: theme === "dark" ? "#374151" : "#FDE68A",
    }),
    [theme]
  );

  const insightMetricKey = insights?.metrics.forecastMetric || "rows";
  const insightMetricLabel =
    insightMetricKey === "revenue" ? "Revenue" : insightMetricKey === "traffic" ? "Traffic" : "Rows";

  const insightObservedSeries = useMemo(() => {
    const daily = insights?.series.daily || [];
    return daily.map((d) => ({
      day: d.day,
      label: toDateLabel(d.day),
      observed:
        insightMetricKey === "revenue"
          ? Number(d.revenue || 0)
          : insightMetricKey === "traffic"
            ? Number(d.traffic || 0)
            : Number(d.rows || 0),
    }));
  }, [insights, insightMetricKey]);

  const insightForecastSeries = useMemo(() => {
    const forecastPoints = insights?.forecast.points || [];
    const map = new Map<string, { day: string; label: string; observed?: number; forecast?: number }>();

    for (const point of insightObservedSeries) {
      map.set(point.day, { day: point.day, label: point.label, observed: point.observed });
    }
    for (const point of forecastPoints) {
      const label = toDateLabel(point.day);
      const existing = map.get(point.day);
      if (existing) {
        existing.forecast = point.value;
      } else {
        map.set(point.day, { day: point.day, label, forecast: point.value });
      }
    }

    return Array.from(map.values()).sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  }, [insightObservedSeries, insights]);

  const aiSummaryLines = useMemo(() => {
    return (insights?.summaries || []).filter(Boolean).slice(0, 3);
  }, [insights]);

  const topAnomaly = useMemo(() => {
    const points = insights?.anomalies.points || [];
    if (points.length === 0) return null;
    return [...points].sort((a, b) => Math.abs(b.zScore) - Math.abs(a.zScore))[0];
  }, [insights]);

  const topLeakage = useMemo(() => {
    const items = insights?.leakage.items || [];
    if (items.length === 0) return null;
    return [...items].sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))[0];
  }, [insights]);

  const aiSignalText = useMemo(() => {
    if (topLeakage && topLeakage.diff > 0) {
      const pct = topLeakage.diffPct === null ? "" : ` (${topLeakage.diffPct.toLocaleString()}%)`;
      return `Highest leakage: ${topLeakage.partner} / ${topLeakage.country} +${topLeakage.diff.toLocaleString()}${pct}`;
    }
    if (topAnomaly) {
      return `Strong anomaly on ${topAnomaly.day}: ${topAnomaly.value.toLocaleString()} (z=${topAnomaly.zScore})`;
    }
    return "No high-risk signals detected from the latest AI insights.";
  }, [topLeakage, topAnomaly]);

  useEffect(() => {
    return () => {
      if (autoSearchTimerRef.current) {
        window.clearTimeout(autoSearchTimerRef.current);
      }
      if (abortRef.current) {
        abortRef.current.abort();
      }
    };
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 via-white to-orange-50 dark:from-gray-950 dark:via-gray-950 dark:to-gray-900 p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="bg-white border rounded-2xl p-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-3xl font-bold text-amber-800">AI Studio</h2>
              <p className="text-sm text-gray-600">
                Ask a question, generate a chart, and review AI insights in one place.
              </p>
            </div>
            <button
              className="px-4 py-2 rounded-xl border border-amber-200 text-amber-700 text-sm font-semibold hover:bg-amber-50"
              onClick={() => navigate("/charts")}
              type="button"
            >
              Manual Charts
            </button>
          </div>

          <div className="mt-4 grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-gray-600">Project</label>
              <select
                className="w-full border rounded-lg px-3 py-2"
                value={projectId ?? ""}
                onChange={(e) => setProjectId(Number(e.target.value))}
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-gray-600">Data Scope</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setScopeMode("single")}
                  className={`flex-1 px-3 py-2 rounded-lg border text-xs font-semibold ${
                    scopeMode === "single"
                      ? "bg-amber-600 text-white border-amber-600"
                      : "bg-white text-amber-700 border-amber-200 hover:bg-amber-50"
                  }`}
                >
                  Single File
                </button>
                <button
                  type="button"
                  onClick={() => setScopeMode("all")}
                  className={`flex-1 px-3 py-2 rounded-lg border text-xs font-semibold ${
                    scopeMode === "all"
                      ? "bg-amber-600 text-white border-amber-600"
                      : "bg-white text-amber-700 border-amber-200 hover:bg-amber-50"
                  }`}
                >
                  All Files
                </button>
              </div>

              {scopeMode === "single" && (
                <select
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                  value={selectedFileId ?? ""}
                  onChange={(e) => {
                    const next = Number(e.target.value);
                    setSelectedFileId(Number.isFinite(next) && next > 0 ? next : null);
                  }}
                >
                  {files.length === 0 ? (
                    <option value="">No files uploaded</option>
                  ) : (
                    files.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))
                  )}
                </select>
              )}

              <div className="flex items-center gap-2">
                <div className="w-full border rounded-lg px-3 py-2 text-xs text-gray-600 bg-gray-50">
                  {files.length === 0
                    ? "No files uploaded yet"
                    : scopeMode === "single"
                      ? `Focused on: ${selectedFile?.name || "Select a file"}`
                      : `AI checks all ${files.length} files separately (no merge)`}
                </div>
                <button
                  type="button"
                  onClick={() => loadFiles({ keepSelection: true })}
                  className="px-3 py-2 rounded-lg border border-amber-200 text-amber-700 text-xs font-semibold hover:bg-amber-50"
                >
                  Refresh
                </button>
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-gray-600">Chart Type</label>
              <div className="flex gap-2">
                {CHART_TYPES.map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setChartType(type)}
                    className={`flex-1 px-3 py-2 rounded-lg border text-sm font-semibold ${
                      chartType === type
                        ? "bg-amber-600 text-white border-amber-600"
                        : "bg-white text-amber-700 border-amber-200 hover:bg-amber-50"
                    }`}
                  >
                    {type}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white border rounded-2xl p-5">
          <form onSubmit={askQuestion} className="space-y-3">
            <div className="flex flex-col md:flex-row gap-3">
              <input
                className="flex-1 border rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-200"
                placeholder="Example: Top 5 values of Service"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                disabled={files.length === 0}
              />
              <button
                type="submit"
                className="px-5 py-2 rounded-xl bg-amber-600 text-white text-sm font-semibold shadow disabled:opacity-60"
                disabled={loading || files.length === 0 || (scopeMode === "single" && !selectedFileId)}
              >
                {loading ? "Asking..." : "Ask"}
              </button>
            </div>

            <div className="text-xs text-gray-500">
              {files.length === 0
                ? "Upload at least one file to start asking AI."
                : scopeMode === "single"
                  ? `Accuracy mode: AI reads only "${selectedFile?.name || "selected file"}".`
                  : `All-files mode: AI reads each file independently and shows per-file results.`}
            </div>
            <div className="text-[11px] text-gray-400">Auto search is on while typing.</div>

            {error && (
              <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                {error}
              </div>
            )}

            {answer && (
              <div className="text-sm text-gray-700 bg-amber-50 border border-amber-100 rounded-xl px-4 py-3">
                {answer}
              </div>
            )}

            <div className="flex flex-wrap gap-2 text-xs text-gray-500">
              {quickPrompts.map((text) => (
                <button
                  key={text}
                  type="button"
                  onClick={() => handleSuggestionClick(text)}
                  className="px-2 py-1 rounded-full border border-amber-200 text-amber-700 hover:bg-amber-50"
                >
                  {text}
                </button>
              ))}
            </div>

            {qaColumns.length > 0 && (
              <div className="text-xs text-gray-500">
                Detected columns: {qaColumns.slice(0, 6).join(", ")}
                {qaColumns.length > 6 ? ` +${qaColumns.length - 6} more` : ""}
              </div>
            )}
          </form>
        </div>

        {scopeMode === "all" && fileResults.length > 0 && (
          <div className="bg-white border rounded-2xl p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-gray-900">Per-File AI Results</h3>
              <div className="text-xs text-gray-500">
                Read {fileResults.filter((r) => !r.error).length}/{fileResults.length} files
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {fileResults.map((result, index) => {
                const isActive = activeFileResultId === result.fileId;
                const style = FILE_CARD_STYLES[index % FILE_CARD_STYLES.length];
                const hasData = result.items.length > 0 || result.value !== null;
                return (
                  <button
                    key={result.fileId}
                    type="button"
                    onClick={() => applyFileResult(result)}
                    className={`text-left rounded-xl border p-3 transition ${style} ${
                      isActive ? "ring-2 ring-amber-400 border-amber-400" : "hover:border-amber-300"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="font-semibold text-sm text-gray-900">{result.fileName}</div>
                      <div
                        className={`text-[11px] px-2 py-0.5 rounded-full border ${
                          result.error
                            ? "text-red-600 border-red-200 bg-red-50"
                            : hasData
                              ? "text-emerald-700 border-emerald-200 bg-emerald-50"
                              : "text-gray-600 border-gray-200 bg-white"
                        }`}
                      >
                        {result.error ? "Failed" : hasData ? "Has Result" : "No Result"}
                      </div>
                    </div>
                    <div className="mt-1 text-xs text-gray-600">
                      {result.column
                        ? `Detected column: ${result.column}`
                        : result.columns.length > 0
                          ? `Columns: ${result.columns.slice(0, 3).join(", ")}${result.columns.length > 3 ? "..." : ""}`
                          : "No columns detected in AI response."}
                    </div>
                    <div className="mt-2 text-xs text-gray-500">
                      {result.error ? result.error : result.answer || "No answer."}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {hasChart && (
          <div className="bg-white border rounded-2xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-900">Generated Chart</h3>
              <div className="text-xs text-gray-500">{chartData.length} points</div>
            </div>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                {chartType === "Line" ? (
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="label" stroke="#6b7280" />
                    <YAxis stroke="#6b7280" />
                    <Tooltip />
                    {hasCompareSeries && <Legend />}
                    <Line
                      type="monotone"
                      dataKey="count"
                      name={qaColumn || "Value"}
                      stroke="#b45309"
                      strokeWidth={2}
                    />
                    {hasCompareSeries && (
                      <Line
                        type="monotone"
                        dataKey="compare"
                        name={qaCompareColumn || "Compare"}
                        stroke="#1d4ed8"
                        strokeWidth={2}
                      />
                    )}
                  </LineChart>
                ) : (
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="label" stroke="#6b7280" />
                    <YAxis stroke="#6b7280" />
                    <Tooltip />
                    {hasCompareSeries && <Legend />}
                    <Bar
                      dataKey="count"
                      name={qaColumn || "Value"}
                      fill="#f59e0b"
                      radius={[8, 8, 0, 0]}
                    />
                    {hasCompareSeries && (
                      <Bar
                        dataKey="compare"
                        name={qaCompareColumn || "Compare"}
                        fill="#3b82f6"
                        radius={[8, 8, 0, 0]}
                      />
                    )}
                  </BarChart>
                )}
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {!hasChart && qaValue !== null && (
          <div className="bg-white border rounded-2xl p-5">
            <div className="text-xs text-gray-500">Generated Metric</div>
            <div className="text-4xl font-bold text-amber-700 mt-2">
              {qaValue.toLocaleString()}
            </div>
            {qaIntent && (
              <div className="text-xs text-gray-500 mt-1">
                Intent: {qaIntent}
              </div>
            )}
          </div>
        )}

        <div className="bg-white border rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">AI Highlights</h3>
              <p className="text-xs text-gray-500">
                Simplified view with the most important AI signals only.
              </p>
            </div>
            <TrendingUp className="w-5 h-5 text-amber-700 ml-auto" />
            <button
              type="button"
              onClick={() => loadInsights()}
              className="px-3 py-1.5 rounded-lg border border-amber-200 text-amber-700 text-xs font-semibold hover:bg-amber-50"
            >
              Refresh AI
            </button>
          </div>

          {insightError && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-4">
              {insightError}
            </div>
          )}

          {insightLoading && !insights ? (
            <div className="text-sm text-gray-500">Loading AI insights...</div>
          ) : !insights ? (
            <div className="text-sm text-gray-500">No insights data yet.</div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="rounded-2xl border border-amber-100 p-4 bg-amber-50/40">
                  <div className="text-xs font-semibold text-amber-700 mb-2">Top AI Summary</div>
                  {aiSummaryLines.length === 0 ? (
                    <div className="text-sm text-gray-500">No summary yet.</div>
                  ) : (
                    <ul className="space-y-2 text-sm text-gray-700">
                      {aiSummaryLines.map((line, idx) => (
                        <li key={`${idx}-${line}`} className="leading-relaxed">
                          {line}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="rounded-2xl border border-amber-100 p-4 bg-white">
                  <div className="text-xs font-semibold text-amber-700 mb-2">Key AI Signal</div>
                  <p className="text-sm text-gray-700 leading-relaxed">{aiSignalText}</p>
                  <div className="mt-2 text-[11px] text-gray-500">
                    Forecast metric: <span className="font-semibold">{insightMetricLabel}</span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="rounded-xl border border-gray-200 p-3">
                  <div className="text-[11px] text-gray-500">Rows Scanned</div>
                  <div className="text-lg font-semibold text-gray-900">
                    {insights.totals.rowsScanned.toLocaleString()}
                  </div>
                </div>
                <div className="rounded-xl border border-gray-200 p-3">
                  <div className="text-[11px] text-gray-500">Rows Matched</div>
                  <div className="text-lg font-semibold text-gray-900">
                    {insights.totals.rowsMatched.toLocaleString()}
                  </div>
                </div>
                <div className="rounded-xl border border-gray-200 p-3">
                  <div className="text-[11px] text-gray-500">Anomalies</div>
                  <div className="text-lg font-semibold text-gray-900">
                    {insights.anomalies.points.length.toLocaleString()}
                  </div>
                </div>
                <div className="rounded-xl border border-gray-200 p-3">
                  <div className="text-[11px] text-gray-500">Leakage Items</div>
                  <div className="text-lg font-semibold text-gray-900">
                    {insights.leakage.items.length.toLocaleString()}
                  </div>
                </div>
              </div>

              {insightForecastSeries.length > 0 && (
                <div className="rounded-2xl border border-amber-100 p-4 bg-white">
                  <h4 className="font-semibold text-gray-900 mb-2">Predictive Trend ({insightMetricLabel})</h4>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={insightForecastSeries}>
                        <CartesianGrid strokeDasharray="3 3" stroke={chartPalette.grid} />
                        <XAxis dataKey="label" stroke={chartPalette.axis} fontSize={12} tickLine={false} axisLine={false} />
                        <YAxis stroke={chartPalette.axis} fontSize={12} allowDecimals={false} tickLine={false} axisLine={false} width={56} />
                        <Tooltip
                          contentStyle={{
                            borderRadius: 12,
                            borderColor: chartPalette.tooltipBorder,
                            background: chartPalette.tooltipBg,
                            color: theme === "dark" ? "#F9FAFB" : "#111827",
                          }}
                        />
                        <Line
                          type="monotone"
                          dataKey="observed"
                          name={`Observed ${insightMetricLabel}`}
                          stroke="#F59E0B"
                          strokeWidth={3}
                          dot={false}
                          connectNulls
                        />
                        <Line
                          type="monotone"
                          dataKey="forecast"
                          name="Forecast"
                          stroke="#FCD34D"
                          strokeWidth={3}
                          strokeDasharray="6 6"
                          dot={false}
                          connectNulls
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AiChartsPage;
