import React, { useEffect, useState } from "react";
import { apiFetch } from "../utils/api";

type Notification = {
  id: number;
  type: string;
  channel: string;
  message: string;
  metadata: any;
  read_at: string | null;
  created_at: string;
};

type Settings = {
  email_enabled: number;
  telegram_enabled: number;
  in_app_enabled: number;
};

const NotificationsPage: React.FC = () => {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [settingsMessage, setSettingsMessage] = useState("");

  const loadNotifications = async () => {
    const res = await apiFetch("/api/notifications");
    const data = await res.json();
    setNotifications(Array.isArray(data) ? data : []);
  };

  const loadSettings = async () => {
    const res = await apiFetch("/api/notification-settings");
    const data = await res.json();
    if (data) {
      setSettings(data);
    } else {
      setSettings({ email_enabled: 1, telegram_enabled: 0, in_app_enabled: 1 });
    }
  };

  useEffect(() => {
    loadNotifications();
    loadSettings();
  }, []);

  const markRead = async (id: number) => {
    await apiFetch(`/api/notifications/${id}/read`, { method: "POST" });
    loadNotifications();
  };

  const saveSettings = async (patch: Partial<Settings>) => {
    const next = {
      email_enabled: settings?.email_enabled ?? 1,
      telegram_enabled: settings?.telegram_enabled ?? 0,
      in_app_enabled: settings?.in_app_enabled ?? 1,
      ...patch,
    };
    const res = await apiFetch("/api/notification-settings", {
      method: "PUT",
      body: JSON.stringify({
        emailEnabled: !!next.email_enabled,
        telegramEnabled: !!next.telegram_enabled,
        inAppEnabled: !!next.in_app_enabled,
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(errText || "Failed to save notification settings");
    }
    setSettings(next);
  };

  const [showUnreadOnly, setShowUnreadOnly] = useState(false);

  const visible = showUnreadOnly
    ? notifications.filter((n) => !n.read_at)
    : notifications;

  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 via-white to-orange-50 p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-3xl font-bold text-amber-800">Notifications</h2>
            <p className="text-sm text-amber-700/80">
              Track uploads, schedule deliveries, and system alerts.
            </p>
          </div>
          <button
            onClick={loadNotifications}
            className="text-sm px-3 py-2 rounded-lg border border-amber-200 bg-white hover:bg-amber-50"
          >
            Refresh
          </button>
        </div>

        <div className="bg-white border rounded-2xl p-5 mb-6">
          <h3 className="font-semibold text-gray-800 mb-3">Alert Settings</h3>
          <div className="flex flex-wrap gap-6 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={!!settings?.in_app_enabled}
                onChange={async (e) => {
                  try {
                    await saveSettings({ in_app_enabled: e.target.checked ? 1 : 0 });
                    setSettingsMessage("Settings saved");
                  } catch (err: any) {
                    setSettingsMessage(err?.message || "Failed to save settings");
                  }
                }}
              />
              In-app
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={!!settings?.email_enabled}
                onChange={async (e) => {
                  try {
                    await saveSettings({ email_enabled: e.target.checked ? 1 : 0 });
                    setSettingsMessage("Settings saved");
                  } catch (err: any) {
                    setSettingsMessage(err?.message || "Failed to save settings");
                  }
                }}
              />
              Email
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={!!settings?.telegram_enabled}
                onChange={async (e) => {
                  try {
                    await saveSettings({ telegram_enabled: e.target.checked ? 1 : 0 });
                    setSettingsMessage("Settings saved");
                  } catch (err: any) {
                    setSettingsMessage(err?.message || "Failed to save settings");
                  }
                }}
              />
              Telegram
            </label>
          </div>
          {settingsMessage && <div className="text-xs text-gray-500 mt-3">{settingsMessage}</div>}
        </div>

        <div className="bg-white border rounded-2xl p-5">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-3">
            <h3 className="font-semibold text-gray-800">Recent Notifications</h3>
            <label className="text-xs text-gray-600 flex items-center gap-2">
              <input
                type="checkbox"
                checked={showUnreadOnly}
                onChange={(e) => setShowUnreadOnly(e.target.checked)}
              />
              Show unread only
            </label>
          </div>
          {visible.length === 0 ? (
            <div className="text-sm text-gray-500">No notifications yet.</div>
          ) : (
            <ul className="space-y-3">
              {visible.map((n) => (
                <li
                  key={n.id}
                  className={`border rounded-xl p-4 text-sm ${
                    n.read_at ? "bg-white" : "bg-amber-50 border-amber-200"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="font-semibold text-gray-900">{n.type}</div>
                    <div className="text-xs text-gray-500">
                      {new Date(n.created_at).toLocaleString()}
                    </div>
                  </div>
                  <div className="text-gray-700 mt-1">{n.message}</div>
                  <div className="text-xs text-gray-500 mt-2">
                    Channel: <span className="font-semibold">{n.channel}</span>
                  </div>
                  {!n.read_at && (
                    <button
                      className="text-xs text-amber-700 hover:text-amber-800 mt-2"
                      onClick={() => markRead(n.id)}
                    >
                      Mark read
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
};

export default NotificationsPage;
