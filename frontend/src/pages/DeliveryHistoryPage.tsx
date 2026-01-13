import React, { useEffect, useState } from "react";
import { apiFetch } from "../utils/api";

type Notification = {
  id: number;
  type: string;
  channel: string;
  message: string;
  metadata: any;
  created_at: string;
};

const DeliveryHistoryPage: React.FC = () => {
  const [items, setItems] = useState<Notification[]>([]);

  const load = async () => {
    const res = await apiFetch("/api/notifications");
    const data = await res.json();
    const filtered = (Array.isArray(data) ? data : []).filter((n: Notification) =>
      n.type?.startsWith("schedule_")
    );
    setItems(filtered);
  };

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 via-white to-orange-50 p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-3xl font-bold text-amber-800">Delivery History</h2>
          <button
            onClick={load}
            className="text-sm px-3 py-2 rounded-lg border border-amber-200 bg-white hover:bg-amber-50"
          >
            Refresh
          </button>
        </div>
        <div className="bg-white border rounded-2xl p-5">
          {items.length === 0 ? (
            <div className="text-sm text-gray-500">No deliveries yet.</div>
          ) : (
            <ul className="space-y-3 text-sm">
              {items.map((n) => (
                <li key={n.id} className="border rounded-xl p-4">
                  <div className="flex items-center justify-between">
                    <div className="font-semibold">{n.type}</div>
                    <div className="text-xs text-gray-500">
                      {new Date(n.created_at).toLocaleString()}
                    </div>
                  </div>
                  <div className="text-gray-700 mt-1">{n.message}</div>
                  <div className="text-xs text-gray-500 mt-2">Channel: {n.channel}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
};

export default DeliveryHistoryPage;
