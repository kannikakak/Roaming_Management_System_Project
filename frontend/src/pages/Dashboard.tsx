import React, { useEffect, useMemo, useState } from "react";
import {
  Database,
  BarChart2,
  FileText,
  Calendar,
  Bell,
  Activity,
  FolderOpen,
  ArrowUpRight,
  TrendingUp,
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
} from "recharts";
import { apiFetch } from "../utils/api";
import { useTheme } from "../theme/ThemeProvider";

type Project = { id: number; name: string };

type AuditLogEntry = {
  id: number;
  timestamp: string;
  action: string;
  details?: any;
};

type NotificationItem = {
  id: number;
  type: string;
  message: string;
  channel: string;
  read_at: string | null;
  created_at: string;
};

const ACCENT = "#F59E0B";
const ACCENT_DARK = "#B45309";
const ACCENT_SOFT = "#FCD34D";

function buildActivitySeries(activity: AuditLogEntry[]) {
  const today = new Date();
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() - (6 - i));
    const key = d.toISOString().slice(0, 10);
    const label = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    return { key, label };
  });

  const counts = new Map<string, number>();
  for (const item of activity) {
    const key = new Date(item.timestamp).toISOString().slice(0, 10);
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  return days.map((d) => ({ label: d.label, count: counts.get(d.key) || 0 }));
}

export default function Dashboard() {
  const { theme } = useTheme();
  const [loading, setLoading] = useState(true);
  const [projects, setProjects] = useState<Project[]>([]);
  const [filesCount, setFilesCount] = useState(0);
  const [reportsCount, setReportsCount] = useState(0);
  const [schedulesCount, setSchedulesCount] = useState(0);
  const [unreadCount, setUnreadCount] = useState(0);
  const [activity, setActivity] = useState<AuditLogEntry[]>([]);
  const [deliveries, setDeliveries] = useState<NotificationItem[]>([]);
  const [projectFileCounts, setProjectFileCounts] = useState<{ id: number; count: number }[]>([]);
  const [avgQualityScore, setAvgQualityScore] = useState<number | null>(null);

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      try {
        setLoading(true);
        const storedUser = localStorage.getItem("authUser");
        const userId = storedUser ? JSON.parse(storedUser).id : 1;

        const projectsRes = await apiFetch(`/api/projects?user_id=${userId}`);
        const projectsData = (await projectsRes.json()) || [];
        if (!mounted) return;
        setProjects(Array.isArray(projectsData) ? projectsData : []);

        const filePromises = (projectsData || []).map((p: Project) =>
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
        setProjectFileCounts(counts);
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

        const activityRes = await apiFetch("/api/audit-logs/me");
        const activityData = await activityRes.json();
        if (mounted) setActivity(Array.isArray(activityData) ? activityData.slice(0, 12) : []);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    load();
    return () => {
      mounted = false;
    };
  }, []);

  const topProjects = useMemo(() => {
    const map = new Map(projectFileCounts.map((p) => [p.id, p.count]));
    return projects
      .map((p) => ({ ...p, count: map.get(p.id) || 0 }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }, [projects, projectFileCounts]);

  const activitySeries = useMemo(() => buildActivitySeries(activity), [activity]);
  const activitySeriesWithComparison = useMemo(() => {
    let prev = 0;
    return activitySeries.map((d) => {
      const comparison = prev;
      prev = d.count;
      return { ...d, comparison };
    });
  }, [activitySeries]);

  const chartPalette = useMemo(
    () => ({
      axis: "#9CA3AF",
      grid: theme === "dark" ? "rgba(255,255,255,0.12)" : "#F3E8D2",
      tooltipBg: theme === "dark" ? "#111827" : "#FFFFFF",
      tooltipBorder: theme === "dark" ? "#374151" : "#FDE68A",
    }),
    [theme]
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 via-white to-orange-50 dark:from-gray-950 dark:via-gray-950 dark:to-gray-900 p-4 md:p-5">
      <div className="max-w-7xl mx-auto space-y-4 md:space-y-5">
        <section className="bg-white border border-amber-100 rounded-3xl p-5 shadow-sm dark:bg-white/5 dark:border-white/10">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.25em] text-amber-600 font-semibold dark:text-amber-300">
                Roaming Analytics
              </p>
              <h2 className="text-3xl font-bold text-gray-900 mt-1.5 dark:text-gray-100">
                Live operations overview
              </h2>
              <p className="text-sm text-gray-500 mt-1.5 dark:text-gray-400">
                Monitor uploads, reports, and automated deliveries in one place.
              </p>
            </div>
            <div className="flex flex-wrap gap-2.5">
              <a
                href="/projects"
                className="px-4 py-2 rounded-lg border border-amber-200 text-amber-700 font-semibold hover:bg-amber-50 dark:border-amber-400/20 dark:text-amber-300 dark:hover:bg-amber-500/10"
              >
                View Projects
              </a>
              <a
                href="/schedules"
                className="px-4 py-2 rounded-lg bg-amber-500 text-white font-semibold hover:bg-amber-600"
              >
                Create Schedule
              </a>
            </div>
          </div>
        </section>

        <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
          <div className="bg-white rounded-2xl border border-amber-100 p-4 shadow-sm dark:bg-white/5 dark:border-white/10">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400">Files Uploaded</p>
                <p className="text-3xl font-bold text-gray-900 mt-1.5 dark:text-gray-100">{filesCount}</p>
              </div>
              <div className="w-11 h-11 rounded-xl flex items-center justify-center" style={{ background: "#FFF3E0" }}>
                <Database className="w-6 h-6" color={ACCENT} />
              </div>
            </div>
            <p className="text-xs text-gray-400 mt-3 dark:text-gray-500">Across all projects</p>
          </div>
          <div className="bg-white rounded-2xl border border-amber-100 p-4 shadow-sm dark:bg-white/5 dark:border-white/10">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400">Charts Created</p>
                <p className="text-3xl font-bold text-gray-900 mt-1.5 dark:text-gray-100">{Math.max(0, reportsCount + 2)}</p>
              </div>
              <div className="w-11 h-11 rounded-xl flex items-center justify-center" style={{ background: "#FFF3E0" }}>
                <BarChart2 className="w-6 h-6" color={ACCENT} />
              </div>
            </div>
            <p className="text-xs text-gray-400 mt-3 dark:text-gray-500">Visual insights generated</p>
          </div>
          <div className="bg-white rounded-2xl border border-amber-100 p-4 shadow-sm dark:bg-white/5 dark:border-white/10">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400">Reports</p>
                <p className="text-3xl font-bold text-gray-900 mt-1.5 dark:text-gray-100">{reportsCount}</p>
              </div>
              <div className="w-11 h-11 rounded-xl flex items-center justify-center" style={{ background: "#FFF3E0" }}>
                <FileText className="w-6 h-6" color={ACCENT} />
              </div>
            </div>
            <p className="text-xs text-gray-400 mt-3 dark:text-gray-500">Saved to library</p>
          </div>
          <div className="bg-white rounded-2xl border border-amber-100 p-4 shadow-sm dark:bg-white/5 dark:border-white/10">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400">Active Schedules</p>
                <p className="text-3xl font-bold text-gray-900 mt-1.5 dark:text-gray-100">{schedulesCount}</p>
              </div>
              <div className="w-11 h-11 rounded-xl flex items-center justify-center" style={{ background: "#FFF3E0" }}>
                <Calendar className="w-6 h-6" color={ACCENT} />
              </div>
            </div>
            <p className="text-xs text-gray-400 mt-3 dark:text-gray-500">Automation running</p>
          </div>
          <div className="bg-white rounded-2xl border border-amber-100 p-4 shadow-sm dark:bg-white/5 dark:border-white/10">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400">Data Quality</p>
                <p className="text-3xl font-bold text-gray-900 mt-1.5 dark:text-gray-100">
                  {avgQualityScore === null ? "N/A" : `${avgQualityScore}%`}
                </p>
              </div>
              <div className="w-11 h-11 rounded-xl flex items-center justify-center" style={{ background: "#FFF3E0" }}>
                <ArrowUpRight className="w-6 h-6" color={ACCENT} />
              </div>
            </div>
            <p className="text-xs text-gray-400 mt-3 dark:text-gray-500">
              {avgQualityScore === null
                ? "No scored files yet"
                : avgQualityScore >= 80
                  ? "Trust level: High"
                  : avgQualityScore >= 50
                    ? "Trust level: Medium"
                    : "Trust level: Low"}
            </p>
          </div>
        </section>

        <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 bg-white border border-amber-100 rounded-2xl p-4 shadow-sm dark:bg-white/5 dark:border-white/10">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3.5">
              <div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Activity Trend</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400">Last 7 days</p>
              </div>
              <div className="flex items-center gap-3 text-[11px] text-gray-600 dark:text-gray-300">
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: ACCENT }} />
                  Activity
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: ACCENT_SOFT }} />
                  Previous
                </span>
                <TrendingUp className="w-5 h-5" color={ACCENT_DARK} />
              </div>
            </div>
            <div className="h-44 md:h-52">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={activitySeriesWithComparison}>
                  <CartesianGrid strokeDasharray="3 3" stroke={chartPalette.grid} />
                  <XAxis dataKey="label" stroke={chartPalette.axis} fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis stroke={chartPalette.axis} fontSize={12} allowDecimals={false} tickLine={false} axisLine={false} width={28} />
                  <Tooltip
                    contentStyle={{
                      borderRadius: 12,
                      borderColor: chartPalette.tooltipBorder,
                      background: chartPalette.tooltipBg,
                      color: theme === "dark" ? "#F9FAFB" : "#111827",
                      boxShadow: "0 10px 25px rgba(245, 158, 11, 0.12)",
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="comparison"
                    stroke={ACCENT_SOFT}
                    strokeWidth={2.5}
                    dot={false}
                    activeDot={{ r: 4 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="count"
                    stroke={ACCENT}
                    strokeWidth={3}
                    dot={{ r: 3 }}
                    activeDot={{ r: 5 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="bg-white border border-amber-100 rounded-2xl p-4 shadow-sm dark:bg-white/5 dark:border-white/10">
            <div className="flex items-center justify-between mb-3.5">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Delivery Pulse</h3>
              <Bell className="w-5 h-5" color={ACCENT_DARK} />
            </div>
            {deliveries.length === 0 ? (
              <div className="text-sm text-gray-500 dark:text-gray-400">No deliveries yet.</div>
            ) : (
              <div className="space-y-2.5 text-sm">
                {deliveries.map((d) => (
                  <div key={d.id} className="p-2.5 rounded-xl border border-amber-100 bg-amber-50/50 dark:border-white/10 dark:bg-white/5">
                    <div className="font-semibold text-gray-900 dark:text-gray-100">{d.type}</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {new Date(d.created_at).toLocaleString()}
                    </div>
                    <div className="text-xs text-gray-600 dark:text-gray-300 mt-1.5">{d.message}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="bg-white border border-amber-100 rounded-2xl p-4 shadow-sm dark:bg-white/5 dark:border-white/10">
            <div className="flex items-center justify-between mb-3.5">
              <div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Projects with Most Files</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400">Top sources by uploaded datasets</p>
              </div>
              <FolderOpen className="w-5 h-5" color={ACCENT_DARK} />
            </div>
            {topProjects.length === 0 ? (
              <div className="text-sm text-gray-500 dark:text-gray-400">No projects yet.</div>
            ) : (
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={topProjects} layout="vertical" margin={{ top: 0, right: 8, left: 8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={chartPalette.grid} />
                    <XAxis type="number" stroke={chartPalette.axis} fontSize={12} allowDecimals={false} tickLine={false} axisLine={false} />
                    <YAxis type="category" dataKey="name" stroke={chartPalette.axis} fontSize={12} width={110} tickLine={false} axisLine={false} />
                    <Tooltip />
                    <Bar dataKey="count" fill={ACCENT} radius={[0, 10, 10, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          <div className="lg:col-span-2 bg-white border border-amber-100 rounded-2xl p-4 shadow-sm dark:bg-white/5 dark:border-white/10">
            <div className="flex items-center justify-between mb-3.5">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Recent Activity</h3>
              <span className="text-xs text-gray-400 dark:text-gray-500">Unread alerts: {unreadCount}</span>
            </div>
            {loading ? (
              <div className="text-sm text-gray-500 dark:text-gray-400">Loading activity...</div>
            ) : activity.length === 0 ? (
              <div className="text-sm text-gray-500 dark:text-gray-400">No activity yet.</div>
            ) : (
              <ul className="space-y-3 text-sm">
                {activity.slice(0, 6).map((item) => (
                  <li key={item.id} className="flex items-start gap-3">
                    <div className="w-9 h-9 rounded-2xl bg-amber-50 border border-amber-100 flex items-center justify-center dark:bg-white/5 dark:border-white/10">
                      <Activity className="w-4 h-4" color={ACCENT_DARK} />
                    </div>
                    <div>
                      <div className="font-semibold text-gray-900 dark:text-gray-100">{item.action}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        {new Date(item.timestamp).toLocaleString()}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
