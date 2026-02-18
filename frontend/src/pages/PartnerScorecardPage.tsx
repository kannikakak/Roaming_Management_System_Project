import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
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

type Project = {
  id: number;
  name: string;
};

type TrendPoint = {
  month: string;
  revenue: number;
  usage: number;
};

type PartnerScorecardItem = {
  partner: string;
  revenue: number;
  usage: number;
  qualityScore: number | null;
  disputeCount: number;
  paymentDelayDays: number | null;
  score: number;
  rows: number;
  files: number;
  trend: TrendPoint[];
};

type PartnerScorecardResponse = {
  filters: {
    projectId: number | null;
    months: number;
    limit: number;
    rowLimit: number;
  };
  metricKeys: {
    revenue: string | null;
    usage: string | null;
    paymentDelay: string | null;
    paymentDueDate: string | null;
    paymentPaidDate: string | null;
  };
  monthKeys: string[];
  summary: {
    partnerCount: number;
    totalRevenue: number;
    totalUsage: number;
    avgQualityScore: number | null;
    totalDisputes: number;
    avgPaymentDelayDays: number | null;
  };
  partners: PartnerScorecardItem[];
};

const MONTH_OPTIONS = [3, 6, 12, 18, 24];
const LIMIT_OPTIONS = [10, 20, 30, 50, 100];
const TREND_COLORS = ["#B45309", "#2563EB", "#0D9488", "#DB2777", "#7C3AED"];

const formatMonthLabel = (value: string) => {
  const parsed = new Date(`${value}-01T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString(undefined, { month: "short", year: "2-digit" });
};

const formatNumber = (value: number | null | undefined, digits = 2) => {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-";
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: digits });
};

const formatQuality = (value: number | null) => {
  if (value === null || !Number.isFinite(value)) return "-";
  return `${Number(value).toLocaleString(undefined, { maximumFractionDigits: 1 })}`;
};

const formatDelay = (value: number | null) => {
  if (value === null || !Number.isFinite(value)) return "-";
  return `${Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })} days`;
};

const PartnerScorecardPage: React.FC = () => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<number | "all">("all");
  const [months, setMonths] = useState(6);
  const [limit, setLimit] = useState(20);
  const [search, setSearch] = useState("");
  const [scorecard, setScorecard] = useState<PartnerScorecardResponse | null>(null);
  const [selectedPartner, setSelectedPartner] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const storedUser = localStorage.getItem("authUser");
    const userId = storedUser ? JSON.parse(storedUser)?.id : 1;
    apiFetch(`/api/projects?user_id=${userId}`)
      .then((res) => res.json())
      .then((data) => {
        const nextProjects = Array.isArray(data) ? (data as Project[]) : [];
        setProjects(nextProjects);
      })
      .catch(() => {
        setProjects([]);
      });
  }, []);

  const loadScorecard = useCallback(async () => {
    try {
      setLoading(true);
      setError("");

      const params = new URLSearchParams();
      if (projectId !== "all") {
        params.set("projectId", String(projectId));
      }
      params.set("months", String(months));
      params.set("limit", String(limit));

      const res = await apiFetch(`/api/partner-scorecard?${params.toString()}`);
      if (!res.ok) {
        const message = await res.text();
        throw new Error(message || "Failed to load partner scorecard.");
      }
      const data = (await res.json()) as PartnerScorecardResponse;
      setScorecard(data);
    } catch (err: any) {
      setError(err?.message || "Failed to load partner scorecard.");
      setScorecard(null);
    } finally {
      setLoading(false);
    }
  }, [limit, months, projectId]);

  useEffect(() => {
    loadScorecard();
  }, [loadScorecard]);

  const partners = useMemo(() => scorecard?.partners ?? [], [scorecard?.partners]);

  const filteredPartners = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return partners;
    return partners.filter((partner) => partner.partner.toLowerCase().includes(q));
  }, [partners, search]);

  useEffect(() => {
    if (filteredPartners.length === 0) {
      setSelectedPartner(null);
      return;
    }
    if (!selectedPartner || !filteredPartners.some((item) => item.partner === selectedPartner)) {
      setSelectedPartner(filteredPartners[0].partner);
    }
  }, [filteredPartners, selectedPartner]);

  const selectedPartnerData = useMemo(
    () => filteredPartners.find((item) => item.partner === selectedPartner) || null,
    [filteredPartners, selectedPartner]
  );

  const topTrendSeries = useMemo(() => {
    const topPartners = filteredPartners.slice(0, 5);
    return topPartners.map((item, index) => ({
      key: `series_${index}`,
      name: item.partner,
      color: TREND_COLORS[index % TREND_COLORS.length],
      trend: item.trend,
    }));
  }, [filteredPartners]);

  const topTrendData = useMemo(() => {
    const monthsAxis = scorecard?.monthKeys || [];
    return monthsAxis.map((month) => {
      const row: Record<string, number | string> = { month };
      for (const series of topTrendSeries) {
        const point = series.trend.find((trendPoint) => trendPoint.month === month);
        row[series.key] = point?.revenue ?? 0;
      }
      return row;
    });
  }, [scorecard?.monthKeys, topTrendSeries]);

  const selectedTrendData = useMemo(() => {
    if (!selectedPartnerData) return [];
    return selectedPartnerData.trend.map((point) => ({
      month: point.month,
      revenue: point.revenue,
      usage: point.usage,
    }));
  }, [selectedPartnerData]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 via-white to-orange-50 dark:from-gray-950 dark:via-gray-950 dark:to-gray-900 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="bg-white border rounded-2xl p-5 dark:bg-gray-900/70 dark:border-white/10">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h2 className="text-3xl font-bold text-amber-800 dark:text-amber-300">Partner Performance Scorecard</h2>
              <p className="text-sm text-gray-600 dark:text-gray-300">
                Revenue, usage, quality, dispute pressure, payment delay, and monthly trends by roaming partner.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={loadScorecard}
                className="px-4 py-2 rounded-xl border border-amber-200 text-amber-700 text-sm font-semibold hover:bg-amber-50 dark:border-amber-300/30 dark:text-amber-300 dark:hover:bg-amber-500/10"
              >
                Refresh
              </button>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Project</label>
              <select
                className="w-full mt-1 border rounded-lg px-3 py-2 text-sm dark:bg-gray-900 dark:border-white/15 dark:text-gray-100"
                value={projectId}
                onChange={(e) => {
                  const next = e.target.value;
                  setProjectId(next === "all" ? "all" : Number(next));
                }}
              >
                <option value="all">All Projects</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Months</label>
              <select
                className="w-full mt-1 border rounded-lg px-3 py-2 text-sm dark:bg-gray-900 dark:border-white/15 dark:text-gray-100"
                value={months}
                onChange={(e) => setMonths(Number(e.target.value))}
              >
                {MONTH_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    Last {option} months
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Partners Returned</label>
              <select
                className="w-full mt-1 border rounded-lg px-3 py-2 text-sm dark:bg-gray-900 dark:border-white/15 dark:text-gray-100"
                value={limit}
                onChange={(e) => setLimit(Number(e.target.value))}
              >
                {LIMIT_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    Top {option}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Find Partner</label>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search partner..."
                className="w-full mt-1 border rounded-lg px-3 py-2 text-sm dark:bg-gray-900 dark:border-white/15 dark:text-gray-100"
              />
            </div>
          </div>

          {scorecard && (
            <div className="mt-3 text-xs text-gray-500 dark:text-gray-400">
              Metrics detected:
              {" Revenue: "}
              <span className="font-semibold">{scorecard.metricKeys.revenue || "-"}</span>
              {" | Usage: "}
              <span className="font-semibold">{scorecard.metricKeys.usage || "-"}</span>
              {" | Payment delay: "}
              <span className="font-semibold">
                {scorecard.metricKeys.paymentDelay ||
                  (scorecard.metricKeys.paymentDueDate && scorecard.metricKeys.paymentPaidDate
                    ? `${scorecard.metricKeys.paymentPaidDate} - ${scorecard.metricKeys.paymentDueDate}`
                    : "-")}
              </span>
            </div>
          )}

          {error && (
            <div className="mt-3 text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
              {error}
            </div>
          )}
        </div>

        {loading ? (
          <div className="bg-white border rounded-2xl p-6 text-sm text-gray-500 dark:bg-gray-900/70 dark:border-white/10 dark:text-gray-300">
            Loading partner scorecard...
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
              <div className="rounded-2xl border border-amber-100 bg-white p-4 dark:bg-gray-900/70 dark:border-white/10">
                <div className="text-xs text-gray-500 dark:text-gray-400">Partners</div>
                <div className="mt-1 text-2xl font-bold text-gray-900 dark:text-gray-100">
                  {formatNumber(scorecard?.summary.partnerCount || 0, 0)}
                </div>
              </div>
              <div className="rounded-2xl border border-amber-100 bg-white p-4 dark:bg-gray-900/70 dark:border-white/10">
                <div className="text-xs text-gray-500 dark:text-gray-400">Total Revenue</div>
                <div className="mt-1 text-2xl font-bold text-gray-900 dark:text-gray-100">
                  {formatNumber(scorecard?.summary.totalRevenue || 0)}
                </div>
              </div>
              <div className="rounded-2xl border border-amber-100 bg-white p-4 dark:bg-gray-900/70 dark:border-white/10">
                <div className="text-xs text-gray-500 dark:text-gray-400">Total Usage</div>
                <div className="mt-1 text-2xl font-bold text-gray-900 dark:text-gray-100">
                  {formatNumber(scorecard?.summary.totalUsage || 0)}
                </div>
              </div>
              <div className="rounded-2xl border border-amber-100 bg-white p-4 dark:bg-gray-900/70 dark:border-white/10">
                <div className="text-xs text-gray-500 dark:text-gray-400">Avg Quality</div>
                <div className="mt-1 text-2xl font-bold text-gray-900 dark:text-gray-100">
                  {formatQuality(scorecard?.summary.avgQualityScore ?? null)}
                </div>
              </div>
              <div className="rounded-2xl border border-amber-100 bg-white p-4 dark:bg-gray-900/70 dark:border-white/10">
                <div className="text-xs text-gray-500 dark:text-gray-400">Active Disputes</div>
                <div className="mt-1 text-2xl font-bold text-gray-900 dark:text-gray-100">
                  {formatNumber(scorecard?.summary.totalDisputes || 0, 0)}
                </div>
              </div>
              <div className="rounded-2xl border border-amber-100 bg-white p-4 dark:bg-gray-900/70 dark:border-white/10">
                <div className="text-xs text-gray-500 dark:text-gray-400">Avg Payment Delay</div>
                <div className="mt-1 text-2xl font-bold text-gray-900 dark:text-gray-100">
                  {scorecard?.summary.avgPaymentDelayDays === null
                    ? "-"
                    : `${formatNumber(scorecard?.summary.avgPaymentDelayDays, 2)}d`}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              <div className="rounded-2xl border border-amber-100 bg-white p-4 dark:bg-gray-900/70 dark:border-white/10">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-1">
                  Revenue Trend (Top Partners)
                </h3>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                  Compare monthly revenue trajectories for top-ranked partners.
                </p>
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={topTrendData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#F3E8D2" />
                      <XAxis
                        dataKey="month"
                        tickFormatter={formatMonthLabel}
                        tickLine={false}
                        axisLine={false}
                        fontSize={12}
                      />
                      <YAxis tickLine={false} axisLine={false} fontSize={12} width={64} />
                      <Tooltip
                        formatter={(value: number | string | undefined) => formatNumber(Number(value))}
                        labelFormatter={(label) => formatMonthLabel(String(label))}
                      />
                      <Legend />
                      {topTrendSeries.map((series) => (
                        <Line
                          key={series.key}
                          dataKey={series.key}
                          name={series.name}
                          type="monotone"
                          stroke={series.color}
                          strokeWidth={2.5}
                          dot={false}
                          activeDot={{ r: 5 }}
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="rounded-2xl border border-amber-100 bg-white p-4 dark:bg-gray-900/70 dark:border-white/10">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-1">
                  Selected Partner Trend
                </h3>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                  Monthly revenue and usage for{" "}
                  <span className="font-semibold">{selectedPartnerData?.partner || "no partner selected"}</span>.
                </p>
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={selectedTrendData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#F3E8D2" />
                      <XAxis
                        dataKey="month"
                        tickFormatter={formatMonthLabel}
                        tickLine={false}
                        axisLine={false}
                        fontSize={12}
                      />
                      <YAxis tickLine={false} axisLine={false} fontSize={12} width={64} />
                      <Tooltip
                        formatter={(value: number | string | undefined) => formatNumber(Number(value))}
                        labelFormatter={(label) => formatMonthLabel(String(label))}
                      />
                      <Legend />
                      <Line
                        dataKey="revenue"
                        name="Revenue"
                        type="monotone"
                        stroke="#B45309"
                        strokeWidth={2.8}
                        dot={false}
                        activeDot={{ r: 5 }}
                      />
                      <Line
                        dataKey="usage"
                        name="Usage"
                        type="monotone"
                        stroke="#2563EB"
                        strokeWidth={2.8}
                        strokeDasharray="6 4"
                        dot={false}
                        activeDot={{ r: 5 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-amber-100 bg-white p-4 dark:bg-gray-900/70 dark:border-white/10">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">Partner Ranking</h3>
              {filteredPartners.length === 0 ? (
                <div className="text-sm text-gray-500 dark:text-gray-400">No partner data found for this filter.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="text-left border-b border-amber-100 dark:border-white/10">
                        <th className="py-2 pr-3 font-semibold text-gray-600 dark:text-gray-300">Partner</th>
                        <th className="py-2 pr-3 font-semibold text-gray-600 dark:text-gray-300">Score</th>
                        <th className="py-2 pr-3 font-semibold text-gray-600 dark:text-gray-300">Revenue</th>
                        <th className="py-2 pr-3 font-semibold text-gray-600 dark:text-gray-300">Usage</th>
                        <th className="py-2 pr-3 font-semibold text-gray-600 dark:text-gray-300">Quality</th>
                        <th className="py-2 pr-3 font-semibold text-gray-600 dark:text-gray-300">Disputes</th>
                        <th className="py-2 pr-3 font-semibold text-gray-600 dark:text-gray-300">Payment Delay</th>
                        <th className="py-2 pr-3 font-semibold text-gray-600 dark:text-gray-300">Files</th>
                        <th className="py-2 pr-3 font-semibold text-gray-600 dark:text-gray-300">Rows</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredPartners.map((item) => {
                        const active = selectedPartner === item.partner;
                        return (
                          <tr
                            key={item.partner}
                            onClick={() => setSelectedPartner(item.partner)}
                            className={`border-b border-amber-50 dark:border-white/5 cursor-pointer ${
                              active ? "bg-amber-50/70 dark:bg-amber-500/10" : "hover:bg-amber-50/40 dark:hover:bg-white/5"
                            }`}
                          >
                            <td className="py-2 pr-3 font-medium text-gray-900 dark:text-gray-100">{item.partner}</td>
                            <td className="py-2 pr-3">
                              <span
                                className={`px-2 py-1 rounded-full text-xs font-semibold ${
                                  item.score >= 80
                                    ? "bg-emerald-100 text-emerald-700"
                                    : item.score >= 60
                                      ? "bg-amber-100 text-amber-700"
                                      : "bg-rose-100 text-rose-700"
                                }`}
                              >
                                {formatNumber(item.score, 1)}
                              </span>
                            </td>
                            <td className="py-2 pr-3 text-gray-700 dark:text-gray-300">{formatNumber(item.revenue)}</td>
                            <td className="py-2 pr-3 text-gray-700 dark:text-gray-300">{formatNumber(item.usage)}</td>
                            <td className="py-2 pr-3 text-gray-700 dark:text-gray-300">{formatQuality(item.qualityScore)}</td>
                            <td className="py-2 pr-3 text-gray-700 dark:text-gray-300">{formatNumber(item.disputeCount, 0)}</td>
                            <td className="py-2 pr-3 text-gray-700 dark:text-gray-300">{formatDelay(item.paymentDelayDays)}</td>
                            <td className="py-2 pr-3 text-gray-700 dark:text-gray-300">{formatNumber(item.files, 0)}</td>
                            <td className="py-2 pr-3 text-gray-700 dark:text-gray-300">{formatNumber(item.rows, 0)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default PartnerScorecardPage;
