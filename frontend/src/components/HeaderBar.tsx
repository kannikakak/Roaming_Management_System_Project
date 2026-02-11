import React, { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Bell, Search } from "lucide-react";
import { apiFetch } from "../utils/api";
import ThemeToggle from "./ThemeToggle";

const titleMap: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/projects": "Projects",
  "/charts": "Charts",
  "/chart": "Charts",
  "/slide-builder": "Slide Builder",
  "/ai-studio": "AI Studio",
  "/reports-library": "Reports Library",
  "/data-explorer": "Data Explorer",
  "/schedules": "Schedules",
  "/alert-center": "Alert Center",
  "/delivery-history": "Delivery History",
  "/my-activity": "My Activity",
  "/templates": "Templates",
  "/users": "User Management",
  "/system-health": "System Health",
  "/backup-restore": "Backup & Restore",
  "/security-center": "Security Center",
  "/audit-log": "Audit Log",
  "/account": "Account Settings",
  "/search": "Global Search",
};

type NotificationItem = {
  id: number;
  type: string;
  message: string;
  channel: string;
  read_at: string | null;
  created_at: string;
};

const HeaderBar: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [alertCount, setAlertCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [searchTerm, setSearchTerm] = useState("");

  const title = useMemo(() => {
    const path = location.pathname;
    return titleMap[path] || "Dashboard";
  }, [location.pathname]);

  const loadNotifications = () => {
    let mounted = true;
    apiFetch("/api/notifications")
      .then((res) => res.json())
      .then((data) => {
        if (!mounted) return;
        const list = Array.isArray(data) ? data : [];
        setItems(list.slice(0, 6));
        const unread = list.filter((n: any) => !n.read_at).length;
        setAlertCount(unread);
      })
      .catch(() => {
        if (!mounted) return;
        setAlertCount(0);
      });
    return () => {
      mounted = false;
    };
  };

  useEffect(() => {
    return loadNotifications();
  }, []);

  const markRead = async (id: number) => {
    await apiFetch(`/api/notifications/${id}/read`, { method: "POST" });
    loadNotifications();
  };

  const markAllRead = async () => {
    await apiFetch("/api/notifications/read-all", { method: "POST" });
    loadNotifications();
    navigate("/delivery-history");
  };

  const onSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = searchTerm.trim();
    if (!q) return;
    navigate(`/search?q=${encodeURIComponent(q)}`);
  };

  return (
    <header className="sticky top-0 z-30 backdrop-blur border-b border-amber-100 bg-white/80 dark:border-white/10 dark:bg-gray-900/80">
      <div className="flex items-center justify-between gap-4 px-6 py-4">
        <div className="flex items-center gap-4 min-w-0">
          <h1 className="text-xl font-bold text-amber-800 dark:text-amber-300 whitespace-nowrap">
            {title}
          </h1>
          <form onSubmit={onSearchSubmit} className="hidden lg:flex items-center">
            <label className="relative">
              <Search className="w-4 h-4 text-gray-400 dark:text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Global search: partner, country, date..."
                className="w-96 max-w-[40vw] pl-9 pr-3 py-2 rounded-xl border border-amber-100 bg-white text-sm text-gray-700 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-amber-300 dark:border-white/10 dark:bg-white/5 dark:text-gray-100 dark:placeholder:text-gray-500"
              />
            </label>
          </form>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle className="w-10 h-10" />
          <div className="relative">
          <button
            className="relative inline-flex items-center justify-center w-10 h-10 rounded-full border border-amber-200 bg-white hover:bg-amber-50 dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10"
            onClick={() => setOpen((v) => !v)}
            title="Notifications"
          >
            <Bell className="w-5 h-5 text-amber-700 dark:text-amber-300" />
            {alertCount > 0 && (
              <span className="absolute -top-1 -right-1 text-[10px] font-semibold text-white bg-red-500 rounded-full px-1.5 py-0.5">
                {alertCount > 99 ? "99+" : alertCount}
              </span>
            )}
          </button>

          {open && (
            <div className="absolute right-0 mt-3 w-80 rounded-xl shadow-lg overflow-hidden bg-white border border-amber-100 dark:bg-gray-900 dark:border-white/10">
              <div className="flex items-center justify-between px-4 py-3 border-b border-amber-100 dark:border-white/10">
                <div className="font-semibold text-gray-800 dark:text-gray-100">Notifications</div>
                <button
                  onClick={markAllRead}
                  className="text-xs text-amber-700 hover:text-amber-800 dark:text-amber-300"
                >
                  Mark all read
                </button>
              </div>
              <div className="max-h-80 overflow-auto">
                {items.length === 0 ? (
                  <div className="text-sm text-gray-500 dark:text-gray-400 p-4">No notifications</div>
                ) : (
                  items.map((n) => (
                    <div
                      key={n.id}
                      className={`px-4 py-3 border-b last:border-b-0 ${
                        n.read_at ? "bg-white dark:bg-gray-900" : "bg-amber-50 dark:bg-amber-500/10"
                      }`}
                    >
                      <div className="text-xs text-gray-500 dark:text-gray-400">{n.type}</div>
                      <div className="text-sm text-gray-800 dark:text-gray-100">{n.message}</div>
                      <div className="mt-2 flex items-center justify-between">
                        <span className="text-[11px] text-gray-400 dark:text-gray-500">
                          {new Date(n.created_at).toLocaleString()}
                        </span>
                        {!n.read_at && (
                          <button
                            onClick={() => markRead(n.id)}
                            className="text-[11px] text-amber-700 hover:text-amber-800 dark:text-amber-300"
                          >
                            Mark read
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
              <button
                onClick={() => navigate("/delivery-history")}
                className="w-full text-xs text-amber-700 py-2 bg-amber-50 hover:bg-amber-100 dark:bg-amber-500/10 dark:text-amber-300 dark:hover:bg-amber-500/20"
              >
                View delivery history
              </button>
            </div>
          )}
          </div>
        </div>
      </div>
    </header>
  );
};

export default HeaderBar;
