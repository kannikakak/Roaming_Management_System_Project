import React, { useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Clock,
  Database,
  FileUp,
  HardDrive,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
  UserRound,
} from "lucide-react";
import { apiFetch } from "../utils/api";

type HealthMetrics = {
  activeUsers: number;
  filesProcessedToday: number;
  avgProcessingTimeMs: number;
  failedJobs: number;
  storageUsageBytes: number;
  storageBreakdown?: {
    databaseBytes: number;
    uploadsBytes: number;
  };
};

type Health = {
  ok: boolean;
  db: string;
  schedules?: { total: number; active: number; lastRun: string | null };
  metrics?: HealthMetrics;
};

type RetentionConfig = {
  enabled: boolean;
  days: number;
  mode: "delete" | "archive";
  deleteFiles: boolean;
  intervalHours: number;
};

const formatStorage = (bytes: number) => {
  const value = Number(bytes || 0);
  if (value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let next = value;
  let idx = 0;
  while (next >= 1024 && idx < units.length - 1) {
    next /= 1024;
    idx += 1;
  }
  return `${next.toFixed(next >= 100 ? 0 : next >= 10 ? 1 : 2)} ${units[idx]}`;
};

const formatAvgProcessing = (ms: number) => {
  const value = Number(ms || 0);
  if (value <= 0) return "N/A";
  if (value < 1000) return `${Math.round(value)} ms`;
  return `${(value / 1000).toFixed(2)} s`;
};

const SystemHealthPage: React.FC = () => {
  const [health, setHealth] = useState<Health | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [retention, setRetention] = useState<RetentionConfig | null>(null);
  const [savingRetention, setSavingRetention] = useState(false);
  const [retentionMessage, setRetentionMessage] = useState<string | null>(null);

  const loadHealth = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch("/api/system/health");
      if (!res.ok) throw new Error("Failed to load system health.");
      const data = await res.json();
      setHealth(data);
      setLastChecked(new Date());
    } catch (err: any) {
      setError(err.message || "Failed to load system health.");
    } finally {
      setLoading(false);
    }
  };

  const loadRetention = async () => {
    try {
      const res = await apiFetch("/api/system/retention");
      if (!res.ok) throw new Error("Failed to load retention settings.");
      const data = await res.json();
      setRetention(data.config);
    } catch (err: any) {
      setRetentionMessage(err.message || "Failed to load retention settings.");
    }
  };

  const saveRetention = async () => {
    if (!retention) return;
    setSavingRetention(true);
    setRetentionMessage(null);
    try {
      const res = await apiFetch("/api/system/retention", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(retention),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || "Failed to save retention settings.");
      setRetention(data.config);
      setRetentionMessage("Retention settings updated.");
    } catch (err: any) {
      setRetentionMessage(err.message || "Failed to save retention settings.");
    } finally {
      setSavingRetention(false);
    }
  };

  useEffect(() => {
    loadHealth();
    loadRetention();
    const intervalId = setInterval(loadHealth, 60000);
    return () => clearInterval(intervalId);
  }, []);

  const schedulerTotal = health?.schedules?.total ?? 0;
  const schedulerActive = health?.schedules?.active ?? 0;
  const schedulerPercent =
    schedulerTotal > 0 ? Math.round((schedulerActive / schedulerTotal) * 100) : 0;
  const overallOk = health?.ok ?? false;
  const activeUsers = health?.metrics?.activeUsers ?? 0;
  const filesProcessedToday = health?.metrics?.filesProcessedToday ?? 0;
  const avgProcessingTimeMs = health?.metrics?.avgProcessingTimeMs ?? 0;
  const failedJobs = health?.metrics?.failedJobs ?? 0;
  const storageUsageBytes = health?.metrics?.storageUsageBytes ?? 0;
  const storageDbBytes = health?.metrics?.storageBreakdown?.databaseBytes ?? 0;
  const storageUploadsBytes = health?.metrics?.storageBreakdown?.uploadsBytes ?? 0;

  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 via-white to-orange-50 p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col gap-3 mb-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-3xl font-bold text-amber-800">System Health</h2>
              <p className="text-sm text-gray-600">
                Live status of core services and automated schedules.
              </p>
            </div>
            <button
              onClick={loadHealth}
              className="inline-flex items-center gap-2 text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-4 py-2 hover:bg-amber-100"
            >
              <RefreshCw className="w-4 h-4" />
              Refresh
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-6">
          <div className="bg-white border rounded-2xl p-5 shadow-sm">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-xs uppercase tracking-widest text-gray-400 font-semibold">
                  Overall
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-amber-600" />
                  <span className="text-lg font-semibold text-gray-900">
                    {overallOk ? "Healthy" : "Attention Needed"}
                  </span>
                </div>
              </div>
              <span
                className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${
                  overallOk
                    ? "bg-green-50 text-green-700 border-green-200"
                    : "bg-red-50 text-red-700 border-red-200"
                }`}
              >
                {overallOk ? "OK" : "Issue"}
              </span>
            </div>
            <div className="mt-4 text-xs text-gray-500 flex items-center gap-2">
              <Clock className="w-4 h-4" />
              {lastChecked ? `Checked ${lastChecked.toLocaleTimeString()}` : "Not checked yet"}
            </div>
          </div>

          <div className="bg-white border rounded-2xl p-5 shadow-sm">
            <div className="text-xs uppercase tracking-widest text-gray-400 font-semibold">
              Database
            </div>
            <div className="mt-2 flex items-center gap-2">
              <Database className="w-5 h-5 text-amber-600" />
              <span className="text-lg font-semibold text-gray-900">
                {health?.db || "Unknown"}
              </span>
            </div>
            <div className="mt-3 text-xs text-gray-500">
              Connection status for primary storage.
            </div>
          </div>

          <div className="bg-white border rounded-2xl p-5 shadow-sm">
            <div className="text-xs uppercase tracking-widest text-gray-400 font-semibold">
              Scheduler
            </div>
            <div className="mt-2 flex items-center gap-2">
              <Activity className="w-5 h-5 text-amber-600" />
              <span className="text-lg font-semibold text-gray-900">
                {schedulerActive} / {schedulerTotal} Active
              </span>
            </div>
            <div className="mt-3">
              <div className="h-2 rounded-full bg-amber-100 overflow-hidden">
                <div
                  className="h-full bg-amber-500"
                  style={{ width: `${schedulerPercent}%` }}
                />
              </div>
              <div className="mt-2 text-xs text-gray-500">{schedulerPercent}% coverage</div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4 mb-6">
          <div className="bg-white border rounded-2xl p-4 shadow-sm">
            <div className="text-xs uppercase tracking-widest text-gray-400 font-semibold">
              Active Users
            </div>
            <div className="mt-2 flex items-center gap-2">
              <UserRound className="w-5 h-5 text-amber-600" />
              <span className="text-xl font-semibold text-gray-900">{activeUsers}</span>
            </div>
            <p className="mt-2 text-xs text-gray-500">Signed-in users with valid sessions now.</p>
          </div>

          <div className="bg-white border rounded-2xl p-4 shadow-sm">
            <div className="text-xs uppercase tracking-widest text-gray-400 font-semibold">
              Files Today
            </div>
            <div className="mt-2 flex items-center gap-2">
              <FileUp className="w-5 h-5 text-amber-600" />
              <span className="text-xl font-semibold text-gray-900">{filesProcessedToday}</span>
            </div>
            <p className="mt-2 text-xs text-gray-500">Files uploaded and processed since midnight.</p>
          </div>

          <div className="bg-white border rounded-2xl p-4 shadow-sm">
            <div className="text-xs uppercase tracking-widest text-gray-400 font-semibold">
              Avg Processing Time
            </div>
            <div className="mt-2 flex items-center gap-2">
              <Clock className="w-5 h-5 text-amber-600" />
              <span className="text-xl font-semibold text-gray-900">
                {formatAvgProcessing(avgProcessingTimeMs)}
              </span>
            </div>
            <p className="mt-2 text-xs text-gray-500">Average ingestion job duration for today.</p>
          </div>

          <div className="bg-white border rounded-2xl p-4 shadow-sm">
            <div className="text-xs uppercase tracking-widest text-gray-400 font-semibold">
              Failed Jobs
            </div>
            <div className="mt-2 flex items-center gap-2">
              <TriangleAlert className="w-5 h-5 text-red-600" />
              <span className="text-xl font-semibold text-gray-900">{failedJobs}</span>
            </div>
            <p className="mt-2 text-xs text-gray-500">Ingestion and scheduler failures today.</p>
          </div>

          <div className="bg-white border rounded-2xl p-4 shadow-sm">
            <div className="text-xs uppercase tracking-widest text-gray-400 font-semibold">
              Storage Usage
            </div>
            <div className="mt-2 flex items-center gap-2">
              <HardDrive className="w-5 h-5 text-amber-600" />
              <span className="text-xl font-semibold text-gray-900">
                {formatStorage(storageUsageBytes)}
              </span>
            </div>
            <p className="mt-2 text-xs text-gray-500">
              DB {formatStorage(storageDbBytes)} + uploads {formatStorage(storageUploadsBytes)}.
            </p>
          </div>
        </div>

        <div className="bg-white border rounded-2xl p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-900">Health Checks</h3>
            {health?.schedules?.lastRun && (
              <div className="text-xs text-gray-500">
                Last schedule run {new Date(health.schedules.lastRun).toLocaleString()}
              </div>
            )}
          </div>

          {loading ? (
            <div className="text-sm text-gray-500">Loading...</div>
          ) : error ? (
            <div className="flex items-center gap-2 text-sm text-red-600">
              <AlertTriangle className="w-4 h-4" />
              {error}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div className="border rounded-xl p-4">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-gray-800">Database Connection</span>
                  <span className="text-xs font-semibold px-2 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                    {health?.db || "Unknown"}
                  </span>
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  Ensures queries and imports can run without interruption.
                </p>
              </div>

              <div className="border rounded-xl p-4">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-gray-800">Scheduler Service</span>
                  <span className="text-xs font-semibold px-2 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                    {schedulerActive} of {schedulerTotal} active
                  </span>
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  Tracks automated deliveries and recurring reports.
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="mt-6 bg-white border rounded-2xl p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-900">Data Retention Policy</h3>
          </div>

          {!retention ? (
            <div className="text-sm text-gray-500">Loading retention settings...</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div className="space-y-3">
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={retention.enabled}
                    onChange={(e) =>
                      setRetention((prev) => prev && { ...prev, enabled: e.target.checked })
                    }
                  />
                  Enable retention
                </label>
                <label className="text-sm text-gray-700">
                  Retention days
                  <input
                    type="number"
                    min={0}
                    className="mt-1 w-full rounded-lg border border-amber-200 px-3 py-2 text-sm"
                    value={retention.days}
                    onChange={(e) =>
                      setRetention((prev) => prev && { ...prev, days: Number(e.target.value) })
                    }
                  />
                </label>
                <label className="text-sm text-gray-700">
                  Mode
                  <select
                    className="mt-1 w-full rounded-lg border border-amber-200 px-3 py-2 text-sm"
                    value={retention.mode}
                    onChange={(e) =>
                      setRetention((prev) => prev && { ...prev, mode: e.target.value as RetentionConfig["mode"] })
                    }
                  >
                    <option value="delete">Delete</option>
                    <option value="archive">Archive</option>
                  </select>
                </label>
              </div>

              <div className="space-y-3">
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={retention.deleteFiles}
                    onChange={(e) =>
                      setRetention((prev) => prev && { ...prev, deleteFiles: e.target.checked })
                    }
                  />
                  Delete uploaded files from disk
                </label>
                <label className="text-sm text-gray-700">
                  Check interval (hours)
                  <input
                    type="number"
                    min={1}
                    className="mt-1 w-full rounded-lg border border-amber-200 px-3 py-2 text-sm"
                    value={retention.intervalHours}
                    onChange={(e) =>
                      setRetention((prev) => prev && { ...prev, intervalHours: Number(e.target.value) })
                    }
                  />
                </label>
                <button
                  onClick={saveRetention}
                  disabled={savingRetention}
                  className="inline-flex items-center gap-2 rounded-full bg-amber-500 px-4 py-2 text-xs font-semibold text-white hover:bg-amber-600 disabled:opacity-60"
                >
                  Save retention policy
                </button>
                {retentionMessage && (
                  <div className="text-xs text-gray-600">{retentionMessage}</div>
                )}
              </div>
            </div>
          )}
        </div>

        {!loading && overallOk === false && (
          <div className="mt-6 bg-red-50 border border-red-200 rounded-2xl p-5 text-sm text-red-700">
            <div className="font-semibold mb-2">Attention Required</div>
            <p>
              One or more services are reporting issues. Check the database connection and
              scheduler status, then refresh.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default SystemHealthPage;
