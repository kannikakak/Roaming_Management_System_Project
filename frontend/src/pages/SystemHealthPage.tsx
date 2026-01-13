import React, { useEffect, useState } from "react";
import { Activity, AlertTriangle, Clock, Database, RefreshCw, ShieldCheck } from "lucide-react";
import { apiFetch } from "../utils/api";

type Health = {
  ok: boolean;
  db: string;
  schedules?: { total: number; active: number; lastRun: string | null };
};

const SystemHealthPage: React.FC = () => {
  const [health, setHealth] = useState<Health | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);

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

  useEffect(() => {
    loadHealth();
    const intervalId = setInterval(loadHealth, 60000);
    return () => clearInterval(intervalId);
  }, []);

  const schedulerTotal = health?.schedules?.total ?? 0;
  const schedulerActive = health?.schedules?.active ?? 0;
  const schedulerPercent =
    schedulerTotal > 0 ? Math.round((schedulerActive / schedulerTotal) * 100) : 0;
  const overallOk = health?.ok ?? false;

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
