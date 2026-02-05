import React, { useCallback, useEffect, useRef, useState } from "react";
import { ClipboardList, Shield } from "lucide-react";

import Surface from "../components/Surface";
import { apiFetch } from "../utils/api";

type ProjectType = { id: number; name: string };
type FileType = {
  id: number;
  name: string;
  uploadedAt: string;
  qualityScore?: number | null;
  trustLevel?: string | null;
};

type HighlightSeverity = "info" | "warning" | "critical";

type DataQualityHighlight = {
  label: string;
  value: string;
  detail: string;
  severity?: HighlightSeverity;
};

type SchemaRename = {
  from: string;
  to: string;
};

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

type DataQualitySummary = {
  fileId: number;
  fileName: string;
  uploadedAt: string;
  score: number;
  badge: "good" | "warning" | "poor";
  status: string;
  confidence: "High" | "Medium" | "Low";
  issues: string[];
  highlights: DataQualityHighlight[];
  metrics: {
    missingRate: number;
    partnerMissingRate: number;
    negativeRevenueRate: number;
    missingDateRate: number;
    invalidRevenueRate: number;
    timeCoverage: number;
    partnerCoverage: number;
    rowCount: number;
    columnCount: number;
    uniquePartners: number;
    uniqueDates: number;
  };
  columns: {
    revenueColumn?: string;
    partnerColumn?: string;
    dateColumn?: string;
  };
  schemaChanges: SchemaChanges;
};

const badgeStyles: Record<DataQualitySummary["badge"], { label: string; className: string }> = {
  good: { label: "Good", className: "text-emerald-700 bg-emerald-50" },
  warning: { label: "Warning", className: "text-amber-700 bg-amber-50" },
  poor: { label: "Poor", className: "text-red-700 bg-red-50" },
};

const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
const safeScore = (value?: number | null) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};
const badgeFromScore = (score: number): DataQualitySummary["badge"] =>
  score >= 90 ? "good" : score >= 75 ? "warning" : "poor";

const formatDateString = (value?: string) => {
  if (!value) return "N/A";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
};

const highlightTone = (severity: HighlightSeverity | undefined) => {
  if (severity === "critical") return "text-rose-600 bg-rose-50 border-rose-100";
  if (severity === "warning") return "text-amber-700 bg-amber-50 border-amber-100";
  return "text-slate-700 bg-white border-slate-100 dark:bg-gray-900 dark:border-gray-800 dark:text-slate-200";
};

const DataQualityPage: React.FC = () => {
  const storedUser = localStorage.getItem("authUser");
  const userId = storedUser ? JSON.parse(storedUser).id : null;

  const [projects, setProjects] = useState<ProjectType[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [files, setFiles] = useState<FileType[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [selectedFileId, setSelectedFileId] = useState<number | null>(null);
  const [quality, setQuality] = useState<DataQualitySummary | null>(null);
  const [loadingQuality, setLoadingQuality] = useState(false);
  const [qualityError, setQualityError] = useState<string | null>(null);
  const [qualityCache, setQualityCache] = useState<Record<number, DataQualitySummary | null>>({});
  const prefetchingIds = useRef<Set<number>>(new Set());

  const fetchProjects = useCallback(async () => {
    if (!userId) return;
    setLoadingProjects(true);
    try {
      const res = await apiFetch(`/api/projects?user_id=${userId}`);
      const data = await res.json();
      setProjects(data || []);
      if (Array.isArray(data) && data.length) {
        setSelectedProjectId(data[0].id);
      }
    } catch (err: any) {
      console.error(err);
    } finally {
      setLoadingProjects(false);
    }
  }, [userId]);

  const fetchFiles = useCallback(async (projectId: number) => {
    setLoadingFiles(true);
    try {
      const res = await apiFetch(`/api/files?projectId=${projectId}`);
      const data = await res.json();
      const list = (data?.files || []) as FileType[];
      setFiles(list);
      setQualityCache((prev) => {
        const filtered: Record<number, DataQualitySummary | null> = {};
        list.forEach((file) => {
          if (Object.prototype.hasOwnProperty.call(prev, file.id)) {
            filtered[file.id] = prev[file.id];
          }
        });
        return filtered;
      });
      if (list.length) {
        setSelectedFileId(list[0].id);
      } else {
        setSelectedFileId(null);
        setQuality(null);
        setQualityCache({});
      }
    } catch (err: any) {
      console.error(err);
      setFiles([]);
      setSelectedFileId(null);
      setQuality(null);
      setQualityCache({});
    } finally {
      setLoadingFiles(false);
    }
  }, []);

  const loadQualitySummary = useCallback(async (fileId: number) => {
    try {
      const response = await apiFetch(`/api/data-quality/files/${fileId}/summary`);
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const message = payload?.message || "Failed to fetch data quality summary.";
        setQualityCache((prev) => ({ ...prev, [fileId]: null }));
        throw new Error(message);
      }
      const summary = payload as DataQualitySummary;
      setQualityCache((prev) => ({ ...prev, [fileId]: summary }));
      return summary;
    } catch (err) {
      setQualityCache((prev) => ({ ...prev, [fileId]: null }));
      throw err;
    }
  }, []);

  const fetchQuality = useCallback(async (fileId: number) => {
    setLoadingQuality(true);
    setQualityError(null);
    try {
      const data = await loadQualitySummary(fileId);
      setQuality(data ?? null);
    } catch (err: any) {
      console.error(err);
      setQuality(null);
      setQualityError(err?.message || "Unable to load data quality summary.");
    } finally {
      setLoadingQuality(false);
    }
  }, [loadQualitySummary]);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  useEffect(() => {
    if (selectedProjectId) {
      fetchFiles(selectedProjectId);
    }
  }, [selectedProjectId, fetchFiles]);

  useEffect(() => {
    if (selectedFileId) {
      fetchQuality(selectedFileId);
    }
  }, [selectedFileId, fetchQuality]);

  useEffect(() => {
    if (!files.length) return;
    const missingIds = files
      .map((file) => file.id)
      .filter((id) => !Object.prototype.hasOwnProperty.call(qualityCache, id));
    if (!missingIds.length) return;
    missingIds.forEach((id) => {
      if (prefetchingIds.current.has(id)) return;
      prefetchingIds.current.add(id);
      loadQualitySummary(id)
        .catch(() => {})
        .finally(() => {
          prefetchingIds.current.delete(id);
        });
    });
  }, [files, loadQualitySummary, qualityCache]);

  useEffect(() => {
    if (!selectedProjectId) return undefined;
    const interval = setInterval(() => {
      fetchFiles(selectedProjectId);
    }, 30000);
    return () => clearInterval(interval);
  }, [selectedProjectId, fetchFiles]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-white via-amber-50 to-white dark:from-gray-950 dark:via-gray-900 dark:to-gray-900">
      <div className="max-w-6xl mx-auto px-6 py-10 space-y-10">
        <div>
          <p className="text-sm uppercase tracking-[0.4em] text-amber-500">Data trust</p>
          <h1 className="text-4xl md:text-5xl font-extrabold text-gray-900 dark:text-white mt-2">
            Data Quality & Completeness
          </h1>
          <p className="mt-2 text-gray-600 dark:text-gray-300 max-w-2xl">
            Every upload gets a 0–100 quality score and a badge so teams know whether they can trust the report.
          </p>
        </div>

        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <ClipboardList className="w-6 h-6 text-amber-500" />
            <div>
              <p className="text-xs uppercase text-gray-500">Project</p>
              <select
                value={selectedProjectId ?? ""}
                onChange={(event) => setSelectedProjectId(Number(event.target.value))}
                className="rounded-full border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 focus:border-amber-500"
              >
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
                {!projects.length && <option value="">(No projects yet)</option>}
              </select>
            </div>
          </div>
          <div className="text-xs text-gray-500">
            {loadingProjects ? "Loading projects..." : `${projects.length} projects available`}
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          {loadingFiles ? (
            <Surface className="p-4 text-center text-sm text-gray-500">Loading files…</Surface>
          ) : files.length === 0 ? (
            <Surface className="p-4 text-center text-sm text-gray-500">
              Upload a file to start scoring its completeness.
            </Surface>
          ) : (
            files.map((file) => {
              const cachedSummary = qualityCache[file.id];
              const cardScoreValue = cachedSummary?.score ?? file.qualityScore ?? 0;
              const displayScore = safeScore(cardScoreValue);
              const badgeKey = cachedSummary?.badge ?? badgeFromScore(displayScore);
              const badgeInfo = badgeStyles[badgeKey];
              const hasCachedEntry = Object.prototype.hasOwnProperty.call(qualityCache, file.id);
              const statusText =
                cachedSummary && cachedSummary.status
                  ? cachedSummary.status
                  : hasCachedEntry
                    ? "Quality check failed"
                    : "Analyzing data quality...";
              return (
                <Surface
                  key={file.id}
                  onClick={() => setSelectedFileId(file.id)}
                  className={`cursor-pointer border ${selectedFileId === file.id ? "border-amber-400" : "border-transparent"} p-4 space-y-2 transition-shadow hover:shadow-md`}
                >
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-gray-900 dark:text-white">{file.name}</p>
                    <span className={`px-2 py-1 text-xs font-semibold rounded-full ${badgeInfo.className}`}>
                      {badgeInfo.label}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500">{new Date(file.uploadedAt).toLocaleString()}</p>
                  <p className="text-xs text-gray-500">{statusText}</p>
                  <div className="text-3xl font-bold text-gray-900 dark:text-white">{displayScore.toFixed(1)}</div>
                  <p className="text-xs uppercase tracking-[0.4em] text-gray-400">quality score</p>
                </Surface>
              );
            })
          )}
        </div>

        <Surface className="p-6 border border-amber-100 space-y-4">
          <div className="flex items-center gap-3">
            <Shield className="w-5 h-5 text-amber-500" />
            <div>
              <p className="text-xs uppercase tracking-[0.4em] text-gray-500">What matters</p>
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">Trust the file</h2>
            </div>
            <button
              onClick={() => selectedFileId && fetchQuality(selectedFileId)}
              disabled={!selectedFileId || loadingQuality}
              className="ml-auto flex items-center gap-2 rounded-full border border-amber-200 px-3 py-1 text-xs font-semibold text-amber-700 hover:bg-amber-50 disabled:opacity-50"
            >
              Refresh badge
            </button>
          </div>

          {loadingQuality ? (
            <p className="text-sm text-gray-500">Refreshing quality summary…</p>
          ) : qualityError ? (
            <p className="text-sm text-red-600">{qualityError}</p>
          ) : !quality ? (
            <p className="text-sm text-gray-500">Select a file to review its quality issues.</p>
          ) : (
            <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
              <div className="space-y-4 rounded-2xl border border-amber-50 bg-gradient-to-br from-amber-50 via-white to-white p-5 shadow-sm">
                <p className="text-xs uppercase tracking-[0.4em] text-gray-500">Quality score</p>
                <div className="flex items-baseline gap-3">
                  <span className="text-5xl font-extrabold text-gray-900 dark:text-white">
                    {safeScore(quality.score).toFixed(1)}
                  </span>
                  <span className="text-sm text-gray-500">/ 100</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-white/50">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-amber-500 to-amber-300 transition-all"
                    style={{ width: `${Math.min(100, safeScore(quality.score))}%` }}
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className={`px-2 py-1 rounded-full ${badgeStyles[quality.badge].className}`}>
                    {badgeStyles[quality.badge].label}
                  </span>
                  <span className="rounded-full border border-gray-200 px-2 py-1 text-amber-700">
                    Confidence {quality.confidence}
                  </span>
                </div>
                <p className="text-xs text-gray-500">{quality.status}</p>
                <div className="flex flex-wrap gap-2 text-[0.65rem] text-gray-600">
                  <span className="rounded-full border border-gray-200 px-2 py-1 bg-white dark:bg-slate-900">
                    {quality.metrics.rowCount} rows
                  </span>
                  <span className="rounded-full border border-gray-200 px-2 py-1 bg-white dark:bg-slate-900">
                    {quality.metrics.columnCount} columns
                  </span>
                  <span className="rounded-full border border-gray-200 px-2 py-1 bg-white dark:bg-slate-900">
                    {quality.metrics.uniquePartners} partners
                  </span>
                  <span className="rounded-full border border-gray-200 px-2 py-1 bg-white dark:bg-slate-900">
                    {quality.metrics.uniqueDates} dates
                  </span>
                </div>
              </div>

              <div className="space-y-5">
                <div>
                  <div className="flex items-center justify-between">
                    <p className="text-xs uppercase tracking-[0.4em] text-gray-500">Highlights</p>
                    <p className="text-xs text-gray-400">Sample preview</p>
                  </div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    {quality.highlights.map((highlight, index) => (
                      <div
                        key={`${highlight.label}-${index}`}
                        className={`rounded-2xl border p-3 text-sm ${highlightTone(highlight.severity)}`}
                      >
                        <p className="text-[0.65rem] uppercase tracking-[0.3em]">{highlight.label}</p>
                        <p className="text-lg font-semibold text-slate-900 dark:text-white">{highlight.value}</p>
                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{highlight.detail}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="text-xs uppercase tracking-[0.4em] text-gray-500">Core metrics</p>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {[
                      { label: "Missing values", value: percent(quality.metrics.missingRate) },
                      { label: "Missing partners", value: percent(quality.metrics.partnerMissingRate) },
                      { label: "Negative/zero revenue", value: percent(quality.metrics.negativeRevenueRate) },
                      { label: "Invalid revenue", value: percent(quality.metrics.invalidRevenueRate) },
                      { label: "Date coverage", value: percent(quality.metrics.timeCoverage) },
                      { label: "Partner coverage", value: percent(quality.metrics.partnerCoverage) },
                    ].map((metric) => (
                      <div key={metric.label} className="rounded-2xl border border-gray-100 p-3">
                        <p className="text-xs uppercase text-gray-500">{metric.label}</p>
                        <p className="text-lg font-semibold text-gray-900 dark:text-white">{metric.value}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs uppercase tracking-[0.4em] text-gray-500">Schema changes</p>
                    <p className="text-xs text-gray-400">
                      {quality.schemaChanges.previousFileName
                        ? `vs ${quality.schemaChanges.previousFileName}`
                        : "No previous upload"}
                      {quality.schemaChanges.previousUploadedAt
                        ? ` · ${formatDateString(quality.schemaChanges.previousUploadedAt)}`
                        : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {quality.schemaChanges.summary.map((line, index) => (
                      <span
                        key={`schema-summary-${index}`}
                        className="rounded-full border border-gray-200 px-2 py-1 text-[0.65rem] text-gray-600 bg-white dark:bg-gray-900"
                      >
                        {line}
                      </span>
                    ))}
                  </div>
                  {quality.schemaChanges.previousFileId && quality.schemaChanges.newColumns.length > 0 && (
                    <div className="rounded-2xl border border-emerald-100 bg-emerald-50/60 p-3 text-sm text-slate-700">
                      <p className="text-[0.65rem] uppercase tracking-[0.4em] text-emerald-600">New columns</p>
                      <ul className="mt-2 list-disc space-y-1 pl-5">
                        {quality.schemaChanges.newColumns.map((column) => (
                          <li key={`new-${column}`}>{column}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {quality.schemaChanges.previousFileId && quality.schemaChanges.removedColumns.length > 0 && (
                    <div className="rounded-2xl border border-rose-100 bg-rose-50/80 p-3 text-sm text-rose-700">
                      <p className="text-[0.65rem] uppercase tracking-[0.4em] text-rose-600">Removed columns</p>
                      <ul className="mt-2 list-disc space-y-1 pl-5">
                        {quality.schemaChanges.removedColumns.map((column) => (
                          <li key={`removed-${column}`}>{column}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {quality.schemaChanges.previousFileId && quality.schemaChanges.renamedColumns.length > 0 && (
                    <div className="rounded-2xl border border-amber-100 bg-amber-50/80 p-3 text-sm text-amber-800">
                      <p className="text-[0.65rem] uppercase tracking-[0.4em] text-amber-600">Renamed columns</p>
                      <ul className="mt-2 space-y-1 pl-5">
                        {quality.schemaChanges.renamedColumns.map((entry) => (
                          <li key={`${entry.from}-${entry.to}`}>
                            {entry.from} → {entry.to}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {quality.schemaChanges.previousFileId && quality.schemaChanges.warnings.length > 0 && (
                    <div className="rounded-2xl border border-amber-400/70 bg-amber-50/60 p-3 text-sm text-amber-900">
                      <p className="text-[0.65rem] uppercase tracking-[0.4em] text-amber-600">Warnings</p>
                      <ul className="mt-1 space-y-1">
                        {quality.schemaChanges.warnings.map((warning, index) => (
                          <li key={`warning-${index}`} className="text-[0.75rem]">
                            {warning}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>

                <div>
                  <p className="text-xs uppercase tracking-[0.4em] text-gray-500">Key issues</p>
                  <ul className="mt-2 space-y-2 text-sm text-gray-600 dark:text-gray-300">
                    {quality.issues.map((issue, index) => (
                      <li key={index} className="flex items-start gap-2">
                        <span className="mt-1 h-2 w-2 rounded-full bg-amber-500" />
                        <span>{issue}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}
        </Surface>
      </div>
    </div>
  );
};

export default DataQualityPage;
