import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { TrendingUp } from "lucide-react";
import {
  Area,
  Brush,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { apiFetch } from "../utils/api";
import { useTheme } from "../theme/ThemeProvider";

type Project = { id: number; name: string };
type FileItem = { id: number; name: string };
type QaItem = { value: string; count: number | string | null; compare?: number | string | null };
type ChartPoint = { label: string; count: number; compare?: number };
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
const CHART_LIMIT_OPTIONS = [10, 20, 50, 100] as const;

const toDateLabel = (day: string) => {
  const parsed = new Date(day);
  if (Number.isNaN(parsed.getTime())) return day;
  return parsed.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

const formatMetricValue = (value: number | null | undefined) => {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-";
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 });
};

const parseFlexibleNumber = (value: unknown): number | null => {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  if (!trimmed) return null;
  const negativeByParen = /^\((.*)\)$/.test(trimmed);
  const withoutParens = negativeByParen ? trimmed.slice(1, -1) : trimmed;
  const sanitized = withoutParens.replace(/,/g, "").replace(/[^0-9.+-]/g, "");
  if (!sanitized || sanitized === "-" || sanitized === "." || sanitized === "+") return null;

  const parsed = Number(sanitized);
  if (!Number.isFinite(parsed)) return null;
  return negativeByParen ? -Math.abs(parsed) : parsed;
};

const formatDisplayValue = (value: number | null | undefined, percentMode: boolean) => {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-";
  if (percentMode) {
    return `${Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;
  }
  return formatMetricValue(value);
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
  const [chartMetricView, setChartMetricView] = useState<"absolute" | "percent">("absolute");
  const [chartSortMode, setChartSortMode] = useState<"default" | "value-desc" | "value-asc" | "label-asc">("default");
  const [chartPointLimit, setChartPointLimit] = useState<number>(20);
  const [showCountSeries, setShowCountSeries] = useState(true);
  const [showCompareSeries, setShowCompareSeries] = useState(true);
  const [focusedLabel, setFocusedLabel] = useState<string | null>(null);
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
    setShowCountSeries(true);
    setShowCompareSeries(true);
    setFocusedLabel(null);
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

  const baseChartSummary = useMemo(() => {
    const grouped = new Map<string, { label: string; count: number; compare: number; hasCompare: boolean }>();
    let droppedRows = 0;
    let validRows = 0;

    for (const item of qaItems) {
      const label = String(item.value ?? "Unknown").trim() || "Unknown";
      const count = parseFlexibleNumber(item.count);
      const compare = parseFlexibleNumber(item.compare);

      if (count === null && compare === null) {
        droppedRows += 1;
        continue;
      }

      validRows += 1;
      const current = grouped.get(label) || { label, count: 0, compare: 0, hasCompare: false };
      if (count !== null) {
        current.count += count;
      }
      if (compare !== null) {
        current.compare += compare;
        current.hasCompare = true;
      }
      grouped.set(label, current);
    }

    const points: ChartPoint[] = Array.from(grouped.values()).map((entry) => ({
      label: entry.label,
      count: entry.count,
      compare: entry.hasCompare ? entry.compare : undefined,
    }));

    return {
      points,
      droppedRows,
      mergedRows: Math.max(0, validRows - points.length),
    };
  }, [qaItems]);

  const chartData = useMemo(() => {
    let next = [...baseChartSummary.points];

    if (chartSortMode === "value-desc") {
      next.sort((a, b) => b.count - a.count);
    } else if (chartSortMode === "value-asc") {
      next.sort((a, b) => a.count - b.count);
    } else if (chartSortMode === "label-asc") {
      next.sort((a, b) => a.label.localeCompare(b.label));
    }

    if (chartPointLimit > 0) {
      next = next.slice(0, chartPointLimit);
    }

    if (chartMetricView === "percent") {
      const totalCount = next.reduce((sum, point) => sum + point.count, 0);
      const totalCompare = next.reduce(
        (sum, point) => sum + (Number.isFinite(point.compare as number) ? Number(point.compare || 0) : 0),
        0
      );
      next = next.map((point) => ({
        ...point,
        count: totalCount === 0 ? 0 : (point.count / totalCount) * 100,
        compare:
          point.compare === null || point.compare === undefined
            ? undefined
            : totalCompare === 0
              ? 0
              : (Number(point.compare || 0) / totalCompare) * 100,
      }));
    }

    return next;
  }, [baseChartSummary.points, chartSortMode, chartPointLimit, chartMetricView]);

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
              const numericValue = parseFlexibleNumber(data?.value);
              return {
                fileId: file.id,
                fileName: file.name,
                answer: data?.answer || "No answer returned.",
                items: Array.isArray(data?.items) ? data.items : [],
                columns: Array.isArray(data?.columns) ? data.columns : [],
                value: numericValue,
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
        const numericValue = parseFlexibleNumber(data?.value);
        setQaValue(numericValue);
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

  const isPercentView = chartMetricView === "percent";
  const hasChart = chartData.length > 0;
  const hasVisibleSeries = showCountSeries || (hasCompareSeries && showCompareSeries);
  const chartTotalPoints = baseChartSummary.points.length;
  const hiddenPointCount = Math.max(0, chartTotalPoints - chartData.length);

  const truncateXAxisLabel = useCallback((value: string | number) => {
    const text = String(value ?? "");
    return text.length > 16 ? `${text.slice(0, 16)}...` : text;
  }, []);

  const formatYAxisTick = useCallback(
    (value: number | string) => {
      const parsed = parseFlexibleNumber(value);
      if (parsed === null) return String(value);
      return isPercentView
        ? `${parsed.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`
        : formatMetricValue(parsed);
    },
    [isPercentView]
  );

  const focusedPoint = useMemo(() => {
    if (!focusedLabel) return null;
    return chartData.find((item) => item.label === focusedLabel) || null;
  }, [chartData, focusedLabel]);

  useEffect(() => {
    if (!focusedLabel) return;
    if (!chartData.some((item) => item.label === focusedLabel)) {
      setFocusedLabel(null);
    }
  }, [chartData, focusedLabel]);

  const chartPalette = useMemo(
    () => ({
      axis: "#9CA3AF",
      grid: theme === "dark" ? "rgba(255,255,255,0.12)" : "#F3E8D2",
      tooltipBg: theme === "dark" ? "#111827" : "#FFFFFF",
      tooltipBorder: theme === "dark" ? "#374151" : "#FDE68A",
    }),
    [theme]
  );

  const generatedChartStats = useMemo(() => {
    if (chartData.length === 0) return null;
    let total = 0;
    let peak = chartData[0];
    let low = chartData[0];
    let compareTotal = 0;
    let alignedCountTotal = 0;
    let comparePoints = 0;

    for (const point of chartData) {
      total += Number(point.count || 0);
      if (point.count > peak.count) peak = point;
      if (point.count < low.count) low = point;

      if (Number.isFinite(point.compare as number)) {
        const compareValue = Number(point.compare || 0);
        compareTotal += compareValue;
        alignedCountTotal += Number(point.count || 0);
        comparePoints += 1;
      }
    }

    return {
      total,
      average: total / chartData.length,
      peak,
      low,
      compareDelta: comparePoints > 0 ? alignedCountTotal - compareTotal : null,
      comparePoints,
    };
  }, [chartData]);

  const toggleSeries = useCallback((series: "count" | "compare") => {
    if (series === "count") {
      setShowCountSeries((prev) => !prev);
      return;
    }
    setShowCompareSeries((prev) => !prev);
  }, []);

  const handleChartPointFocus = useCallback((state: any) => {
    const label = state?.activeLabel;
    if (label === null || label === undefined) return;
    setFocusedLabel(String(label));
  }, []);

  const renderGeneratedTooltip = useCallback(
    ({ active, payload, label }: any) => {
      if (!active || !Array.isArray(payload) || payload.length === 0) return null;

      const primary = payload.find((entry: any) => entry?.dataKey === "count");
      const compare = payload.find((entry: any) => entry?.dataKey === "compare");
      const primaryValue = Number(primary?.value ?? 0);
      const compareValue = Number(compare?.value);
      const hasCompareValue = Number.isFinite(compareValue);
      const delta = hasCompareValue ? primaryValue - compareValue : null;

      return (
        <div
          className="rounded-xl border shadow-lg px-3 py-2 text-xs"
          style={{
            borderColor: chartPalette.tooltipBorder,
            background: chartPalette.tooltipBg,
            color: theme === "dark" ? "#F9FAFB" : "#111827",
          }}
        >
          <div className="font-semibold mb-1">{String(label)}</div>
          {primary && (
            <div className="flex items-center justify-between gap-4">
              <span>{primary.name || qaColumn || "Value"}</span>
              <span className="font-semibold">{formatDisplayValue(primaryValue, isPercentView)}</span>
            </div>
          )}
          {hasCompareValue && (
            <div className="flex items-center justify-between gap-4">
              <span>{compare?.name || qaCompareColumn || "Compare"}</span>
              <span className="font-semibold">{formatDisplayValue(compareValue, isPercentView)}</span>
            </div>
          )}
          {delta !== null && (
            <div className="mt-1 border-t pt-1 flex items-center justify-between gap-4" style={{ borderColor: chartPalette.grid }}>
              <span>{isPercentView ? "Difference (pp)" : "Difference"}</span>
              <span className={`font-semibold ${delta >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                {delta >= 0 ? "+" : ""}
                {formatDisplayValue(delta, isPercentView)}
              </span>
            </div>
          )}
        </div>
      );
    },
    [chartPalette.grid, chartPalette.tooltipBg, chartPalette.tooltipBorder, isPercentView, qaColumn, qaCompareColumn, theme]
  );

  const generatedLegendFormatter = useCallback(
    (value: string, entry: any) => {
      const seriesKey = entry?.dataKey;
      const active = seriesKey === "count" ? showCountSeries : showCompareSeries;
      return (
        <span className={active ? "text-gray-700 dark:text-gray-200" : "text-gray-400 line-through"}>
          {value}
        </span>
      );
    },
    [showCompareSeries, showCountSeries]
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

          <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
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
          <div className="bg-white dark:bg-gray-900/70 border dark:border-white/10 rounded-2xl p-5 shadow-sm">
            <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between mb-4">
              <div>
                <h3 className="font-semibold text-gray-900 dark:text-gray-100">Generated Chart</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Click a point to focus. Drag the bottom range selector to zoom.
                </p>
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400">
                Showing {chartData.length}/{chartTotalPoints} points
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
              <div className="rounded-xl border border-gray-200 bg-white px-3 py-2">
                <div className="text-[11px] text-gray-500 mb-1">Metric View</div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setChartMetricView("absolute")}
                    className={`flex-1 rounded-lg border px-2 py-1.5 text-xs font-semibold ${
                      chartMetricView === "absolute"
                        ? "border-amber-400 bg-amber-50 text-amber-800"
                        : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    Absolute
                  </button>
                  <button
                    type="button"
                    onClick={() => setChartMetricView("percent")}
                    className={`flex-1 rounded-lg border px-2 py-1.5 text-xs font-semibold ${
                      chartMetricView === "percent"
                        ? "border-amber-400 bg-amber-50 text-amber-800"
                        : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    Share %
                  </button>
                </div>
              </div>
              <div className="rounded-xl border border-gray-200 bg-white px-3 py-2">
                <div className="text-[11px] text-gray-500 mb-1">Sort</div>
                <select
                  className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs text-gray-700"
                  value={chartSortMode}
                  onChange={(e) =>
                    setChartSortMode(
                      e.target.value as "default" | "value-desc" | "value-asc" | "label-asc"
                    )
                  }
                >
                  <option value="default">Default order</option>
                  <option value="value-desc">Highest value first</option>
                  <option value="value-asc">Lowest value first</option>
                  <option value="label-asc">A to Z</option>
                </select>
              </div>
              <div className="rounded-xl border border-gray-200 bg-white px-3 py-2">
                <div className="text-[11px] text-gray-500 mb-1">Point Limit</div>
                <select
                  className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs text-gray-700"
                  value={chartPointLimit}
                  onChange={(e) => setChartPointLimit(Number(e.target.value))}
                >
                  <option value={0}>All points</option>
                  {CHART_LIMIT_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      Top {option}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {(baseChartSummary.mergedRows > 0 || baseChartSummary.droppedRows > 0 || hiddenPointCount > 0) && (
              <div className="mb-4 text-xs text-gray-600 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                {baseChartSummary.mergedRows > 0
                  ? `Merged ${baseChartSummary.mergedRows} duplicate category rows for accuracy. `
                  : ""}
                {baseChartSummary.droppedRows > 0
                  ? `Ignored ${baseChartSummary.droppedRows} rows with non-numeric values. `
                  : ""}
                {hiddenPointCount > 0
                  ? `Hidden ${hiddenPointCount} points due to current limit.`
                  : ""}
              </div>
            )}

            {generatedChartStats && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                <div className="rounded-xl border border-amber-100 bg-amber-50/50 px-3 py-2">
                  <div className="text-[11px] text-amber-700">Total</div>
                  <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                    {formatDisplayValue(generatedChartStats.total, isPercentView)}
                  </div>
                </div>
                <div className="rounded-xl border border-amber-100 bg-amber-50/50 px-3 py-2">
                  <div className="text-[11px] text-amber-700">Average</div>
                  <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                    {formatDisplayValue(generatedChartStats.average, isPercentView)}
                  </div>
                </div>
                <div className="rounded-xl border border-amber-100 bg-amber-50/50 px-3 py-2">
                  <div className="text-[11px] text-amber-700">Peak</div>
                  <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                    {generatedChartStats.peak.label}
                  </div>
                  <div className="text-[11px] text-gray-500">
                    {formatDisplayValue(generatedChartStats.peak.count, isPercentView)}
                  </div>
                </div>
                <div className="rounded-xl border border-amber-100 bg-amber-50/50 px-3 py-2">
                  <div className="text-[11px] text-amber-700">
                    {hasCompareSeries ? (isPercentView ? "Delta vs Compare (pp)" : "Delta vs Compare") : "Lowest"}
                  </div>
                  {hasCompareSeries ? (
                    <div
                      className={`text-sm font-semibold ${
                        (generatedChartStats.compareDelta || 0) >= 0 ? "text-emerald-600" : "text-rose-600"
                      }`}
                    >
                      {(generatedChartStats.compareDelta || 0) >= 0 ? "+" : ""}
                      {formatDisplayValue(generatedChartStats.compareDelta, isPercentView)}
                    </div>
                  ) : (
                    <>
                      <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                        {generatedChartStats.low.label}
                      </div>
                      <div className="text-[11px] text-gray-500">
                        {formatDisplayValue(generatedChartStats.low.count, isPercentView)}
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2 mb-3">
              <button
                type="button"
                onClick={() => toggleSeries("count")}
                className={`px-3 py-1.5 rounded-full border text-xs font-semibold transition ${
                  showCountSeries
                    ? "border-amber-300 bg-amber-50 text-amber-800"
                    : "border-gray-200 bg-white text-gray-500"
                }`}
              >
                {showCountSeries ? "Hide" : "Show"} {qaColumn || "Value"}
              </button>
              {hasCompareSeries && (
                <button
                  type="button"
                  onClick={() => toggleSeries("compare")}
                  className={`px-3 py-1.5 rounded-full border text-xs font-semibold transition ${
                    showCompareSeries
                      ? "border-blue-300 bg-blue-50 text-blue-700"
                      : "border-gray-200 bg-white text-gray-500"
                  }`}
                >
                  {showCompareSeries ? "Hide" : "Show"} {qaCompareColumn || "Compare"}
                </button>
              )}
              {focusedPoint && (
                <button
                  type="button"
                  onClick={() => setFocusedLabel(null)}
                  className="px-3 py-1.5 rounded-full border border-gray-200 text-xs font-semibold text-gray-600 hover:bg-gray-50"
                >
                  Clear Focus
                </button>
              )}
              {focusedPoint && (
                <div className="text-xs text-gray-600 dark:text-gray-300 ml-auto">
                  Focused: <span className="font-semibold">{focusedPoint.label}</span> |{" "}
                  {qaColumn || "Value"}: {formatDisplayValue(focusedPoint.count, isPercentView)}
                  {Number.isFinite(focusedPoint.compare as number)
                    ? ` | ${qaCompareColumn || "Compare"}: ${formatDisplayValue(Number(focusedPoint.compare || 0), isPercentView)}`
                    : ""}
                </div>
              )}
            </div>

            {!hasVisibleSeries && (
              <div className="mb-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                Enable at least one series to see the chart.
              </div>
            )}

            <div className="h-[23rem] rounded-2xl border border-amber-100 bg-gradient-to-b from-white to-amber-50/40 p-3">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} onClick={handleChartPointFocus}>
                  <defs>
                    <linearGradient id="aiStudioCountArea" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#F59E0B" stopOpacity={0.32} />
                      <stop offset="100%" stopColor="#F59E0B" stopOpacity={0.03} />
                    </linearGradient>
                    <linearGradient id="aiStudioCompareArea" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#3B82F6" stopOpacity={0.28} />
                      <stop offset="100%" stopColor="#3B82F6" stopOpacity={0.02} />
                    </linearGradient>
                    <linearGradient id="aiStudioCountStroke" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0%" stopColor="#B45309" />
                      <stop offset="100%" stopColor="#F59E0B" />
                    </linearGradient>
                    <linearGradient id="aiStudioCompareStroke" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0%" stopColor="#1D4ED8" />
                      <stop offset="100%" stopColor="#60A5FA" />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={chartPalette.grid} />
                  <XAxis
                    dataKey="label"
                    stroke={chartPalette.axis}
                    tickLine={false}
                    axisLine={false}
                    fontSize={12}
                    tickFormatter={truncateXAxisLabel}
                    interval={chartData.length > 10 ? "preserveStartEnd" : 0}
                  />
                  <YAxis
                    stroke={chartPalette.axis}
                    tickLine={false}
                    axisLine={false}
                    fontSize={12}
                    width={56}
                    allowDecimals={isPercentView}
                    tickFormatter={formatYAxisTick}
                  />
                  <Tooltip
                    content={renderGeneratedTooltip}
                    cursor={{ stroke: theme === "dark" ? "#FCD34D" : "#F59E0B", strokeDasharray: "4 4" }}
                  />
                  {hasCompareSeries && (
                    <Legend
                      formatter={generatedLegendFormatter}
                      wrapperStyle={{ fontSize: 12, cursor: "pointer" }}
                      align="right"
                      verticalAlign="top"
                      height={32}
                      onClick={(entry) => {
                        if ((entry as any)?.dataKey === "count") toggleSeries("count");
                        if ((entry as any)?.dataKey === "compare") toggleSeries("compare");
                      }}
                    />
                  )}
                  {focusedLabel && (
                    <ReferenceLine x={focusedLabel} stroke={theme === "dark" ? "#FCD34D" : "#D97706"} strokeDasharray="4 4" />
                  )}
                  {showCountSeries && generatedChartStats && (
                    <ReferenceLine
                      y={generatedChartStats.average}
                      stroke={theme === "dark" ? "#FCD34D" : "#B45309"}
                      strokeDasharray="3 3"
                    />
                  )}
                  {showCountSeries && (
                    <>
                      <Area
                        type="monotone"
                        dataKey="count"
                        fill="url(#aiStudioCountArea)"
                        stroke="none"
                        isAnimationActive
                        animationDuration={500}
                      />
                      <Line
                        type="monotone"
                        dataKey="count"
                        name={qaColumn || "Value"}
                        stroke="url(#aiStudioCountStroke)"
                        strokeWidth={3.5}
                        dot={chartData.length <= 16 ? { r: 3.5, strokeWidth: 1, fill: "#fff" } : false}
                        activeDot={{ r: 6, strokeWidth: 2, fill: "#fff" }}
                        connectNulls
                        animationDuration={500}
                      />
                    </>
                  )}
                  {hasCompareSeries && showCompareSeries && (
                    <>
                      <Area
                        type="monotone"
                        dataKey="compare"
                        fill="url(#aiStudioCompareArea)"
                        stroke="none"
                        isAnimationActive
                        animationDuration={500}
                      />
                      <Line
                        type="monotone"
                        dataKey="compare"
                        name={qaCompareColumn || "Compare"}
                        stroke="url(#aiStudioCompareStroke)"
                        strokeWidth={3}
                        strokeDasharray="6 4"
                        dot={chartData.length <= 16 ? { r: 3, strokeWidth: 1, fill: "#fff" } : false}
                        activeDot={{ r: 6, strokeWidth: 2, fill: "#fff" }}
                        connectNulls
                        animationDuration={500}
                      />
                    </>
                  )}
                  {chartData.length > 8 && (
                    <Brush
                      dataKey="label"
                      height={24}
                      stroke={theme === "dark" ? "#FCD34D" : "#D97706"}
                      fill={theme === "dark" ? "#1F2937" : "#FFF7ED"}
                      tickFormatter={truncateXAxisLabel}
                      travellerWidth={10}
                    />
                  )}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-3 text-[11px] text-gray-500 dark:text-gray-400">
              Tip: click chart points, hide/show series, and drag the bottom selector to inspect dense areas.
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
