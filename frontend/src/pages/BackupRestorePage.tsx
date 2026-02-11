import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Loader2,
  RefreshCw,
  RotateCcw,
} from "lucide-react";
import { apiFetch } from "../utils/api";

type DeletedSourceBackupItem = {
  id: number;
  originalFileId: number;
  projectId: number;
  fileName: string;
  fileType: string;
  backupFileName: string;
  backupFilePath: string;
  backupFileSize: number;
  rowsCount: number;
  columnsCount: number;
  deletedBy: string | null;
  status: string;
  restoredFileId: number | null;
  restoredBy: string | null;
  restoredAt: string | null;
  createdAt: string;
};

const formatBytes = (bytes: number | null) => {
  const value = Number(bytes || 0);
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let current = value;
  let idx = 0;
  while (current >= 1024 && idx < units.length - 1) {
    current /= 1024;
    idx += 1;
  }
  return `${current.toFixed(current >= 100 ? 0 : current >= 10 ? 1 : 2)} ${units[idx]}`;
};

const statusTone = (status: string) => {
  const key = String(status || "").toLowerCase();
  if (key === "success") return "bg-emerald-100 text-emerald-700 border-emerald-200";
  if (key === "restored") return "bg-blue-100 text-blue-700 border-blue-200";
  if (key.includes("fail")) return "bg-rose-100 text-rose-700 border-rose-200";
  return "bg-slate-100 text-slate-700 border-slate-200";
};

const BackupRestorePage: React.FC = () => {
  const [deletedSourceItems, setDeletedSourceItems] = useState<DeletedSourceBackupItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [restoringDeletedId, setRestoringDeletedId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const loadData = useCallback(async () => {
    setError("");
    setLoading(true);
    try {
      const [deletedSourceRes] = await Promise.all([
        apiFetch("/api/system/backups/deleted-files?limit=200"),
      ]);
      if (!deletedSourceRes.ok) {
        const txt = await deletedSourceRes.text();
        throw new Error(txt || "Failed to load deleted source backup history");
      }

      const deletedSourceData = await deletedSourceRes.json();
      setDeletedSourceItems(Array.isArray(deletedSourceData?.items) ? deletedSourceData.items : []);
    } catch (err: any) {
      setError(err?.message || "Failed to load backup module data.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const restoreDeletedSource = async (id: number) => {
    const confirmed = window.confirm(
      `Restore deleted source backup #${id}? This will recreate the deleted file in its project.`
    );
    if (!confirmed) return;

    setRestoringDeletedId(id);
    setError("");
    setMessage("");
    try {
      const response = await apiFetch(`/api/system/backups/deleted-files/${id}/restore`, {
        method: "POST",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.message || "Failed to restore deleted source");
      setMessage(`Deleted source backup #${id} restored successfully.`);
      await loadData();
    } catch (err: any) {
      setError(err?.message || "Failed to restore deleted source");
    } finally {
      setRestoringDeletedId(null);
    }
  };

  const stats = useMemo(() => {
    const latestDeletedSource = deletedSourceItems[0];
    const totalStorage = deletedSourceItems.reduce(
      (sum, item) => sum + Number(item.backupFileSize || 0),
      0
    );
    const totalRestores = deletedSourceItems.filter((item) => item.status === "restored").length;
    const deletedSourceTotal = deletedSourceItems.length;
    const deletedSourceAvailable = deletedSourceItems.filter((item) => item.status === "available").length;

    return {
      latestDeletedSource,
      totalStorage,
      totalRestores,
      deletedSourceTotal,
      deletedSourceAvailable,
    };
  }, [deletedSourceItems]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 via-white to-orange-50 p-6 md:p-8">
      <div className="max-w-7xl mx-auto space-y-5">
        <section className="rounded-2xl border border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-amber-700">Disaster Recovery</p>
              <h2 className="text-3xl font-extrabold text-amber-900">Backup & Restore</h2>
              <p className="text-sm text-amber-800 mt-1">
                Deleted source files are auto-backed up before deletion so you can recover them later.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={loadData}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-amber-300 bg-white text-amber-900 hover:bg-amber-100"
              >
                <RefreshCw className="w-4 h-4" />
                Refresh
              </button>
            </div>
          </div>
          {error && <p className="mt-3 text-sm text-rose-700">{error}</p>}
          {message && <p className="mt-3 text-sm text-emerald-700">{message}</p>}
        </section>

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-blue-900">
            <div className="text-xs uppercase tracking-wide opacity-80">Delete Backup Policy</div>
            <div className="text-2xl font-bold mt-1">Enabled</div>
            <p className="text-xs mt-2">Automatic backup runs before source file deletion</p>
          </div>
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
            <div className="text-xs uppercase tracking-wide opacity-80">Deleted Source Backups</div>
            <div className="text-2xl font-bold mt-1">{stats.deletedSourceTotal}</div>
            <p className="text-xs mt-2">{stats.deletedSourceAvailable} available for restore</p>
          </div>
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-900">
            <div className="text-xs uppercase tracking-wide opacity-80">Last Deleted Source</div>
            <div className="text-sm font-semibold mt-2 break-all">
              {stats.latestDeletedSource?.fileName || "No deleted source backup yet"}
            </div>
            <p className="text-xs mt-2">
              {stats.latestDeletedSource?.createdAt
                ? new Date(stats.latestDeletedSource.createdAt).toLocaleString()
                : "N/A"}
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-slate-900">
            <div className="text-xs uppercase tracking-wide opacity-80">Deleted Backup Storage</div>
            <div className="text-2xl font-bold mt-1">{formatBytes(stats.totalStorage)}</div>
            <p className="text-xs mt-2">
              {stats.deletedSourceAvailable} available backup(s) | {stats.totalRestores} restored
            </p>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xl font-bold text-slate-900">Deleted Source File Recovery</h3>
            <div className="text-xs text-slate-500">
              Auto-created when a source file is deleted
            </div>
          </div>

          {loading ? (
            <div className="py-10 text-center text-slate-500">Loading deleted source backups...</div>
          ) : deletedSourceItems.length === 0 ? (
            <div className="py-10 text-center text-slate-500">No deleted source backup yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-100 border-b border-slate-200">
                  <tr>
                    <th className="px-3 py-2 text-left">Deleted At</th>
                    <th className="px-3 py-2 text-left">File</th>
                    <th className="px-3 py-2 text-left">Project</th>
                    <th className="px-3 py-2 text-left">Rows/Cols</th>
                    <th className="px-3 py-2 text-left">Status</th>
                    <th className="px-3 py-2 text-left">Deleted By</th>
                    <th className="px-3 py-2 text-left">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {deletedSourceItems.map((item) => (
                    <tr key={item.id} className="border-b border-slate-100 align-top">
                      <td className="px-3 py-3 whitespace-nowrap text-slate-600">
                        {new Date(item.createdAt).toLocaleString()}
                      </td>
                      <td className="px-3 py-3 text-slate-700">
                        <div className="font-medium break-all">{item.fileName}</div>
                        <div className="text-xs text-slate-500 break-all">{item.backupFileName}</div>
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap text-slate-700">#{item.projectId}</td>
                      <td className="px-3 py-3 whitespace-nowrap text-slate-700">
                        {item.rowsCount.toLocaleString()} / {item.columnsCount.toLocaleString()}
                      </td>
                      <td className="px-3 py-3">
                        <span className={`px-2 py-1 rounded-full border text-xs font-semibold ${statusTone(item.status)}`}>
                          {item.status.toUpperCase()}
                        </span>
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap text-slate-700">{item.deletedBy || "-"}</td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        <button
                          type="button"
                          disabled={item.status !== "available" || restoringDeletedId === item.id}
                          onClick={() => restoreDeletedSource(item.id)}
                          className="inline-flex items-center gap-1 rounded-lg border border-amber-300 text-amber-800 px-2.5 py-1.5 hover:bg-amber-50 disabled:opacity-60"
                        >
                          {restoringDeletedId === item.id ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <RotateCcw className="w-4 h-4" />
                          )}
                          Restore File
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

export default BackupRestorePage;
