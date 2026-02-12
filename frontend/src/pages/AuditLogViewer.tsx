import React, { useEffect, useMemo, useState } from "react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { getAuditLogs } from "../utils/auditLog";

type AuditLog = {
  id?: number;
  timestamp?: string;
  user?: string;
  action?: string;
  details?: any;
};

const formatDate = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
};

const parseDetails = (details: any) => {
  if (details === null || details === undefined) return null;
  if (typeof details === "string") {
    try {
      return JSON.parse(details);
    } catch {
      return details;
    }
  }
  return details;
};

const detailsToText = (details: any) => {
  const parsed = parseDetails(details);
  if (parsed === null || parsed === undefined) return "";
  if (typeof parsed === "string") return parsed;
  try {
    return JSON.stringify(parsed);
  } catch {
    return String(parsed);
  }
};

const shortDetails = (details: any, limit = 140) => {
  const text = detailsToText(details);
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}...`;
};

const isDataModified = (log: AuditLog) => {
  const action = String(log.action || "").toLowerCase();
  const parsed = parseDetails(log.details);
  if (action.includes("modified") || action.includes("update") || action.includes("role_changed")) return true;
  return Boolean(parsed && typeof parsed === "object" && ("modificationType" in parsed || "changesPreview" in parsed));
};

const AuditLogViewer: React.FC = () => {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [userFilter, setUserFilter] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const loadLogs = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await getAuditLogs();
      setLogs(Array.isArray(data) ? data : []);
    } catch (err: any) {
      setError(err?.message || "Failed to load logs");
      setLogs([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLogs();
  }, []);

  const users = useMemo(() => {
    return Array.from(
      new Set(logs.map((log) => String(log.user || "").trim()).filter(Boolean))
    ).sort((a, b) => a.localeCompare(b));
  }, [logs]);

  const actions = useMemo(() => {
    return Array.from(
      new Set(logs.map((log) => String(log.action || "").trim()).filter(Boolean))
    ).sort((a, b) => a.localeCompare(b));
  }, [logs]);

  const filteredLogs = useMemo(() => {
    const q = query.trim().toLowerCase();
    return logs
      .filter((log) => {
        const ts = String(log.timestamp || "");
        const fromMatch = !dateFrom || new Date(ts) >= new Date(dateFrom);
        const toMatch =
          !dateTo || new Date(ts) <= new Date(`${dateTo}T23:59:59.999`);
        if (!fromMatch || !toMatch) return false;

        if (userFilter && String(log.user || "") !== userFilter) return false;
        if (actionFilter && String(log.action || "") !== actionFilter) return false;

        if (!q) return true;
        const merged = `${String(log.user || "")} ${String(log.action || "")} ${detailsToText(log.details)}`.toLowerCase();
        return merged.includes(q);
      })
      .sort((a, b) => {
        const at = new Date(String(a.timestamp || "")).getTime();
        const bt = new Date(String(b.timestamp || "")).getTime();
        return bt - at;
      });
  }, [logs, query, userFilter, actionFilter, dateFrom, dateTo]);

  const modifiedCount = useMemo(
    () => filteredLogs.filter((log) => isDataModified(log)).length,
    [filteredLogs]
  );

  const exportPDF = (rows: AuditLog[], fileName: string) => {
    const doc = new jsPDF({ orientation: "landscape" });
    doc.setFontSize(16);
    doc.text("Audit Logs", 14, 16);
    doc.setFontSize(10);
    doc.text(`Exported rows: ${rows.length}`, 14, 22);
    autoTable(doc, {
      head: [["Timestamp", "User", "Action", "Details"]],
      body: rows.map((log) => [
        formatDate(String(log.timestamp || "")),
        String(log.user || ""),
        String(log.action || ""),
        shortDetails(log.details, 260),
      ]),
      startY: 26,
      styles: { fontSize: 8, cellWidth: "wrap" },
      headStyles: { fillColor: [180, 83, 9] },
    });
    doc.save(fileName);
  };

  return (
    <div className="p-6 md:p-8 max-w-[1200px] mx-auto">
      <div className="rounded-2xl border border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50 p-5 mb-5">
        <div className="flex flex-wrap items-center gap-3 justify-between">
          <div>
            <h1 className="text-3xl font-extrabold text-amber-900">Audit Logs</h1>
            <p className="text-sm text-amber-800 mt-1">
              Critical activity trail with modified-data details and fast filtering.
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
              onClick={() => exportPDF(filteredLogs, "audit_logs_filtered.pdf")}
              className="px-4 py-2 rounded-lg bg-amber-600 text-white hover:bg-amber-700"
            >
              Export Filtered PDF
            </button>
            <button
              type="button"
              onClick={() => exportPDF(logs, "audit_logs_all.pdf")}
              className="px-4 py-2 rounded-lg bg-amber-500 text-white hover:bg-amber-600"
            >
              Export All PDF
            </button>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3 mb-5">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs uppercase tracking-wide text-slate-500">Total Logs</div>
          <div className="text-2xl font-bold text-slate-900 mt-1">{logs.length}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs uppercase tracking-wide text-slate-500">Filtered</div>
          <div className="text-2xl font-bold text-slate-900 mt-1">{filteredLogs.length}</div>
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <div className="text-xs uppercase tracking-wide text-amber-800">Data Modified</div>
          <div className="text-2xl font-bold text-amber-900 mt-1">{modifiedCount}</div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 mb-5">
        <div className="grid gap-3 md:grid-cols-5">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search all fields..."
            className="md:col-span-2 border border-slate-300 rounded-lg px-3 py-2 text-sm"
          />
          <select
            value={userFilter}
            onChange={(e) => setUserFilter(e.target.value)}
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
          >
            <option value="">All users</option>
            {users.map((user) => (
              <option key={user} value={user}>
                {user}
              </option>
            ))}
          </select>
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
          <div className="grid grid-cols-2 gap-2">
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="border border-slate-300 rounded-lg px-2 py-2 text-sm"
            />
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="border border-slate-300 rounded-lg px-2 py-2 text-sm"
            />
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-slate-500">Loading audit logs...</div>
        ) : error ? (
          <div className="p-8 text-center text-red-600">{error}</div>
        ) : filteredLogs.length === 0 ? (
          <div className="p-8 text-center text-slate-500">No audit logs found.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-100 border-b border-slate-200">
                <tr>
                  <th className="text-left px-4 py-3 font-semibold text-slate-800">Timestamp</th>
                  <th className="text-left px-4 py-3 font-semibold text-slate-800">User</th>
                  <th className="text-left px-4 py-3 font-semibold text-slate-800">Action</th>
                  <th className="text-left px-4 py-3 font-semibold text-slate-800">Details</th>
                </tr>
              </thead>
              <tbody>
                {filteredLogs.map((log, index) => {
                  const key = `${log.id || "row"}-${log.timestamp || ""}-${index}`;
                  const expandedRow = Boolean(expanded[key]);
                  const detailsObj = parseDetails(log.details);
                  return (
                    <tr key={key} className="border-b border-slate-100 align-top">
                      <td className="px-4 py-3 text-slate-600 whitespace-nowrap">
                        {formatDate(String(log.timestamp || ""))}
                      </td>
                      <td className="px-4 py-3 text-slate-700">{String(log.user || "-")}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-2 items-center">
                          <span className="font-medium text-slate-900">{String(log.action || "-")}</span>
                          {isDataModified(log) && (
                            <span className="text-xs bg-amber-100 text-amber-900 px-2 py-0.5 rounded-full border border-amber-200">
                              Data Modified
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                          <div className="text-slate-700 text-xs break-words">
                            {shortDetails(detailsObj, 180) || "-"}
                          </div>
                          {detailsObj && (
                            <button
                              type="button"
                              onClick={() =>
                                setExpanded((prev) => ({ ...prev, [key]: !prev[key] }))
                              }
                              className="mt-2 text-xs text-amber-700 hover:text-amber-800 font-medium"
                            >
                              {expandedRow ? "Hide full details" : "Show full details"}
                            </button>
                          )}
                          {expandedRow && detailsObj && (
                            <pre className="mt-2 text-xs text-slate-800 bg-white rounded border border-slate-200 p-2 overflow-auto max-h-60 whitespace-pre-wrap">
                              {JSON.stringify(detailsObj, null, 2)}
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
  );
};

export default AuditLogViewer;
