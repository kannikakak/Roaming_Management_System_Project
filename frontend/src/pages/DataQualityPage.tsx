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
              const ringR = 36;
              const ringC = 2 * Math.PI * ringR;
              const ringColor = badgeKey === "good" ? "#10b981" : badgeKey === "warning" ? "#f59e0b" : "#ef4444";

              return (
                <Surface
                  key={file.id}
                  onClick={() => setSelectedFileId(file.id)}
                  className={`cursor-pointer border-2 ${selectedFileId === file.id ? "border-amber-400" : "border-transparent"} p-5 flex flex-col items-center gap-3 transition-shadow hover:shadow-md`}
                >
                  <div className="relative flex items-center justify-center">
                    <svg width="96" height="96" viewBox="0 0 96 96">
                      <circle cx="48" cy="48" r={ringR} fill="none" stroke="#f3f4f6" strokeWidth="8" />
                      <circle
                        cx="48" cy="48" r={ringR}
                        fill="none"
                        stroke={ringColor}
                        strokeWidth="8"
                        strokeLinecap="round"
                        strokeDasharray={ringC}
                        strokeDashoffset={ringC * (1 - displayScore / 100)}
                        transform="rotate(-90 48 48)"
                      />
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-xl font-bold text-gray-900 dark:text-white leading-none">{displayScore.toFixed(0)}</span>
                      <span className="text-[0.6rem] text-gray-400">/ 100</span>
                    </div>
                  </div>
                  <p className="text-sm font-semibold text-gray-800 dark:text-white text-center w-full truncate">{file.name}</p>
                  <span className={`px-2 py-0.5 text-xs font-semibold rounded-full ${badgeInfo.className}`}>
                    {badgeInfo.label}
                  </span>
                </Surface>
              );
            })
          )}
        </div>

        <Surface className="p-6 border border-gray-100">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-amber-500" />
              <h2 className="text-base font-semibold text-gray-900 dark:text-white">File Analysis</h2>
            </div>
            <button
              onClick={() => selectedFileId && fetchQuality(selectedFileId)}
              disabled={!selectedFileId || loadingQuality}
              className="rounded-full border border-gray-200 px-3 py-1 text-xs text-gray-500 hover:border-amber-300 hover:text-amber-700 disabled:opacity-40 transition-colors"
            >
              Refresh
            </button>
          </div>

          {loadingQuality ? (
            <p className="text-sm text-gray-400">Loading…</p>
          ) : qualityError ? (
            <p className="text-sm text-red-500">{qualityError}</p>
          ) : !quality ? (
            <p className="text-sm text-gray-400">Select a file above to see its analysis.</p>
          ) : (
            <div className="grid gap-8 lg:grid-cols-[200px_1fr]">

              {/* Left — score ring */}
              {(() => {
                const detailR = 44;
                const detailC = 2 * Math.PI * detailR;
                const detailScore = safeScore(quality.score);
                const detailColor = quality.badge === "good" ? "#10b981" : quality.badge === "warning" ? "#f59e0b" : "#ef4444";
                return (
                  <div className="flex flex-col items-center gap-4">
                    <div className="relative flex items-center justify-center">
                      <svg width="120" height="120" viewBox="0 0 120 120">
                        <circle cx="60" cy="60" r={detailR} fill="none" stroke="#f3f4f6" strokeWidth="9" />
                        <circle
                          cx="60" cy="60" r={detailR}
                          fill="none"
                          stroke={detailColor}
                          strokeWidth="9"
                          strokeLinecap="round"
                          strokeDasharray={detailC}
                          strokeDashoffset={detailC * (1 - detailScore / 100)}
                          transform="rotate(-90 60 60)"
                        />
                      </svg>
                      <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <span className="text-2xl font-bold text-gray-900 dark:text-white leading-none">{detailScore.toFixed(1)}</span>
                        <span className="text-[0.6rem] text-gray-400">/ 100</span>
                      </div>
                    </div>
                    <div className="flex flex-col items-center gap-1 text-center">
                      <span className={`px-2 py-0.5 text-xs font-semibold rounded-full ${badgeStyles[quality.badge].className}`}>
                        {badgeStyles[quality.badge].label}
                      </span>
                      <p className="text-xs text-gray-400">{quality.status}</p>
                    </div>
                    <div className="w-full border-t border-gray-100 pt-3 grid grid-cols-2 gap-y-2 text-center">
                      {[
                        { label: "Rows", value: quality.metrics.rowCount },
                        { label: "Columns", value: quality.metrics.columnCount },
                        { label: "Partners", value: quality.metrics.uniquePartners },
                        { label: "Dates", value: quality.metrics.uniqueDates },
                      ].map((s) => (
                        <div key={s.label}>
                          <p className="text-sm font-semibold text-gray-800 dark:text-white">{s.value}</p>
                          <p className="text-[0.65rem] text-gray-400">{s.label}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {/* Right — metrics + issues + schema */}
              <div className="space-y-6">

                {/* Metrics */}
                <div>
                  <p className="text-xs font-medium text-gray-400 mb-3">Metrics</p>
                  <div className="space-y-2">
                    {[
                      { label: "Missing values",       value: quality.metrics.missingRate,        bad: (v: number) => v > 0.02 },
                      { label: "Missing partners",     value: quality.metrics.partnerMissingRate,  bad: (v: number) => v > 0.05 },
                      { label: "Negative revenue",     value: quality.metrics.negativeRevenueRate, bad: (v: number) => v > 0.02 },
                      { label: "Invalid revenue",      value: quality.metrics.invalidRevenueRate,  bad: (v: number) => v > 0.01 },
                      { label: "Date coverage",        value: quality.metrics.timeCoverage,        bad: (v: number) => v < 0.6  },
                      { label: "Partner coverage",     value: quality.metrics.partnerCoverage,     bad: (v: number) => v < 0.6  },
                    ].map((m) => {
                      const isBad = m.bad(m.value);
                      return (
                        <div key={m.label} className="flex items-center justify-between py-1.5 border-b border-gray-50 dark:border-gray-800 last:border-0">
                          <span className="text-sm text-gray-600 dark:text-gray-300">{m.label}</span>
                          <div className="flex items-center gap-2">
                            <span className={`h-1.5 w-1.5 rounded-full ${isBad ? "bg-red-400" : "bg-emerald-400"}`} />
                            <span className={`text-sm font-semibold ${isBad ? "text-red-600" : "text-gray-800 dark:text-white"}`}>
                              {percent(m.value)}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Issues */}
                <div>
                  <p className="text-xs font-medium text-gray-400 mb-3">Issues</p>
                  <ul className="space-y-1.5">
                    {quality.issues.map((issue, i) => (
                      <li key={i} className="text-sm text-gray-600 dark:text-gray-300 flex items-start gap-2">
                        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
                        {issue}
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Schema changes — only if there's something to show */}
                {quality.schemaChanges.previousFileId && (
                  quality.schemaChanges.newColumns.length > 0 ||
                  quality.schemaChanges.removedColumns.length > 0 ||
                  quality.schemaChanges.renamedColumns.length > 0
                ) && (
                  <div>
                    <p className="text-xs font-medium text-gray-400 mb-3">
                      Schema changes
                      {quality.schemaChanges.previousFileName && (
                        <span className="ml-1 font-normal text-gray-300">vs {quality.schemaChanges.previousFileName}</span>
                      )}
                    </p>
                    <div className="space-y-2">
                      {quality.schemaChanges.newColumns.map((col) => (
                        <div key={`new-${col}`} className="flex items-center gap-2 text-sm text-emerald-700">
                          <span className="text-emerald-400">+</span> {col}
                        </div>
                      ))}
                      {quality.schemaChanges.removedColumns.map((col) => (
                        <div key={`rm-${col}`} className="flex items-center gap-2 text-sm text-red-500">
                          <span>−</span> {col}
                        </div>
                      ))}
                      {quality.schemaChanges.renamedColumns.map((entry) => (
                        <div key={`${entry.from}-${entry.to}`} className="text-sm text-amber-700">
                          {entry.from} → {entry.to}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

              </div>
            </div>
          )}
        </Surface>
      </div>
    </div>
  );
};

export default DataQualityPage;
