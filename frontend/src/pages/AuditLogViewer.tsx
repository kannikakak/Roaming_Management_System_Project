import React, { useEffect, useState } from 'react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { getAuditLogs } from '../utils/auditLog';

const formatDate = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
};

const columns = [
  { key: 'timestamp', label: 'Timestamp' },
  { key: 'user', label: 'User' },
  { key: 'action', label: 'Action' },
  { key: 'details', label: 'Details' },
];

const AuditLogViewer: React.FC = () => {
  const [logs, setLogs] = useState<any[]>([]);
  const [userFilter, setUserFilter] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  useEffect(() => {
    let mounted = true;
    getAuditLogs().then((data) => {
      if (!mounted) return;
      setLogs(Array.isArray(data) ? data : []);
    });
    return () => {
      mounted = false;
    };
  }, []);

  // Filtering logic
  const filteredLogs = logs.filter(log =>
    (!userFilter || log.user.toLowerCase().includes(userFilter.toLowerCase())) &&
    (!actionFilter || log.action.toLowerCase().includes(actionFilter.toLowerCase())) &&
    (!dateFrom || new Date(log.timestamp) >= new Date(dateFrom)) &&
    (!dateTo || new Date(log.timestamp) <= new Date(dateTo))
  );

  const exportPDF = () => {
    const doc = new jsPDF();
    doc.text('Audit Logs', 14, 16);
    const tableColumn = columns.map(c => c.label);
    const tableRows = filteredLogs
      .slice()
      .reverse()
      .map(log =>
        columns.map(c =>
          c.key === 'timestamp'
            ? formatDate(log.timestamp)
            : c.key === 'details'
            ? JSON.stringify(log.details, null, 2)
            : log[c.key]
        )
      );
    autoTable(doc, {
      head: [tableColumn],
      body: tableRows,
      startY: 22,
      styles: { fontSize: 8, cellWidth: 'wrap' },
      headStyles: { fillColor: [255, 193, 7] },
    });
    doc.save('audit_logs.pdf');
  };

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <h2 className="text-3xl font-bold mb-8 text-amber-700 flex items-center gap-2">
        <span className="inline-block w-2 h-8 bg-amber-400 rounded mr-2"></span>
        Audit Log
      </h2>
      {/* Search/Filter Form */}
      <form
        className="flex flex-wrap gap-4 mb-6 items-end bg-amber-50 rounded-xl p-4 border border-amber-100"
        onSubmit={e => e.preventDefault()}
      >
        <div>
          <label className="block text-xs font-semibold text-amber-900 mb-1">User</label>
          <input
            type="text"
            placeholder="Search by user"
            className="border border-amber-300 rounded px-3 py-2 text-sm focus:ring-amber-400 focus:border-amber-400 outline-none"
            value={userFilter}
            onChange={e => setUserFilter(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-amber-900 mb-1">Action</label>
          <input
            type="text"
            placeholder="Search by action"
            className="border border-amber-300 rounded px-3 py-2 text-sm focus:ring-amber-400 focus:border-amber-400 outline-none"
            value={actionFilter}
            onChange={e => setActionFilter(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-amber-900 mb-1">From</label>
          <input
            type="date"
            className="border border-amber-300 rounded px-3 py-2 text-sm focus:ring-amber-400 focus:border-amber-400 outline-none"
            value={dateFrom}
            onChange={e => setDateFrom(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-amber-900 mb-1">To</label>
          <input
            type="date"
            className="border border-amber-300 rounded px-3 py-2 text-sm focus:ring-amber-400 focus:border-amber-400 outline-none"
            value={dateTo}
            onChange={e => setDateTo(e.target.value)}
          />
        </div>
        <button
          type="button"
          onClick={exportPDF}
          className="ml-auto px-5 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-white font-semibold shadow transition-all"
        >
          Export as PDF
        </button>
      </form>
      <div className="bg-white rounded-2xl shadow-lg p-6 border border-amber-100 overflow-x-auto">
        <table className="w-full text-sm table-auto">
          <thead>
            <tr className="bg-amber-50 border-b border-amber-200">
              {columns.map(col => (
                <th
                  key={col.key}
                  className="text-left p-3 font-semibold text-amber-900"
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredLogs.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="text-center py-8 text-gray-400"
                >
                  No audit logs found.
                </td>
              </tr>
            ) : (
              filteredLogs
                .slice()
                .reverse()
                .map((log, idx) => (
                  <tr
                    key={idx}
                    className={`border-b last:border-b-0 ${
                      idx % 2 === 0 ? 'bg-white' : 'bg-amber-50/50'
                    }`}
                  >
                    {columns.map(col => (
                      <td
                        key={col.key}
                        className="p-3 align-top text-gray-700 whitespace-pre-line"
                      >
                        {col.key === 'timestamp'
                          ? formatDate(log.timestamp)
                          : col.key === 'details'
                          ? (
                              <div className="bg-gray-50 rounded-lg p-2 overflow-x-auto max-w-xl">
                                <pre className="whitespace-pre-wrap text-xs text-gray-800 font-mono break-all">
                                  {JSON.stringify(log.details, null, 2)}
                                </pre>
                              </div>
                            )
                          : log[col.key]}
                      </td>
                    ))}
                  </tr>
                ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default AuditLogViewer;
