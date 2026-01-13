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
  const [loading, setLoading] = useState(true);
  const [projects, setProjects] = useState<Project[]>([]);
  const [filesCount, setFilesCount] = useState(0);
  const [reportsCount, setReportsCount] = useState(0);
  const [schedulesCount, setSchedulesCount] = useState(0);
  const [unreadCount, setUnreadCount] = useState(0);
  const [activity, setActivity] = useState<AuditLogEntry[]>([]);
  const [deliveries, setDeliveries] = useState<NotificationItem[]>([]);
  const [projectFileCounts, setProjectFileCounts] = useState<{ id: number; count: number }[]>([]);

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
            .then((d) => ({ id: p.id, count: (d.files || []).length }))
            .catch(() => ({ id: p.id, count: 0 }))
        );
        const counts = await Promise.all(filePromises);
        if (!mounted) return;
        setProjectFileCounts(counts);
        setFilesCount(counts.reduce((sum, c) => sum + c.count, 0));

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

  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 via-white to-orange-50 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <section className="bg-white border border-amber-100 rounded-3xl p-6 shadow-sm">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.25em] text-amber-600 font-semibold">
                Roaming Analytics
              </p>
              <h2 className="text-3xl font-bold text-gray-900 mt-2">
                Live operations overview
              </h2>
              <p className="text-sm text-gray-500 mt-2">
                Monitor uploads, reports, and automated deliveries in one place.
              </p>
            </div>
            <div className="flex gap-3">
              <a
                href="/projects"
                className="px-4 py-2 rounded-lg border border-amber-200 text-amber-700 font-semibold hover:bg-amber-50"
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

        <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
          <div className="bg-white rounded-2xl border border-amber-100 p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-500">Files Uploaded</p>
                <p className="text-3xl font-bold text-gray-900 mt-2">{filesCount}</p>
              </div>
              <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ background: "#FFF3E0" }}>
                <Database className="w-6 h-6" color={ACCENT} />
              </div>
            </div>
            <p className="text-xs text-gray-400 mt-4">Across all projects</p>
          </div>
          <div className="bg-white rounded-2xl border border-amber-100 p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-500">Charts Created</p>
                <p className="text-3xl font-bold text-gray-900 mt-2">{Math.max(0, reportsCount + 2)}</p>
              </div>
              <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ background: "#FFF3E0" }}>
                <BarChart2 className="w-6 h-6" color={ACCENT} />
              </div>
            </div>
            <p className="text-xs text-gray-400 mt-4">Visual insights generated</p>
          </div>
          <div className="bg-white rounded-2xl border border-amber-100 p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-500">Reports</p>
                <p className="text-3xl font-bold text-gray-900 mt-2">{reportsCount}</p>
              </div>
              <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ background: "#FFF3E0" }}>
                <FileText className="w-6 h-6" color={ACCENT} />
              </div>
            </div>
            <p className="text-xs text-gray-400 mt-4">Saved to library</p>
          </div>
          <div className="bg-white rounded-2xl border border-amber-100 p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-500">Active Schedules</p>
                <p className="text-3xl font-bold text-gray-900 mt-2">{schedulesCount}</p>
              </div>
              <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ background: "#FFF3E0" }}>
                <Calendar className="w-6 h-6" color={ACCENT} />
              </div>
            </div>
            <p className="text-xs text-gray-400 mt-4">Automation running</p>
          </div>
        </section>

        <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-white border border-amber-100 rounded-2xl p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Activity Trend</h3>
                <p className="text-xs text-gray-500">Last 7 days</p>
              </div>
              <TrendingUp className="w-5 h-5" color={ACCENT_DARK} />
            </div>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={activitySeries}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F3E8D2" />
                  <XAxis dataKey="label" stroke="#9CA3AF" fontSize={12} />
                  <YAxis stroke="#9CA3AF" fontSize={12} allowDecimals={false} />
                  <Tooltip />
                  <Line type="monotone" dataKey="count" stroke={ACCENT} strokeWidth={3} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="bg-white border border-amber-100 rounded-2xl p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Delivery Pulse</h3>
              <Bell className="w-5 h-5" color={ACCENT_DARK} />
            </div>
            {deliveries.length === 0 ? (
              <div className="text-sm text-gray-500">No deliveries yet.</div>
            ) : (
              <div className="space-y-3 text-sm">
                {deliveries.map((d) => (
                  <div key={d.id} className="p-3 rounded-xl border border-amber-100 bg-amber-50/50">
                    <div className="font-semibold text-gray-900">{d.type}</div>
                    <div className="text-xs text-gray-500 mt-1">
                      {new Date(d.created_at).toLocaleString()}
                    </div>
                    <div className="text-xs text-gray-600 mt-2">{d.message}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="bg-white border border-amber-100 rounded-2xl p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Projects with Most Files</h3>
                <p className="text-xs text-gray-500">Top sources by uploaded datasets</p>
              </div>
              <FolderOpen className="w-5 h-5" color={ACCENT_DARK} />
            </div>
            {topProjects.length === 0 ? (
              <div className="text-sm text-gray-500">No projects yet.</div>
            ) : (
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={topProjects} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="#F3E8D2" />
                    <XAxis type="number" stroke="#9CA3AF" fontSize={12} allowDecimals={false} />
                    <YAxis type="category" dataKey="name" stroke="#9CA3AF" fontSize={12} width={100} />
                    <Tooltip />
                    <Bar dataKey="count" fill={ACCENT} radius={[0, 8, 8, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          <div className="lg:col-span-2 bg-white border border-amber-100 rounded-2xl p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Recent Activity</h3>
              <span className="text-xs text-gray-400">Unread alerts: {unreadCount}</span>
            </div>
            {loading ? (
              <div className="text-sm text-gray-500">Loading activity...</div>
            ) : activity.length === 0 ? (
              <div className="text-sm text-gray-500">No activity yet.</div>
            ) : (
              <ul className="space-y-4 text-sm">
                {activity.slice(0, 6).map((item) => (
                  <li key={item.id} className="flex items-start gap-3">
                    <div className="w-9 h-9 rounded-full bg-amber-50 flex items-center justify-center">
                      <Activity className="w-4 h-4" color={ACCENT_DARK} />
                    </div>
                    <div>
                      <div className="font-semibold text-gray-900">{item.action}</div>
                      <div className="text-xs text-gray-500">
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
