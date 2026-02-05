import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Filter, TrendingUp } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
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
type QaItem = { value: string; count: number };
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

type InsightsFilterState = {
  startDate: string;
  endDate: string;
  partner: string;
  country: string;
};

const CHART_TYPES = ["Line", "Bar"] as const;
const AUTO_DELAY_MS = 700;

const toDateLabel = (day: string) => {
  const parsed = new Date(day);
  if (Number.isNaN(parsed.getTime())) return day;
  return parsed.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

const buildInsightsParams = (filters: InsightsFilterState) => {
  const params = new URLSearchParams();
  if (filters.startDate) params.set("startDate", filters.startDate);
  if (filters.endDate) params.set("endDate", filters.endDate);
  if (filters.partner.trim()) params.set("partner", filters.partner.trim());
  if (filters.country.trim()) params.set("country", filters.country.trim());
  return params;
};

const AiChartsPage: React.FC = () => {
  const navigate = useNavigate();
  const { theme } = useTheme();
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<number | null>(null);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [qaItems, setQaItems] = useState<QaItem[]>([]);
  const [qaColumns, setQaColumns] = useState<string[]>([]);
  const [qaValue, setQaValue] = useState<number | null>(null);
  const [qaIntent, setQaIntent] = useState<string | null>(null);
  const [chartType, setChartType] = useState<(typeof CHART_TYPES)[number]>("Line");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [autoAsk, setAutoAsk] = useState(true);
  const debounceRef = useRef<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const lastAskedKeyRef = useRef("");
  const [insightFilters, setInsightFilters] = useState<InsightsFilterState>({
    startDate: "",
    endDate: "",
    partner: "",
    country: "",
  });
  const [insightAppliedFilters, setInsightAppliedFilters] = useState<InsightsFilterState>(insightFilters);
  const [insightLoading, setInsightLoading] = useState(true);
  const [insightError, setInsightError] = useState<string | null>(null);
  const [insights, setInsights] = useState<DashboardInsights | null>(null);

  const resetQaState = useCallback(() => {
    setAnswer(null);
    setQaItems([]);
    setQaColumns([]);
    setQaValue(null);
    setQaIntent(null);
    setError("");
  }, []);

  const buildKey = (activeProjectId: number | null, text: string) =>
    `${activeProjectId ?? "none"}:${text.trim().toLowerCase()}`;

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
          return;
        }

        if (options.keepSelection) return;
      } catch {
        setFiles([]);
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

  useEffect(() => {
    let mounted = true;
    const run = async () => {
      try {
        setInsightLoading(true);
        setInsightError(null);
        const params = buildInsightsParams(insightAppliedFilters);
        const res = await apiFetch(`/api/dashboard/insights?${params.toString()}`);
        if (!res.ok) {
          const message = await res.text();
          throw new Error(message || "Failed to load insights");
        }
        const json = (await res.json()) as DashboardInsights;
        if (mounted) setInsights(json);
      } catch (err: any) {
        if (mounted) setInsightError(err.message || "Failed to load insights.");
      } finally {
        if (mounted) setInsightLoading(false);
      }
    };

    run();
    return () => {
      mounted = false;
    };
  }, [insightAppliedFilters]);

  useEffect(() => {
    loadFiles();
  }, [loadFiles]);

  useEffect(() => {
    const handleFocus = () => loadFiles({ keepSelection: true });
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [loadFiles]);

  useEffect(() => {
    if (debounceRef.current) {
      window.clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setLoading(false);
    resetQaState();
    lastAskedKeyRef.current = "";
  }, [projectId, resetQaState]);

  const chartData = useMemo(
    () =>
      qaItems.map((item) => ({
        label: String(item.value ?? "Unknown"),
        count: Number(item.count || 0),
      })),
    [qaItems]
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

    const key = buildKey(projectId, trimmed);
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
      const res = await apiFetch("/api/data-qa/ask", {
        method: "POST",
        body: JSON.stringify({ projectId, question: trimmed }),
        signal: controller.signal,
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || "Failed to answer the question.");
      } else {
        setAnswer(data.answer || "No answer returned.");
        setQaItems(Array.isArray(data.items) ? data.items : []);
        setQaColumns(Array.isArray(data.columns) ? data.columns : []);
        const numericValue = Number(data.value);
        setQaValue(Number.isFinite(numericValue) ? numericValue : null);
        setQaIntent(typeof data.intent === "string" ? data.intent : null);
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
  }, [projectId, resetQaState]);

  const askQuestion = async (event: React.FormEvent) => {
    event.preventDefault();
    await submitQuestion(question, { force: true });
  };

  const handleSuggestionClick = (text: string) => {
    setQuestion(text);
    submitQuestion(text, { force: true });
  };

  const suggestions = [
    "How many rows are in this file?",
    "Top 5 values of Service",
    "Average of Revenue",
    "Distinct values of KPI",
  ];

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

  const onApplyInsightFilters = (e: React.FormEvent) => {
    e.preventDefault();
    setInsightAppliedFilters(insightFilters);
  };

  const onClearInsightFilters = () => {
    const empty: InsightsFilterState = { startDate: "", endDate: "", partner: "", country: "" };
    setInsightFilters(empty);
    setInsightAppliedFilters(empty);
  };

  useEffect(() => {
    if (!autoAsk) return;
    if (!projectId) return;
    const trimmed = question.trim();
    if (!trimmed) return;
    const key = buildKey(projectId, trimmed);
    if (key === lastAskedKeyRef.current) return;

    if (debounceRef.current) {
      window.clearTimeout(debounceRef.current);
    }
    debounceRef.current = window.setTimeout(() => {
      submitQuestion(trimmed);
    }, AUTO_DELAY_MS);

    return () => {
      if (debounceRef.current) {
        window.clearTimeout(debounceRef.current);
      }
    };
  }, [autoAsk, projectId, question, submitQuestion]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        window.clearTimeout(debounceRef.current);
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
              <label className="text-xs font-semibold text-gray-600">Files</label>
              <div className="flex items-center gap-2">
                <div className="w-full border rounded-lg px-3 py-2 text-sm text-gray-700 bg-gray-50">
                  {files.length === 0
                    ? "No files uploaded yet"
                    : `All ${files.length} uploaded files in this project`}
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
                  disabled={loading || files.length === 0}
                >
                {loading ? "Asking..." : "Ask"}
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500">
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={autoAsk}
                  onChange={(e) => setAutoAsk(e.target.checked)}
                  className="accent-amber-500"
                />
                Auto-run search
              </label>
              <span>Tip: use column names from Data Explorer for best results.</span>
            </div>

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

            {qaColumns.length > 0 && (
              <div className="flex flex-wrap gap-2 text-xs">
                {qaColumns.slice(0, 12).map((c) => (
                  <span
                    key={c}
                    className="px-2 py-1 rounded-full bg-gray-100 text-gray-700 border border-gray-200"
                  >
                    {c}
                  </span>
                ))}
              </div>
            )}

            <div className="flex flex-wrap gap-2 text-xs text-gray-500">
              {suggestions.map((text) => (
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
          </form>
        </div>

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
                    <Line type="monotone" dataKey="count" stroke="#b45309" strokeWidth={2} />
                  </LineChart>
                ) : (
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="label" stroke="#6b7280" />
                    <YAxis stroke="#6b7280" />
                    <Tooltip />
                    <Bar dataKey="count" fill="#f59e0b" radius={[8, 8, 0, 0]} />
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
          <div className="flex items-center gap-2 mb-3">
            <Filter className="w-5 h-5 text-amber-700" />
            <div>
              <h3 className="text-lg font-semibold text-gray-900">AI Insights</h3>
              <p className="text-xs text-gray-500">Forecasts, anomalies, leakage checks, and summaries.</p>
            </div>
            <TrendingUp className="w-5 h-5 text-amber-700 ml-auto" />
          </div>

          <form onSubmit={onApplyInsightFilters} className="grid grid-cols-1 md:grid-cols-5 gap-3 mb-4">
            <input
              type="date"
              value={insightFilters.startDate}
              onChange={(e) => setInsightFilters((prev) => ({ ...prev, startDate: e.target.value }))}
              className="px-3 py-2.5 rounded-xl border border-amber-100 bg-white text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-amber-300"
              placeholder="Start date"
            />
            <input
              type="date"
              value={insightFilters.endDate}
              onChange={(e) => setInsightFilters((prev) => ({ ...prev, endDate: e.target.value }))}
              className="px-3 py-2.5 rounded-xl border border-amber-100 bg-white text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-amber-300"
              placeholder="End date"
            />
            <input
              value={insightFilters.partner}
              onChange={(e) => setInsightFilters((prev) => ({ ...prev, partner: e.target.value }))}
              className="px-3 py-2.5 rounded-xl border border-amber-100 bg-white text-sm text-gray-700 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-amber-300"
              placeholder="Partner"
            />
            <input
              value={insightFilters.country}
              onChange={(e) => setInsightFilters((prev) => ({ ...prev, country: e.target.value }))}
              className="px-3 py-2.5 rounded-xl border border-amber-100 bg-white text-sm text-gray-700 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-amber-300"
              placeholder="Country"
            />
            <div className="flex gap-2">
              <button
                type="submit"
                className="flex-1 px-4 py-2.5 rounded-xl bg-amber-500 text-white font-semibold hover:bg-amber-600"
              >
                Apply
              </button>
              <button
                type="button"
                onClick={onClearInsightFilters}
                className="px-4 py-2.5 rounded-xl border border-amber-200 text-amber-700 font-semibold hover:bg-amber-50"
              >
                Clear
              </button>
            </div>
          </form>

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
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
              <div className="xl:col-span-1 rounded-2xl border border-amber-100 p-4 bg-amber-50/40">
                <div className="text-xs font-semibold text-amber-700 mb-2">Automated Summaries</div>
                <ul className="space-y-2 text-sm text-gray-700">
                  {insights.summaries.map((line, idx) => (
                    <li key={`${idx}-${line}`} className="leading-relaxed">
                      {line}
                    </li>
                  ))}
                </ul>
                <div className="mt-3 text-[11px] text-gray-500">
                  Forecast metric: <span className="font-semibold">{insightMetricLabel}</span>
                </div>
              </div>

              <div className="xl:col-span-2 rounded-2xl border border-amber-100 p-4 bg-white">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h4 className="font-semibold text-gray-900">
                      Predictive Trend ({insightMetricLabel})
                    </h4>
                    <p className="text-xs text-gray-500">Observed values with a short forward forecast.</p>
                  </div>
                </div>
                <div className="h-72">
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

              <div className="rounded-2xl border border-amber-100 p-4 bg-white">
                <div className="flex items-center justify-between mb-2.5">
                  <h4 className="font-semibold text-gray-900">Anomalies</h4>
                  <div className="text-[11px] text-gray-500">z-score &gt;= 2.5</div>
                </div>
                {insights.anomalies.points.length === 0 ? (
                  <div className="text-sm text-gray-500">No anomalies detected.</div>
                ) : (
                  <div className="overflow-auto">
                    <table className="min-w-full text-xs">
                      <thead>
                        <tr className="text-left text-gray-500">
                          <th className="py-1 pr-3">Day</th>
                          <th className="py-1 pr-3">{insightMetricLabel}</th>
                          <th className="py-1">z</th>
                        </tr>
                      </thead>
                      <tbody className="text-gray-700">
                        {insights.anomalies.points.map((p) => (
                          <tr key={`${p.day}-${p.zScore}`} className="border-t border-amber-100/60">
                            <td className="py-1.5 pr-3">{p.day}</td>
                            <td className="py-1.5 pr-3">{p.value.toLocaleString()}</td>
                            <td className="py-1.5">{p.zScore}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="xl:col-span-2 rounded-2xl border border-amber-100 p-4 bg-white">
                <div className="flex items-center justify-between mb-2.5">
                  <div>
                    <h4 className="font-semibold text-gray-900">Cost Leakage Detection</h4>
                    <p className="text-[11px] text-gray-500">Expected vs actual charges by partner and country.</p>
                  </div>
                  <div className="text-[11px] text-gray-500">
                    {insights.metrics.expectedKey && insights.metrics.actualKey
                      ? `${insights.metrics.expectedKey} vs ${insights.metrics.actualKey}`
                      : "Needs expected + actual columns"}
                  </div>
                </div>
                {insights.leakage.items.length === 0 ? (
                  <div className="text-sm text-gray-500">
                    {insights.metrics.expectedKey && insights.metrics.actualKey
                      ? "No major leakage signals found."
                      : "Upload data with expected tariff and actual charge columns to enable this check."}
                  </div>
                ) : (
                  <div className="overflow-auto">
                    <table className="min-w-full text-xs">
                      <thead>
                        <tr className="text-left text-gray-500">
                          <th className="py-1 pr-3">Partner</th>
                          <th className="py-1 pr-3">Country</th>
                          <th className="py-1 pr-3">Expected</th>
                          <th className="py-1 pr-3">Actual</th>
                          <th className="py-1 pr-3">Diff</th>
                          <th className="py-1">% Diff</th>
                        </tr>
                      </thead>
                      <tbody className="text-gray-700">
                        {insights.leakage.items.map((item) => (
                          <tr
                            key={`${item.partner}-${item.country}`}
                            className="border-t border-amber-100/60"
                          >
                            <td className="py-1.5 pr-3">{item.partner}</td>
                            <td className="py-1.5 pr-3">{item.country}</td>
                            <td className="py-1.5 pr-3">{item.expected.toLocaleString()}</td>
                            <td className="py-1.5 pr-3">{item.actual.toLocaleString()}</td>
                            <td
                              className={`py-1.5 pr-3 font-semibold ${
                                item.diff >= 0 ? "text-red-600" : "text-emerald-600"
                              }`}
                            >
                              {item.diff.toLocaleString()}
                            </td>
                            <td className="py-1.5">
                              {item.diffPct === null ? "-" : `${item.diffPct.toLocaleString()}%`}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AiChartsPage;
