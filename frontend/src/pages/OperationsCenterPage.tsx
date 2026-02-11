import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Database,
  Layers,
  Play,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

import { apiFetch } from "../utils/api";
import Surface from "../components/Surface";

/* ----------------------------- Types ----------------------------- */

type ProjectType = { id: number; name: string };

type SourceRow = {
  id: number;
  name: string;
  type: string;
  enabled: boolean;
  projectId: number;
  pollIntervalMinutes: number;
  lastScanAt: string | null;
  lastError: string | null;
};

type FileStatusRow = { status: string; count: number };
type JobResultRow = { result: string | null; count: number };

type TimelineEvent = {
  id: number;
  sourceName: string | null;
  sourceType: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  result: string | null;
  attempt: number;
};

type SourceError = {
  id: number;
  name: string;
  type: string;
  enabled: boolean;
  lastError: string | null;
  lastScanAt: string | null;
};

type Snapshot = {
  totals: {
    projects: number;
    files: number;
    sources: number;
    ingestionFiles: number;
    ingestionJobs: number;
    charts: number;
    reports: number;
  };
  fileStatus: FileStatusRow[];
  jobResults: JobResultRow[];
  timeline: TimelineEvent[];
  recentErrors: SourceError[];
};

type ImpactMetric = {
  label: string;
  current: number;
  previous?: number | null;
  change?: number | null;
  changePercent?: number | null;
  unit?: "currency" | "count" | "usage" | "generic";
};

type ImpactChart = {
  label: string;
  previous: number | null;
  current: number;
  unit: string;
};

type SchemaRename = { from: string; to: string };

type SchemaChanges = {
  previousFileId: number | null;
  previousFileName?: string;
  previousUploadedAt?: string;
  newColumns: string[];
  removedColumns: string[];
  renamedColumns: SchemaRename[];
  warnings: string[];
  summary: string[];
};

type ImpactPayload = {
  projectId: number;
  projectName: string;
  currentFile: { id: number; name: string; uploadedAt: string };
  previousFile?: { id: number; name: string; uploadedAt: string };
  metrics: {
    netRevenue: ImpactMetric;
    usage: ImpactMetric;
    partners: ImpactMetric;
  };
  kpis: ImpactMetric[];
  chart?: ImpactChart;
  insights: string[];
  schemaChanges: SchemaChanges;
};

type NewSourceState = { name: string; path: string; projectId: string };

/* ----------------------------- Helpers ----------------------------- */

const DASH = "—";

const safeJson = async <T,>(response: Response): Promise<T | null> => {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
};

const request = async <T,>(response: Response, fallbackMessage: string): Promise<T> => {
  const payload = await safeJson<any>(response);
  if (!response.ok) {
    throw new Error(payload?.message || fallbackMessage);
  }
  return (payload as T) ?? (null as unknown as T);
};

const formatDateTime = (value: string | null) => (value ? new Date(value).toLocaleString() : DASH);

const statusColor = (status: string) => {
  const s = status.toLowerCase();
  if (s.includes("new") || s.includes("pending")) return "text-amber-600";
  if (s.includes("processing") || s.includes("running")) return "text-blue-600";
  if (s.includes("error") || s.includes("failed")) return "text-red-600";
  return "text-emerald-600";
};

const impactCurrencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 1,
});
const impactNumberFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
});

const formatImpactValue = (value: number, unit?: ImpactMetric["unit"]) => {
  if (unit === "currency") return impactCurrencyFormatter.format(value);
  if (unit === "usage") return `${impactNumberFormatter.format(value)} ${value === 1 ? "unit" : "units"}`;
  return impactNumberFormatter.format(value);
};

const formatChangeLabel = (metric: ImpactMetric) => {
  if (metric.changePercent == null) return null;
  const direction = (metric.change || 0) >= 0 ? "+" : "-";
  return `${direction}${Math.abs(metric.changePercent).toFixed(1)}%`;
};

const timelineLabel = (event: TimelineEvent) => {
  const base = event.sourceName ? event.sourceName : "Ingestion job";
  return `${base} · attempt ${event.attempt}`;
};

/* ----------------------------- Small UI blocks ----------------------------- */

function SectionHeader({
  kicker,
  title,
  description,
  right,
}: {
  kicker: string;
  title: string;
  description?: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p className="text-xs uppercase tracking-[0.6em] text-amber-500">{kicker}</p>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">{title}</h2>
        {description ? <p className="text-gray-500 dark:text-gray-300 text-sm max-w-2xl">{description}</p> : null}
      </div>
      {right ? <div className="flex items-center gap-2">{right}</div> : null}
    </div>
  );
}

/* ----------------------------- Page ----------------------------- */

const OperationsCenterPage: React.FC = () => {
  const userId = useMemo(() => {
    const storedUser = localStorage.getItem("authUser");
    if (!storedUser) return null;
    try {
      return JSON.parse(storedUser)?.id ?? null;
    } catch {
      return null;
    }
  }, []);

  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loadingSnapshot, setLoadingSnapshot] = useState(false);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);

  const [sources, setSources] = useState<SourceRow[]>([]);
  const [loadingSources, setLoadingSources] = useState(false);

  const [projects, setProjects] = useState<ProjectType[]>([]);

  const [impact, setImpact] = useState<ImpactPayload | null>(null);
  const [loadingImpact, setLoadingImpact] = useState(false);
  const [impactError, setImpactError] = useState<string | null>(null);

  const [newSource, setNewSource] = useState<NewSourceState>({ name: "", path: "", projectId: "" });
  const [submitting, setSubmitting] = useState(false);

  const [flash, setFlash] = useState<string | null>(null);
  const [activeAction, setActiveAction] = useState<string | null>(null);

  /* Flash auto-clear */
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 4000);
    return () => clearTimeout(t);
  }, [flash]);

  /* ----------------------------- Data fetching ----------------------------- */

  const fetchSnapshot = useCallback(async () => {
    setLoadingSnapshot(true);
    setSnapshotError(null);
    try {
      const res = await apiFetch("/api/operations/snapshot");
      const data = await request<Snapshot>(res, "Unable to load operations snapshot.");
      setSnapshot(data);
    } catch (err: any) {
      setSnapshotError(err?.message || "Snapshot service unavailable.");
    } finally {
      setLoadingSnapshot(false);
    }
  }, []);

  const fetchSources = useCallback(async () => {
    setLoadingSources(true);
    try {
      const res = await apiFetch("/api/sources");
      const data = await request<SourceRow[]>(res, "Unable to load ingestion sources.");
      setSources(data || []);
    } catch (err: any) {
      setSources([]);
      setFlash(err?.message || "Failed to refresh sources.");
    } finally {
      setLoadingSources(false);
    }
  }, []);

  const fetchProjects = useCallback(async () => {
    if (!userId) return;
    try {
      const res = await apiFetch(`/api/projects?user_id=${userId}`);
      const data = await request<ProjectType[]>(res, "Unable to load projects.");
      setProjects(data || []);
    } catch (err: any) {
      setProjects([]);
      setFlash(err?.message || "Failed to load projects.");
    }
  }, [userId]);

  const fetchImpact = useCallback(async (projectId: number) => {
    if (!projectId) return;
    setLoadingImpact(true);
    setImpactError(null);
    try {
      const res = await apiFetch(`/api/impact/projects/${projectId}/latest`);
      const data = await request<ImpactPayload>(res, "Unable to load impact analysis.");
      setImpact(data);
    } catch (err: any) {
      setImpact(null);
      setImpactError(err?.message || "Failed to refresh upload impact.");
    } finally {
      setLoadingImpact(false);
    }
  }, []);

  /* Initial load */
  useEffect(() => {
    fetchSnapshot();
    fetchSources();
    fetchProjects();
  }, [fetchSnapshot, fetchSources, fetchProjects]);

  /* Load impact once we have projects */
  useEffect(() => {
    if (!projects.length) return;
    fetchImpact(projects[0].id);
  }, [projects, fetchImpact]);

  /* Default project selection for create-source form */
  useEffect(() => {
    if (!projects.length) return;
    setNewSource((prev) => (prev.projectId ? prev : { ...prev, projectId: String(projects[0].id) }));
  }, [projects]);

  const refreshImpact = useCallback(() => {
    const projectId = impact?.projectId || projects[0]?.id;
    if (projectId) fetchImpact(projectId);
  }, [impact?.projectId, projects, fetchImpact]);

  const getSourceActionHint = useCallback(
    (source: SourceRow) => {
      if (!activeAction) return null;
      const [type, idPart] = activeAction.split("-");
      const actionSourceId = Number(idPart);
      if (Number.isNaN(actionSourceId) || actionSourceId !== source.id) return null;
      if (type === "test") return "Testing connection…";
      if (type === "scan") return "Scanning source…";
      if (type === "toggle") return source.enabled ? "Disabling source…" : "Enabling source…";
      return null;
    },
    [activeAction]
  );

  /* ----------------------------- Derived UI data ----------------------------- */

  const projectMap = useMemo(() => new Map(projects.map((p) => [p.id, p.name])), [projects]);

  const heroStatus = useMemo(() => {
    if (!snapshot) return "Gathering telemetry...";
    if (snapshot.recentErrors.length)
      return `${snapshot.recentErrors.length} pending alert${snapshot.recentErrors.length > 1 ? "s" : ""}`;
    return "All systems nominal";
  }, [snapshot]);

  const stats = useMemo(() => {
    if (!snapshot) return [];
    const { totals } = snapshot;
    return [
      {
        label: "Active projects",
        value: totals.projects.toLocaleString(),
        helper: `${totals.sources.toLocaleString()} ingestion sources`,
        icon: <Layers size={24} className="text-amber-600" />,
      },
      {
        label: "Files stored",
        value: totals.files.toLocaleString(),
        helper: `${totals.ingestionFiles.toLocaleString()} rows/processes`,
        icon: <Database size={24} className="text-blue-600" />,
      },
      {
        label: "Ingestion jobs",
        value: totals.ingestionJobs.toLocaleString(),
        helper: `${snapshot.jobResults.reduce((sum, item) => sum + item.count, 0).toLocaleString()} polls run`,
        icon: <Activity size={24} className="text-emerald-600" />,
      },
      {
        label: "Reports ready",
        value: totals.reports.toLocaleString(),
        helper: `${totals.charts.toLocaleString()} semantic statements`,
        icon: <Sparkles size={24} className="text-fuchsia-600" />,
      },
      {
        label: "Guard rails",
        value: `${snapshot.recentErrors.length} errors`,
        helper: "Alerts and remediation in place",
        icon: <ShieldCheck size={24} className="text-teal-600" />,
      },
    ];
  }, [snapshot]);

  /* ----------------------------- Mutations ----------------------------- */

  const handleCreateSource = useCallback(async () => {
    if (!newSource.name.trim() || !newSource.path.trim() || !newSource.projectId) {
      setFlash("Name, project, and path are required.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await apiFetch("/api/sources", {
        method: "POST",
        body: JSON.stringify({
          name: newSource.name.trim(),
          type: "local",
          projectId: Number(newSource.projectId),
          pollIntervalMinutes: 5,
          connectionConfig: {
            path: newSource.path.trim(),
            paths: newSource.path
              .split(/[\r\n;,]+/)
              .map((p) => p.trim())
              .filter(Boolean),
            recursive: true,
            extensions: [".csv", ".xlsx", ".xls"],
          },
          filePattern: "*.csv;*.xlsx;*.xls",
          enabled: true,
        }),
      });

      await request(res, "Unable to create source.");

      setFlash("Source created. Refreshing queue...");
      setNewSource((prev) => ({ ...prev, name: "", path: "" }));
      fetchSnapshot();
      fetchSources();
    } catch (err: any) {
      setFlash(err?.message || "Source creation failed.");
    } finally {
      setSubmitting(false);
    }
  }, [newSource, fetchSnapshot, fetchSources]);

  const handleToggleSource = useCallback(
    async (source: SourceRow) => {
      const actionKey = `toggle-${source.id}`;
      setActiveAction(actionKey);
      try {
        const res = await apiFetch(`/api/sources/${source.id}`, {
          method: "PUT",
          body: JSON.stringify({ enabled: !source.enabled }),
        });
        await request(res, "Unable to update source.");
        setFlash(!source.enabled ? "Source enabled." : "Source disabled.");
        fetchSources();
        fetchSnapshot();
      } catch (err: any) {
        setFlash(err?.message || "Failed to update source.");
      } finally {
        setActiveAction(null);
      }
    },
    [fetchSources, fetchSnapshot]
  );

  const handleSourceAction = useCallback(
    async (id: number, type: "test" | "scan") => {
      const actionKey = `${type}-${id}`;
      setActiveAction(actionKey);
      try {
        const res = await apiFetch(`/api/sources/${id}/${type}`, { method: "POST" });
        await request(res, `Unable to ${type} source.`);
        setFlash(type === "test" ? "Connection validated." : "Scan queued.");
        if (type === "scan") fetchSnapshot();
      } catch (err: any) {
        setFlash(err?.message || `Source ${type} failed.`);
      } finally {
        setActiveAction(null);
      }
    },
    [fetchSnapshot]
  );

  /* ----------------------------- Render ----------------------------- */

  return (
    <div className="min-h-screen bg-gradient-to-b from-white via-amber-50 to-white dark:from-gray-950 dark:via-gray-900 dark:to-gray-900">
      <div className="max-w-7xl mx-auto px-6 py-10 space-y-10">
        {/* Hero */}
        <div className="space-y-4">
          <p className="text-sm uppercase tracking-[0.4em] text-amber-500">Operations intelligence</p>

          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <h1 className="text-4xl md:text-5xl font-extrabold text-gray-900 dark:text-white">
                Roaming control tower
              </h1>
              <p className="mt-2 text-gray-600 dark:text-gray-300 max-w-2xl">
                This page is used to manage source folders, run scans, and verify what changed after each upload.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={fetchSnapshot}
                className="inline-flex items-center gap-2 rounded-full bg-amber-500 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white shadow-lg hover:bg-amber-600 transition"
              >
                <RefreshCw className="w-4 h-4" />
                Refresh all
              </button>
              {snapshotError ? <span className="text-xs font-semibold text-red-600">{snapshotError}</span> : null}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="text-sm font-semibold uppercase text-gray-500 dark:text-gray-400 tracking-[0.5em]">
              {heroStatus}
            </div>
            {loadingSnapshot ? <span className="text-xs text-gray-500">Updating snapshot...</span> : null}
          </div>
        </div>

        <Surface className="p-4 border border-amber-100">
          <p className="text-xs uppercase tracking-[0.4em] text-amber-500">Purpose</p>
          <div className="mt-3 grid gap-3 md:grid-cols-3 text-sm">
            <div className="rounded-xl border border-amber-100 bg-amber-50/40 p-3">
              <p className="font-semibold text-gray-900 dark:text-white">1. Connect folders</p>
              <p className="text-gray-600 dark:text-gray-300">Create source paths and test access.</p>
            </div>
            <div className="rounded-xl border border-amber-100 bg-amber-50/40 p-3">
              <p className="font-semibold text-gray-900 dark:text-white">2. Ingest automatically</p>
              <p className="text-gray-600 dark:text-gray-300">Scan and import new or updated files.</p>
            </div>
            <div className="rounded-xl border border-amber-100 bg-amber-50/40 p-3">
              <p className="font-semibold text-gray-900 dark:text-white">3. Compare impact</p>
              <p className="text-gray-600 dark:text-gray-300">See metric and schema changes between uploads.</p>
            </div>
          </div>
        </Surface>

        {flash ? (
          <div className="p-3 border border-amber-200 bg-amber-50 rounded-xl text-sm text-amber-800">
            {flash}
          </div>
        ) : null}

        {/* Upload impact */}
        <section className="space-y-4">
          <SectionHeader
            kicker="Upload intelligence"
            title="Latest upload impact"
            description="Compare the latest file with the previous file for the same project."
            right={
              <button
                onClick={refreshImpact}
                disabled={loadingImpact}
                className="flex items-center gap-2 rounded-full border border-amber-200 px-4 py-2 text-xs font-semibold text-amber-700 hover:bg-amber-50 disabled:opacity-50"
              >
                <RefreshCw className="w-4 h-4" />
                Refresh impact
              </button>
            }
          />

          {loadingImpact ? (
            <Surface className="p-5 border border-amber-100 text-sm text-gray-500">
              Loading upload comparison...
            </Surface>
          ) : impactError ? (
            <Surface className="p-5 border border-red-200 text-sm text-red-600">{impactError}</Surface>
          ) : impact ? (
            <Surface className="p-6 border border-amber-100 space-y-6">
              {/* Header - File Comparison */}
              <div className="rounded-lg bg-amber-50/50 border border-amber-200 p-4">
                <p className="text-xs uppercase tracking-wider text-amber-600 mb-3 font-semibold">
                  Comparing latest and previous uploads
                </p>
                <div className="grid md:grid-cols-2 gap-4">
                  {/* Current File */}
                  <div className="bg-white rounded-lg p-3 border-2 border-emerald-300">
                    <p className="text-xs text-emerald-600 font-semibold mb-1">Latest upload (new)</p>
                    <p className="text-sm font-bold text-gray-900 dark:text-white">{impact.currentFile.name}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {formatDateTime(impact.currentFile.uploadedAt)}
                    </p>
                  </div>

                  {/* Previous File */}
                  {impact.previousFile ? (
                    <div className="bg-white rounded-lg p-3 border-2 border-gray-300">
                      <p className="text-xs text-gray-600 font-semibold mb-1">Previous upload (old)</p>
                      <p className="text-sm font-bold text-gray-900 dark:text-white">{impact.previousFile.name}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {formatDateTime(impact.previousFile.uploadedAt)}
                      </p>
                    </div>
                  ) : (
                    <div className="bg-gray-50 rounded-lg p-3 border-2 border-dashed border-gray-300 flex items-center justify-center">
                      <p className="text-xs text-gray-500">No previous file to compare</p>
                    </div>
                  )}
                </div>
                <p className="text-xs text-gray-600 mt-3 text-center">
                  Metrics below show what changed between these two uploads.
                </p>
              </div>

              {/* Metrics */}
              <div className="grid gap-4 md:grid-cols-3">
                {Object.values(impact.metrics).map((metric) => (
                  <div key={metric.label} className="rounded-2xl border border-amber-100 p-4">
                    <p className="text-xs uppercase text-gray-500 tracking-wider">{metric.label}</p>
                    <p className="text-2xl font-semibold text-gray-900 dark:text-white">
                      {formatImpactValue(metric.current, metric.unit)}
                    </p>
                    <p className="text-xs text-gray-500">
                      {metric.previous != null
                        ? `${formatChangeLabel(metric) || ""} vs ${formatImpactValue(metric.previous, metric.unit)}`
                        : "No prior baseline"}
                    </p>
                  </div>
                ))}
              </div>

              {/* Insights */}
              {impact.insights.length ? (
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wider">Key insights</p>
                  <ul className="mt-2 space-y-1 text-sm text-gray-600 dark:text-gray-300">
                    {impact.insights.slice(0, 3).map((insight, idx) => (
                      <li key={idx}>- {insight}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {/* Schema changes summary */}
              {impact.schemaChanges?.summary?.length ? (
                <div className="border-t border-amber-50 pt-3">
                  <p className="text-xs text-gray-500 mb-2">Schema changes detected</p>
                  <div className="flex flex-wrap gap-2 text-xs">
                    {impact.schemaChanges.newColumns.length ? (
                      <span className="text-emerald-600">+{impact.schemaChanges.newColumns.length} new</span>
                    ) : null}
                    {impact.schemaChanges.removedColumns.length ? (
                      <span className="text-red-600">-{impact.schemaChanges.removedColumns.length} removed</span>
                    ) : null}
                    {impact.schemaChanges.renamedColumns.length ? (
                      <span className="text-blue-600">{impact.schemaChanges.renamedColumns.length} renamed</span>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </Surface>
          ) : (
            <Surface className="p-5 border border-amber-100 text-sm text-gray-500">
              Impact analysis will appear after you upload at least one file.
            </Surface>
          )}
        </section>

        {/* Stats */}
        <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
          {stats.length ? (
            stats.map((stat) => (
              <Surface
                key={stat.label}
                className="p-4 flex flex-col justify-between border-l-4 border-amber-200 shadow-lg"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center justify-center w-12 h-12 bg-amber-50 rounded-2xl">{stat.icon}</div>
                  <div className="text-right">
                    <p className="text-xs uppercase text-gray-500">{stat.label}</p>
                    <p className="text-3xl font-semibold text-gray-900 dark:text-white">{stat.value}</p>
                  </div>
                </div>
                <p className="mt-3 text-xs text-gray-500">{stat.helper}</p>
              </Surface>
            ))
          ) : (
            <Surface className="p-6 text-center text-gray-500">Loading snapshot...</Surface>
          )}
        </div>

        {/* Timeline + Health */}
        <section className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          <Surface className="p-6 space-y-6 border border-amber-100">
            <SectionHeader kicker="Live timeline" title="Ingestion flow" />

            <div className="space-y-4">
              {/* Timeline */}
              {snapshot?.timeline?.length ? (
                snapshot.timeline.map((event) => (
                  <div key={event.id} className="rounded-2xl border border-gray-100 dark:border-white/10 p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-semibold text-gray-900 dark:text-white">{timelineLabel(event)}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          {(event.sourceType || "Local") + " - " + (event.result || "in progress")}
                        </p>
                      </div>
                      <span className={`text-xs font-semibold ${statusColor(event.result || "running")}`}>
                        {event.result ? event.result : "Running"}
                      </span>
                    </div>

                    <div className="mt-3 text-xs text-gray-500 dark:text-gray-400">
                      Started: {formatDateTime(event.startedAt)}
                      {event.finishedAt ? ` - Finished: ${formatDateTime(event.finishedAt)}` : ""}
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-sm text-gray-500">No timeline events yet.</p>
              )}
            </div>
          </Surface>

          <Surface className="p-6 space-y-6 border border-amber-100">
            <SectionHeader kicker="Health pulses" title="File & job states" />

            <div className="space-y-3">
              {snapshot?.fileStatus?.map((row) => (
                <div key={row.status} className="flex items-center justify-between text-sm text-gray-600 dark:text-gray-300">
                  <div className="font-semibold">{row.status}</div>
                  <div>{row.count}</div>
                </div>
              ))}
            </div>

            <div className="space-y-2">
              {snapshot?.jobResults?.map((row) => (
                <div key={`${row.result ?? "unknown"}-${row.count}`} className="flex items-center justify-between text-xs text-gray-500">
                  <span>{row.result || "unknown"}</span>
                  <span className="font-semibold text-gray-900 dark:text-white">{row.count}</span>
                </div>
              ))}
            </div>
          </Surface>
        </section>

        {/* Sources */}
        <section className="space-y-6">
          <SectionHeader
            kicker="Ingestion sources"
            title="CRUD & control"
            description="Provision local connectors, trigger scans, and validate paths without leaving the dashboard."
            right={
              <button
                onClick={fetchSources}
                className="flex items-center gap-2 rounded-full border border-amber-200 px-4 py-2 text-sm font-semibold text-amber-700 hover:bg-amber-50"
              >
                <RefreshCw size={16} /> Refresh sources
              </button>
            }
          />

          <div className="grid gap-6 lg:grid-cols-2">
            {/* Create source */}
            <Surface className="p-5 space-y-4 border border-amber-100">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Create new source</h3>

              <div className="space-y-3 text-sm text-gray-600 dark:text-gray-300">
                <div>
                  <label className="block mb-1 font-medium text-gray-700 dark:text-gray-200">Name</label>
                  <input
                    value={newSource.name}
                    onChange={(e) => setNewSource((prev) => ({ ...prev, name: e.target.value }))}
                    className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-amber-400 focus:outline-none"
                    placeholder="e.g. Cellcard Roaming CDRs"
                  />
                </div>

                <div>
                  <label className="block mb-1 font-medium text-gray-700 dark:text-gray-200">Project</label>
                  <select
                    value={newSource.projectId}
                    onChange={(e) => setNewSource((prev) => ({ ...prev, projectId: e.target.value }))}
                    className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm focus:border-amber-400 focus:outline-none"
                  >
                    {projects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}
                      </option>
                    ))}
                    {!projects.length ? <option value="">(No projects yet)</option> : null}
                  </select>
                </div>

                <div>
                  <label className="block mb-1 font-medium text-gray-700 dark:text-gray-200">Local path(s)</label>
                  <input
                    value={newSource.path}
                    onChange={(e) => setNewSource((prev) => ({ ...prev, path: e.target.value }))}
                    className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-amber-400 focus:outline-none"
                    placeholder="e.g. /ingest/roaming;/ingest/partner-b"
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    Use `;` to add multiple folders. Subfolders are scanned automatically.
                  </p>
                </div>
              </div>

              <button
                disabled={submitting}
                onClick={handleCreateSource}
                className="w-full rounded-full bg-amber-500 px-4 py-2 text-sm font-semibold text-white shadow-lg hover:bg-amber-600 disabled:opacity-60"
              >
                Create source
              </button>
            </Surface>

            {/* Sources table */}
            <Surface className="p-5 space-y-4 border border-amber-100">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Live controls</h3>

              <div className="overflow-y-auto max-h-[360px] text-sm">
                {loadingSources ? (
                  <p className="text-gray-500">Loading sources...</p>
                ) : sources.length === 0 ? (
                  <p className="text-gray-500">No sources defined yet.</p>
                ) : (
                  <table className="w-full text-left">
                    <thead className="text-xs uppercase text-gray-500">
                      <tr>
                        <th className="pb-2">Source</th>
                        <th className="pb-2">Status</th>
                        <th className="pb-2">Actions</th>
                      </tr>
                    </thead>

                    <tbody className="text-gray-700 dark:text-gray-200">
                      {sources.map((source) => {
                        const actionHint = getSourceActionHint(source);
                        return (
                          <tr key={source.id} className="border-t border-gray-100 dark:border-white/5">
                            <td className="py-3">
                              <div className="font-semibold text-gray-900 dark:text-white">{source.name}</div>
                              <div className="text-xs text-gray-500">
                                {projectMap.get(source.projectId) || "Unknown project"}
                              </div>
                            </td>

                            <td className="py-3">
                              <div className="text-xs font-semibold">{source.enabled ? "Enabled" : "Disabled"}</div>
                              <div className="text-xs text-gray-500">Last scan: {formatDateTime(source.lastScanAt)}</div>
                            </td>

                            <td className="py-3">
                              <div className="flex flex-wrap gap-2">
                                <button
                                  onClick={() => handleToggleSource(source)}
                                  disabled={activeAction === `toggle-${source.id}`}
                                  className="rounded-full border border-gray-200 px-3 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-100 disabled:opacity-50"
                                >
                                  {source.enabled ? "Disable" : "Enable"}
                                </button>

                                <button
                                  onClick={() => handleSourceAction(source.id, "test")}
                                  disabled={activeAction === `test-${source.id}`}
                                  className="rounded-full border border-amber-200 px-3 py-1 text-xs font-semibold text-amber-600 hover:bg-amber-50 disabled:opacity-50"
                                >
                                  <Play className="inline w-3 h-3 mr-1" />
                                  Test
                                </button>

                                <button
                                  onClick={() => handleSourceAction(source.id, "scan")}
                                  disabled={activeAction === `scan-${source.id}`}
                                  className="rounded-full border border-blue-200 px-3 py-1 text-xs font-semibold text-blue-600 hover:bg-blue-50 disabled:opacity-50"
                                >
                                  <Activity className="inline w-3 h-3 mr-1" />
                                  Scan
                                </button>
                              </div>
                              {actionHint ? (
                                <p className="mt-2 text-xs text-amber-600">{actionHint}</p>
                              ) : null}

                              {source.lastError ? (
                                <p className="mt-1 text-xs text-red-600">
                                  <AlertTriangle size={12} className="mr-1 inline" />
                                  {source.lastError}
                                </p>
                              ) : null}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </Surface>
          </div>
        </section>

        {/* Alerts */}
        <section className="space-y-4">
          <Surface className="p-5 border border-amber-100">
            <SectionHeader kicker="Signal watchdog" title="Recent alerts" />
            <div className="mt-4 space-y-3">
              {snapshot?.recentErrors?.length ? (
                snapshot.recentErrors.map((err) => (
                  <div
                    key={err.id}
                    className="flex items-center justify-between rounded-2xl border border-red-100 bg-red-50/70 p-3"
                  >
                    <div>
                      <p className="text-sm font-semibold text-red-700">{err.name}</p>
                      <p className="text-xs text-red-600">{err.type}</p>
                      <p className="text-xs text-red-600">Last scan: {formatDateTime(err.lastScanAt)}</p>
                    </div>
                    <CheckCircle2 size={20} className={err.enabled ? "text-emerald-600" : "text-gray-500"} />
                  </div>
                ))
              ) : (
                <p className="text-sm text-gray-500">No alerting errors recorded yet.</p>
              )}
            </div>
          </Surface>
        </section>
      </div>
    </div>
  );
};

export default OperationsCenterPage;




