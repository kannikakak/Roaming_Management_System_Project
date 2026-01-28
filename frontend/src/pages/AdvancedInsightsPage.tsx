import React, { useEffect, useMemo, useState } from "react";
import { Filter, TrendingUp } from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { apiFetch } from "../utils/api";
import { useTheme } from "../theme/ThemeProvider";

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

const ACCENT = "#F59E0B";
const ACCENT_SOFT = "#FCD34D";

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

const AdvancedInsightsPage: React.FC = () => {
  const { theme } = useTheme();
  const [filters, setFilters] = useState<InsightsFilterState>({
    startDate: "",
    endDate: "",
    partner: "",
    country: "",
  });
  const [appliedFilters, setAppliedFilters] = useState<InsightsFilterState>(filters);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [insights, setInsights] = useState<DashboardInsights | null>(null);

  useEffect(() => {
    let mounted = true;
    const run = async () => {
      try {
        setLoading(true);
        setError(null);
        const params = buildInsightsParams(appliedFilters);
        const res = await apiFetch(`/api/dashboard/insights?${params.toString()}`);
        if (!res.ok) {
          const message = await res.text();
          throw new Error(message || "Failed to load insights");
        }
        const json = (await res.json()) as DashboardInsights;
        if (mounted) setInsights(json);
      } catch (err: any) {
        if (mounted) setError(err.message || "Failed to load insights.");
      } finally {
        if (mounted) setLoading(false);
      }
    };

    run();
    return () => {
      mounted = false;
    };
  }, [appliedFilters]);

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

  const onApplyFilters = (e: React.FormEvent) => {
    e.preventDefault();
    setAppliedFilters(filters);
  };

  const onClearFilters = () => {
    const empty: InsightsFilterState = { startDate: "", endDate: "", partner: "", country: "" };
    setFilters(empty);
    setAppliedFilters(empty);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 via-white to-orange-50 dark:from-gray-950 dark:via-gray-950 dark:to-gray-900 p-4 md:p-5">
      <div className="max-w-7xl mx-auto space-y-4 md:space-y-5">
        <section className="bg-white border border-amber-100 rounded-3xl p-5 shadow-sm dark:bg-white/5 dark:border-white/10">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.25em] text-amber-600 font-semibold dark:text-amber-300">
                AI-Driven Insights
              </p>
              <h2 className="text-3xl font-bold text-gray-900 mt-1.5 dark:text-gray-100">
                Advanced analytics studio
              </h2>
              <p className="text-sm text-gray-500 mt-1.5 dark:text-gray-400">
                Forecasts, anomaly detection, leakage checks, and plain-language summaries.
              </p>
            </div>
            <TrendingUp className="w-6 h-6 text-amber-700 dark:text-amber-300" />
          </div>
        </section>

        <section className="bg-white border border-amber-100 rounded-2xl p-4 shadow-sm dark:bg-white/5 dark:border-white/10">
          <div className="flex items-center gap-2 mb-3">
            <Filter className="w-5 h-5 text-amber-700 dark:text-amber-300" />
            <div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Scope Filters</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400">Apply the same filters used by the dashboard.</p>
            </div>
          </div>
          <form onSubmit={onApplyFilters} className="grid grid-cols-1 md:grid-cols-5 gap-3">
            <input
              type="date"
              value={filters.startDate}
              onChange={(e) => setFilters((prev) => ({ ...prev, startDate: e.target.value }))}
              className="px-3 py-2.5 rounded-xl border border-amber-100 bg-white text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-amber-300 dark:border-white/10 dark:bg-white/5 dark:text-gray-100"
              placeholder="Start date"
            />
            <input
              type="date"
              value={filters.endDate}
              onChange={(e) => setFilters((prev) => ({ ...prev, endDate: e.target.value }))}
              className="px-3 py-2.5 rounded-xl border border-amber-100 bg-white text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-amber-300 dark:border-white/10 dark:bg-white/5 dark:text-gray-100"
              placeholder="End date"
            />
            <input
              value={filters.partner}
              onChange={(e) => setFilters((prev) => ({ ...prev, partner: e.target.value }))}
              className="px-3 py-2.5 rounded-xl border border-amber-100 bg-white text-sm text-gray-700 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-amber-300 dark:border-white/10 dark:bg-white/5 dark:text-gray-100"
              placeholder="Partner"
            />
            <input
              value={filters.country}
              onChange={(e) => setFilters((prev) => ({ ...prev, country: e.target.value }))}
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
        </section>

        <section className="bg-white border border-amber-100 rounded-2xl p-4 shadow-sm dark:bg-white/5 dark:border-white/10">
          {error && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-4 dark:bg-red-500/10 dark:border-red-500/20 dark:text-red-300">
              {error}
            </div>
          )}

          {loading && !insights ? (
            <div className="text-sm text-gray-500 dark:text-gray-400">Loading AI insights...</div>
          ) : !insights ? (
            <div className="text-sm text-gray-500 dark:text-gray-400">No insights data yet.</div>
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
              <div className="xl:col-span-1 rounded-2xl border border-amber-100 p-4 bg-amber-50/40 dark:bg-white/5 dark:border-white/10">
                <div className="text-xs font-semibold text-amber-700 dark:text-amber-300 mb-2">
                  Automated Summaries
                </div>
                <ul className="space-y-2 text-sm text-gray-700 dark:text-gray-200">
                  {insights.summaries.map((line, idx) => (
                    <li key={`${idx}-${line}`} className="leading-relaxed">
                      {line}
                    </li>
                  ))}
                </ul>
                <div className="mt-3 text-[11px] text-gray-500 dark:text-gray-400">
                  Forecast metric: <span className="font-semibold">{insightMetricLabel}</span>
                </div>
              </div>

              <div className="xl:col-span-2 rounded-2xl border border-amber-100 p-4 bg-white dark:bg-white/5 dark:border-white/10">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h4 className="font-semibold text-gray-900 dark:text-gray-100">
                      Predictive Trend ({insightMetricLabel})
                    </h4>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Observed values with a short forward forecast.
                    </p>
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
                        stroke={ACCENT}
                        strokeWidth={3}
                        dot={false}
                        connectNulls
                      />
                      <Line
                        type="monotone"
                        dataKey="forecast"
                        name="Forecast"
                        stroke={ACCENT_SOFT}
                        strokeWidth={3}
                        strokeDasharray="6 6"
                        dot={false}
                        connectNulls
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="rounded-2xl border border-amber-100 p-4 bg-white dark:bg-white/5 dark:border-white/10">
                <div className="flex items-center justify-between mb-2.5">
                  <h4 className="font-semibold text-gray-900 dark:text-gray-100">Anomalies</h4>
                  <div className="text-[11px] text-gray-500 dark:text-gray-400">z-score ≥ 2.5</div>
                </div>
                {insights.anomalies.points.length === 0 ? (
                  <div className="text-sm text-gray-500 dark:text-gray-400">No anomalies detected.</div>
                ) : (
                  <div className="overflow-auto">
                    <table className="min-w-full text-xs">
                      <thead>
                        <tr className="text-left text-gray-500 dark:text-gray-400">
                          <th className="py-1 pr-3">Day</th>
                          <th className="py-1 pr-3">{insightMetricLabel}</th>
                          <th className="py-1">z</th>
                        </tr>
                      </thead>
                      <tbody className="text-gray-700 dark:text-gray-200">
                        {insights.anomalies.points.map((p) => (
                          <tr key={`${p.day}-${p.zScore}`} className="border-t border-amber-100/60 dark:border-white/10">
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

              <div className="xl:col-span-2 rounded-2xl border border-amber-100 p-4 bg-white dark:bg-white/5 dark:border-white/10">
                <div className="flex items-center justify-between mb-2.5">
                  <div>
                    <h4 className="font-semibold text-gray-900 dark:text-gray-100">Cost Leakage Detection</h4>
                    <p className="text-[11px] text-gray-500 dark:text-gray-400">
                      Expected vs actual charges by partner and country.
                    </p>
                  </div>
                  <div className="text-[11px] text-gray-500 dark:text-gray-400">
                    {insights.metrics.expectedKey && insights.metrics.actualKey
                      ? `${insights.metrics.expectedKey} vs ${insights.metrics.actualKey}`
                      : "Needs expected + actual columns"}
                  </div>
                </div>
                {insights.leakage.items.length === 0 ? (
                  <div className="text-sm text-gray-500 dark:text-gray-400">
                    {insights.metrics.expectedKey && insights.metrics.actualKey
                      ? "No major leakage signals found."
                      : "Upload data with expected tariff and actual charge columns to enable this check."}
                  </div>
                ) : (
                  <div className="overflow-auto">
                    <table className="min-w-full text-xs">
                      <thead>
                        <tr className="text-left text-gray-500 dark:text-gray-400">
                          <th className="py-1 pr-3">Partner</th>
                          <th className="py-1 pr-3">Country</th>
                          <th className="py-1 pr-3">Expected</th>
                          <th className="py-1 pr-3">Actual</th>
                          <th className="py-1 pr-3">Diff</th>
                          <th className="py-1">% Diff</th>
                        </tr>
                      </thead>
                      <tbody className="text-gray-700 dark:text-gray-200">
                        {insights.leakage.items.map((item) => (
                          <tr
                            key={`${item.partner}-${item.country}`}
                            className="border-t border-amber-100/60 dark:border-white/10"
                          >
                            <td className="py-1.5 pr-3">{item.partner}</td>
                            <td className="py-1.5 pr-3">{item.country}</td>
                            <td className="py-1.5 pr-3">{item.expected.toLocaleString()}</td>
                            <td className="py-1.5 pr-3">{item.actual.toLocaleString()}</td>
                            <td
                              className={`py-1.5 pr-3 font-semibold ${
                                item.diff >= 0 ? "text-red-600 dark:text-red-300" : "text-emerald-600 dark:text-emerald-300"
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
        </section>
      </div>
    </div>
  );
};

export default AdvancedInsightsPage;

