import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  BellRing,
  CheckCircle2,
  CircleAlert,
  RefreshCcw,
  Search,
  Siren,
  ShieldAlert,
} from "lucide-react";
import { apiFetch } from "../utils/api";

type AlertSeverity = "low" | "medium" | "high";
type AlertStatus = "open" | "resolved";

type AlertItem = {
  id: number;
  alert_type: string;
  severity: AlertSeverity;
  status: AlertStatus;
  title: string;
  message: string;
  source: string;
  project_id: number | null;
  project_name: string | null;
  partner: string | null;
  first_detected_at: string;
  last_detected_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
};

type AlertSummaryBucket = {
  low: number;
  medium: number;
  high: number;
  total: number;
};

type AlertSummary = {
  open: AlertSummaryBucket;
  resolved: AlertSummaryBucket;
};

type SummaryResponse = {
  summary: AlertSummary;
  filters: {
    projects: Array<{ id: number; name: string }>;
    partners: string[];
    alertTypes: string[];
  };
};

const severityTone = (severity: string) => {
  if (severity === "high") return "bg-rose-100 text-rose-700 border-rose-200";
  if (severity === "medium") return "bg-amber-100 text-amber-700 border-amber-200";
  return "bg-emerald-100 text-emerald-700 border-emerald-200";
};

const statusTone = (status: string) =>
  status === "resolved"
    ? "bg-slate-100 text-slate-700 border-slate-200"
    : "bg-amber-100 text-amber-700 border-amber-200";

const alertTypeLabel = (type: string) => {
  const key = String(type || "").toLowerCase();
  if (key === "revenue_drop") return "Revenue Drop";
  if (key === "traffic_spike") return "Traffic Spike";
  if (key === "failed_scheduled_job") return "Failed Scheduled Job";
  if (key === "data_quality_warning") return "Data Quality Warning";
  if (key === "anomaly_detection") return "Anomaly Detection";
  return type
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
};

const defaultSummary: AlertSummary = {
  open: { low: 0, medium: 0, high: 0, total: 0 },
  resolved: { low: 0, medium: 0, high: 0, total: 0 },
};

const AlertCenterPage: React.FC = () => {
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [summary, setSummary] = useState<AlertSummary>(defaultSummary);
  const [projects, setProjects] = useState<Array<{ id: number; name: string }>>([]);
  const [partners, setPartners] = useState<string[]>([]);
  const [alertTypes, setAlertTypes] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [severityFilter, setSeverityFilter] = useState("");
  const [projectFilter, setProjectFilter] = useState("");
  const [partnerFilter, setPartnerFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [searchFilter, setSearchFilter] = useState("");
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [detecting, setDetecting] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState("");
  const canManageAlerts = useMemo(() => {
    const raw = localStorage.getItem("authUser");
    if (!raw) return false;
    try {
      const parsed = JSON.parse(raw);
      const roles = Array.isArray(parsed?.roles)
        ? parsed.roles
        : parsed?.role
          ? [parsed.role]
          : [];
      return roles.includes("admin") || roles.includes("analyst");
    } catch {
      return false;
    }
  }, []);

  const loadSummary = useCallback(async () => {
    const response = await apiFetch("/api/alerts/summary");
    if (!response.ok) {
      throw new Error("Failed to load alert summary");
    }
    const data: SummaryResponse = await response.json();
    setSummary(data?.summary || defaultSummary);
    setProjects(Array.isArray(data?.filters?.projects) ? data.filters.projects : []);
    setPartners(Array.isArray(data?.filters?.partners) ? data.filters.partners : []);
    setAlertTypes(Array.isArray(data?.filters?.alertTypes) ? data.filters.alertTypes : []);
  }, []);

  const loadAlerts = useCallback(async () => {
    const params = new URLSearchParams();
    if (statusFilter) params.set("status", statusFilter);
    if (severityFilter) params.set("severity", severityFilter);
    if (projectFilter) params.set("projectId", projectFilter);
    if (partnerFilter) params.set("partner", partnerFilter);
    if (typeFilter) params.set("alertType", typeFilter);
    if (searchFilter.trim()) params.set("q", searchFilter.trim());
    params.set("limit", "200");

    const response = await apiFetch(`/api/alerts?${params.toString()}`);
    if (!response.ok) {
      throw new Error("Failed to load alerts");
    }
    const data = await response.json();
    setAlerts(Array.isArray(data?.items) ? data.items : []);
    setTotal(Number(data?.total || 0));
    setLastUpdatedAt(new Date().toISOString());
  }, [statusFilter, severityFilter, projectFilter, partnerFilter, typeFilter, searchFilter]);

  const refreshAll = useCallback(async () => {
    setError("");
    setLoading(true);
    try {
      await Promise.all([loadSummary(), loadAlerts()]);
    } catch (err: any) {
      setError(err?.message || "Failed to load alerts");
    } finally {
      setLoading(false);
    }
  }, [loadSummary, loadAlerts]);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      Promise.all([loadSummary(), loadAlerts()]).catch(() => undefined);
    }, 15000);
    return () => window.clearInterval(timer);
  }, [loadSummary, loadAlerts]);

  const runDetection = async () => {
    setDetecting(true);
    setError("");
    try {
      const response = await apiFetch("/api/alerts/detect", { method: "POST" });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || "Failed to run detections");
      }
      await refreshAll();
    } catch (err: any) {
      setError(err?.message || "Failed to run detections");
    } finally {
      setDetecting(false);
    }
  };

  const updateAlertStatus = async (alertId: number, action: "resolve" | "reopen") => {
    setBusyId(alertId);
    setError("");
    try {
      const response = await apiFetch(`/api/alerts/${alertId}/${action}`, { method: "POST" });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `Failed to ${action} alert`);
      }
      await refreshAll();
    } catch (err: any) {
      setError(err?.message || `Failed to ${action} alert`);
    } finally {
      setBusyId(null);
    }
  };

  const clearFilters = () => {
    setStatusFilter("");
    setSeverityFilter("");
    setProjectFilter("");
    setPartnerFilter("");
    setTypeFilter("");
    setSearchFilter("");
  };

  const cards = useMemo(
    () => [
      {
        label: "Open Alerts",
        value: summary.open.total,
        className: "border-amber-200 bg-amber-50 text-amber-900",
        icon: <BellRing className="w-4 h-4" />,
      },
      {
        label: "High Severity",
        value: summary.open.high,
        className: "border-rose-200 bg-rose-50 text-rose-900",
        icon: <Siren className="w-4 h-4" />,
      },
      {
        label: "Data Quality Open",
        value: alerts.filter((item) => item.status === "open" && item.alert_type === "data_quality_warning").length,
        className: "border-amber-200 bg-amber-50 text-amber-900",
        icon: <ShieldAlert className="w-4 h-4" />,
      },
      {
        label: "Resolved History",
        value: summary.resolved.total,
        className: "border-emerald-200 bg-emerald-50 text-emerald-900",
        icon: <CheckCircle2 className="w-4 h-4" />,
      },
    ],
    [summary, alerts]
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 via-white to-orange-50 p-6 md:p-8">
      <div className="max-w-7xl mx-auto space-y-5">
        <section className="rounded-2xl border border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-amber-700">Real-Time Monitoring Hub</p>
              <h2 className="text-3xl font-extrabold text-amber-900">Alert Center</h2>
              <p className="text-sm text-amber-800 mt-1">
                Monitor revenue drops, traffic spikes, schedule failures, data quality warnings, and anomalies.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={refreshAll}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-amber-300 bg-white text-amber-900 hover:bg-amber-100"
              >
                <RefreshCcw className="w-4 h-4" />
                Refresh
              </button>
              {canManageAlerts && (
                <button
                  type="button"
                  onClick={runDetection}
                  disabled={detecting}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-60"
                >
                  <CircleAlert className="w-4 h-4" />
                  {detecting ? "Detecting..." : "Run Detection"}
                </button>
              )}
            </div>
          </div>
          {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
          {lastUpdatedAt && (
            <p className="mt-3 text-xs text-amber-800/80">Last synced: {new Date(lastUpdatedAt).toLocaleString()}</p>
          )}
        </section>

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {cards.map((card) => (
            <div key={card.label} className={`rounded-xl border p-4 ${card.className}`}>
              <div className="flex items-center justify-between text-xs uppercase tracking-wide opacity-80">
                <span>{card.label}</span>
                {card.icon}
              </div>
              <div className="text-3xl font-bold mt-2">{card.value}</div>
            </div>
          ))}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <label className="relative xl:col-span-2">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
                placeholder="Search title, message, partner..."
                className="w-full border border-slate-300 rounded-lg pl-9 pr-3 py-2 text-sm"
              />
            </label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
            >
              <option value="">All status</option>
              <option value="open">Open</option>
              <option value="resolved">Resolved</option>
            </select>
            <select
              value={severityFilter}
              onChange={(e) => setSeverityFilter(e.target.value)}
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
            >
              <option value="">All severity</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
            <select
              value={projectFilter}
              onChange={(e) => setProjectFilter(e.target.value)}
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
            >
              <option value="">All projects</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name || `Project ${project.id}`}
                </option>
              ))}
            </select>
            <select
              value={partnerFilter}
              onChange={(e) => setPartnerFilter(e.target.value)}
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
            >
              <option value="">All partners</option>
              {partners.map((partner) => (
                <option key={partner} value={partner}>
                  {partner}
                </option>
              ))}
            </select>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
            >
              <option value="">All alert types</option>
              {alertTypes.map((type) => (
                <option key={type} value={type}>
                  {alertTypeLabel(type)}
                </option>
              ))}
            </select>
          </div>
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={clearFilters}
              className="text-sm px-3 py-1.5 rounded-lg border border-amber-200 text-amber-700 hover:bg-amber-50"
            >
              Clear filters
            </button>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
            <h3 className="text-xl font-bold text-slate-900">Alert History Log</h3>
            <span className="text-sm text-slate-600">
              Showing {alerts.length} of {total}
            </span>
          </div>

          {loading ? (
            <div className="py-10 text-center text-slate-500">Loading alerts...</div>
          ) : alerts.length === 0 ? (
            <div className="py-10 text-center text-slate-500">No alerts found for the selected filters.</div>
          ) : (
            <div className="space-y-3">
              {alerts.map((alert) => (
                <article
                  key={alert.id}
                  className="rounded-xl border border-slate-200 bg-gradient-to-r from-white to-slate-50 p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h4 className="text-base font-semibold text-slate-900 break-words">{alert.title}</h4>
                      <p className="text-sm text-slate-700 mt-1 break-words">{alert.message}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`px-2.5 py-1 text-xs font-semibold rounded-full border ${severityTone(alert.severity)}`}>
                        {alert.severity.toUpperCase()}
                      </span>
                      <span className={`px-2.5 py-1 text-xs font-semibold rounded-full border ${statusTone(alert.status)}`}>
                        {alert.status.toUpperCase()}
                      </span>
                    </div>
                  </div>

                  <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-5 text-xs text-slate-600">
                    <div>
                      <span className="font-semibold text-slate-700">Type:</span> {alertTypeLabel(alert.alert_type)}
                    </div>
                    <div>
                      <span className="font-semibold text-slate-700">Project:</span>{" "}
                      {alert.project_name || (alert.project_id ? `Project ${alert.project_id}` : "-")}
                    </div>
                    <div>
                      <span className="font-semibold text-slate-700">Partner:</span> {alert.partner || "-"}
                    </div>
                    <div>
                      <span className="font-semibold text-slate-700">Detected:</span>{" "}
                      {new Date(alert.last_detected_at).toLocaleString()}
                    </div>
                    <div>
                      <span className="font-semibold text-slate-700">Resolved:</span>{" "}
                      {alert.resolved_at ? new Date(alert.resolved_at).toLocaleString() : "-"}
                    </div>
                  </div>

                  {canManageAlerts && (
                    <div className="mt-3 flex justify-end">
                      {alert.status === "open" ? (
                        <button
                          type="button"
                          disabled={busyId === alert.id}
                          onClick={() => updateAlertStatus(alert.id, "resolve")}
                          className="text-sm px-3 py-1.5 rounded-lg bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-60"
                        >
                          {busyId === alert.id ? "Saving..." : "Mark Resolved"}
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={busyId === alert.id}
                          onClick={() => updateAlertStatus(alert.id, "reopen")}
                          className="text-sm px-3 py-1.5 rounded-lg border border-amber-200 text-amber-700 hover:bg-amber-50 disabled:opacity-60"
                        >
                          {busyId === alert.id ? "Saving..." : "Reopen"}
                        </button>
                      )}
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

export default AlertCenterPage;
