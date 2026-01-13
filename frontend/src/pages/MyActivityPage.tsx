import React, { useEffect, useState } from "react";
import { apiFetch } from "../utils/api";

type AuditLogEntry = {
  id: number;
  timestamp: string;
  user: string;
  action: string;
  details?: any;
};

const MyActivityPage: React.FC = () => {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);

  useEffect(() => {
    apiFetch("/api/audit-logs/me")
      .then((res) => res.json())
      .then((data) => setLogs(Array.isArray(data) ? data : []));
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 via-white to-orange-50 p-6">
      <div className="max-w-6xl mx-auto">
        <h2 className="text-3xl font-bold text-amber-800 mb-6">My Activity</h2>
        <div className="bg-white border rounded-2xl p-5">
          {logs.length === 0 ? (
            <div className="text-sm text-gray-500">No activity yet.</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-600">
                  <th className="py-2">Time</th>
                  <th>Action</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id} className="border-t">
                    <td className="py-2">{new Date(l.timestamp).toLocaleString()}</td>
                    <td>{l.action}</td>
                    <td className="text-xs text-gray-500">{JSON.stringify(l.details)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};

export default MyActivityPage;
