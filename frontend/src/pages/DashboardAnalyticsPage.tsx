import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Database,
  FolderOpen,
  TrendingUp,
  PieChart as PieChartIcon,
  Filter,
  Download,
  Sparkles,
  BarChart2,
  FileText,
  Calendar,
} from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import { apiFetch } from "../utils/api";
import { useTheme } from "../theme/ThemeProvider";
import * as htmlToImage from "html-to-image";

type AnalyticsSeries = { name: string; value: number };

type DashboardAnalytics = {
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
  uploadTrend: Array<{ day: string; files: number }>;
  projectComparison: Array<{ id: number; name: string; fileCount: number; rowCount: number }>;
  rowTrend: Array<{ day: string; rows: number }>;
  partnerShare: AnalyticsSeries[];
  countryShare: AnalyticsSeries[];
  partnerDrilldown: Record<string, AnalyticsSeries[]>;
};

type AnalyticsFilterState = {
  startDate: string;
  endDate: string;
  partner: string;
  country: string;
};

type ExportFormat = "excel" | "pdf" | "png" | "json" | "xml";

type Project = { id: number; name: string };

type NotificationItem = {
  id: number;
  type: string;
  message: string;
  channel: string;
  read_at: string | null;
  created_at: string;
};

const ACCENT = "#F59E0B";
const ACCENT_SOFT = "#FCD34D";
const PIE_COLORS = [
  "#F59E0B",
  "#F97316",
  "#FB923C",
  "#FBBF24",
  "#FCD34D",
  "#FDBA74",
  "#FFEDD5",
  "#FED7AA",
];

const formatNumber = (value: number) => new Intl.NumberFormat().format(value);
const formatCompact = (value: number) =>
  new Intl.NumberFormat(undefined, { notation: "compact" }).format(value);
const AUTO_REFRESH_MS = 60000;

const toDateLabel = (day: string) => {
  const parsed = new Date(day);
  if (Number.isNaN(parsed.getTime())) return day;
  return parsed.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

const buildAnalyticsParams = (filters: AnalyticsFilterState) => {
  const params = new URLSearchParams();
  if (filters.startDate) params.set("startDate", filters.startDate);
  if (filters.endDate) params.set("endDate", filters.endDate);
  if (filters.partner.trim()) params.set("partner", filters.partner.trim());
  if (filters.country.trim()) params.set("country", filters.country.trim());
  return params;
};

const DashboardAnalyticsPage: React.FC = () => {
  const { theme } = useTheme();
  const [analyticsLoading, setAnalyticsLoading] = useState(true);
  const [analyticsError, setAnalyticsError] = useState<string | null>(null);
  const [analytics, setAnalytics] = useState<DashboardAnalytics | null>(null);
  const [, setAnalyticsLastUpdated] = useState<Date | null>(null);
  const [, setOpsLastUpdated] = useState<Date | null>(null);
  const [filterInputs, setFilterInputs] = useState<AnalyticsFilterState>({
    startDate: "",
    endDate: "",
    partner: "",
    country: "",
  });
  const [appliedFilters, setAppliedFilters] = useState<AnalyticsFilterState>(filterInputs);
  const [selectedPartner, setSelectedPartner] = useState<string | null>(null);
  const [exportingFormat, setExportingFormat] = useState<string | null>(null);
  const chartRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [refreshTick, setRefreshTick] = useState(0);
  const filterDebounceRef = useRef<number | null>(null);

  const [opsLoading, setOpsLoading] = useState(true);
  const [filesCount, setFilesCount] = useState(0);
  const [reportsCount, setReportsCount] = useState(0);
  const [schedulesCount, setSchedulesCount] = useState(0);
  const [, setUnreadCount] = useState(0);
  const [, setDeliveries] = useState<NotificationItem[]>([]);
  const [, setAvgQualityScore] = useState<number | null>(null);

  useEffect(() => {
    let mounted = true;
    const run = async () => {
      try {
        setAnalyticsLoading(true);
        setAnalyticsError(null);
        const params = buildAnalyticsParams(appliedFilters);
        const res = await apiFetch(`/api/dashboard/analytics?${params.toString()}`);
        if (!res.ok) {
          const message = await res.text();
          throw new Error(message || "Failed to load analytics");
        }
        const json = (await res.json()) as DashboardAnalytics;
        if (!mounted) return;
        setAnalytics(json);
        setAnalyticsLastUpdated(new Date());
        if (json.filters.partner) {
          setSelectedPartner(json.filters.partner);
        } else if (appliedFilters.partner) {
          setSelectedPartner(appliedFilters.partner);
        } else {
          setSelectedPartner(null);
        }
      } catch (err: any) {
        if (mounted) setAnalyticsError(err.message || "Failed to load analytics.");
      } finally {
        if (mounted) setAnalyticsLoading(false);
      }
    };

    run();
    return () => {
      mounted = false;
    };
  }, [appliedFilters, refreshTick]);

  useEffect(() => {
    const id = window.setInterval(() => setRefreshTick((prev) => prev + 1), AUTO_REFRESH_MS);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (filterDebounceRef.current) window.clearTimeout(filterDebounceRef.current);
    filterDebounceRef.current = window.setTimeout(() => {
      setAppliedFilters(filterInputs);
    }, 500);
    return () => {
      if (filterDebounceRef.current) window.clearTimeout(filterDebounceRef.current);
    };
  }, [filterInputs]);

  useEffect(() => {
    let mounted = true;

    const loadOps = async () => {
      try {
        setOpsLoading(true);
        const storedUser = localStorage.getItem("authUser");
        const userId = storedUser ? JSON.parse(storedUser).id : 1;

        const projectsRes = await apiFetch(`/api/projects?user_id=${userId}`);
        const projectsData = (await projectsRes.json()) || [];
        if (!mounted) return;
        const safeProjects = Array.isArray(projectsData) ? projectsData : [];

        const filePromises = (safeProjects || []).map((p: Project) =>
          apiFetch(`/api/files?projectId=${p.id}`)
            .then((r) => r.json())
            .then((d) => ({
              id: p.id,
              count: (d.files || []).length,
              qualityScores: (d.files || [])
                .map((f: any) => (typeof f.qualityScore === "number" ? f.qualityScore : null))
                .filter((v: number | null) => v !== null),
            }))
            .catch(() => ({ id: p.id, count: 0, qualityScores: [] }))
        );
        const counts = await Promise.all(filePromises);
        if (!mounted) return;
        setFilesCount(counts.reduce((sum, c) => sum + c.count, 0));
        const allScores = counts.flatMap((c) => c.qualityScores || []);
        if (allScores.length) {
          const avg = allScores.reduce((sum, v) => sum + v, 0) / allScores.length;
          setAvgQualityScore(Math.round(avg * 10) / 10);
        } else {
          setAvgQualityScore(null);
        }

        const reportsRes = await apiFetch("/api/reports");
        const reportsData = await reportsRes.json();
        if (mounted) setReportsCount(Array.isArray(reportsData) ? reportsData.length : 0);

        const schedulesRes = await apiFetch("/api/schedules");
        const schedulesData = await schedulesRes.json();
        if (mounted) setSchedulesCount(Array.isArray(schedulesData) ? schedulesData.length : 0);

        const notificationsRes = await apiFetch("/api/notifications");
        const notificationsData = await notificationsRes.json();
        const list = Array.isArray(notificationsData) ? notificationsData : [];
        if (mounted) {
          setUnreadCount(list.filter((n: NotificationItem) => !n.read_at).length);
          setDeliveries(list.filter((n: NotificationItem) => n.type?.startsWith("schedule_")).slice(0, 5));
        }

        if (mounted) setOpsLastUpdated(new Date());
      } finally {
        if (mounted) setOpsLoading(false);
      }
    };

    loadOps();
    const id = window.setInterval(loadOps, AUTO_REFRESH_MS);
    return () => {
      mounted = false;
      window.clearInterval(id);
    };
  }, []);

  const chartPalette = useMemo(
    () => ({
      axis: "#9CA3AF",
      grid: theme === "dark" ? "rgba(255,255,255,0.12)" : "#F3E8D2",
      tooltipBg: theme === "dark" ? "#111827" : "#FFFFFF",
      tooltipBorder: theme === "dark" ? "#374151" : "#FDE68A",
    }),
    [theme]
  );

  const summary = useMemo(() => {
    const countries = analytics?.countryShare.length ?? 0;
    const uploadsTotal = (analytics?.uploadTrend ?? []).reduce((sum, d) => sum + d.files, 0);
    return { countries, uploadsTotal };
  }, [analytics]);

  const activeFilterChips = useMemo(() => {
    const chips: Array<{ label: string; value: string }> = [];
    if (appliedFilters.startDate) chips.push({ label: "Start", value: appliedFilters.startDate });
    if (appliedFilters.endDate) chips.push({ label: "End", value: appliedFilters.endDate });
    if (appliedFilters.partner.trim()) chips.push({ label: "Partner", value: appliedFilters.partner.trim() });
    if (appliedFilters.country.trim()) chips.push({ label: "Country", value: appliedFilters.country.trim() });
    return chips;
  }, [appliedFilters]);

  const rowTrendSeries = useMemo(
    () =>
      (analytics?.rowTrend || []).map((d) => ({
        ...d,
        label: toDateLabel(d.day),
      })),
    [analytics]
  );

  const uploadTrendSeries = useMemo(
    () =>
      (analytics?.uploadTrend || []).map((d) => ({
        ...d,
        label: toDateLabel(d.day),
      })),
    [analytics]
  );

  const drilldownPartner = selectedPartner || appliedFilters.partner.trim() || "";
  const drilldownSeries = useMemo(() => {
    if (!analytics) return [] as AnalyticsSeries[];
    if (drilldownPartner && analytics.partnerDrilldown[drilldownPartner]) {
      return analytics.partnerDrilldown[drilldownPartner];
    }
    return analytics.countryShare || [];
  }, [analytics, drilldownPartner]);

  const onApplyFilters = (e: React.FormEvent) => {
    e.preventDefault();
    setAppliedFilters(filterInputs);
  };

  const onClearFilters = () => {
    const empty: AnalyticsFilterState = { startDate: "", endDate: "", partner: "", country: "" };
    setFilterInputs(empty);
    setAppliedFilters(empty);
    setSelectedPartner(null);
  };

  const onPartnerDrilldown = (partnerName: string) => {
    const nextInputs = { ...filterInputs, partner: partnerName };
    setFilterInputs(nextInputs);
    setAppliedFilters(nextInputs);
    setSelectedPartner(partnerName);
  };

  const setChartRef = (id: string) => (el: HTMLDivElement | null) => {
    chartRefs.current[id] = el;
  };

  const buildDashboardExportRows = (data: DashboardAnalytics | null) => {
    if (!data) return [] as Array<Record<string, any>>;
    const rows: Array<Record<string, any>> = [];

    data.rowTrend.forEach((d) =>
      rows.push({ dataset: "rowTrend", day: d.day, label: toDateLabel(d.day), value: d.rows })
    );
    data.uploadTrend.forEach((d) =>
      rows.push({ dataset: "uploadTrend", day: d.day, label: toDateLabel(d.day), value: d.files })
    );
    data.partnerShare.forEach((d) =>
      rows.push({ dataset: "partnerShare", label: d.name, value: d.value, partner: d.name })
    );
    data.countryShare.forEach((d) =>
      rows.push({ dataset: "countryShare", label: d.name, value: d.value, country: d.name })
    );
    data.projectComparison.forEach((d) =>
      rows.push({
        dataset: "projectComparison",
        label: d.name,
        projectId: d.id,
        rowCount: d.rowCount,
        fileCount: d.fileCount,
      })
    );

    const drilldownKey = drilldownPartner ? `partnerDrilldown:${drilldownPartner}` : "countryDrilldown";
    drilldownSeries.forEach((d) =>
      rows.push({
        dataset: drilldownKey,
        label: d.name,
        value: d.value,
        partner: drilldownPartner || "",
        country: d.name,
      })
    );

    return rows;
  };

  const chartConfig = useMemo(
    () => [
      { id: "rowTrend", title: "Roaming Trend (Rows)", type: "line", dataset: "rowTrend" },
      { id: "partnerShare", title: "Partner Share", type: "pie", dataset: "partnerShare" },
      { id: "uploadTrend", title: "Upload Trend", type: "line", dataset: "uploadTrend" },
      { id: "projectComparison", title: "Project Performance", type: "bar", dataset: "projectComparison" },
      {
        id: "countryDrilldown",
        title: drilldownPartner ? `Country Drill-down (${drilldownPartner})` : "Country Share",
        type: "bar",
        dataset: drilldownPartner ? `partnerDrilldown:${drilldownPartner}` : "countryShare",
      },
    ],
    [drilldownPartner]
  );

  const captureChartImages = async () => {
    const images: Array<{ id: string; title: string; dataUrl: string }> = [];
    for (const chart of chartConfig) {
      const node = chartRefs.current[chart.id];
      if (!node) continue;
      try {
        const dataUrl = await htmlToImage.toPng(node, { cacheBust: true, pixelRatio: 2 });
        images.push({ id: chart.id, title: chart.title, dataUrl });
      } catch {
        // Skip charts that fail to render to PNG.
      }
    }
    return images;
  };

  const parseFileName = (contentDisposition: string | null, fallback: string) => {
    if (!contentDisposition) return fallback;
    const match = /filename="?([^";]+)"?/i.exec(contentDisposition);
    return match?.[1] || fallback;
  };

  const handleExport = async (format: ExportFormat) => {
    if (!analytics) return;
    try {
      setExportingFormat(format);
      const dataRows = buildDashboardExportRows(analytics);
      const selectedColumns = [
        "dataset",
        "day",
        "label",
        "value",
        "rowCount",
        "fileCount",
        "partner",
        "country",
        "projectId",
      ];

      const chartImages =
        format === "json" || format === "xml" || format === "excel" ? [] : await captureChartImages();

      const res = await apiFetch("/api/export/data", {
        method: "POST",
        body: JSON.stringify({
          format,
          scope: "dashboard",
          title: "Roaming_Visualization_Dashboard",
          filters: appliedFilters,
          selectedColumns,
          chartConfig: { charts: chartConfig },
          chartImages,
          dataRows,
          rowLimit: 20000,
        }),
      });

      if (!res.ok) {
        const message = await res.text();
        throw new Error(message || "Export failed");
      }

      const blob = await res.blob();
      const contentDisposition = res.headers.get("content-disposition");
      const fallbackName = `roaming_dashboard.${format === "excel" ? "xlsx" : format}`;
      const fileName = parseFileName(contentDisposition, fallbackName);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      // eslint-disable-next-line no-alert
      alert(err.message || "Export failed.");
    } finally {
      setExportingFormat(null);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 via-white to-orange-50 dark:from-gray-950 dark:via-gray-950 dark:to-gray-900 p-4 md:p-5">
      <div className="max-w-7xl mx-auto space-y-4 md:space-y-5">
        <section className="relative overflow-hidden rounded-[28px] border border-amber-100 bg-white/80 p-6 shadow-sm backdrop-blur dark:bg-white/5 dark:border-white/10">
          <div className="absolute -top-16 -right-16 h-56 w-56 rounded-full bg-amber-200/40 blur-3xl dark:bg-amber-500/10" />
          <div className="absolute -bottom-20 -left-20 h-64 w-64 rounded-full bg-orange-200/40 blur-3xl dark:bg-orange-500/10" />
          <div className="relative flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-white/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.3em] text-amber-600 shadow-sm dark:border-amber-400/20 dark:bg-white/5 dark:text-amber-300">
                <Sparkles className="h-3.5 w-3.5" />
                Unified Dashboard
              </div>
              <h2 className="text-3xl md:text-[32px] font-bold text-gray-900 mt-3 dark:text-gray-100">
                Roaming analytics studio
              </h2>
              <p className="text-sm text-gray-500 mt-2 max-w-2xl dark:text-gray-400">
                Track uploads, partner performance, and roaming volume in a single, focused command center.
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
                <span className="inline-flex items-center gap-2 rounded-full border border-amber-100 bg-amber-50 px-3 py-1 dark:border-white/10 dark:bg-white/5">
                  <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                  Live overview
                </span>
                {analytics && (
                  <span>
                    Rows matched: {formatNumber(analytics.totals.rowsMatched)} / {formatNumber(analytics.totals.rowsScanned)}
                  </span>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 min-w-[240px]">
              <div className="rounded-2xl border border-amber-100 bg-white/70 p-3 text-xs text-gray-500 shadow-sm dark:border-white/10 dark:bg-white/5 dark:text-gray-400">
                <div className="text-[10px] uppercase tracking-[0.2em] text-amber-500">Uploads</div>
                <div className="text-2xl font-bold text-gray-900 mt-1 dark:text-gray-100">
                  {formatCompact(summary.uploadsTotal)}
                </div>
                <div className="text-[11px]">Files processed</div>
              </div>
              <div className="rounded-2xl border border-amber-100 bg-white/70 p-3 text-xs text-gray-500 shadow-sm dark:border-white/10 dark:bg-white/5 dark:text-gray-400">
                <div className="text-[10px] uppercase tracking-[0.2em] text-amber-500">Coverage</div>
                <div className="text-2xl font-bold text-gray-900 mt-1 dark:text-gray-100">
                  {formatNumber(summary.countries)}
                </div>
                <div className="text-[11px]">Countries active</div>
              </div>
            </div>
          </div>
        </section>

        <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {[
            {
              label: "Files Uploaded",
              value: formatNumber(filesCount),
              hint: "Across all projects",
              icon: <Database className="w-5 h-5" color={ACCENT} />,
            },
            {
              label: "Charts Created",
              value: formatNumber(Math.max(0, reportsCount + 2)),
              hint: "Visual insights generated",
              icon: <BarChart2 className="w-5 h-5" color={ACCENT} />,
            },
            {
              label: "Reports",
              value: formatNumber(reportsCount),
              hint: "Saved to library",
              icon: <FileText className="w-5 h-5" color={ACCENT} />,
            },
            {
              label: "Active Schedules",
              value: formatNumber(schedulesCount),
              hint: "Automation running",
              icon: <Calendar className="w-5 h-5" color={ACCENT} />,
            },
          ].map((card) => (
            <div
              key={card.label}
              className="rounded-[22px] border border-amber-200/60 bg-white p-5 shadow-[0_12px_30px_rgba(245,158,11,0.06)] transition-transform duration-300 hover:-translate-y-1 dark:border-white/10 dark:bg-white/5"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.28em] text-gray-400">{card.label}</p>
                  <p className="mt-3 text-2xl font-bold text-gray-900 dark:text-gray-100">
                    {opsLoading ? "..." : card.value}
                  </p>
                  <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">{card.hint}</p>
                </div>
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-amber-50 shadow-inner shadow-amber-100/70 dark:bg-white/10">
                  {card.icon}
                </div>
              </div>
            </div>
          ))}
        </section>

        <section className="bg-white/90 border border-amber-100 rounded-2xl p-4 shadow-sm backdrop-blur dark:bg-white/5 dark:border-white/10">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 mb-4">
            <div className="flex items-center gap-2">
              <Filter className="w-5 h-5 text-amber-700 dark:text-amber-300" />
              <div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Filters & Exports</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Scope the data and export with applied filters.
                </p>
              </div>
            </div>
            {analytics && (
              <div className="flex flex-wrap gap-2">
                {([
                  { key: "excel", label: "Excel" },
                  { key: "pdf", label: "PDF" },
                  { key: "png", label: "PNG" },
                  { key: "json", label: "JSON" },
                  { key: "xml", label: "XML" },
                ] as Array<{ key: ExportFormat; label: string }>).map((fmt) => (
                  <button
                    key={fmt.key}
                    type="button"
                    onClick={() => handleExport(fmt.key)}
                    disabled={Boolean(exportingFormat)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-amber-200 text-amber-700 text-xs font-semibold hover:bg-amber-50 disabled:opacity-60 disabled:cursor-not-allowed dark:border-amber-400/20 dark:text-amber-300 dark:hover:bg-amber-500/10"
                    title={`Export as ${fmt.label}`}
                  >
                    <Download className="w-3.5 h-3.5" />
                    {exportingFormat === fmt.key ? "Exporting..." : fmt.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <form onSubmit={onApplyFilters} className="grid grid-cols-1 md:grid-cols-5 gap-3 mb-4">
            <input
              type="date"
              value={filterInputs.startDate}
              onChange={(e) => setFilterInputs((prev) => ({ ...prev, startDate: e.target.value }))}
              className="px-3 py-2.5 rounded-xl border border-amber-100 bg-white text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-amber-300 dark:border-white/10 dark:bg-white/5 dark:text-gray-100"
              placeholder="Start date"
            />
            <input
              type="date"
              value={filterInputs.endDate}
              onChange={(e) => setFilterInputs((prev) => ({ ...prev, endDate: e.target.value }))}
              className="px-3 py-2.5 rounded-xl border border-amber-100 bg-white text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-amber-300 dark:border-white/10 dark:bg-white/5 dark:text-gray-100"
              placeholder="End date"
            />
            <input
              value={filterInputs.partner}
              onChange={(e) => setFilterInputs((prev) => ({ ...prev, partner: e.target.value }))}
              className="px-3 py-2.5 rounded-xl border border-amber-100 bg-white text-sm text-gray-700 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-amber-300 dark:border-white/10 dark:bg-white/5 dark:text-gray-100"
              placeholder="Partner"
            />
            <input
              value={filterInputs.country}
              onChange={(e) => setFilterInputs((prev) => ({ ...prev, country: e.target.value }))}
              className="px-3 py-2.5 rounded-xl border border-amber-100 bg-white text-sm text-gray-700 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-amber-300 dark:border-white/10 dark:bg-white/5 dark:text-gray-100"
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
                onClick={onClearFilters}
                className="px-4 py-2.5 rounded-xl border border-amber-200 text-amber-700 font-semibold hover:bg-amber-50 dark:border-amber-400/20 dark:text-amber-300 dark:hover:bg-amber-500/10"
              >
                Clear
              </button>
            </div>
          </form>

          <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500 dark:text-gray-400 mb-4">
            <span className="uppercase tracking-[0.2em] text-[10px] font-semibold text-amber-500">Active filters</span>
            {activeFilterChips.length === 0 ? (
              <span className="text-gray-400 dark:text-gray-500">None</span>
            ) : (
              activeFilterChips.map((chip) => (
                <span
                  key={`${chip.label}-${chip.value}`}
                  className="inline-flex items-center gap-2 rounded-full border border-amber-100 bg-amber-50 px-3 py-1 text-[11px] text-amber-700 dark:border-white/10 dark:bg-white/5 dark:text-amber-300"
                >
                  {chip.label}: {chip.value}
                </span>
              ))
            )}
          </div>

          {analyticsError && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-4 dark:bg-red-500/10 dark:border-red-500/20 dark:text-red-300">
              {analyticsError}
            </div>
          )}

          {analyticsLoading && !analytics ? (
            <div className="text-sm text-gray-500 dark:text-gray-400">Loading analytics...</div>
          ) : !analytics ? (
            <div className="text-sm text-gray-500 dark:text-gray-400">No analytics data yet.</div>
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
              <div className="xl:col-span-2 rounded-2xl border border-amber-100 p-4 bg-amber-50/40 dark:bg-white/5 dark:border-white/10">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h4 className="font-semibold text-gray-900 dark:text-gray-100">Roaming Trend (Rows)</h4>
                    <p className="text-xs text-gray-500 dark:text-gray-400">Line chart with date drill-down</p>
                  </div>
                  <TrendingUp className="w-5 h-5 text-amber-700 dark:text-amber-300" />
                </div>
                <div className="h-64" ref={setChartRef("rowTrend")}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={rowTrendSeries}>
                      <CartesianGrid strokeDasharray="3 3" stroke={chartPalette.grid} />
                      <XAxis dataKey="label" stroke={chartPalette.axis} fontSize={12} tickLine={false} axisLine={false} />
                      <YAxis stroke={chartPalette.axis} fontSize={12} allowDecimals={false} tickLine={false} axisLine={false} width={36} />
                      <Tooltip
                        contentStyle={{
                          borderRadius: 12,
                          borderColor: chartPalette.tooltipBorder,
                          background: chartPalette.tooltipBg,
                          color: theme === "dark" ? "#F9FAFB" : "#111827",
                        }}
                        formatter={(value: any) => [value, "Rows"]}
                        labelFormatter={(label: any) => `Date: ${label}`}
                      />
                      <Line type="monotone" dataKey="rows" stroke={ACCENT} strokeWidth={3} dot={{ r: 2 }} activeDot={{ r: 5 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="rounded-2xl border border-amber-100 p-4 bg-white dark:bg-white/5 dark:border-white/10">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h4 className="font-semibold text-gray-900 dark:text-gray-100">Partner Share</h4>
                    <p className="text-xs text-gray-500 dark:text-gray-400">Pie chart with partner drill-down</p>
                  </div>
                  <PieChartIcon className="w-5 h-5 text-amber-700 dark:text-amber-300" />
                </div>
                {analytics.partnerShare.length === 0 ? (
                  <div className="text-sm text-gray-500 dark:text-gray-400">No partner data yet.</div>
                ) : (
                  <div className="h-64" ref={setChartRef("partnerShare")}>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={analytics.partnerShare}
                          dataKey="value"
                          nameKey="name"
                          innerRadius={55}
                          outerRadius={90}
                          paddingAngle={2}
                          onClick={(entry: any) => entry?.name && onPartnerDrilldown(entry.name)}
                        >
                          {analytics.partnerShare.map((entry, index) => (
                            <Cell key={entry.name} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip
                          contentStyle={{
                            borderRadius: 12,
                            borderColor: chartPalette.tooltipBorder,
                            background: chartPalette.tooltipBg,
                            color: theme === "dark" ? "#F9FAFB" : "#111827",
                          }}
                        />
                        <Legend />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                )}
                {drilldownPartner && (
                  <div className="text-xs text-amber-700 dark:text-amber-300 mt-2">
                    Drill-down partner: {drilldownPartner}
                  </div>
                )}
              </div>

              <div className="rounded-2xl border border-amber-100 p-4 bg-white dark:bg-white/5 dark:border-white/10">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h4 className="font-semibold text-gray-900 dark:text-gray-100">Upload Trend</h4>
                    <p className="text-xs text-gray-500 dark:text-gray-400">Files uploaded over time</p>
                  </div>
                  <Database className="w-5 h-5 text-amber-700 dark:text-amber-300" />
                </div>
                <div className="h-56" ref={setChartRef("uploadTrend")}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={uploadTrendSeries}>
                      <CartesianGrid strokeDasharray="3 3" stroke={chartPalette.grid} />
                      <XAxis dataKey="label" stroke={chartPalette.axis} fontSize={12} tickLine={false} axisLine={false} />
                      <YAxis stroke={chartPalette.axis} fontSize={12} allowDecimals={false} tickLine={false} axisLine={false} width={36} />
                      <Tooltip
                        contentStyle={{
                          borderRadius: 12,
                          borderColor: chartPalette.tooltipBorder,
                          background: chartPalette.tooltipBg,
                          color: theme === "dark" ? "#F9FAFB" : "#111827",
                        }}
                        formatter={(value: any) => [value, "Files"]}
                        labelFormatter={(label: any) => `Date: ${label}`}
                      />
                      <Line type="monotone" dataKey="files" stroke={ACCENT_SOFT} strokeWidth={3} dot={false} activeDot={{ r: 4 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="xl:col-span-2 rounded-2xl border border-amber-100 p-4 bg-white dark:bg-white/5 dark:border-white/10">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h4 className="font-semibold text-gray-900 dark:text-gray-100">Project Performance</h4>
                    <p className="text-xs text-gray-500 dark:text-gray-400">Row counts by project</p>
                  </div>
                  <FolderOpen className="w-5 h-5 text-amber-700 dark:text-amber-300" />
                </div>
                {analytics.projectComparison.length === 0 ? (
                  <div className="text-sm text-gray-500 dark:text-gray-400">No project data yet.</div>
                ) : (
                  <div className="h-64" ref={setChartRef("projectComparison")}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={analytics.projectComparison} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke={chartPalette.grid} />
                        <XAxis dataKey="name" stroke={chartPalette.axis} fontSize={12} tickLine={false} axisLine={false} interval={0} angle={-20} textAnchor="end" height={60} />
                        <YAxis stroke={chartPalette.axis} fontSize={12} allowDecimals={false} tickLine={false} axisLine={false} width={40} />
                        <Tooltip
                          contentStyle={{
                            borderRadius: 12,
                            borderColor: chartPalette.tooltipBorder,
                            background: chartPalette.tooltipBg,
                            color: theme === "dark" ? "#F9FAFB" : "#111827",
                          }}
                          formatter={(value: any, key: any) => [value, key === "rowCount" ? "Rows" : "Files"]}
                        />
                        <Legend />
                        <Bar dataKey="rowCount" name="Rows" fill={ACCENT} radius={[10, 10, 0, 0]} />
                        <Bar dataKey="fileCount" name="Files" fill={ACCENT_SOFT} radius={[10, 10, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>

              <div className="rounded-2xl border border-amber-100 p-4 bg-white dark:bg-white/5 dark:border-white/10">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h4 className="font-semibold text-gray-900 dark:text-gray-100">
                      {drilldownPartner ? "Country Drill-down" : "Country Share"}
                    </h4>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {drilldownPartner ? `Top countries for ${drilldownPartner}` : "Countries by roaming activity"}
                    </p>
                  </div>
                  <TrendingUp className="w-5 h-5 text-amber-700 dark:text-amber-300" />
                </div>
                {drilldownSeries.length === 0 ? (
                  <div className="text-sm text-gray-500 dark:text-gray-400">No country data yet.</div>
                ) : (
                  <div className="h-64" ref={setChartRef("countryDrilldown")}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={drilldownSeries} layout="vertical" margin={{ top: 0, right: 8, left: 8, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke={chartPalette.grid} />
                        <XAxis type="number" stroke={chartPalette.axis} fontSize={12} allowDecimals={false} tickLine={false} axisLine={false} />
                        <YAxis type="category" dataKey="name" stroke={chartPalette.axis} fontSize={12} width={120} tickLine={false} axisLine={false} />
                        <Tooltip
                          contentStyle={{
                            borderRadius: 12,
                            borderColor: chartPalette.tooltipBorder,
                            background: chartPalette.tooltipBg,
                            color: theme === "dark" ? "#F9FAFB" : "#111827",
                          }}
                        />
                        <Bar dataKey="value" fill={ACCENT} radius={[0, 10, 10, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

export default DashboardAnalyticsPage;
