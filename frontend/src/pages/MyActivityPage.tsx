import React, { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../utils/api";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

type AuditLogEntry = {
  id: number;
  timestamp: string;
  user: string;
  action: string;
  details?: any;
};

const MyActivityPage: React.FC = () => {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [expandedRows, setExpandedRows] = useState<Record<number, boolean>>({});

  const loadLogs = () => {
    setLoading(true);
    setError("");
    apiFetch("/api/audit-logs/me")
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load my activity");
        return res.json();
      })
      .then((data) => setLogs(Array.isArray(data) ? data : []))
      .catch((err: any) => {
        setError(err?.message || "Failed to load my activity");
        setLogs([]);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadLogs();
  }, []);

  const actions = useMemo(() => {
    return Array.from(new Set(logs.map((log) => log.action).filter(Boolean))).sort((a, b) =>
      a.localeCompare(b)
    );
  }, [logs]);

  const detailsText = (details: any) => {
    if (details === null || details === undefined) return "";
    if (typeof details === "string") return details;
    try {
      return JSON.stringify(details);
    } catch {
      return String(details);
    }
  };

  const shortDetails = (details: any, limit = 260) => {
    const text = detailsText(details);
    if (text.length <= limit) return text;
    return `${text.slice(0, limit)}...`;
  };

  const exportAllPdf = () => {
    const rows = logs
      .slice()
      .sort(
        (a, b) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );

    const doc = new jsPDF({ orientation: "landscape" });
    doc.setFontSize(16);
    doc.text("My Activity Audit Logs", 14, 16);
    doc.setFontSize(10);
    doc.text(`Exported rows: ${rows.length}`, 14, 22);
    autoTable(doc, {
      head: [["Time", "Action", "Details"]],
      body: rows.map((row) => [
        new Date(row.timestamp).toLocaleString(),
        row.action,
        shortDetails(row.details),
      ]),
      startY: 26,
      styles: { fontSize: 8, cellWidth: "wrap" },
      headStyles: { fillColor: [180, 83, 9] },
    });
    doc.save("my_activity_audit_logs_all.pdf");
  };

  const filteredLogs = useMemo(() => {
    const q = query.trim().toLowerCase();
    return logs
      .filter((log) => {
        const time = new Date(log.timestamp);
        const fromOk = !dateFrom || time >= new Date(dateFrom);
        const toOk = !dateTo || time <= new Date(`${dateTo}T23:59:59.999`);
        if (!fromOk || !toOk) return false;
        if (actionFilter && log.action !== actionFilter) return false;
        if (!q) return true;
        const combined = `${log.action} ${detailsText(log.details)}`.toLowerCase();
        return combined.includes(q);
      })
      .sort(
        (a, b) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );
  }, [logs, query, actionFilter, dateFrom, dateTo]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 via-white to-orange-50 p-6 md:p-8">
      <div className="max-w-6xl mx-auto space-y-5">
        <div className="rounded-2xl border border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-3xl font-extrabold text-amber-900">My Activity</h2>
              <p className="text-sm text-amber-800 mt-1">
                Live timeline of your actions with fast search and filters.
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={loadLogs}
                className="px-4 py-2 rounded-lg border border-amber-300 text-amber-900 hover:bg-amber-100"
              >
                Refresh
              </button>
              <button
                type="button"
                onClick={exportAllPdf}
                className="px-4 py-2 rounded-lg bg-amber-500 text-white hover:bg-amber-600"
              >
                Export All PDF
              </button>
            </div>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="text-xs uppercase tracking-wide text-slate-500">Total Activities</div>
            <div className="text-2xl font-bold text-slate-900 mt-1">{logs.length}</div>
          </div>
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
            <div className="text-xs uppercase tracking-wide text-amber-800">Filtered</div>
            <div className="text-2xl font-bold text-amber-900 mt-1">{filteredLogs.length}</div>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="grid gap-3 md:grid-cols-5">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search action or details..."
              className="md:col-span-2 border border-slate-300 rounded-lg px-3 py-2 text-sm"
            />
            <select
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
            >
              <option value="">All actions</option>
              {actions.map((action) => (
                <option key={action} value={action}>
                  {action}
                </option>
              ))}
            </select>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
            />
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
          {loading ? (
            <div className="p-8 text-center text-slate-500">Loading activity...</div>
          ) : error ? (
            <div className="p-8 text-center text-red-600">{error}</div>
          ) : filteredLogs.length === 0 ? (
            <div className="p-8 text-center text-slate-500">No activity yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-100 border-b border-slate-200">
                  <tr>
                    <th className="text-left px-4 py-3 font-semibold text-slate-800">Time</th>
                    <th className="text-left px-4 py-3 font-semibold text-slate-800">Action</th>
                    <th className="text-left px-4 py-3 font-semibold text-slate-800">Details</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredLogs.map((log) => {
                    const rawDetails = detailsText(log.details);
                    const isExpanded = Boolean(expandedRows[log.id]);
                    const preview =
                      rawDetails.length > 200
                        ? `${rawDetails.slice(0, 200)}...`
                        : rawDetails;

                    return (
                      <tr key={log.id} className="border-b border-slate-100 align-top">
                        <td className="px-4 py-3 text-slate-600 whitespace-nowrap">
                          {new Date(log.timestamp).toLocaleString()}
                        </td>
                        <td className="px-4 py-3 font-medium text-slate-900">{log.action}</td>
                        <td className="px-4 py-3">
                          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                            <div className="text-xs text-slate-700 break-words">
                              {preview || "-"}
                            </div>
                            {rawDetails.length > 200 && (
                              <button
                                type="button"
                                onClick={() =>
                                  setExpandedRows((prev) => ({
                                    ...prev,
                                    [log.id]: !prev[log.id],
                                  }))
                                }
                                className="mt-2 text-xs text-amber-700 hover:text-amber-800 font-medium"
                              >
                                {isExpanded ? "Hide full details" : "Show full details"}
                              </button>
                            )}
                            {isExpanded && (
                              <pre className="mt-2 text-xs text-slate-800 bg-white rounded border border-slate-200 p-2 overflow-auto max-h-64 whitespace-pre-wrap">
                                {rawDetails}
                              </pre>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default MyActivityPage;
