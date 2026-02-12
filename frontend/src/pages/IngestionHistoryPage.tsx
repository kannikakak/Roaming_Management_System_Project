import React, { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import Surface from "../components/Surface";
import { apiFetch } from "../utils/api";

type SourceRow = {
  id: number;
  name: string;
  type: string;
};

type HistoryItem = {
  id: string;
  sourceId: number | null;
  sourceName: string;
  sourceType: string;
  ingestionFileId: number | null;
  fileName: string;
  fileHash: string | null;
  status: string;
  rowsImported: number;
  errorMessage: string | null;
  importedFileId: number | null;
  createdAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
};

type HistoryResponse = {
  items: HistoryItem[];
  total: number;
};

const requestJson = async <T,>(res: Response, fallback: string): Promise<T> => {
  let payload: any = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }

  if (!res.ok) {
    throw new Error(payload?.message || payload?.error || fallback);
  }
  return payload as T;
};

const formatDateTime = (value: string | null) => {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return "—";
  }
};

const statusBadgeClass = (status: string) => {
  const normalized = String(status || "").toUpperCase();
  if (normalized === "SUCCESS") return "bg-emerald-100 text-emerald-700";
  if (normalized === "FAILED") return "bg-red-100 text-red-700";
  if (normalized === "SKIPPED") return "bg-gray-100 text-gray-700";
  if (normalized === "PROCESSING") return "bg-blue-100 text-blue-700";
  return "bg-amber-100 text-amber-700";
};

const IngestionHistoryPage: React.FC = () => {
  const [sources, setSources] = useState<SourceRow[]>([]);
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const fetchSources = useCallback(async () => {
    try {
      const response = await apiFetch("/api/sources");
      const data = await requestJson<SourceRow[]>(response, "Failed to load sources.");
      setSources(Array.isArray(data) ? data : []);
    } catch {
      setSources([]);
    }
  }, []);

  const fetchHistory = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setMessage(null);
      setError(null);
      try {
        const params = new URLSearchParams();
        params.set("limit", "300");
        if (sourceFilter !== "all") {
          params.set("sourceId", sourceFilter);
        }

        const response = await apiFetch(`/api/ingest/history?${params.toString()}`);
        const data = await requestJson<HistoryResponse>(response, "Failed to load ingestion history.");
        setItems(Array.isArray(data?.items) ? data.items : []);
      } catch (err: any) {
        setItems([]);
        setError(err?.message || "Failed to load ingestion history.");
      } finally {
        if (isRefresh) {
          setRefreshing(false);
        } else {
          setLoading(false);
        }
      }
    },
    [sourceFilter]
  );

  const handleClearHistory = useCallback(
    async (mode: "deleted" | "all") => {
      const label = mode === "deleted" ? "deleted rows" : "all ingestion rows for this filter";
      const confirmed = window.confirm(`Delete ${label}? This cannot be undone.`);
      if (!confirmed) return;

      setClearing(true);
      setMessage(null);
      setError(null);
      try {
        const params = new URLSearchParams();
        params.set("mode", mode);
        if (sourceFilter !== "all") {
          params.set("sourceId", sourceFilter);
        }

        const response = await apiFetch(`/api/ingest/history?${params.toString()}`, {
          method: "DELETE",
        });
        const result = await requestJson<{ deletedFiles: number; deletedJobs: number }>(
          response,
          "Failed to clear ingestion history."
        );
        setMessage(
          `Cleared history: ${Number(result.deletedFiles || 0)} file records and ${Number(
            result.deletedJobs || 0
          )} job records removed.`
        );
        await fetchHistory(true);
      } catch (err: any) {
        setError(err?.message || "Failed to clear ingestion history.");
      } finally {
        setClearing(false);
      }
    },
    [fetchHistory, sourceFilter]
  );

  useEffect(() => {
    void fetchSources();
  }, [fetchSources]);

  useEffect(() => {
    void fetchHistory(false);
  }, [fetchHistory]);

  useEffect(() => {
    if (!autoRefresh) return;
    const timer = window.setInterval(() => {
      void fetchHistory(true);
    }, 30000);
    return () => window.clearInterval(timer);
  }, [autoRefresh, fetchHistory]);

  const summary = useMemo(() => {
    let success = 0;
    let failed = 0;
    let processing = 0;
    let skipped = 0;

    for (const item of items) {
      const status = String(item.status || "").toUpperCase();
      if (status === "SUCCESS") success += 1;
      else if (status === "FAILED") failed += 1;
      else if (status === "PROCESSING" || status === "PENDING") processing += 1;
      else if (status === "SKIPPED") skipped += 1;
    }

    return {
      total: items.length,
      success,
      failed,
      processing,
      skipped,
    };
  }, [items]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-white via-amber-50/30 to-white dark:from-gray-950 dark:via-gray-900 dark:to-gray-900">
      <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Ingestion History</h1>
            <p className="text-sm text-gray-600 dark:text-gray-300">
              Unified history for manual uploads and folder-sync ingestion jobs.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void fetchHistory(true)}
              disabled={refreshing}
              className="inline-flex items-center gap-2 rounded-full border border-amber-200 px-4 py-2 text-sm font-semibold text-amber-700 hover:bg-amber-50 disabled:opacity-60"
            >
              <RefreshCw size={16} />
              {refreshing ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>

        {error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>
        ) : null}
        {message ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">
            {message}
          </div>
        ) : null}

        <div className="grid gap-4 md:grid-cols-5">
          <Surface className="p-4 border border-amber-100">
            <p className="text-xs uppercase tracking-wide text-gray-500">Total entries</p>
            <p className="text-2xl font-semibold text-gray-900 dark:text-white">{summary.total}</p>
          </Surface>
          <Surface className="p-4 border border-amber-100">
            <p className="text-xs uppercase tracking-wide text-gray-500">Success</p>
            <p className="text-2xl font-semibold text-emerald-700">{summary.success}</p>
          </Surface>
          <Surface className="p-4 border border-amber-100">
            <p className="text-xs uppercase tracking-wide text-gray-500">Failed</p>
            <p className="text-2xl font-semibold text-red-700">{summary.failed}</p>
          </Surface>
          <Surface className="p-4 border border-amber-100">
            <p className="text-xs uppercase tracking-wide text-gray-500">Processing</p>
            <p className="text-2xl font-semibold text-blue-700">{summary.processing}</p>
          </Surface>
          <Surface className="p-4 border border-amber-100">
            <p className="text-xs uppercase tracking-wide text-gray-500">Skipped</p>
            <p className="text-2xl font-semibold text-gray-700">{summary.skipped}</p>
          </Surface>
        </div>

        <Surface className="p-4 border border-amber-100">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">
                Source filter
              </label>
              <select
                value={sourceFilter}
                onChange={(event) => setSourceFilter(event.target.value)}
                className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm focus:border-amber-400 focus:outline-none"
              >
                <option value="all">All sources (with manual uploads)</option>
                {sources.map((source) => (
                  <option key={source.id} value={source.id}>
                    {source.name} ({source.type})
                  </option>
                ))}
              </select>
            </div>

            <label className="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200 pb-2">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(event) => setAutoRefresh(event.target.checked)}
                className="h-4 w-4 rounded border-gray-300"
              />
              Auto-refresh every 30s
            </label>

            <button
              type="button"
              onClick={() => void handleClearHistory("deleted")}
              disabled={clearing}
              className="rounded-full border border-red-200 px-4 py-2 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
            >
              {clearing ? "Clearing..." : "Clear deleted"}
            </button>
            <button
              type="button"
              onClick={() => void handleClearHistory("all")}
              disabled={clearing}
              className="rounded-full border border-red-300 px-4 py-2 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
            >
              {clearing ? "Clearing..." : "Clear all (filtered)"}
            </button>
          </div>
        </Surface>

        <Surface className="p-5 border border-amber-100">
          {loading ? (
            <div className="py-12 text-center text-gray-500">Loading ingestion history...</div>
          ) : items.length === 0 ? (
            <div className="py-12 text-center text-gray-500">No ingestion events found.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase text-gray-500">
                  <tr>
                    <th className="pb-2">File</th>
                    <th className="pb-2">Source</th>
                    <th className="pb-2">Status</th>
                    <th className="pb-2">Rows</th>
                    <th className="pb-2">Created</th>
                    <th className="pb-2">Finished</th>
                    <th className="pb-2">Error</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id} className="border-t border-gray-100 dark:border-white/10 align-top">
                      <td className="py-3">
                        <div className="font-semibold text-gray-900 dark:text-white">{item.fileName || "Unknown"}</div>
                        {item.fileHash ? (
                          <div className="text-[11px] text-gray-500 break-all">hash: {item.fileHash}</div>
                        ) : null}
                      </td>
                      <td className="py-3 text-gray-600 dark:text-gray-300">
                        <div>{item.sourceName || "Unknown source"}</div>
                        <div className="text-xs text-gray-500">{item.sourceType || "unknown"}</div>
                      </td>
                      <td className="py-3">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${statusBadgeClass(
                            item.status
                          )}`}
                        >
                          {String(item.status || "UNKNOWN").toUpperCase()}
                        </span>
                      </td>
                      <td className="py-3 text-gray-700 dark:text-gray-200">{item.rowsImported || 0}</td>
                      <td className="py-3 text-xs text-gray-500">{formatDateTime(item.createdAt)}</td>
                      <td className="py-3 text-xs text-gray-500">{formatDateTime(item.finishedAt)}</td>
                      <td className="py-3 text-xs text-red-600 max-w-xs">{item.errorMessage || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Surface>
      </div>
    </div>
  );
};

export default IngestionHistoryPage;
